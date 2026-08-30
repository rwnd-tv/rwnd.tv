/**
 * Captures screenshots against a running rwnd.tv instance — either the
 * documentation screenshots README.md embeds, or the marketing screenshots
 * apps/web/src/routes/LandingPage.tsx embeds. Select with TARGET.
 *
 * Usage:
 *   BASE_URL=https://dev.rwnd.tv EMAIL=you@example.com PASSWORD=... pnpm start
 *   TARGET=landing BASE_URL=... EMAIL=... PASSWORD=... pnpm start
 *
 * TARGET defaults to "docs" (writes docs/screenshots/, embedded in
 * README.md). "landing" writes apps/web/public/landing/ instead, matching
 * the `{name}-{locale}-{theme}.webp` pattern LandingPage.tsx's `<Shot>`
 * component reads, and captures each shot at the exact aspect ratio its CSS
 * container uses (`object-cover` + a fixed `aspectRatio` style) so nothing
 * gets unexpectedly cropped.
 *
 * BASE_URL defaults to http://localhost:3000. Use a dedicated account with a
 * small, curated watch history you're comfortable putting in a public repo
 * forever — not a personal account. See README.md.
 *
 * Logs in once and reuses that session (via storageState) across every
 * locale/theme context instead of logging in per-context — the login route
 * is rate-limited (10/15min), and one login per run instead of six keeps a
 * rerun from eating into that limit.
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

const TARGETS = ['docs', 'landing'] as const
type Target = (typeof TARGETS)[number]
const TARGET = parseTarget(process.env.TARGET)

// Captured at 2x and downsampled back to each shot's own width below —
// supersampled antialiasing, not a size change.
const CAPTURE_SCALE = 2

const LOCALES = ['en-GB', 'en-US'] as const
type Locale = (typeof LOCALES)[number]
const THEMES = ['light', 'dark'] as const
type Theme = (typeof THEMES)[number]

interface Viewport {
  width: number
  height: number
}

interface Shot {
  name: string
  path: string
  viewport: Viewport
  /** Extra settle time beyond `networkidle`, for a query that resolves
   * and re-renders just after the last request finishes. */
  settleMs?: number
}

interface Preferences {
  locale: Locale
  theme: string
}

interface ShotContext {
  showSlug: string | undefined
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name} — see this file's usage comment.`)
  return value
}

