// The renderer alone in a plain browser, on the mock API (src/renderer/src/dev/mockApi.ts).
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src/renderer',
  publicDir: resolve('fixtures'),
  plugins: [react()],
  server: { port: 5180, strictPort: true, host: '127.0.0.1' },
})
