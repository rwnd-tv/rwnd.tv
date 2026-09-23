import { defineConfig } from 'tsup'

export default defineConfig({
  // restore-entrypoint.ts is a second, standalone entry run directly by
  // docker-entrypoint.sh (as dist/restore-entrypoint.js) — see its own doc
  // comment for why it has to be a separate process rather than a code path
  // inside index.ts.
  entry: ['src/index.ts', 'src/restore-entrypoint.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // @rwnd/db and @rwnd/shared ship TypeScript source (no build step of
  // their own — see their package.json `exports`), which only Vite/tsx can
  // load directly. Bundling them in here means the production container
  // only needs plain Node plus this package's real npm dependencies.
  noExternal: ['@rwnd/db', '@rwnd/shared'],
})
