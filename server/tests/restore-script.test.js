import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const execFileAsync = promisify(execFile);
const rootDir = fileURLToPath(new URL('../../', import.meta.url));
const restoreScript = path.join(rootDir, 'scripts/restore-data.sh');
const post = {
  id: 'restored-post', slug: 'restored-post', title: 'Restored post',
  contentHtml: '<p>Preserved content</p>', status: 'published',
  publishedAt: '2026-10-01', updatedAt: '2026-10-01T01:00:00.000Z'
};

async function checksum(archive) {
  const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(`${archive}.sha256`, `${hash}  ${path.basename(archive)}\n`);
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'hamlog-restore-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  for (const directory of [source, target]) {
    await mkdir(path.join(directory, 'data/posts'), { recursive: true });
    await mkdir(path.join(directory, 'uploads'), { recursive: true });
    await writeFile(path.join(directory, 'data/posts.json'), JSON.stringify([post]));
    await writeFile(path.join(directory, 'data/posts/restored-post.json'), JSON.stringify(post));
  }
  await writeFile(path.join(source, 'uploads/cover.txt'), 'backup image');
  await writeFile(path.join(target, 'uploads/cover.txt'), 'current image');
  await writeFile(path.join(target, 'uploads/later.txt'), 'newer image');
  await mkdir(path.join(target, 'data/post-deletions'));
  const intentFile = `${createHash('sha256').update(post.id).digest('hex')}.json`;
  await writeFile(path.join(target, 'data/post-deletions', intentFile), JSON.stringify({
    ...post, status: 'draft', deletedAt: '2026-10-01T02:00:00.000Z',
    purgeRequestedAt: '2026-10-01T03:00:00.000Z'
  }));
  await writeFile(path.join(target, 'data/posts/newer.json'), JSON.stringify({ ...post, id: 'newer', slug: 'newer' }));
  await mkdir(path.join(target, 'data/revisions'));
  await writeFile(path.join(target, 'data/revisions/newer.json'), '[]');
  const backups = path.join(root, 'backups');
  await execFileAsync('bash', [path.join(rootDir, 'scripts/backup-data.sh'), source, backups], {
    env: {
      ...process.env, HAMLOG_CONTAINER_NAME: '', HAMLOG_DATA_DIR: path.join(source, 'data'),
      HAMLOG_VERIFY_DATA: 'true', HAMLOG_ALLOW_EMPTY_BACKUP: 'false', HAMLOG_BACKUP_HOOK: ''
    }
  });
  const archive = path.join(backups, (await readdir(backups)).find(file => file.endsWith('.tar.gz')));
  return { root, source, target, archive, intentFile };
}

function restoreEnv(extra = {}) {
  return { ...process.env, HAMLOG_CONTAINER_NAME: '', ...extra };
}

async function assertOriginal(target, intentFile) {
  assert.equal(await readFile(path.join(target, 'uploads/cover.txt'), 'utf8'), 'current image');
  assert.equal(await readFile(path.join(target, 'uploads/later.txt'), 'utf8'), 'newer image');
  assert.deepEqual(JSON.parse(await readFile(path.join(target, 'data/posts.json'), 'utf8')), [post]);
  assert.ok((await readdir(path.join(target, 'data/post-deletions'))).includes(intentFile));
}

