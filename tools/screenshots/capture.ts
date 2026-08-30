/**
 * Captures documentation screenshots against a running rwnd.tv instance.
 *
 * Usage:
 *   BASE_URL=https://dev.rwnd.tv EMAIL=you@example.com PASSWORD=... pnpm start
 *
 * BASE_URL defaults to http://localhost:3000. Use a dedicated account with a
 * small, curated watch history you're comfortable putting in a public repo
 * forever — not a personal account. See README.md.
 *
 * Output: ../../docs/screenshots/{name}-{locale}-{theme}.webp, 1600px wide.
 *
 * Locale is a server-side account preference
 * (`PATCH /api/v1/auth/me`, apps/api/src/routes/auth.ts), not a browser
 * setting — apps/web/src/components/PreferencesEffect.tsx applies it via
 * `i18n.changeLanguage`, so there's no client-only equivalent. All shots for
 * one locale are captured before switching to the next, and the account's
 * original locale/theme are restored in `finally` — even on a failed run —
 * so a broken capture can't leave the account stuck in the wrong language.
 *
 * Theme, by contrast, is just `prefers-color-scheme`
 * (apps/web/src/index.css:24) as long as the account's theme preference is
 * `system` — so it's driven by Playwright's `colorScheme` context option
 * with no account mutation needed. The account's theme is force-set to
 * `system` for the duration of the run (and restored after) precisely so
 * that trick works regardless of what the account had it set to before.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext } from 'playwright'
import sharp from 'sharp'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const EMAIL = requireEnv('EMAIL')
const PASSWORD = requireEnv('PASSWORD')

const OUT_DIR = path.resolve(fileURLToPath(import.meta.url), '../../../docs/screenshots')
const VIEWPORT = { width: 1600, height: 1000 }

const LOCALES = ['en-GB', 'en-US'] as const
type Locale = (typeof LOCALES)[number]
const THEMES = ['light', 'dark'] as const
type Theme = (typeof THEMES)[number]

interface Shot {
  name: string
  path: string
  /** Extra settle time beyond `networkidle`, for a query that resolves
   * and re-renders just after the last request finishes. */
  settleMs?: number
}

interface Preferences {
  locale: Locale
  theme: string
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name} — see this file's usage comment.`)
  return value
}

async function login(context: BrowserContext): Promise<void> {
  const res = await context.request.post('/api/v1/auth/login', {
    data: { email: EMAIL, password: PASSWORD },
  })
  if (!res.ok()) {
    throw new Error(`Login failed: ${res.status()} ${await res.text()}`)
  }
}

async function getPreferences(context: BrowserContext): Promise<Preferences> {
  const res = await context.request.get('/api/v1/auth/me')
  if (!res.ok()) throw new Error(`GET /auth/me failed: ${res.status()}`)
  const body = (await res.json()) as Preferences
  return { locale: body.locale, theme: body.theme }
}

async function setPreferences(context: BrowserContext, prefs: Preferences): Promise<void> {
  const res = await context.request.patch('/api/v1/auth/me', { data: prefs })
  if (!res.ok()) {
    throw new Error(`PATCH /auth/me failed: ${res.status()} ${await res.text()}`)
  }
}

/**
 * Finds a real show slug from the account's own watch history, rather than
 * hardcoding a title that might not exist on whichever instance this runs
 * against. Returns undefined (and the show-detail shot is skipped) if the
 * account hasn't logged any watches yet.
 */
async function findShowSlug(context: BrowserContext): Promise<string | undefined> {
  const res = await context.request.get('/api/v1/library/shows')
  if (!res.ok()) return undefined
  const body = (await res.json()) as { shows: { slug: string }[] }
  return body.shows[0]?.slug
}

function buildShotList(showSlug: string | undefined): Shot[] {
  const shots: Shot[] = [
    { name: 'dashboard', path: '/dashboard', settleMs: 500 },
    { name: 'shows', path: '/shows', settleMs: 500 },
    { name: 'movies', path: '/movies', settleMs: 500 },
    { name: 'history', path: '/history', settleMs: 500 },
    { name: 'import', path: '/import', settleMs: 300 },
    // Whole /settings page — includes the Tokens panel the "Connecting
    // Plex" doc section needs. Deliberately never creates a token here: a
    // freshly created one shows its full secret on screen, which is not
    // something that belongs in a screenshot committed to a public repo.
    // With no token just-created, the panel only ever shows names/dates.
    { name: 'settings-tokens', path: '/settings', settleMs: 300 },
  ]
  if (showSlug) {
    shots.push({ name: 'show-detail', path: `/shows/${showSlug}`, settleMs: 500 })
  } else {
    console.warn('No watched show on this account — skipping the show-detail shot.')
  }
  return shots
}

async function saveWebp(png: Buffer, filename: string): Promise<void> {
  const webp = await sharp(png).resize({ width: VIEWPORT.width }).webp({ quality: 82 }).toBuffer()
  await writeFile(path.join(OUT_DIR, filename), webp)
}

async function captureLocaleTheme(
  browser: Browser,
  locale: Locale,
  theme: Theme,
  shots: Shot[],
): Promise<void> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: theme,
  })
  try {
    await login(context)
    await setPreferences(context, { locale, theme: 'system' })

    const page = await context.newPage()
    for (const shot of shots) {
      await page.goto(shot.path)
      await page.waitForLoadState('networkidle')
      if (shot.settleMs) await page.waitForTimeout(shot.settleMs)
      const png = await page.screenshot()
      const filename = `${shot.name}-${locale}-${theme}.webp`
      await saveWebp(png, filename)
      console.log(`Captured ${filename}`)
    }
  } finally {
    await context.close()
  }
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })

  const browser = await chromium.launch()
  const setupContext = await browser.newContext({ baseURL: BASE_URL })
  await login(setupContext)
  const original = await getPreferences(setupContext)
  const showSlug = await findShowSlug(setupContext)
  await setupContext.close()

  const shots = buildShotList(showSlug)

  try {
    for (const locale of LOCALES) {
      for (const theme of THEMES) {
        await captureLocaleTheme(browser, locale, theme, shots)
      }
    }
  } finally {
    try {
      const restoreContext = await browser.newContext({ baseURL: BASE_URL })
      await login(restoreContext)
      await setPreferences(restoreContext, original)
      await restoreContext.close()
      console.log(`Restored account preferences: locale=${original.locale} theme=${original.theme}`)
    } catch (err) {
      console.error(
        'Failed to restore original account preferences — check it by hand in Account/Settings:',
        err,
      )
      process.exitCode = 1
    }
    await browser.close()
  }
}

await main()
