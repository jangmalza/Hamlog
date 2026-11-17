import app from './app.js';
import { resolveServerNetworkConfig } from './config/network.js';
import { initializeDatabase } from './services/db.js';
import { readProfile } from './models/profileModel.js';
import { hasConfiguredSiteUrl } from './config/site.js';
import { runWithDataStoreLock } from './utils/storeLock.js';

// Docker sends SIGTERM and waits 10 s before SIGKILL. Node running as PID 1
// ignores SIGTERM without a handler, so every deploy used to wait the full
// timeout and cut off in-flight requests.
const SHUTDOWN_TIMEOUT_MS = 8000;

function registerGracefulShutdown(server) {
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received; finishing in-flight requests and data writes.`);

    const forceExit = setTimeout(() => {
      console.error('Shutdown timed out; exiting without waiting further.');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    // close() stops accepting connections, closes idle keep-alive sockets and
    // waits for active requests; queued file writes finish after that.
    const serverClosed = new Promise(resolve => server.close(resolve));
    serverClosed
      .then(() => runWithDataStoreLock(() => {}))
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('Shutdown failed', error);
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (process.env.NODE_ENV === 'production') {
  process.umask(0o027);
}

async function start() {
  try {
    const { host, port } = resolveServerNetworkConfig();
    await initializeDatabase();
    if (process.env.NODE_ENV === 'production' && !hasConfiguredSiteUrl(await readProfile())) {
      console.warn('WARNING: No site URL is configured. Set SITE_URL or the profile site URL so canonical and sitemap URLs point to your domain.');
    }

    const server = app.listen(port, host, () => {
      const displayHost = host.includes(':') ? `[${host}]` : host;
      console.log(`API server listening on http://${displayHost}:${port}`);
    });
    registerGracefulShutdown(server);
  } catch (error) {
    console.error('Failed to start server', error);
    process.exit(1);
  }
}

start();
