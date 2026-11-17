import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverEntry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');

const freePort = () => new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address();
        probe.close(() => resolve(port));
    });
});

const startServer = async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'hamlog-shutdown-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const port = await freePort();
    const child = spawn(process.execPath, [serverEntry], {
        env: {
            ...process.env,
            NODE_ENV: 'test',
            HOST: '127.0.0.1',
            PORT: String(port),
            HAMLOG_DATA_DIR: path.join(root, 'data'),
            HAMLOG_UPLOAD_DIR: path.join(root, 'uploads')
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });

    let output = '';
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 15000);
        const onData = (chunk) => {
            output += chunk;
            if (output.includes('API server listening')) {
                clearTimeout(timer);
                resolve();
            }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', (chunk) => { output += chunk; });
        child.once('exit', () => reject(new Error(`server exited early:\n${output}`)));
    });
    return { child, port, getOutput: () => output };
};

const waitForExit = (child) => new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
});

for (const signal of ['SIGTERM', 'SIGINT']) {
    test(`${signal} closes the server and exits cleanly`, async (t) => {
        const { child, port, getOutput } = await startServer(t);
        const health = await fetch(`http://127.0.0.1:${port}/api/health`);
        assert.equal(health.status, 200);

        const startedAt = Date.now();
        const exited = waitForExit(child);
        child.kill(signal);
        const { code, signal: exitSignal } = await exited;

        assert.equal(exitSignal, null, `the process handled ${signal} instead of being killed by it`);
        assert.equal(code, 0);
        assert.ok(Date.now() - startedAt < 5000, 'shutdown finished well before docker stop gives up');
        assert.match(getOutput(), new RegExp(`${signal} received`));
    });
}
