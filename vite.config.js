import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

function healthEndpointsPlugin() {
  const handleHealthRequest = (req, res, next) => {
    const requestUrl = req.url || ''
    if (requestUrl !== '/health' && requestUrl !== '/ready') {
      next()
      return
    }
    const payload = JSON.stringify({
      status: 'ok',
      ready: true,
      service: 'brillio-adam',
      timestamp: new Date().toISOString(),
    })
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(payload)
  }

  return {
    name: 'adam-health-endpoints',
    configureServer(server) {
      server.middlewares.use(handleHealthRequest)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleHealthRequest)
    },
  }
}

export default defineConfig({
  plugins: [react(), healthEndpointsPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor'
          }

          if (id.includes('@supabase/supabase-js')) {
            return 'supabase'
          }

          if (id.includes('@xyflow/react')) {
            return 'xyflow'
          }

          if (id.includes('node_modules/officeparser')) {
            return 'officeparser'
          }

          if (id.includes('node_modules/xlsx')) {
            return 'xlsx'
          }

          if (id.includes('node_modules/tesseract.js')) {
            return 'tesseract'
          }

          if (
            id.includes('node_modules/pdfjs-dist') ||
            id.includes('node_modules/mammoth') ||
            id.includes('node_modules/jszip')
          ) {
            return 'docparsing'
          }

          return undefined
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  }
})
