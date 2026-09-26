import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { cpSync } from 'node:fs'

// core/languages.ts reads tags.scm next to the running script, so ship them beside the main bundle.
const copyQueries = {
  name: 'copy-tree-sitter-queries',
  writeBundle() {
    cpSync('src/core/queries', 'out/main/queries', { recursive: true })
  },
}

export default defineConfig({
  main: { plugins: [copyQueries] },
  // A sandboxed preload must be a single CommonJS file.
  preload: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } } },
  renderer: { plugins: [react()] },
})