async function mockDocker(f, extra = {}) {
  const bin = path.join(f.root, 'bin');
  const state = path.join(f.root, 'running');
  const count = path.join(f.root, 'starts');
  const log = path.join(f.root, 'docker.log');
  await mkdir(bin);
  await writeFile(state, 'true');
  await writeFile(count, '0');
  await writeFile(path.join(f.root, 'helper-count'), '0');
  await writeFile(path.join(bin, 'docker'), `#!/usr/bin/env bash
set -e
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$1" in
  inspect)
    if [ -f "$HELPER_ROOT/id" ] && [ "\${@: -1}" = "$(cat "$HELPER_ROOT/id")" ]; then
      case "$*" in
        *State.Running*) cat "$HELPER_ROOT/running" ;;
        *State.ExitCode*) cat "$HELPER_ROOT/exit-code" ;;
        *) exit 1 ;;
      esac
      exit 0
    fi
    case "$*" in
      *State.Running*)
        if [ "\${MOCK_FAIL_INSPECT:-false}" = true ]; then exit 1; fi
        cat "$RUNNING_FILE" ;;
      *State.Paused*) printf '%s\\n' "\${MOCK_PAUSED:-false}" ;;
      *Config.User*) printf '%s\\n' node ;;
      *.Image*) printf '%s\\n' sha256:test-image ;;
      *.Mounts*)
        printf '%s\\t%s\\n' "\${MOCK_MOUNT_ROOT:-$TARGET_ROOT}/data" /app/server/data
        printf '%s\\t%s\\n' "$TARGET_ROOT/uploads" /app/server/uploads ;;
      *) exit 1 ;;
    esac ;;
  run)
    if [[ "$*" == *'--entrypoint node'* ]]; then
      for argument in "$@"; do
        case "$argument" in *:/app/server/data:ro) verified_data="\${argument%:/app/server/data:ro}" ;; esac
      done
      HAMLOG_DATA_DIR="$verified_data" HAMLOG_REQUIRE_DATA=true "$REAL_NODE" "$VERIFIER_PATH"
    fi ;;
  create)
    mkdir -p "$HELPER_ROOT"
    count=$(cat "$HELPER_COUNT_FILE")
    count=$((count + 1))
    printf '%s' "$count" > "$HELPER_COUNT_FILE"
    printf '%064x' "$count" > "$HELPER_ROOT/id"
    printf '%s' "\${@: -2:1}" > "$HELPER_ROOT/from"
    printf '%s' "\${@: -1}" > "$HELPER_ROOT/to"
    printf '%s' false > "$HELPER_ROOT/running"
    printf '%s' 0 > "$HELPER_ROOT/exit-code"
    cat "$HELPER_ROOT/id" ;;
  ps)
    if [ -f "$HELPER_ROOT/id" ]; then cat "$HELPER_ROOT/id"; fi ;;
  rm)
    if [ -f "$HELPER_ROOT/pid" ]; then kill -TERM "$(cat "$HELPER_ROOT/pid")" 2>/dev/null || true; fi
    rm -rf "$HELPER_ROOT" ;;
  stop) printf '%s' false > "$RUNNING_FILE" ;;
  start)
    if [ "$2" = --attach ]; then
      [ "$3" = "$(cat "$HELPER_ROOT/id")" ]
      source_path=$(cat "$HELPER_ROOT/from")
      destination_path=$(cat "$HELPER_ROOT/to")
      source_path="$TARGET_ROOT\${source_path#/restore}"
      destination_path="$TARGET_ROOT\${destination_path#/restore}"
      printf '%s' true > "$HELPER_ROOT/running"
      if [ "\${MOCK_FAIL_MOVE:-false}" = true ] && [[ "$source_path" == */payload/uploads ]]; then
        printf '%s' 1 > "$HELPER_ROOT/exit-code"
        printf '%s' false > "$HELPER_ROOT/running"
        exit 0
      fi
      if [ "\${MOCK_PENDING_MOVE:-false}" = true ] && [[ "$source_path" == */payload/data ]]; then
        "$REAL_NODE" -e "setTimeout(() => require('node:fs').renameSync(process.argv[1], process.argv[2]), 10000)" "$source_path" "$destination_path" &
        printf '%s' "$!" > "$HELPER_ROOT/pid"
        kill -TERM "$PPID"
        exit 1
      fi
      "$REAL_NODE" -e "require('node:fs').renameSync(process.argv[1], process.argv[2])" "$source_path" "$destination_path"
      printf '%s' false > "$HELPER_ROOT/running"
      if [ "\${MOCK_SIGNAL_MOVE:-false}" = true ] && [[ "$source_path" == */payload/data ]]; then kill -TERM "$PPID"; fi
      exit 0
    fi
    starts=$(cat "$STARTS_FILE")
    starts=$((starts + 1))
    printf '%s' "$starts" > "$STARTS_FILE"
    if [ "\${MOCK_FAIL_START:-false}" = true ] && [ "$starts" = 1 ]; then exit 1; fi
    printf '%s' true > "$RUNNING_FILE" ;;
  exec)
    if [ "\${MOCK_FAIL_HEALTH:-false}" = true ]; then exit 1; fi
    exit 0 ;;
  *) exit 1 ;;
esac
`);
  await chmod(path.join(bin, 'docker'), 0o755);
  return {
    env: restoreEnv({
      PATH: `${bin}:${process.env.PATH}`, HAMLOG_CONTAINER_NAME: 'hamlog-test',
      TARGET_ROOT: f.target, DOCKER_LOG: log, RUNNING_FILE: state, STARTS_FILE: count,
      REAL_NODE: process.execPath, VERIFIER_PATH: path.join(rootDir, 'scripts/verify-data.js'),
      HELPER_ROOT: path.join(f.root, 'helper'), HELPER_COUNT_FILE: path.join(f.root, 'helper-count'), ...extra
    }), bin, state, log
  };
}

