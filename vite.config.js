import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

function utoolsManifestPlugin () {
  let outDir = 'dist'

  return {
    name: 'utools-manifest',
    configResolved (config) {
      outDir = config.build.outDir
    },
    closeBundle () {
      const manifestPath = path.resolve(outDir, 'plugin.json')
      const sidebarPath = path.resolve(outDir, 'sidebar.html')
      const preloadPath = path.resolve(outDir, 'preload', 'services.js')

      if (fs.existsSync(manifestPath)) {
        const config = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        delete config.development
        fs.writeFileSync(manifestPath, `${JSON.stringify(config, null, 2)}\n`)
      }

      if (fs.existsSync(sidebarPath)) {
        fs.writeFileSync(sidebarPath, `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>剪贴板侧栏</title>
    <meta http-equiv="refresh" content="0; url=index.html?view=sidebar">
  </head>
  <body>
    <script>window.location.replace('index.html?view=sidebar')</script>
  </body>
</html>
`)
      }

      if (fs.existsSync(preloadPath)) {
        const source = fs.readFileSync(preloadPath, 'utf8')
          .replace(
            'function getIndexUrl (query) {\n  const utools = safeUtools()\n  if (utools && utools.isDev && utools.isDev()) return `http://127.0.0.1:5173/${query}`\n  return `index.html${query}`\n}',
            'function getIndexUrl (query) {\n  return `index.html${query}`\n}'
          )
        fs.writeFileSync(preloadPath, source)
      }
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), utoolsManifestPlugin()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
})
