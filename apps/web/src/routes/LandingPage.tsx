import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router'
import type { Locale } from '@rwnd/shared'
import { useAuth } from '../lib/use-auth.js'
import { useSetupStatus } from '../lib/use-setup-status.js'
import { usePublicSettings } from '../lib/use-public-settings.js'
import { detectedLocale } from '../lib/detected-locale.js'
import { Spinner } from '../components/ui/Spinner.js'

/**
 * Public landing page at '/', for visitors who aren't signed in — the one
 * marketing surface this app has. Logged-in users never see it: '/' sends
 * them to /dashboard, same as before.
 *
 * Screenshots come in dark/light pairs, per locale (the app UI they show
 * has locale-specific copy baked into the pixels, e.g. "Films" vs "Movies").
 * Both theme variants are rendered and CSS shows one, using the same
 * selectors as the theme tokens (see the .landing-shot-* rules in index.css,
 * and .tvdb-logo-* above them for the existing precedent) — a visitor has no
 * account, so there's no stored theme preference to read, only the OS
 * setting. Locale comes from i18n.language, same as RegisterPage/SetupPage.
 */

const SHOTS = '/landing'

const FEATURE_KEYS = ['log', 'plex', 'trakt', 'galleries', 'lists', 'export'] as const
const STEP_KEYS = ['run', 'import', 'current'] as const
const GALLERY_KEYS = ['shows', 'films', 'show', 'season'] as const
const GALLERY_SHOTS: Record<(typeof GALLERY_KEYS)[number], string> = {
  shows: 'tv-shows',
  films: 'films',
  show: 'show-detail',
  season: 'season',
}
const FAQ_KEYS = ['selfHost', 'dropIn', 'metadata', 'requirements', 'players'] as const
const MILESTONES = [
  { key: 'm1', status: 'done' },
  { key: 'm2', status: 'done' },
  { key: 'm3', status: 'done' },
] as const

const QUICK_START = `curl -O https://raw.githubusercontent.com/rwnd-tv/rwnd.tv/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/rwnd-tv/rwnd.tv/main/.env.example
mv .env.example .env
# edit .env — see docs/self-hosting.md
docker compose up -d`

const REPO = 'https://github.com/rwnd-tv/rwnd.tv'

/** A screenshot with its dark and light variants; only one is ever shown. */
function Shot({
  name,
  locale,
  alt,
  className = '',
  lazy = true,
}: {
  name: string
  locale: Locale
  alt: string
  className?: string
  lazy?: boolean
}) {
  const common = `block w-full object-cover object-left-top ${className}`
  return (
    <>
      <img
        src={`${SHOTS}/${name}-${locale}-dark.webp`}
        alt={alt}
        loading={lazy ? 'lazy' : undefined}
        className={`landing-shot-dark ${common}`}
      />
      <img
        src={`${SHOTS}/${name}-${locale}-light.webp`}
        alt={alt}
        loading={lazy ? 'lazy' : undefined}
        className={`landing-shot-light ${common}`}
      />
    </>
  )
}