test('restore replaces the complete snapshot and retains originals without replaying newer deletion intents', async t => {
  const f = await fixture(t);
  const result = await execFileAsync('bash', [restoreScript, f.archive, f.target], { env: restoreEnv() });
  const preserved = result.stdout.match(/Original data retained at: (.+)/)?.[1];
  assert.ok(preserved);
  await assertOriginal(preserved, f.intentFile);
  assert.equal(await readFile(path.join(f.target, 'uploads/cover.txt'), 'utf8'), 'backup image');
  await assert.rejects(readFile(path.join(f.target, 'uploads/later.txt')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(f.target, 'data/posts/newer.json')), { code: 'ENOENT' });
  await assert.rejects(readdir(path.join(f.target, 'data/post-deletions')), { code: 'ENOENT' });
  await assert.rejects(readdir(path.join(f.target, 'data/revisions')), { code: 'ENOENT' });
  // Exercise the real startup recovery which deleted restored posts with the
  // previous README's overlay extraction procedure.
  await execFileAsync(process.execPath, ['--input-type=module', '-e',
    "const { initializeDatabase } = await import('./server/services/db.js'); await initializeDatabase();"
  ], {
    cwd: rootDir,
    env: restoreEnv({
      HAMLOG_DATA_DIR: path.join(f.target, 'data'), HAMLOG_UPLOAD_DIR: path.join(f.target, 'uploads'),
      NODE_ENV: 'test', JWT_SECRET: 'restore-test-secret', ADMIN_PASSWORD: 'restore-test-password'
    })
  });
  const restored = JSON.parse(await readFile(path.join(f.target, 'data/posts.json'), 'utf8'));
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, post.id);
  assert.ok(await readFile(path.join(f.target, 'data/posts/restored-post.json')));
});

test('restore supports Korean slugs and upload names containing spaces', async t => {
  const f = await fixture(t);
  const koreanPost = { ...post, id: 'korean-post', slug: '한글 글', title: '한글 제목' };
  await writeFile(path.join(f.source, 'data/posts.json'), JSON.stringify([post, koreanPost]));
  await writeFile(path.join(f.source, 'data/posts/한글 글.json'), JSON.stringify(koreanPost));
  await writeFile(path.join(f.source, 'uploads/한글 이미지 파일.txt'), '한글 이미지');
  await execFileAsync('tar', ['-czf', f.archive, '-C', f.source, 'data', 'uploads']);
  await checksum(f.archive);
  await execFileAsync('bash', [restoreScript, f.archive, f.target], { env: restoreEnv() });
  assert.deepEqual(JSON.parse(await readFile(path.join(f.target, 'data/posts/한글 글.json'), 'utf8')), koreanPost);
  assert.equal(await readFile(path.join(f.target, 'uploads/한글 이미지 파일.txt'), 'utf8'), '한글 이미지');
});

