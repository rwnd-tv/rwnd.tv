import { readFileSync } from 'node:fs'

/**
 * This package's own `version` field, read directly from its package.json
 * rather than `process.env.npm_package_version` — the production
 * entrypoint (`docker-entrypoint.sh`) runs `node dist/index.js` directly,
 * not through a pnpm/npm script, so that env var is never set there.
 *
 * Deliberately placed at `src/version.ts` (a sibling of `index.ts`, not
 * nested under `lib/`): tsup bundles everything into one `dist/index.js`,
 * so `import.meta.url` there resolves to that bundled file's own path, not
 * this source file's original location — `../package.json` only lands on
 * `apps/api/package.json` in both dev (unbundled, `src/version.ts`) and
 * prod (bundled, `dist/index.js`) because `src/` and `dist/` sit at the
 * same depth below `apps/api/`. Nesting this under `src/lib/` would break
 * dev, where `import.meta.url` is this file's real, unbundled location.
 */
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as { version: string }

export const APP_VERSION: string = packageJson.version