export function LandingPage() {
  const { t, i18n } = useTranslation()
  const locale = detectedLocale(i18n.language) ?? 'en-US'
  const { user, isLoading: authLoading } = useAuth()
  const { data: setupStatus, isLoading: setupLoading } = useSetupStatus()
  const { data: settings } = usePublicSettings()

  if (setupLoading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    )
  }
  // A brand-new instance has no admin yet — setup comes before anything else.
  if (setupStatus?.required) return <Navigate to="/setup" replace />
  if (user) return <Navigate to="/dashboard" replace />

  // Same gate as LoginPage's register prompt: an instance with registration
  // closed — or with no SMTP, which makes email verification impossible —
  // can't take sign-ups, so the page leads with self-hosting instead.
  const canRegister =
    !!settings && settings.registrationMode !== 'closed' && settings.emailConfigured

  const sectionLink = 'rounded-md px-3 py-2 text-sm font-medium hover:bg-[var(--color-surface)]'
  const primaryCta =
    'inline-flex items-center justify-center rounded-md bg-[var(--color-primary)] px-5 py-2.5 text-[15px] font-medium text-[var(--color-primary-fg)] hover:opacity-90'
  const secondaryCta =
    'inline-flex items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-2.5 text-[15px] font-medium text-[var(--color-fg)] hover:bg-[var(--color-border)]'
  const card =
    'flex flex-col gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6'
  const frame =
    'overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]'

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-5">
        <a href="#top" className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-6 w-6 shrink-0" />
          <span className="text-lg font-semibold">{t('app.name')}</span>
        </a>
        {settings && (
          <span className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-xs font-medium text-[var(--color-fg-muted)]">
            v{settings.appVersion}
          </span>
        )}
        <div className="flex-1" />
        <nav className="flex min-w-0 items-center gap-1">
          <a href="#features" className={`hidden whitespace-nowrap md:block ${sectionLink}`}>
            {t('landing.nav.features')}
          </a>
          <a href="#self-host" className={`hidden whitespace-nowrap md:block ${sectionLink}`}>
            {t('landing.nav.selfHost')}
          </a>
          <a href="#status" className={`hidden whitespace-nowrap md:block ${sectionLink}`}>
            {t('landing.nav.status')}
          </a>
          <a href={REPO} className={`hidden whitespace-nowrap md:block ${sectionLink}`}>
            {t('landing.nav.github')}
          </a>
          <Link
            to="/login"
            className="ml-2 inline-flex shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium whitespace-nowrap hover:bg-[var(--color-border)]"
          >
            {t('landing.signIn')}
          </Link>
          {canRegister && (
            <Link
              to="/register"
              className="inline-flex shrink-0 items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium whitespace-nowrap text-[var(--color-primary-fg)] hover:opacity-90"
            >
              {t('landing.createAccountShort')}
            </Link>
          )}
        </nav>
      </header>

      <section id="top" className="border-b border-[var(--color-border)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-5 pt-20">
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-[13px] font-medium text-[var(--color-fg-muted)]">
            <span className="h-[7px] w-[7px] rounded-full bg-[var(--color-success)]" />
            {t('landing.hero.status', { version: settings?.appVersion ?? '' })}
          </span>
          <h1 className="max-w-[20ch] text-center text-4xl leading-[1.06] font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl">
            {t('landing.hero.title')}
          </h1>
          <p className="max-w-[60ch] text-center text-lg leading-8 text-pretty text-[var(--color-fg-muted)]">
            {t('landing.hero.body')}
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-1">
            {canRegister ? (
              <>
                <Link to="/register" className={primaryCta}>
                  {t('landing.createAccount')}
                </Link>
                <a href="#self-host" className={secondaryCta}>
                  {t('landing.selfHostCta')}
                </a>
              </>
            ) : (
              <>
                <a href="#self-host" className={primaryCta}>
                  {t('landing.selfHostCta')}
                </a>
                <Link to="/login" className={secondaryCta}>
                  {t('landing.signIn')}
                </Link>
              </>
            )}
          </div>
          <p className="text-[13px] text-[var(--color-fg-muted)]">{t('landing.hero.meta')}</p>
          <div
            className={`mt-8 w-full rounded-b-none border-b-0 ${frame}`}
            style={{ aspectRatio: '16 / 8' }}
          >
            <Shot
              name="dashboard"
              locale={locale}
              alt={t('landing.shots.dashboard')}
              className="h-full"
              lazy={false}
            />
          </div>
        </div>
      </section>

      <section className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-7 sm:grid-cols-2 lg:grid-cols-4">
          {MILESTONES.map(({ key, status }) => (
            <div key={key} className="flex flex-col gap-1">
              <span
                className={`text-[13px] font-medium ${
                  status === 'done' ? 'text-[var(--color-success)]' : 'text-[var(--color-primary)]'
                }`}
              >
                {t(`landing.strip.${key}.label`)}
              </span>
              <span className="text-sm leading-5 text-[var(--color-fg-muted)]">
                {t(`landing.strip.${key}.body`)}
              </span>
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-[var(--color-fg-muted)]">
              {t('landing.strip.honest.label')}
            </span>
            <span className="text-sm leading-5 text-[var(--color-fg-muted)]">
              {t('landing.strip.honest.body')}{' '}
              <a href="#status" className="text-[var(--color-primary)] underline">
                {t('landing.strip.honest.link')}
              </a>
            </span>
          </div>
        </div>
      </section>

      <section id="features">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-18">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
              {t('landing.features.title')}
            </h2>
            <p className="max-w-[62ch] text-base leading-7 text-[var(--color-fg-muted)]">
              {t('landing.features.body')}
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_KEYS.map((key) => (
              <div key={key} className={card}>
                <h3 className="text-base font-semibold">{t(`landing.features.${key}.title`)}</h3>
                <p className="text-sm leading-6 text-[var(--color-fg-muted)]">
                  {t(`landing.features.${key}.body`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="self-host"
        className="border-t border-[var(--color-border)] bg-[var(--color-surface)]"
      >
        <div className="mx-auto grid max-w-6xl gap-14 px-5 py-18 lg:grid-cols-2">
          <div className="flex flex-col gap-7">
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
                {t('landing.selfHost.title')}
              </h2>
              <p className="max-w-[52ch] text-base leading-7 text-[var(--color-fg-muted)]">
                {t('landing.selfHost.body')}
              </p>
            </div>
            <ol className="flex list-none flex-col gap-5 p-0">
              {STEP_KEYS.map((key, i) => (
                <li key={key} className="grid grid-cols-[28px_1fr] items-start gap-3.5">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-primary)] text-[13px] font-semibold text-[var(--color-primary-fg)]">
                    {i + 1}
                  </span>
                  <div className="flex flex-col gap-1">
                    <span className="text-[15px] font-semibold">
                      {t(`landing.selfHost.${key}.title`)}
                    </span>
                    <span className="text-sm leading-6 text-[var(--color-fg-muted)]">
                      {t(`landing.selfHost.${key}.body`)}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-5">
              <span className="text-xs font-semibold tracking-wider text-[var(--color-fg-muted)] uppercase">
                {t('landing.selfHost.quickStart')}
              </span>
              <pre className="overflow-x-auto font-mono text-[13px] leading-6">{QUICK_START}</pre>
            </div>
            <p className="text-sm leading-6 text-[var(--color-fg-muted)]">
              {t('landing.selfHost.docsPrompt')}{' '}
              <a
                href={`${REPO}/blob/main/docs/self-hosting.md`}
                className="text-[var(--color-primary)] underline"
              >
                {t('landing.selfHost.docsLink')}
              </a>
              . {t('landing.selfHost.registrationNote')}
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-7 px-5 py-18">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
              {t('landing.gallery.title')}
            </h2>
            <p className="text-base leading-7 text-[var(--color-fg-muted)]">
              {t('landing.gallery.body')}
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            {GALLERY_KEYS.map((key) => (
              <figure key={key} className="m-0 flex flex-col gap-2.5">
                <div className={frame} style={{ aspectRatio: '16 / 10' }}>
                  <Shot
                    name={GALLERY_SHOTS[key]}
                    locale={locale}
                    alt={t(`landing.shots.${key}`)}
                    className="h-full"
                  />
                </div>
                <figcaption className="text-sm leading-6 text-[var(--color-fg-muted)]">
                  {t(`landing.gallery.${key}`)}
                </figcaption>
              </figure>
            ))}
          </div>
          <figure className="m-0 flex flex-col gap-2.5">
            <div className={frame} style={{ aspectRatio: '3 / 2' }}>
              <Shot
                name="import"
                locale={locale}
                alt={t('landing.shots.import')}
                className="h-full"
              />
            </div>
            <figcaption className="text-sm leading-6 text-[var(--color-fg-muted)]">
              {t('landing.gallery.import')}
            </figcaption>
          </figure>
        </div>
      </section>

      <section
        id="status"
        className="border-t border-[var(--color-border)] bg-[var(--color-surface)]"
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-18">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
              {t('landing.status.title')}
            </h2>
            <p className="max-w-[68ch] text-base leading-7 text-[var(--color-fg-muted)]">
              {t('landing.status.body', { version: settings?.appVersion ?? '' })}
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {MILESTONES.map(({ key, status }) => (
              <div
                key={key}
                className={`flex flex-col gap-3.5 rounded-lg border bg-[var(--color-bg)] p-6 ${
                  status === 'done'
                    ? 'border-[var(--color-border)]'
                    : 'border-[var(--color-primary)]'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold">{t(`landing.status.${key}.title`)}</h3>
                  <span
                    className={`text-[13px] font-medium ${
                      status === 'done'
                        ? 'text-[var(--color-success)]'
                        : 'text-[var(--color-primary)]'
                    }`}
                  >
                    {t(`landing.status.${status}`)}
                  </span>
                </div>
                <ul className="flex list-none flex-col gap-2 p-0 text-sm leading-6 text-[var(--color-fg-muted)]">
                  {[0, 1, 2, 3].map((i) => (
                    <li key={i}>{t(`landing.status.${key}.items.${i}`)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-6 py-5">
            <p className="min-w-[320px] flex-1 text-[15px] leading-6 text-[var(--color-fg-muted)]">
              <strong className="font-semibold text-[var(--color-fg)]">
                {t('landing.status.builtTitle')}
              </strong>{' '}
              {t('landing.status.builtBody')}
            </p>
            <div className="flex gap-3">
              <a
                href={`${REPO}/blob/main/docs/vision.md`}
                className="inline-flex items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-border)]"
              >
                {t('landing.status.visionLink')}
              </a>
              <a
                href={REPO}
                className="inline-flex items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-border)]"
              >
                {t('landing.status.repoLink')}
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto grid max-w-6xl gap-14 px-5 py-18 lg:grid-cols-[320px_1fr]">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
              {t('landing.faq.title')}
            </h2>
            <p className="text-[15px] leading-6 text-[var(--color-fg-muted)]">
              {t('landing.faq.body')}{' '}
              <a
                href={`${REPO}/blob/main/CONTRIBUTING.md`}
                className="text-[var(--color-primary)] underline"
              >
                {t('landing.faq.contributeLink')}
              </a>
              .
            </p>
          </div>
          <dl className="m-0 flex flex-col">
            {FAQ_KEYS.map((key, i) => (
              <div
                key={key}
                className={`flex flex-col gap-1.5 border-t border-[var(--color-border)] py-5 ${
                  i === FAQ_KEYS.length - 1 ? 'border-b' : ''
                }`}
              >
                <dt className="text-[15px] font-semibold">{t(`landing.faq.${key}.q`)}</dt>
                <dd className="m-0 max-w-[74ch] text-sm leading-6 text-[var(--color-fg-muted)]">
                  {key === 'selfHost'
                    ? t(`landing.faq.selfHost.${canRegister ? 'aOpen' : 'aClosed'}`)
                    : t(`landing.faq.${key}.a`)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-5 py-18 text-center">
          <h2 className="max-w-[26ch] text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {t('landing.cta.title')}
          </h2>
          <p className="max-w-[56ch] text-base leading-7 text-[var(--color-fg-muted)]">
            {canRegister ? t('landing.cta.bodyOpen') : t('landing.cta.bodyClosed')}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {canRegister ? (
              <>
                <Link to="/register" className={primaryCta}>
                  {t('landing.createAccount')}
                </Link>
                <a
                  href="#self-host"
                  className="inline-flex items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-5 py-2.5 text-[15px] font-medium hover:bg-[var(--color-border)]"
                >
                  {t('landing.selfHostCta')}
                </a>
              </>
            ) : (
              <>
                <a href="#self-host" className={primaryCta}>
                  {t('landing.selfHostCta')}
                </a>
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-5 py-2.5 text-[15px] font-medium hover:bg-[var(--color-border)]"
                >
                  {t('landing.signIn')}
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      <footer className="border-t border-[var(--color-border)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-7 px-5 pt-10 pb-12">
          <div className="flex flex-wrap items-start justify-between gap-8">
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-3">
                <img src="/favicon.svg" alt="" className="h-6 w-6" />
                <span className="text-lg font-semibold">{t('app.name')}</span>
              </div>
              <p className="text-sm leading-6 text-[var(--color-fg-muted)]">
                {t('landing.footer.blurb')}{' '}
                <a
                  href={`${REPO}/blob/main/LICENSE`}
                  className="text-[var(--color-primary)] underline"
                >
                  {t('landing.footer.licence')}
                </a>
                .
              </p>
            </div>
            <div className="flex gap-14">
              <div className="flex flex-col gap-2 text-sm leading-6">
                <span className="font-semibold">{t('landing.footer.product')}</span>
                <a href="#features" className="text-[var(--color-fg-muted)] hover:underline">
                  {t('landing.nav.features')}
                </a>
                <a href="#status" className="text-[var(--color-fg-muted)] hover:underline">
                  {t('landing.nav.status')}
                </a>
                <Link to="/login" className="text-[var(--color-fg-muted)] hover:underline">
                  {t('landing.signIn')}
                </Link>
              </div>
              <div className="flex flex-col gap-2 text-sm leading-6">
                <span className="font-semibold">{t('landing.footer.project')}</span>
                <a href={REPO} className="text-[var(--color-fg-muted)] hover:underline">
                  {t('landing.nav.github')}
                </a>
                <a
                  href={`${REPO}/blob/main/docs/self-hosting.md`}
                  className="text-[var(--color-fg-muted)] hover:underline"
                >
                  {t('landing.footer.selfHostingGuide')}
                </a>
                <a
                  href={`${REPO}/tree/main/docs/adr`}
                  className="text-[var(--color-fg-muted)] hover:underline"
                >
                  {t('landing.footer.adrs')}
                </a>
                <a
                  href={`${REPO}/blob/main/CONTRIBUTING.md`}
                  className="text-[var(--color-fg-muted)] hover:underline"
                >
                  {t('landing.footer.contributing')}
                </a>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-[var(--color-border)] pt-6">
            <img src="/attribution/tmdb-logo.svg" alt="TMDB" className="h-5 w-auto" />
            <p className="text-[13px] leading-5 text-[var(--color-fg-muted)]">
              {t('landing.footer.attribution')}
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
