import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const deployScriptPath = fileURLToPath(new URL('../../scripts/server-deploy.sh', import.meta.url));
const installScriptPath = fileURLToPath(new URL('../../scripts/install-server-agent.sh', import.meta.url));

// Fake Docker state: the original container ("old") can be renamed, stopped,
// restarted, or removed; a replacement ("new") exists after `run -d`.
const fakeDockerSource = `#!/usr/bin/env bash
set -e
printf '%s\\n' "$*" >> "$DOCKER_ARGS_LOG"
state="$DOCKER_STATE_DIR"
read_state() { cat "$state/$1"; }
write_state() { printf '%s' "$2" > "$state/$1"; }

format=''
for argument in "$@"; do
  case "$argument" in
    --format=*) format="\${argument#--format=}" ;;
  esac
done

inspect_container() {
  local target="$1"
  local selected=''
  if [ "$target" = 'hamlog' ] && [ "$(read_state new-exists)" = 'true' ]; then
    selected='new'
  elif [ "$target" = "$(read_state old-name)" ]; then
    selected='old'
  else
    return 1
  fi
  case "$format" in
    '{{.Image}}') [ "$selected" = 'old' ] && printf '%s\\n' 'sha256:old' || printf '%s\\n' "$FAKE_PULLED_ID" ;;
    '{{.Config.Image}}') printf '%s\\n' 'ghcr.io/test/hamlog:previous' ;;
    '{{.Config.User}}') printf '%s\\n' 'node' ;;
    '{{.State.Running}}') [ "$selected" = 'old' ] && read_state old-running || printf '%s\\n' 'true' ;;
    '{{.State.Paused}}') printf '%s\\n' 'false' ;;
  esac
}

command="$1"
shift
case "$command" in
  pull) ;;
  image)
    if [ "$1" = 'inspect' ]; then
      case "$format" in
        '{{.Id}}') printf '%s\\n' "$FAKE_PULLED_ID" ;;
        '{{.Config.User}}') printf '%s\\n' 'node' ;;
        *Labels*) printf '%s\\n' "$FAKE_REVISION" ;;
      esac
    fi
    ;;
  inspect) inspect_container "\${!#}" ;;
  stop)
    [ "$1" = "$(read_state old-name)" ] && write_state old-running false
    ;;
  rename)
    if [ "$1" = "$(read_state old-name)" ]; then write_state old-name "$2"; else exit 1; fi
    ;;
  run)
    if [[ " $* " == *' --rm '* ]]; then exit 0; fi
    write_state new-exists true
    printf '%s\\n' 'new-container-id'
    ;;
  rm)
    target="\${!#}"
    if [ "$target" = 'hamlog' ] && [ "$(read_state new-exists)" = 'true' ]; then
      write_state new-exists false
    elif [ "$target" = "$(read_state old-name)" ]; then
      write_state old-name removed
    fi
    ;;
  start)
    [ "$1" = "$(read_state old-name)" ] && write_state old-running true
    ;;
  exec|pause|unpause|logs) ;;
esac
`;

// Health responses come from FAKE_HEALTH; every other URL succeeds.
const fakeCurlSource = `#!/usr/bin/env bash
for argument in "$@"; do
  if [[ "$argument" == */api/health ]]; then
    printf '%s\\n' "$*" >> "$CURL_ARGS_LOG"
    if [ "$FAKE_HEALTH" = 'ok' ]; then
      printf '{"status":"ok","version":"%s"}' "$FAKE_HEALTH_VERSION"
      exit 0
    fi
    exit 7
  fi
done
exit 0
`;

const runScript = (scriptPath, args, env) => new Promise((resolve, reject) => {
  const child = spawn('bash', [scriptPath, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const timeout = setTimeout(() => {
    child.kill('SIGKILL');
    reject(new Error(`${path.basename(scriptPath)} test timed out`));
  }, 20_000);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', error => {
    clearTimeout(timeout);
    reject(error);
  });
  child.on('close', code => {
    clearTimeout(timeout);
    resolve({ code, stdout, stderr });
  });
});

