import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const setupScriptPath = fileURLToPath(new URL('../../scripts/setup-server.sh', import.meta.url));

const runSetupScript = ({ env, input }) => new Promise((resolve, reject) => {
  const child = spawn('bash', [setupScriptPath], {
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  const timeout = setTimeout(() => {
    child.kill('SIGKILL');
    reject(new Error('setup-server.sh test timed out'));
  }, 10_000);

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', error => {
    clearTimeout(timeout);
    reject(error);
  });
  child.on('close', (code, signal) => {
    clearTimeout(timeout);
    resolve({ code, signal, stdout, stderr });
  });
  child.stdin.end(input);
});

test('setup script is valid Bash and arms recovery before container cutover', async () => {
  await execFileAsync('bash', ['-n', setupScriptPath]);
  const source = await readFile(setupScriptPath, 'utf8');

  const armIndex = source.indexOf("trap 'handle_deploy_exit' EXIT");
  const backupIndex = source.indexOf('bash "$SCRIPT_DIR/backup-data.sh"');
  const stopIndex = source.indexOf('docker stop "$APP_NAME"');
  const commitIndex = source.indexOf('DEPLOYMENT_COMMITTED=true');
  const disarmIndex = source.indexOf('trap - EXIT TERM HUP INT', commitIndex);
  const cleanupIndex = source.indexOf('docker rm "$ROLLBACK_NAME"', disarmIndex);

  assert.ok(backupIndex > 0 && backupIndex < armIndex);
  assert.ok(armIndex > backupIndex && armIndex < stopIndex);
  assert.ok(commitIndex > stopIndex && disarmIndex > commitIndex);
  assert.ok(cleanupIndex > disarmIndex);
  assert.match(source, /handle_deploy_signal TERM 143/);
  assert.match(source, /handle_deploy_signal HUP 129/);
  assert.match(source, /handle_deploy_signal INT 130/);
  assert.match(source, /trap - EXIT\n\s+trap '' TERM HUP INT/);
  // No hard-coded owner: a deleted account name could be re-registered by someone else.
  assert.doesNotMatch(source, /hyeonwo-o/);
  assert.match(source, /remote get-url origin/);
  assert.match(source, /HAMLOG_IMAGE:-\$\{LEGACY_IMAGE_OVERRIDE/);
  assert.match(source, /BACKUP_RETENTION_DAYS="\$\{BACKUP_RETENTION_DAYS:-30\}"/);
  assert.match(source, /HAMLOG_CONTAINER_NAME="\$APP_NAME"/);
  assert.match(source, /HAMLOG_VERIFY_DATA=true/);
});

test('setup script restores the preserved container when replacement preparation fails', async () => {
  const testRoot = await mkdtemp(path.join(tmpdir(), 'hamlog-setup-test-'));
  const fakeBin = path.join(testRoot, 'bin');
  const stateDir = path.join(testRoot, 'state');
  const dockerLog = path.join(testRoot, 'docker.log');
  const backupDir = path.join(testRoot, 'custom-backups');
  const fakeDocker = path.join(fakeBin, 'docker');

  try {
    await mkdir(fakeBin, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    await mkdir(path.join(testRoot, 'hamlog-data', 'data', 'posts'), { recursive: true });
    await mkdir(path.join(testRoot, 'hamlog-data', 'uploads'), { recursive: true });
    await writeFile(path.join(testRoot, 'hamlog-data', 'data', 'posts.json'), '[]');
    await writeFile(path.join(stateDir, 'old-name'), 'hamlog');
    await writeFile(path.join(stateDir, 'old-running'), 'true');
    await writeFile(path.join(stateDir, 'new-exists'), 'false');
    await writeFile(fakeDocker, `#!/usr/bin/env bash
set -e
printf '%s\\n' "$*" >> "$DOCKER_ARGS_LOG"
state="$DOCKER_STATE_DIR"
old_id='old-container-id'
old_image='sha256:old-image'

read_state() { cat "$state/$1"; }
write_state() { printf '%s' "$2" > "$state/$1"; }

inspect_container() {
  local target="$1"
  local format="$2"
  local old_name
  local selected=''
  old_name="$(read_state old-name)"

  if [ "$target" = "$old_id" ] || [ "$target" = "$old_name" ]; then
    selected='old'
  elif [ "$target" = 'hamlog' ] && [ "$(read_state new-exists)" = 'true' ]; then
    selected='new'
  else
    return 1
  fi

  case "$format" in
    '{{.Id}}') [ "$selected" = 'old' ] && printf '%s\\n' "$old_id" || printf '%s\\n' 'new-container-id' ;;
    '{{.Image}}') [ "$selected" = 'old' ] && printf '%s\\n' "$old_image" || printf '%s\\n' 'sha256:new-image' ;;
    '{{.Config.User}}') [ "$selected" = 'old' ] && printf '%s\\n' 'root' || printf '%s\\n' 'node' ;;
    '{{.Name}}') [ "$selected" = 'old' ] && printf '/%s\\n' "$old_name" || printf '%s\\n' '/hamlog' ;;
    '{{.State.Running}}') [ "$selected" = 'old' ] && read_state old-running || printf '%s' 'true' ;;
    '{{.State.Paused}}') printf '%s' 'false' ;;
  esac
}

command="$1"
shift
case "$command" in
  login)
    cat >/dev/null
    ;;
  pull)
    ;;
  image)
    # docker image inspect --format=... IMAGE
    printf '%s\\n' 'node'
    ;;
  inspect)
    format=''
    target="\${!#}"
    for argument in "$@"; do
      case "$argument" in
        --format=*) format="\${argument#--format=}" ;;
      esac
    done
    inspect_container "$target" "$format"
    ;;
  stop)
    if [ "$1" = "$(read_state old-name)" ]; then
      write_state old-running false
    fi
    ;;
  rename)
    source_name="$1"
    destination_name="$2"
    if [ "$source_name" = "$old_id" ] || [ "$source_name" = "$(read_state old-name)" ]; then
      write_state old-name "$destination_name"
    else
      exit 1
    fi
    ;;
  run)
    if [[ " $* " == *' --rm '* ]]; then
      if [[ " $* " == *" $HAMLOG_TEST_NEW_IMAGE "* ]]; then
        exit 42
      fi
      exit 0
    fi
    write_state new-exists true
    printf '%s\\n' 'new-container-id'
    ;;
  rm)
    target="\${!#}"
    if [ "$target" = 'hamlog' ] && [ "$(read_state new-exists)" = 'true' ]; then
      write_state new-exists false
    elif [ "$target" = "$(read_state old-name)" ] || [ "$target" = "$old_id" ]; then
      write_state old-name removed
      write_state old-running false
    fi
    ;;
  start)
    if [ "$1" = "$old_id" ] || [ "$1" = "$(read_state old-name)" ]; then
      write_state old-running true
    fi
    ;;
  pause|unpause)
    ;;
  exec)
    if [ "$2" != 'hamlog' ] && [ "$1" != 'hamlog' ]; then
      exit 1
    fi
    ;;
  logs)
    ;;
esac
`, 'utf8');
    await chmod(fakeDocker, 0o755);

    const newImage = 'ghcr.io/test-owner/test-repo:release';
    const result = await runSetupScript({
      env: {
        ...process.env,
        HOME: testRoot,
        PATH: `${fakeBin}:${process.env.PATH}`,
        DOCKER_ARGS_LOG: dockerLog,
        DOCKER_STATE_DIR: stateDir,
        HAMLOG_IMAGE: newImage,
        HAMLOG_TEST_NEW_IMAGE: newImage,
        HAMLOG_BACKUP_DIR: backupDir,
        HAMLOG_ALLOW_EMPTY_BACKUP: 'false'
      },
      input: 'tester\nregistry-token\nadmin-password\njwt-secret\n\n0\nauto\nauto\n'
    });

    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.match(result.stderr, /Previous container restored/);
    assert.equal(await readFile(path.join(stateDir, 'old-name'), 'utf8'), 'hamlog');
    assert.equal(await readFile(path.join(stateDir, 'old-running'), 'utf8'), 'true');
    assert.equal(await readFile(path.join(stateDir, 'new-exists'), 'utf8'), 'false');

    const backups = await readdir(backupDir);
    assert.equal(backups.filter(file => file.endsWith('.tar.gz')).length, 1);
    assert.equal(backups.filter(file => file.endsWith('.tar.gz.sha256')).length, 1);

    const calls = await readFile(dockerLog, 'utf8');
    assert.match(calls, new RegExp(`pull ${newImage}`));
    assert.match(calls, /rename hamlog hamlog-rollback-/);
    assert.match(calls, /rename old-container-id hamlog/);
    assert.match(calls, /start hamlog/);
    assert.ok(calls.indexOf('pause hamlog') < calls.indexOf('stop hamlog'));
    assert.ok(calls.indexOf('unpause hamlog') < calls.indexOf('stop hamlog'));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test('setup script leaves the current container running when backup fails', async () => {
  const testRoot = await mkdtemp(path.join(tmpdir(), 'hamlog-setup-backup-failure-test-'));
  const fakeBin = path.join(testRoot, 'bin');
  const dockerLog = path.join(testRoot, 'docker.log');
  const fakeDocker = path.join(fakeBin, 'docker');

  try {
    await mkdir(fakeBin, { recursive: true });
    await writeFile(fakeDocker, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$DOCKER_ARGS_LOG"
command="$1"
shift

case "$command" in
  login)
    cat >/dev/null
    ;;
  pull)
    ;;
  image)
    printf '%s\\n' 'node'
    ;;
  inspect)
    target="\${!#}"
    if [[ "$target" == hamlog-rollback-* ]]; then
      exit 1
    fi
    if [ "$target" != 'hamlog' ]; then
      exit 1
    fi
    case "$*" in
      *'{{.Id}}'*) printf '%s\\n' 'old-container-id' ;;
      *'{{.Image}}'*) printf '%s\\n' 'sha256:old-image' ;;
      *'{{.Config.User}}'*) printf '%s\\n' 'root' ;;
    esac
    ;;
esac
`, 'utf8');
    await chmod(fakeDocker, 0o755);

    const result = await runSetupScript({
      env: {
        ...process.env,
        HOME: testRoot,
        PATH: `${fakeBin}:${process.env.PATH}`,
        DOCKER_ARGS_LOG: dockerLog,
        HAMLOG_IMAGE: 'ghcr.io/test-owner/test-repo:release',
        HAMLOG_ALLOW_EMPTY_BACKUP: 'false'
      },
      input: 'tester\nregistry-token\nadmin-password\njwt-secret\n\n0\nauto\nauto\n'
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /refusing to create an empty backup/);

    const calls = await readFile(dockerLog, 'utf8');
    assert.doesNotMatch(calls, /^stop hamlog$/m);
    assert.doesNotMatch(calls, /^rename hamlog /m);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test('setup script refuses to guess an image without a configured repository', async () => {
  const testRoot = await mkdtemp(path.join(tmpdir(), 'hamlog-setup-image-'));
  try {
    // A copy outside any git checkout has no origin remote to read the repository from.
    const isolatedScript = path.join(testRoot, 'scripts', 'setup-server.sh');
    await mkdir(path.dirname(isolatedScript), { recursive: true });
    await writeFile(isolatedScript, await readFile(setupScriptPath, 'utf8'));
    const env = { ...process.env, HOME: testRoot, GIT_CEILING_DIRECTORIES: testRoot };
    for (const name of ['HAMLOG_IMAGE', 'IMAGE_NAME', 'HAMLOG_GITHUB_REPOSITORY', 'GITHUB_REPOSITORY']) {
      delete env[name];
    }

    const result = await execFileAsync('bash', [isolatedScript], { env }).then(
      () => ({ code: 0, stderr: '' }),
      (error) => ({ code: error.code, stderr: error.stderr })
    );

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Set HAMLOG_IMAGE or HAMLOG_GITHUB_REPOSITORY/);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});