test('checksum and data integrity failures leave original data and running container untouched', async t => {
  for (const failure of ['checksum', 'integrity']) {
    await t.test(failure, async child => {
      const f = await fixture(child);
      const docker = await mockDocker(f);
      if (failure === 'checksum') {
        await writeFile(`${f.archive}.sha256`, `${'0'.repeat(64)}  ${path.basename(f.archive)}\n`);
      } else {
        await writeFile(path.join(f.source, 'data/posts.json'), '{');
        await execFileAsync('tar', ['-czf', f.archive, '-C', f.source, 'data', 'uploads']);
        await checksum(f.archive);
      }
      await assert.rejects(execFileAsync('bash', [restoreScript, f.archive, f.target], { env: docker.env }));
      await assertOriginal(f.target, f.intentFile);
      assert.equal(await readFile(docker.state, 'utf8'), 'true');
      const log = await readFile(docker.log, 'utf8').catch(() => '');
      assert.doesNotMatch(log, /^stop /m);
      assert.deepEqual((await readdir(f.target)).sort(), ['data', 'uploads']);
    });
  }
});

function tarMember(name, type = '0', content = '', link = '') {
  const body = Buffer.from(content);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  for (const [offset, length, value] of [[100, 8, 0o750], [108, 8, 0], [116, 8, 0], [124, 12, body.length], [136, 12, 1]]) {
    header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length);
  }
  header.fill(32, 148, 156);
  header.write(type, 156);
  header.write(link, 157, 100);
  header.write('ustar\0', 257);
  header.write('00', 263);
  const sum = header.reduce((total, value) => total + value, 0);
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)]);
}

test('restore rejects traversal, links, special files and duplicate archive members before extraction', async t => {
  const cases = [
    ['traversal', tarMember('../escaped.txt', '0', 'escaped')],
    ['absolute path', tarMember('/tmp/hamlog-restore-escaped.txt', '0', 'escaped')],
    ['symlink', tarMember('data/link', '2', '', '../../outside')],
    ['hardlink', tarMember('data/link', '1', '', '../outside')],
    ['special file', tarMember('data/fifo', '6')],
    ['duplicate', tarMember('data/', '5')]
  ];
  for (const [label, member] of cases) {
    await t.test(label, async child => {
      const f = await fixture(child);
      const contents = Buffer.concat([tarMember('data/', '5'), tarMember('uploads/', '5'), member, Buffer.alloc(1024)]);
      await writeFile(f.archive, gzipSync(contents));
      await checksum(f.archive);
      await assert.rejects(execFileAsync('bash', [restoreScript, f.archive, f.target], { env: restoreEnv() }), /Archive|archive|Unsafe/);
      await assertOriginal(f.target, f.intentFile);
      await assert.rejects(readFile(path.join(f.target, 'escaped.txt')), { code: 'ENOENT' });
      assert.deepEqual((await readdir(f.target)).sort(), ['data', 'uploads']);
    });
  }
});

test('running container is stopped only after validation and restarted after complete replacement', async t => {
  const f = await fixture(t);
  const docker = await mockDocker(f);
  const result = await execFileAsync('bash', [restoreScript, f.archive, f.target], { env: docker.env });
  const log = await readFile(docker.log, 'utf8');
  assert.ok(log.indexOf('run --rm') < log.indexOf('stop hamlog-test'));
  assert.ok(log.indexOf('stop hamlog-test') < log.indexOf('start hamlog-test'));
  assert.ok(log.indexOf('start hamlog-test') < log.indexOf('exec hamlog-test'));
  assert.equal(await readFile(docker.state, 'utf8'), 'true');
  assert.equal(await readFile(path.join(f.target, 'uploads/cover.txt'), 'utf8'), 'backup image');
  await assertOriginal(result.stdout.match(/Original data retained at: (.+)/)[1], f.intentFile);
});

test('restore verifies using the container image when the host has no Node.js', async t => {
  const f = await fixture(t);
  const docker = await mockDocker(f);
  // Provide the host's existing shell/core tools but deliberately omit node.
  for (const command of ['bash', 'cat', 'chmod', 'cp', 'gzip', 'id', 'mkdir', 'mktemp', 'realpath', 'rm', 'rmdir', 'sha256sum', 'tar', 'basename', 'dirname']) {
    const executable = (await execFileAsync('sh', ['-c', `command -v ${command}`])).stdout.trim();
    await symlink(executable, path.join(docker.bin, command));
  }
  const result = await execFileAsync('bash', [restoreScript, f.archive, f.target], { env: { ...docker.env, PATH: docker.bin } });
  // Older bash tolerates `cd ""` after a missing tool, so require every tool to resolve.
  assert.doesNotMatch(result.stderr, /command not found/);
  assert.match(await readFile(docker.log, 'utf8'), /--entrypoint node .* \/verify-data.js/);
  assert.equal(await readFile(path.join(f.target, 'uploads/cover.txt'), 'utf8'), 'backup image');
});