async function createServer({ appEnv = 'JWT_SECRET=jwt\nADMIN_PASSWORD=admin\n' } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'hamlog-server-deploy-test-'));
  const fakeBin = path.join(root, 'bin');
  const dockerState = path.join(root, 'docker-state');
  const stateDir = path.join(root, 'agent-state');
  await mkdir(fakeBin, { recursive: true });
  await mkdir(dockerState, { recursive: true });
  await mkdir(path.join(root, 'hamlog-data', 'data', 'posts'), { recursive: true });
  await mkdir(path.join(root, 'hamlog-data', 'uploads'), { recursive: true });
  await writeFile(path.join(root, 'hamlog-data', 'data', 'posts.json'), '[]');
  await writeFile(path.join(dockerState, 'old-name'), 'hamlog');
  await writeFile(path.join(dockerState, 'old-running'), 'true');
  await writeFile(path.join(dockerState, 'new-exists'), 'false');
  await writeFile(path.join(root, 'hamlog.env'), appEnv);
  await writeFile(path.join(fakeBin, 'docker'), fakeDockerSource);
  await writeFile(path.join(fakeBin, 'curl'), fakeCurlSource);
  // Health retries sleep between attempts; tests do not need to wait.
  await writeFile(path.join(fakeBin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
  for (const tool of ['docker', 'curl', 'sleep']) await chmod(path.join(fakeBin, tool), 0o755);

  const env = {
    ...process.env,
    HOME: root,
    PATH: `${fakeBin}:${process.env.PATH}`,
    DOCKER_ARGS_LOG: path.join(root, 'docker.log'),
    CURL_ARGS_LOG: path.join(root, 'curl.log'),
    DOCKER_STATE_DIR: dockerState,
    HAMLOG_DEPLOY_ENV_FILE: path.join(root, 'missing-deploy.env'),
    HAMLOG_APP_ENV_FILE: path.join(root, 'hamlog.env'),
    HAMLOG_STATE_DIR: stateDir,
    HAMLOG_IMAGE: 'ghcr.io/test/hamlog:latest',
    HAMLOG_PUBLIC_URL: '',
    FAKE_PULLED_ID: 'sha256:new',
    FAKE_REVISION: 'abc1234def5678',
    FAKE_HEALTH: 'ok',
    FAKE_HEALTH_VERSION: 'abc1234'
  };
  const docker = async () => readFile(env.DOCKER_ARGS_LOG, 'utf8').catch(() => '');
  const dockerState_ = async name => readFile(path.join(dockerState, name), 'utf8');
  return { root, env, stateDir, docker, dockerState: dockerState_ };
}

test('deploy script is valid Bash and backs up before arming the cutover', async () => {
  await execFileAsync('bash', ['-n', deployScriptPath]);
  await execFileAsync('bash', ['-n', installScriptPath]);
  const source = await readFile(deployScriptPath, 'utf8');

  const lockIndex = source.indexOf('flock -n 9');
  const pullIndex = source.indexOf('docker pull -q "$IMAGE"');
  const validateIndex = source.indexOf('if ! validate_app_env');
  const backupIndex = source.indexOf('if ! run_backup; then', validateIndex);
  const armIndex = source.indexOf('trap restore_interrupted_cutover EXIT');
  const stopIndex = source.indexOf('if ! preserve_previous_container; then');
  const commitIndex = source.indexOf('DEPLOYMENT_COMMITTED=true\n');
  const disarmIndex = source.indexOf('trap - EXIT HUP INT TERM', commitIndex);

  assert.ok(lockIndex > 0 && lockIndex < pullIndex);
  assert.ok(pullIndex < validateIndex && validateIndex < backupIndex);
  assert.ok(backupIndex < armIndex && armIndex < stopIndex);
  assert.ok(stopIndex < commitIndex && commitIndex < disarmIndex);
  // Secrets reach the container only through the env file.
  assert.match(source, /--env-file "\$APP_ENV_FILE"/);
  assert.doesNotMatch(source, /-e (JWT_SECRET|ADMIN_PASSWORD)=/);
});

test('an unchanged image does not touch the running container', async () => {
  const server = await createServer();
  try {
    const result = await runScript(deployScriptPath, ['deploy'], { ...server.env, FAKE_PULLED_ID: 'sha256:old' });
    assert.equal(result.code, 0, result.stderr);
    const calls = await server.docker();
    assert.match(calls, /^pull -q ghcr\.io\/test\/hamlog:latest$/m);
    assert.doesNotMatch(calls, /^(stop|run|rename|pause) /m);
  } finally {
    await rm(server.root, { recursive: true, force: true });
  }
});

test('a new image is backed up, deployed with the env file, and verified', async () => {
  const server = await createServer();
  try {
    const result = await runScript(deployScriptPath, ['deploy'], server.env);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Deployed abc1234\./);

    const backups = await readdir(path.join(server.root, 'hamlog-backups'));
    assert.equal(backups.filter(file => file.endsWith('.tar.gz')).length, 1);

    const calls = await server.docker();
    const runCall = calls.split('\n').find(line => line.startsWith('run -d '));
    assert.ok(runCall, calls);
    assert.match(runCall, new RegExp(`--env-file ${server.env.HAMLOG_APP_ENV_FILE}`));
    assert.match(runCall, /-e APP_VERSION=abc1234 sha256:new$/);
    assert.ok(calls.indexOf('pause hamlog') < calls.indexOf('stop hamlog'));
    assert.match(calls, /^rename hamlog hamlog-rollback-\d+$/m);
    assert.match(calls, /^rm hamlog-rollback-\d+$/m);
    assert.match(calls, /^image rm sha256:old$/m);
    assert.equal(await server.dockerState('new-exists'), 'true');
    assert.equal(await server.dockerState('old-name'), 'removed');
    assert.match(await readFile(server.env.CURL_ARGS_LOG, 'utf8'), /http:\/\/127\.0\.0\.1:4000\/api\/health/);
  } finally {
    await rm(server.root, { recursive: true, force: true });
  }
});