function parseTarget(value: string | undefined): Target {
  if (value === undefined) return 'docs'
  if ((TARGETS as readonly string[]).includes(value)) return value as Target
  throw new Error(`Unknown TARGET "${value}" — expected one of: ${TARGETS.join(', ')}`)
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
 * against. Returns undefined (and show-detail/season shots are skipped) if
 * the account hasn't logged any watches yet.
 */
async function findShowSlug(context: BrowserContext): Promise<string | undefined> {
  const res = await context.request.get('/api/v1/library/shows')
  if (!res.ok()) return undefined
  const body = (await res.json()) as { shows: { slug: string }[] }
  return body.shows[0]?.slug
}

// ---- docs/screenshots (README.md) ----

// Deliberately narrower than a typical desktop viewport: the sidebar is a
// fixed width, so a wide capture leaves a lot of empty gutter on
// lightly-populated pages, and a screenshot this size gets squeezed into a
// README table column a fraction of its width anyway — capturing narrower
// means less downscaling there, so text ends up more legible, not less.
// Comfortably above the app's sm: (640px) breakpoint where the sidebar
// switches to its mobile overlay behavior.
const DOCS_VIEWPORT: Viewport = { width: 1120, height: 760 }

function buildDocsShots({ showSlug }: ShotContext): Shot[] {
  const shots: Shot[] = [
    { name: 'dashboard', path: '/dashboard', viewport: DOCS_VIEWPORT, settleMs: 500 },
    { name: 'shows', path: '/shows', viewport: DOCS_VIEWPORT, settleMs: 500 },
    { name: 'movies', path: '/movies', viewport: DOCS_VIEWPORT, settleMs: 500 },
    { name: 'history', path: '/history', viewport: DOCS_VIEWPORT, settleMs: 500 },
    { name: 'import', path: '/import', viewport: DOCS_VIEWPORT, settleMs: 300 },
    // Whole /settings page — includes the Tokens panel the "Connecting
    // Plex" doc section needs. Deliberately never creates a token here: a
    // freshly created one shows its full secret on screen, which is not
    // something that belongs in a screenshot committed to a public repo.
    // With no token just-created, the panel only ever shows names/dates.
    { name: 'settings-tokens', path: '/settings', viewport: DOCS_VIEWPORT, settleMs: 300 },
  ]
  if (showSlug) {
    shots.push({
      name: 'show-detail',
      path: `/shows/${showSlug}`,
      viewport: DOCS_VIEWPORT,
      settleMs: 500,
    })
  } else {
    console.warn('No watched show on this account — skipping the show-detail shot.')
  }
  return shots
}

// ---- apps/web/public/landing (LandingPage.tsx) ----

// Each viewport's aspect ratio matches the CSS `aspectRatio` its <Shot>
// container uses (see the `style={{ aspectRatio: ... }}` wrappers in
// LandingPage.tsx) exactly, so `object-cover` never has anything to crop —
// the whole captured frame fits the container precisely.
const LANDING_HERO_VIEWPORT: Viewport = { width: 1600, height: 800 } // 16 / 8
const LANDING_GALLERY_VIEWPORT: Viewport = { width: 1600, height: 1000 } // 16 / 10
const LANDING_IMPORT_VIEWPORT: Viewport = { width: 1600, height: 1067 } // 3 / 2

function buildLandingShots({ showSlug }: ShotContext): Shot[] {
  const shots: Shot[] = [
    { name: 'dashboard', path: '/dashboard', viewport: LANDING_HERO_VIEWPORT, settleMs: 500 },
    { name: 'tv-shows', path: '/shows', viewport: LANDING_GALLERY_VIEWPORT, settleMs: 500 },
    { name: 'films', path: '/movies', viewport: LANDING_GALLERY_VIEWPORT, settleMs: 500 },
    { name: 'import', path: '/import', viewport: LANDING_IMPORT_VIEWPORT, settleMs: 300 },
  ]
  if (showSlug) {
    shots.push(
      {
        name: 'show-detail',
        path: `/shows/${showSlug}`,
        viewport: LANDING_GALLERY_VIEWPORT,
        settleMs: 500,
      },
      // Season 1 specifically, matching the landing page's own convention —
      // every show a capture account logs starts there, so it's always
      // real content rather than an empty/unwatched season.
      {
        name: 'season',
        path: `/shows/${showSlug}/season/1`,
        viewport: LANDING_GALLERY_VIEWPORT,
        settleMs: 500,
      },
    )
  } else {
    console.warn('No watched show on this account — skipping the show-detail/season shots.')
  }
  return shots
}

const TARGET_CONFIG: Record<
  Target,
  { outDir: string; buildShots: (ctx: ShotContext) => Shot[] }
> = {
  docs: {
    outDir: path.resolve(fileURLToPath(import.meta.url), '../../../docs/screenshots'),
    buildShots: buildDocsShots,
  },
  landing: {
    outDir: path.resolve(fileURLToPath(import.meta.url), '../../../apps/web/public/landing'),
    buildShots: buildLandingShots,
  },
}

async function saveWebp(
  png: Buffer,
  filename: string,
  width: number,
  outDir: string,
): Promise<void> {
  const webp = await sharp(png).resize({ width }).webp({ quality: 82 }).toBuffer()
  await writeFile(path.join(outDir, filename), webp)
}

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>

async function captureLocaleTheme(
  browser: Browser,
  storageState: StorageState,
  locale: Locale,
  theme: Theme,
  shots: Shot[],
  outDir: string,
): Promise<void> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    deviceScaleFactor: CAPTURE_SCALE,
    colorScheme: theme,
    storageState,
  })
  try {
    await setPreferences(context, { locale, theme: 'system' })

    const page = await context.newPage()
    for (const shot of shots) {
      await page.setViewportSize(shot.viewport)
      await page.goto(shot.path)
      await page.waitForLoadState('networkidle')
      if (shot.settleMs) await page.waitForTimeout(shot.settleMs)
      const png = await page.screenshot()
      const filename = `${shot.name}-${locale}-${theme}.webp`
      await saveWebp(png, filename, shot.viewport.width, outDir)
      console.log(`Captured ${filename}`)
    }
  } finally {
    await context.close()
  }
}

async function main(): Promise<void> {
  const { outDir, buildShots } = TARGET_CONFIG[TARGET]
  await mkdir(outDir, { recursive: true })

  const browser = await chromium.launch()
  const setupContext = await browser.newContext({ baseURL: BASE_URL })
  await login(setupContext)
  const original = await getPreferences(setupContext)
  const showSlug = await findShowSlug(setupContext)
  // Authenticate once and reuse the session cookie for every context below —
  // one login instead of one per locale/theme combination (+ restore), so a
  // run doesn't eat into the login rate limit (10/15min, ASVS V2.2.1) on its
  // own and can be rerun back-to-back without waiting one out.
  const storageState = await setupContext.storageState()
  await setupContext.close()

  const shots = buildShots({ showSlug })

  try {
    for (const locale of LOCALES) {
      for (const theme of THEMES) {
        await captureLocaleTheme(browser, storageState, locale, theme, shots, outDir)
      }
    }
  } finally {
    try {
      const restoreContext = await browser.newContext({ baseURL: BASE_URL, storageState })
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