test('failed restart restores both original directories and previous running state', async t => {
  const f = await fixture(t);
  const docker = await mockDocker(f, { MOCK_FAIL_START: 'true' });
  await assert.rejects(execFileAsync('bash', [restoreScript, f.archive, f.target], { env: docker.env }), /Original directories and previous container state restored/);
  await assertOriginal(f.target, f.intentFile);
  assert.equal(await readFile(docker.state, 'utf8'), 'true');
  assert.equal((await readFile(docker.log, 'utf8')).match(/^start hamlog-test$/gm).length, 2);
});

test('failed health checks stop the replacement before recovering original data', async t => {
  const f = await fixture(t);
  const docker = await mockDocker(f, { MOCK_FAIL_HEALTH: 'true' });
  await writeFile(path.join(docker.bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
  await chmod(path.join(docker.bin, 'sleep'), 0o755);
  await assert.rejects(execFileAsync('bash', [restoreScript, f.archive, f.target], { env: docker.env }), /Original directories and previous container state restored/);
  await assertOriginal(f.target, f.intentFile);
  assert.equal(await readFile(docker.state, 'utf8'), 'true');
  const log = await readFile(docker.log, 'utf8');
  assert.equal(log.match(/^exec hamlog-test /gm).length, 20);
  assert.equal(log.match(/^stop hamlog-test$/gm).length, 2);
});

test('a stopped container remains stopped after restoration', async t => {
  const f = await fixture(t);
  const docker = await mockDocker(f);
  await writeFile(docker.state, 'false');
  await execFileAsync('bash', [restoreScript, f.archive, f.target], { env: docker.env });
  assert.equal(await readFile(docker.state, 'utf8'), 'false');
  assert.doesNotMatch(await readFile(docker.log, 'utf8'), /^(stop|start) hamlog-test$/m);
  assert.equal(await readFile(path.join(f.target, 'uploads/cover.txt'), 'utf8'), 'backup image');
});

test('failed move and interruption during cutover restore the entire original snapshot', async t => {
  for (const failure of ['move', 'signal', 'pending helper']) {
    await t.test(failure, async child => {
      const f = await fixture(child);
      const docker = await mockDocker(f, {
        MOCK_FAIL_MOVE: String(failure === 'move'), MOCK_SIGNAL_MOVE: String(failure === 'signal'),
        MOCK_PENDING_MOVE: String(failure === 'pending helper')
      });
      await assert.rejects(execFileAsync('bash', [restoreScript, f.archive, f.target], {
        env: docker.env
      }), /Original directories and previous container state restored/);
      await assertOriginal(f.target, f.intentFile);
      assert.equal(await readFile(docker.state, 'utf8'), 'true');
      await assert.rejects(readdir(path.join(f.target, '.hamlog-restore-lock')), { code: 'ENOENT' });
      await assert.rejects(readdir(path.join(f.root, 'helper')), { code: 'ENOENT' });
    });
  }
});

test('restore refuses paused containers, mismatched mounts and unknown running state without stopping it', async t => {
  for (const extra of [{ MOCK_PAUSED: 'true' }, { MOCK_MOUNT_ROOT: '/different/data-root' }, { MOCK_FAIL_INSPECT: 'true' }]) {
    await t.test(JSON.stringify(extra), async child => {
      const f = await fixture(child);
      const docker = await mockDocker(f, extra);
      await assert.rejects(execFileAsync('bash', [restoreScript, f.archive, f.target], { env: docker.env }));
      await assertOriginal(f.target, f.intentFile);
      assert.doesNotMatch(await readFile(docker.log, 'utf8'), /^stop /m);
    });
  }
});
