import test, { after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fixtureRoot = await fs.mkdtemp(path.join(tmpdir(), 'hamlog-data-safety-'));
process.env.HAMLOG_DATA_DIR = path.join(fixtureRoot, 'data');
process.env.HAMLOG_UPLOAD_DIR = path.join(fixtureRoot, 'uploads');
const { initializeDatabase } = await import('../services/db.js');
const { readPosts, writePosts } = await import('../models/postModel.js');
const { readPostDeletionIntents } = await import('../models/postDeletionModel.js');
const { recoverPendingPostDeletions } = await import('../services/postDeletionService.js');
const { readCategories } = await import('../models/categoryModel.js');
const { createComment, readComments, writeComments } = await import('../models/commentModel.js');
const { readPostRevisions } = await import('../models/revisionModel.js');
const { readPostViews } = await import('../models/postViewModel.js');
const { updateCategory, removeCategory } = await import('../services/categoryService.js');
const {
  createPostService, updatePostService, deletePostService, getTrashedPostsService,
  restoreTrashedPostService, permanentlyDeletePostService, recordPostViewService,
  restorePostRevisionService, getPostBySlugService
} = await import('../services/postService.js');
const { isPostPublicVisible } = await import('../utils/postVisibility.js');
const { runWithDataStoreLock } = await import('../utils/storeLock.js');

beforeEach(async () => {
  await fs.rm(process.env.HAMLOG_DATA_DIR, { recursive: true, force: true });
  await fs.rm(process.env.HAMLOG_UPLOAD_DIR, { recursive: true, force: true });
  await initializeDatabase();
});
after(() => fs.rm(fixtureRoot, { recursive: true, force: true }));

const create = async (slug = 'safety-fixture', category = '이전 분류') => {
  const result = await createPostService({
    title: `Fixture ${slug}`, slug, category, status: 'published',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Synthetic body' }] }] }
  });
  assert.equal(result.success, true);
  return result.data;
};

test('post updates reject missing or non-string versions before changing any stores', async () => {
  const post = await create();
  const originalPosts = await readPosts();
  const originalCategories = await readCategories();
  const originalRevisions = await readPostRevisions(post.id);
  for (const version of [undefined, null, 0, false, [], {}]) {
    const result = await updatePostService(post.id, {
      title: 'Unversioned overwrite', category: 'Must Not Be Created',
      ...(version === undefined ? {} : { expectedUpdatedAt: version })
    });
    assert.equal(result.code, 'precondition_required');
  }
  assert.deepEqual(await readPosts(), originalPosts);
  assert.deepEqual(await readCategories(), originalCategories);
  assert.deepEqual(await readPostRevisions(post.id), originalRevisions);

  const saved = await updatePostService(post.id, { title: 'Current version save', expectedUpdatedAt: post.updatedAt });
  assert.equal(saved.success, true);
  assert.notEqual(saved.data.updatedAt, post.updatedAt);
  const currentRevisions = await readPostRevisions(post.id);
  for (const expectedUpdatedAt of [post.updatedAt, '']) {
    const stale = await updatePostService(post.id, { title: 'Stale overwrite', expectedUpdatedAt });
    assert.equal(stale.code, 'edit_conflict');
  }
  assert.equal((await readPosts())[0].title, 'Current version save');
  assert.deepEqual(await readPostRevisions(post.id), currentRevisions);
});

test('a legacy post without updatedAt requires an explicit empty version and gains a version on save', async () => {
  const { updatedAt, ...legacy } = await create();
  assert.ok(updatedAt);
  await writePosts([legacy]);
  assert.equal((await updatePostService(legacy.id, { title: 'Unversioned overwrite' })).code, 'precondition_required');
  const saved = await updatePostService(legacy.id, { title: 'Confirmed legacy overwrite', expectedUpdatedAt: '' });
  assert.equal(saved.success, true);
  assert.ok(Number.isFinite(Date.parse(saved.data.updatedAt)));
  assert.equal((await updatePostService(legacy.id, { title: 'Repeated legacy overwrite', expectedUpdatedAt: '' })).code, 'edit_conflict');
  assert.equal((await readPosts())[0].title, 'Confirmed legacy overwrite');
});

for (const action of ['rename', 'delete']) {
  test(`category ${action} advances affected versions and rejects stale saves before category recreation`, async () => {
    const post = await create();
    const untouched = await create('untouched', '다른 분류');
    const future = { ...post, updatedAt: '2099-01-01T00:00:00.000Z' };
    await writePosts([future, untouched]);
    const category = (await readCategories()).find(item => item.name === post.category);
    if (action === 'rename') await updateCategory(category.id, { name: '새 분류' });
    else await removeCategory(category.id);
    const changed = (await readPosts()).find(item => item.id === post.id);
    assert.ok(Date.parse(changed.updatedAt) > Date.parse(future.updatedAt));
    assert.notEqual(changed.category, post.category);
    assert.equal((await readPosts()).find(item => item.id === untouched.id).updatedAt, untouched.updatedAt);
    const stale = await updatePostService(post.id, { category: post.category, expectedUpdatedAt: future.updatedAt });
    assert.equal(stale.code, 'edit_conflict');
    assert.ok(!(await readCategories()).some(item => item.name === post.category));
    const fresh = await updatePostService(post.id, { title: 'Fresh title', expectedUpdatedAt: changed.updatedAt });
    assert.equal(fresh.success, true);
    assert.ok(Date.parse(fresh.data.updatedAt) > Date.parse(changed.updatedAt));
  });
}

test('revision restore advances a future version monotonically', async () => {
  const post = await create();
  const [revision] = await readPostRevisions(post.id);
  const future = { ...post, updatedAt: '2099-01-01T00:00:00.000Z' };
  await writePosts([future]);
  const result = await restorePostRevisionService(post.id, revision.id, { expectedUpdatedAt: future.updatedAt });
  assert.equal(result.success, true);
  assert.ok(Date.parse(result.data.updatedAt) > Date.parse(future.updatedAt));
});

const makePurgeFixture = async () => {
  const post = await create();
  const other = await create('unrelated', '다른 분류');
  await writeComments([
    { id: 'target-comment', postId: post.id, content: 'Synthetic target comment' },
    { id: 'other-comment', postId: other.id, content: 'Synthetic unrelated comment' }
  ]);
  await recordPostViewService(post.slug);
  await recordPostViewService(other.slug);
  await deletePostService(post.id);
  const [trashed] = (await getTrashedPostsService()).data;
  return { post, other, confirmation: { expectedDeletedAt: trashed.deletedAt, confirmTitle: post.title } };
};

const injectBoundaryFailure = (context, boundary, fixture) => {
  const originalRename = fs.rename;
  const originalRm = fs.rm;
  const originalUnlink = fs.unlink;
  let indexWrites = 0;
  let failures = 0;
  const fail = () => {
    failures += 1;
    throw Object.assign(new Error(`Injected ${boundary} failure`), { code: 'EIO' });
  };
  context.mock.method(fs, 'rename', async (from, to) => {
    const target = String(to);
    if (target === path.join(process.env.HAMLOG_DATA_DIR, 'posts.json')) {
      indexWrites += 1;
      if (boundary === 'retain-marker' || (boundary === 'final-index' && indexWrites === 2)) fail();
    }
    if ((boundary === 'views' && target.endsWith('/post-views.json'))
      || (boundary === 'comments' && target.endsWith('/comments.json'))
      || (boundary === 'stale-other-file' && target.endsWith('/posts/unrelated.json'))
      || (boundary === 'intent-write' && target.includes('/post-deletions/'))) fail();
    return originalRename(from, to);
  });
  context.mock.method(fs, 'rm', async (target, options) => {
    if (boundary === 'revisions' && String(target).endsWith(`/revisions/${fixture.post.id}.json`)) fail();
    return originalRm(target, options);
  });
  context.mock.method(fs, 'unlink', async target => {
    if ((boundary === 'individual-file' && String(target).endsWith(`/posts/${fixture.post.slug}.json`))
      || (boundary === 'intent-removal' && String(target).includes('/post-deletions/') && String(target).endsWith('.json'))) fail();
    return originalUnlink(target);
  });
  syncBuiltinESMExports();
  return () => {
    context.mock.restoreAll();
    syncBuiltinESMExports();
    assert.equal(failures, 1, 'the selected cleanup boundary must actually have been exercised');
  };
};

for (const boundary of ['retain-marker', 'revisions', 'views', 'comments', 'final-index', 'stale-other-file', 'individual-file', 'intent-removal']) {
  for (const recovery of ['retry', 'restart']) {
    test(`purge survives ${boundary} EIO with ${recovery} recovery`, async context => {
      const fixture = await makePurgeFixture();
      const [revision] = await readPostRevisions(fixture.post.id);
      if (boundary === 'stale-other-file') {
        // Unchanged files are no longer rewritten, so an unrelated file is only
        // written when an earlier interrupted save left it behind the index.
        await fs.writeFile(
          path.join(process.env.HAMLOG_DATA_DIR, 'posts', 'unrelated.json'),
          JSON.stringify({ ...fixture.other, title: 'Stale individual copy' }, null, 2)
        );
      }
      const stopFailure = injectBoundaryFailure(context, boundary, fixture);
      try {
        await assert.rejects(permanentlyDeletePostService(fixture.post.id, fixture.confirmation), { code: 'EIO' });
      } finally {
        stopFailure();
      }
      const [pending] = (await getTrashedPostsService()).data;
      assert.equal(pending.id, fixture.post.id);
      assert.ok(pending.purgeRequestedAt);
      assert.equal(pending.deletedAt, fixture.confirmation.expectedDeletedAt);
      assert.equal((await readPostDeletionIntents()).length, 1);
      assert.equal(isPostPublicVisible(pending), false);
      assert.equal((await getPostBySlugService(fixture.post.slug)).code, 'not_found');
      assert.equal((await restoreTrashedPostService(fixture.post.id, fixture.confirmation)).code, 'edit_conflict');
      assert.equal((await updatePostService(fixture.post.id, { title: 'Cannot edit' })).code, 'edit_conflict');
      assert.equal((await restorePostRevisionService(fixture.post.id, revision.id, { expectedUpdatedAt: pending.updatedAt })).code, 'edit_conflict');
      assert.equal((await createPostService({ slug: fixture.post.slug, title: 'Reserved slug', status: 'draft' })).code, 'duplicate_slug');
      assert.equal((await permanentlyDeletePostService(fixture.post.id, { ...fixture.confirmation, confirmTitle: 'wrong' })).code, 'validation_error');
      assert.equal((await permanentlyDeletePostService(fixture.post.id, { ...fixture.confirmation, expectedDeletedAt: 'obsolete' })).code, 'edit_conflict');
      if (['individual-file', 'intent-removal'].includes(boundary)) {
        const index = JSON.parse(await fs.readFile(path.join(process.env.HAMLOG_DATA_DIR, 'posts.json'), 'utf8'));
        assert.ok(!index.some(post => post.id === fixture.post.id), 'index removal was committed before the injected failure');
      }
      if (boundary === 'stale-other-file') {
        const index = JSON.parse(await fs.readFile(path.join(process.env.HAMLOG_DATA_DIR, 'posts.json'), 'utf8'));
        assert.ok(index.find(post => post.id === fixture.post.id)?.purgeRequestedAt, 'the pending marker index was committed before the injected failure');
      }
      if (recovery === 'retry') {
        assert.equal((await permanentlyDeletePostService(fixture.post.id, fixture.confirmation)).success, true);
      } else {
        execFileSync(process.execPath, ['--input-type=module', '-e', 'import { initializeDatabase } from "./server/services/db.js"; await initializeDatabase();'], { env: process.env });
      }
      assert.deepEqual(await readPostDeletionIntents(), []);
      assert.deepEqual((await getTrashedPostsService()).data, []);
      assert.deepEqual((await readPosts()).map(post => post.id), [fixture.other.id]);
      assert.deepEqual(await readPostRevisions(fixture.post.id), []);
      assert.equal((await readPostViews())[fixture.post.id], undefined);
      assert.equal((await readPostViews())[fixture.other.id], 1);
      assert.deepEqual((await readComments()).map(comment => comment.id), ['other-comment']);
      await assert.rejects(fs.access(path.join(process.env.HAMLOG_DATA_DIR, 'posts', `${fixture.post.slug}.json`)), { code: 'ENOENT' });
      execFileSync(process.execPath, ['scripts/verify-data.js'], { env: process.env });
    });
  }
}

test('failure to persist deletion intent leaves recoverable trash and all auxiliary stores intact', async context => {
  const fixture = await makePurgeFixture();
  const revisions = await readPostRevisions(fixture.post.id);
  const stopFailure = injectBoundaryFailure(context, 'intent-write', fixture);
  try {
    await assert.rejects(permanentlyDeletePostService(fixture.post.id, fixture.confirmation), { code: 'EIO' });
  } finally {
    stopFailure();
  }
  assert.deepEqual(await readPostDeletionIntents(), []);
  assert.equal((await getTrashedPostsService()).data[0].purgeRequestedAt, undefined);
  assert.deepEqual(await readPostRevisions(fixture.post.id), revisions);
  assert.equal((await readPostViews())[fixture.post.id], 1);
  assert.equal((await readComments()).length, 2);
  assert.equal((await restoreTrashedPostService(fixture.post.id, fixture.confirmation)).success, true);
});

test('failed recovery retains a private retryable intent and integrity checking reports pending cleanup', async context => {
  const fixture = await makePurgeFixture();
  const stopFailure = injectBoundaryFailure(context, 'revisions', fixture);
  try {
    await assert.rejects(permanentlyDeletePostService(fixture.post.id, fixture.confirmation), { code: 'EIO' });
  } finally {
    stopFailure();
  }
  const originalRm = fs.rm;
  context.mock.method(fs, 'rm', async (target, options) => {
    if (String(target).endsWith(`/revisions/${fixture.post.id}.json`)) {
      throw Object.assign(new Error('Persistent synthetic storage failure'), { code: 'EIO' });
    }
    return originalRm(target, options);
  });
  const log = context.mock.method(console, 'error', () => {});
  syncBuiltinESMExports();
  try {
    await recoverPendingPostDeletions();
    assert.equal(log.mock.callCount(), 1);
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal((await readPostDeletionIntents()).length, 1);
  assert.equal((await restoreTrashedPostService(fixture.post.id, fixture.confirmation)).code, 'edit_conflict');
  assert.throws(
    () => execFileSync(process.execPath, ['scripts/verify-data.js'], { env: process.env, stdio: 'pipe' }),
    error => error.status === 1 && String(error.stderr).includes('영구삭제 정리 대기')
  );
  assert.equal((await permanentlyDeletePostService(fixture.post.id, fixture.confirmation)).success, true);
});

test('rebuilding a missing index cannot expose or lose a pending deletion intent', async context => {
  const fixture = await makePurgeFixture();
  const stopFailure = injectBoundaryFailure(context, 'individual-file', fixture);
  try {
    await assert.rejects(permanentlyDeletePostService(fixture.post.id, fixture.confirmation), { code: 'EIO' });
  } finally {
    stopFailure();
  }
  await fs.unlink(path.join(process.env.HAMLOG_DATA_DIR, 'posts.json'));
  assert.equal((await readPosts()).find(post => post.id === fixture.post.id)?.purgeRequestedAt !== undefined, true);
  assert.equal((await getPostBySlugService(fixture.post.slug)).code, 'not_found');
  execFileSync(process.execPath, ['--input-type=module', '-e', 'import { initializeDatabase } from "./server/services/db.js"; await initializeDatabase();'], { env: process.env });
  assert.deepEqual(await readPostDeletionIntents(), []);
  assert.deepEqual((await readPosts()).map(post => post.id), [fixture.other.id]);
  execFileSync(process.execPath, ['scripts/verify-data.js'], { env: process.env });
});

test('pending marker is server-owned and malformed markers fail closed even without deletedAt', async () => {
  const result = await createPostService({ slug: 'marker-input', title: 'Synthetic', status: 'draft', purgeRequestedAt: '2026-01-01' });
  assert.equal(result.data.purgeRequestedAt, undefined);
  const changed = await updatePostService(result.data.id, { purgeRequestedAt: '2026-01-01', expectedUpdatedAt: result.data.updatedAt });
  assert.equal(changed.data.purgeRequestedAt, undefined);
  for (const purgeRequestedAt of [null, '', 'invalid']) {
    assert.equal(isPostPublicVisible({ status: 'published', purgeRequestedAt }), false);
  }
});

test('a malformed string trash token stays private and can still be permanently deleted', async () => {
  const post = await create();
  await writePosts([{ ...post, deletedAt: '' }]);
  assert.equal((await getPostBySlugService(post.slug)).code, 'not_found');
  const result = await permanentlyDeletePostService(post.id, { expectedDeletedAt: '', confirmTitle: post.title });
  assert.equal(result.success, true);
  assert.deepEqual(await readPosts(), []);
  assert.deepEqual(await readPostDeletionIntents(), []);
});

test('comment insertion queued behind deletion rechecks visibility inside the mutation lock', async () => {
  const fixture = await makePurgeFixture();
  // Hold the queue while both mutations arrive; no timing-based sleeps required.
  const gate = Promise.withResolvers();
  const held = runWithDataStoreLock(() => gate.promise);
  const purge = permanentlyDeletePostService(fixture.post.id, fixture.confirmation);
  const comment = createComment({ postId: fixture.post.id, author: 'Synthetic', password: 'pw', content: 'Queued comment' });
  gate.resolve();
  await held;
  assert.equal((await purge).success, true);
  assert.equal(await comment, null);
  assert.deepEqual((await readComments()).map(item => item.id), ['other-comment']);
});

after(() => {
  mock.restoreAll();
  syncBuiltinESMExports();
});
