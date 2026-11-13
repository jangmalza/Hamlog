import app from './app.js';
import { resolveServerNetworkConfig } from './config/network.js';
import { initializeDatabase } from './services/db.js';
import { readProfile } from './models/profileModel.js';
import { hasConfiguredSiteUrl } from './config/site.js';

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

    app.listen(port, host, () => {
      const displayHost = host.includes(':') ? `[${host}]` : host;
      console.log(`API server listening on http://${displayHost}:${port}`);
    });
  } catch (error) {
    console.error('Failed to start server', error);
    process.exit(1);
  }
}

start();