test('a failed health check restores the previous container and skips that image afterwards', async () => {
  const server = await createServer();
  try {
    const failed = await runScript(deployScriptPath, ['deploy'], { ...server.env, FAKE_HEALTH: 'down' });
    assert.equal(failed.code, 1);
    assert.match(failed.stderr, /failed; the previous version was restored/);
    assert.equal(await server.dockerState('old-name'), 'hamlog');
    assert.equal(await server.dockerState('old-running'), 'true');
    assert.equal(await server.dockerState('new-exists'), 'false');
    assert.equal(await readFile(path.join(server.stateDir, 'failed-image'), 'utf8'), 'sha256:new');

    // The next timer run must not cut over to the same broken release again.
    await writeFile(server.env.DOCKER_ARGS_LOG, '');
    const retried = await runScript(deployScriptPath, ['deploy'], server.env);
    assert.equal(retried.code, 0, retried.stderr);
    assert.doesNotMatch(await server.docker(), /^(stop|run|rename|pause) /m);

    // A newer release is tried and clears the failure marker.
    const next = await runScript(deployScriptPath, ['deploy'], { ...server.env, FAKE_PULLED_ID: 'sha256:newer' });
    assert.equal(next.code, 0, next.stderr);
    await assert.rejects(access(path.join(server.stateDir, 'failed-image')));
  } finally {
    await rm(server.root, { recursive: true, force: true });
  }
});

test('missing secrets stop the deployment before the backup or cutover', async () => {
  const server = await createServer({ appEnv: 'JWT_SECRET=jwt\nADMIN_PASSWORD=\n' });
  try {
    const result = await runScript(deployScriptPath, ['deploy'], server.env);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /ADMIN_PASSWORD is required/);
    assert.doesNotMatch(await server.docker(), /^(stop|run|rename|pause) /m);
    await assert.rejects(access(path.join(server.root, 'hamlog-backups')));
  } finally {
    await rm(server.root, { recursive: true, force: true });
  }
});

test('a deploy check is skipped while a backup holds the lock', async () => {
  const server = await createServer();
  await mkdir(server.stateDir, { recursive: true });
  const holder = spawn('flock', [path.join(server.stateDir, 'deploy.lock'), '-c', 'read -r _'], {
    stdio: ['pipe', 'ignore', 'ignore']
  });
  try {
    // Wait until the holder has taken the lock.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const probe = await execFileAsync('flock', ['-n', path.join(server.stateDir, 'deploy.lock'), 'true'])
        .then(() => false, () => true);
      if (probe) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const result = await runScript(deployScriptPath, ['deploy'], server.env);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Another deployment or backup is running/);
    assert.equal(await server.docker(), '');
  } finally {
    holder.stdin.end('\n');
    await rm(server.root, { recursive: true, force: true });
  }
});

test('the scheduled backup mode creates a verified archive', async () => {
  const server = await createServer();
  try {
    const result = await runScript(deployScriptPath, ['backup'], server.env);
    assert.equal(result.code, 0, result.stderr);
    const backups = await readdir(path.join(server.root, 'hamlog-backups'));
    assert.equal(backups.filter(file => file.endsWith('.tar.gz.sha256')).length, 1);
    assert.doesNotMatch(await server.docker(), /^(pull|stop|run -d) /m);
  } finally {
    await rm(server.root, { recursive: true, force: true });
  }
});

test('the installer keeps secrets private and seeds only application settings', async () => {
  // Root, system users, and systemd are not available in tests; check the rules.
  const source = await readFile(installScriptPath, 'utf8');
  assert.match(source, /APP_ENV_KEYS='JWT_SECRET ADMIN_PASSWORD AUTH_MODE /);
  assert.doesNotMatch(source.match(/APP_ENV_KEYS='[^']*'/)[0], /\b(NODE_ENV|PORT|APP_VERSION|PATH)\b/);
  assert.match(source, /install -d -o root -g "\$DEPLOY_GROUP" -m 750 "\$CONFIG_DIR"/);
  assert.match(source, /-m 640 \/dev\/null "\$CONFIG_DIR\/hamlog\.env"/);
  assert.match(source, /install -o root -g root -m 755 "\$SOURCE_DIR\/server-deploy\.sh"/);
  assert.match(source, /OnUnitInactiveSec=2min/);
  assert.match(source, /OnCalendar=\*-\*-\* 03:17:00 Asia\/Seoul/);
  assert.match(source, /ExecStart=\$INSTALL_DIR\/server-deploy\.sh deploy/);
});
