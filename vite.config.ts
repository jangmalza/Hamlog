import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost'])
const defaultDevJwtSecret = 'dev-only-secret-do-not-use-in-production'
const defaultDevAdminPassword = 'admin1234'

const isLoopbackHost = (host: string) => loopbackHosts.has(
  host.trim().toLowerCase().replace(/^\[|\]$/g, '')
)

const assertExternalDevAccessIsSafe = (host: string, env: Record<string, string | undefined>) => {
  if (isLoopbackHost(host)) return

  if (env.HAMLOG_ALLOW_EXTERNAL_DEV !== 'true') {
    throw new Error(
      'External development access is disabled. Set HAMLOG_ALLOW_EXTERNAL_DEV=true only when it is intentional.'
    )
  }

  const jwtSecret = env.JWT_SECRET?.trim()
  const adminPassword = env.ADMIN_PASSWORD?.trim()

  if (!jwtSecret || jwtSecret === defaultDevJwtSecret) {
    throw new Error('External development access requires a non-default JWT_SECRET.')
  }

  if (!adminPassword || adminPassword === defaultDevAdminPassword) {
    throw new Error('External development access requires a non-default ADMIN_PASSWORD.')
  }
}

const externalDevSafetyPlugin = (env: Record<string, string | undefined>): Plugin => ({
  name: 'hamlog-external-dev-safety',
  apply: 'serve',
  configResolved(config) {
    // configResolved runs after CLI flags, so `vite --host 0.0.0.0` cannot bypass this guard.
    const resolvedHost = config.server.host === true
      ? '0.0.0.0'
      : config.server.host === false
        ? '127.0.0.1'
        : config.server.host || '127.0.0.1'

    assertExternalDevAccessIsSafe(resolvedHost, env)
  }
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const devHost = env.VITE_DEV_HOST?.trim() || '127.0.0.1'
  const apiProxyTarget = env.VITE_DEV_API_TARGET?.trim() || 'http://127.0.0.1:4000'

  return {
    plugins: [react(), externalDevSafetyPlugin(env)],
    server: {
      host: devHost,
      proxy: {
        '/admin/api': apiProxyTarget,
        '/api': apiProxyTarget,
        '/uploads': apiProxyTarget
      }
    },
    build: {
      // dist/.vite/manifest.json lets the server preload a lazy page's chunks
      // (server/utils/clientManifest.js); server/app.js does not serve dot directories.
      manifest: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Match package internals too: assigning only entry points lets the
            // JSX runtime or shared CommonJS helpers leak into the lazy editor.
            if (id.includes('commonjsHelpers')) return 'react-vendor'
            const packagePath = id.split('/node_modules/').at(-1)
            if (packagePath === id) return
            const packageName = packagePath?.match(/^(@[^/]+\/[^/]+|[^/]+)/)?.[1]
            if (!packageName) return

            if (['react', 'react-dom', 'react-router', 'react-router-dom', 'scheduler'].includes(packageName)) {
              return 'react-vendor'
            }
            if (packageName.startsWith('@tiptap/') || packageName.startsWith('prosemirror-') || packageName === 'tippy.js') {
              return 'editor-vendor'
            }
            if (packageName === 'lucide-react') return 'icon-vendor'
            if (packageName === 'katex') return 'math-vendor'
          }
        }
      }
    }
  }
})
