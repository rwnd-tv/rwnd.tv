import type { ReactNode } from 'react'
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
 *
 * Self-host is always the primary call to action, in the hero and
 * everywhere else it appears, regardless of `canRegister`: self-hosting is
 * the actual differentiator, so it leads unconditionally. Only the
 * *secondary* action (create an account vs. sign in) depends on whether
 * this instance is taking registrations. See CLAUDE.md's "Public-facing
 * design surfaces" section for why this page's structure deliberately
 * doesn't mirror the closest comparable open-source project's.
 */

const SHOTS = '/landing'
const GRADIENT = 'linear-gradient(135deg, #d946ef 0%, #f59e0b 100%)'

const FEATURE_KEYS = ['log', 'plex', 'trakt', 'galleries', 'lists', 'export', 'calendar'] as const
const STEP_KEYS = ['run', 'import', 'current'] as const
const GALLERY_SHOTS = {
  films: 'movies',
  show: 'show-detail',
  season: 'season',
} as const
const FAQ_KEYS = ['selfHost', 'dropIn', 'metadata', 'requirements', 'players'] as const
const MILESTONES = [
  { key: 'm1', status: 'done' },
  { key: 'm2', status: 'done' },
  { key: 'm3', status: 'done' },
] as const

const QUICK_START = `curl -O https://raw.githubusercontent.com/rwnd-tv/rwnd.tv/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/rwnd-tv/rwnd.tv/main/.env.example
mv .env.example .env
# edit .env (see docs/self-hosting.md)
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

/** The hero's and self-host section's dark "terminal window" chrome, kept
 * visually dark regardless of the page's own light/dark theme (a terminal
 * window reads as a terminal window either way), same convention as the
 * traffic-light dots below it. */
function TerminalWindow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-[#2e2e34] bg-[#1b1b1f]">
      <div className="flex items-center gap-2 bg-[#232328] px-3.5 py-[11px]">
        <span className="h-2.5 w-2.5 rounded-full bg-[#f47067]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#f5b942]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#3fb950]" />
        <span className="ml-1.5 font-mono text-[11.5px] text-[#7a7a85]">{label}</span>
      </div>
      {children}
    </div>
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
  // can't take sign-ups. Unlike the old page, this only changes the
  // *secondary* action below; self-host stays primary either way.
  const canRegister =
    !!settings && settings.registrationMode !== 'closed' && settings.emailConfigured

  const sectionLink =
    'text-sm font-medium text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
  const primaryCta =
    'inline-flex h-[46px] items-center justify-center rounded-lg px-[22px] text-[14.5px] font-semibold text-[#16161a]'
  const secondaryCta =
    'inline-flex h-[46px] items-center justify-center rounded-lg border border-[var(--color-border)] px-[22px] text-[14.5px] font-semibold text-[var(--color-fg)] hover:bg-[var(--color-surface)]'
  const ghostBtnSm =
    'inline-flex h-[38px] items-center justify-center rounded-md border border-[var(--color-border)] px-4 text-[13.5px] font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface)]'
  const numeral =
    'w-[46px] shrink-0 bg-clip-text text-[15px] font-bold tracking-wide text-transparent'

  const secondaryCtaLabel = canRegister ? t('landing.createAccount') : t('landing.signIn')
  const secondaryCtaTo = canRegister ? '/register' : '/login'

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-fg)]">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-7 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-5">
        <a href="#top" className="flex shrink-0 items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="h-[22px] w-[22px] shrink-0" />
          <span className="text-[15.5px] font-bold">{t('app.name')}</span>
        </a>
        <nav className="hidden min-w-0 flex-1 items-center gap-5 md:flex">
          <a href="#features" className={sectionLink}>
            {t('landing.nav.features')}
          </a>
          <a href="#self-host" className={sectionLink}>
            {t('landing.nav.selfHost')}
          </a>
          <a href="#status" className={sectionLink}>
            {t('landing.nav.status')}
          </a>
          <a href="#faq" className={sectionLink}>
            {t('landing.nav.faq')}
          </a>
          <a href={REPO} className={sectionLink}>
            {t('landing.nav.github')}
          </a>
        </nav>
        <div className="flex flex-1 items-center justify-end gap-2.5 md:flex-none">
          <Link to="/login" className={ghostBtnSm}>
            {t('landing.signIn')}
          </Link>
          {canRegister && (
            <Link
              to="/register"
              className="inline-flex h-[38px] items-center justify-center rounded-md bg-[var(--color-fg)] px-4 text-[13.5px] font-semibold text-[var(--color-bg)]"
            >
              {t('landing.createAccountShort')}
            </Link>
          )}
        </div>
      </header>

      {/* HERO: self-hosting is the headline claim, not a supporting section. */}
      <section
        id="top"
        className="mx-auto grid max-w-6xl gap-14 px-5 pt-[76px] pb-16 lg:grid-cols-2 lg:items-center"
      >
        <div className="flex flex-col gap-[22px]">
          <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold tracking-wide text-[var(--color-fg-muted)] uppercase">
            <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--color-success)]" />
            {t('landing.hero.status', { version: settings?.appVersion ?? '' })}
          </span>
          <h1 className="max-w-[20ch] text-[50px] leading-[1.08] font-extrabold tracking-tight text-balance">
            {t('landing.hero.title')}
          </h1>
          <p className="max-w-[46ch] text-[17px] leading-[1.6] text-pretty text-[var(--color-fg-muted)]">
            {t('landing.hero.body')}
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <a href="#self-host" className={primaryCta} style={{ backgroundImage: GRADIENT }}>
              {t('landing.selfHostCta')}
            </a>
            <Link to={secondaryCtaTo} className={secondaryCta}>
              {secondaryCtaLabel}
            </Link>
          </div>
          <p className="pt-1.5 font-mono text-xs tracking-wide text-[var(--color-fg-muted)]">
            {t('landing.hero.meta')}
          </p>
        </div>
        <div className="relative">
          <div
            className="pointer-events-none absolute -inset-10 -z-10 blur-md"
            style={{
              background:
                'radial-gradient(closest-side, rgba(217,70,239,0.22), rgba(245,158,11,0.12), transparent 72%)',
            }}
          />
          <div className="rotate-[-0.6deg]">
            <TerminalWindow
              label={`${typeof window !== 'undefined' ? window.location.host : 'yourdomain.example'} · rwnd.tv`}
            >
              <div style={{ aspectRatio: '16 / 10' }} className="overflow-hidden bg-[#0f0f11]">
                <Shot
                  name="dashboard"
                  locale={locale}
                  alt={t('landing.shots.dashboard')}
                  className="h-full"
                  lazy={false}
                />
              </div>
            </TerminalWindow>
          </div>
        </div>
      </section>

      {/* PROOF STRIP */}
      <div className="border-y border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-9 px-5 py-4">
          {MILESTONES.map(({ key }) => (
            <span
              key={key}
              className="font-mono text-[12.5px] font-semibold text-[var(--color-success)]"
            >
              ✓ {t(`landing.strip.${key}.label`)}
            </span>
          ))}
          <span className="hidden h-4 w-px bg-[var(--color-border)] sm:block" />
          <span className="text-[13px] text-[var(--color-fg-muted)]">
            <strong className="font-semibold text-[var(--color-fg)]">
              {t('landing.strip.honest.label')}
            </strong>{' '}
            {t('landing.strip.honest.body')}{' '}
            <a href="#status" className="text-[13px] text-[var(--color-primary)] underline">
              {t('landing.strip.honest.link')}
            </a>
          </span>
        </div>
      </div>

      {/* FEATURES: numbered rows, not a card grid. */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-20">
        <div className="mb-10 max-w-[60ch]">
          <h2 className="mb-2.5 text-[28px] font-extrabold tracking-tight">
            {t('landing.features.title')}
          </h2>
          <p className="text-[15.5px] leading-[1.6] text-[var(--color-fg-muted)]">
            {t('landing.features.body')}
          </p>
        </div>
        <div className="border-t border-[var(--color-border)]">
          {FEATURE_KEYS.map((key, i) => (
            <div key={key} className="flex gap-6 border-b border-[var(--color-border)] py-[22px]">
              <span className={numeral} style={{ backgroundImage: GRADIENT }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="max-w-[64ch]">
                <h3 className="mb-1.5 text-[16.5px] font-bold">
                  {t(`landing.features.${key}.title`)}
                </h3>
                <p className="text-[14.5px] leading-[1.65] text-[var(--color-fg-muted)]">
                  {t(`landing.features.${key}.body`)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* SELF-HOST: the section this page actually leads with. */}
      <section
        id="self-host"
        className="border-y border-[var(--color-border)] bg-[var(--color-surface)]"
      >
        <div className="mx-auto grid max-w-6xl gap-14 px-5 py-20 lg:grid-cols-2">
          <div>
            <h2 className="mb-2.5 text-[28px] font-extrabold tracking-tight">
              {t('landing.selfHost.title')}
            </h2>
            <p className="mb-[30px] max-w-[48ch] text-[15px] leading-[1.6] text-[var(--color-fg-muted)]">
              {t('landing.selfHost.body')}
            </p>
            <div className="relative pl-0.5">
              <div
                className="absolute top-1.5 bottom-1.5 left-[15px] w-0.5"
                style={{ backgroundImage: 'linear-gradient(180deg, #d946ef, #f59e0b)' }}
              />
              <ol className="m-0 list-none p-0">
                {STEP_KEYS.map((key, i) => (
                  <li key={key} className="relative flex gap-[18px] pb-[26px] last:pb-0">
                    <span className="z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-[var(--color-border)] bg-[var(--color-bg)] text-[13.5px] font-bold">
                      {i + 1}
                    </span>
                    <div>
                      <span className="mb-1 block text-[15px] font-bold">
                        {t(`landing.selfHost.${key}.title`)}
                      </span>
                      <span className="block max-w-[42ch] text-sm leading-[1.6] text-[var(--color-fg-muted)]">
                        {t(`landing.selfHost.${key}.body`)}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <div className="flex flex-col gap-3.5">
            <TerminalWindow label={t('landing.selfHost.quickStart')}>
              <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-[1.9] text-[#e2e2e5]">
                {QUICK_START}
              </pre>
            </TerminalWindow>
            <p className="text-[13.5px] leading-[1.6] text-[var(--color-fg-muted)]">
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

      {/* GALLERY: shadow-elevated, not bordered cards; five real shots. */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="mb-11 max-w-[60ch]">
          <h2 className="mb-2.5 text-[28px] font-extrabold tracking-tight">
            {t('landing.gallery.title')}
          </h2>
          <p className="text-[15.5px] leading-[1.6] text-[var(--color-fg-muted)]">
            {t('landing.gallery.body')}
          </p>
        </div>
        {/* Two columns, not three. A real screenshot needs to stay large
            enough to actually read (poster titles, small controls), and a
            third column was shrinking these past that point. The
            differentiation from a plain grid comes from the shadow-elevated,
            borderless tiles below, not from the column count. */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <figure className="m-0">
            <div
              className="overflow-hidden rounded-[10px] bg-[var(--color-surface)] shadow-[0_1px_3px_rgba(0,0,0,0.1),0_14px_30px_-16px_rgba(0,0,0,0.35)]"
              style={{ aspectRatio: '16 / 10' }}
            >
              <Shot
                name="tv-shows"
                locale={locale}
                alt={t('landing.shots.shows')}
                className="h-full"
              />
            </div>
            <figcaption className="mt-2.5 text-[13px] text-[var(--color-fg-muted)]">
              {t('landing.gallery.shows')}
            </figcaption>
          </figure>
          <figure className="m-0">
            <div
              className="overflow-hidden rounded-[10px] bg-[var(--color-surface)] shadow-[0_1px_3px_rgba(0,0,0,0.1),0_14px_30px_-16px_rgba(0,0,0,0.35)]"
              style={{ aspectRatio: '16 / 10' }}
            >
              <Shot
                name={GALLERY_SHOTS.films}
                locale={locale}
                alt={t('landing.shots.films')}
                className="h-full"
              />
            </div>
            <figcaption className="mt-2.5 text-[13px] text-[var(--color-fg-muted)]">
              {t('landing.gallery.films')}
            </figcaption>
          </figure>
          {(['show', 'season'] as const).map((key) => (
            <figure key={key} className="m-0">
              <div
                className="overflow-hidden rounded-[10px] bg-[var(--color-surface)] shadow-[0_1px_3px_rgba(0,0,0,0.1),0_14px_30px_-16px_rgba(0,0,0,0.35)]"
                style={{ aspectRatio: '16 / 10' }}
              >
                <Shot
                  name={GALLERY_SHOTS[key]}
                  locale={locale}
                  alt={t(`landing.shots.${key}`)}
                  className="h-full"
                />
              </div>
              <figcaption className="mt-2.5 text-[13px] text-[var(--color-fg-muted)]">
                {t(`landing.gallery.${key}`)}
              </figcaption>
            </figure>
          ))}
        </div>
        <figure className="m-0 mt-6">
          <div
            className="overflow-hidden rounded-[10px] bg-[var(--color-surface)] shadow-[0_1px_3px_rgba(0,0,0,0.1),0_14px_30px_-16px_rgba(0,0,0,0.35)]"
            style={{ aspectRatio: '16 / 10' }}
          >
            <Shot
              name="import"
              locale={locale}
              alt={t('landing.shots.import')}
              className="h-full"
            />
          </div>
          <figcaption className="mt-2.5 text-[13px] text-[var(--color-fg-muted)]">
            {t('landing.gallery.import')}
          </figcaption>
        </figure>
      </section>

      {/* STATUS: a colonnade with hairline dividers, not bordered cards. */}
      <section id="status" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="mb-11 max-w-[68ch]">
            <h2 className="mb-2.5 text-[28px] font-extrabold tracking-tight">
              {t('landing.status.title')}
            </h2>
            <p className="text-[15.5px] leading-[1.6] text-[var(--color-fg-muted)]">
              {t('landing.status.body', { version: settings?.appVersion ?? '' })}
            </p>
          </div>
          <div className="mb-9 grid gap-0 lg:grid-cols-3">
            {MILESTONES.map(({ key }, i) => (
              <div
                key={key}
                className={`px-7 first:pl-0 ${i > 0 ? 'border-[var(--color-border)] lg:border-l' : ''}`}
              >
                <div className="mb-4 flex items-baseline justify-between gap-2 border-b border-[var(--color-border)] pb-3">
                  <h3 className="text-[15px] font-bold">{t(`landing.status.${key}.title`)}</h3>
                  <span className="font-mono text-[11.5px] font-bold text-[var(--color-success)]">
                    {t('landing.status.done')}
                  </span>
                </div>
                <ul className="m-0 flex list-none flex-col gap-[11px] p-0 text-[13.5px] leading-[1.5] text-[var(--color-fg-muted)]">
                  {[0, 1, 2, 3].map((itemIndex) => (
                    <li key={itemIndex} className="relative pl-4">
                      <span className="absolute left-0 text-[var(--color-success)]">•</span>
                      {t(`landing.status.${key}.items.${itemIndex}`)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div
            className="flex flex-wrap items-center justify-between gap-5 rounded-b-[10px] bg-[var(--color-surface)] px-[26px] py-[22px]"
            style={{
              borderTop: '3px solid',
              borderImage: `${GRADIENT.replace('135deg', '90deg')} 1`,
            }}
          >
            <p className="min-w-[320px] flex-1 text-[14.5px] leading-[1.6] text-[var(--color-fg-muted)]">
              <strong className="font-bold text-[var(--color-fg)]">
                {t('landing.status.builtTitle')}
              </strong>{' '}
              {t('landing.status.builtBody')}
            </p>
            <div className="flex gap-2.5">
              <a href={`${REPO}/blob/main/docs/vision.md`} className={ghostBtnSm}>
                {t('landing.status.visionLink')}
              </a>
              <a href={REPO} className={ghostBtnSm}>
                {t('landing.status.repoLink')}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-y border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto grid max-w-6xl gap-14 px-5 py-20 lg:grid-cols-[300px_1fr]">
          <div>
            <h2 className="mb-2.5 text-[28px] font-extrabold tracking-tight">
              {t('landing.faq.title')}
            </h2>
            <p className="text-[14.5px] leading-[1.6] text-[var(--color-fg-muted)]">
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
                className={`flex flex-col gap-2 border-t border-[var(--color-border)] py-5 ${
                  i === FAQ_KEYS.length - 1 ? 'border-b' : ''
                }`}
              >
                <dt className="text-[15px] font-bold">{t(`landing.faq.${key}.q`)}</dt>
                <dd className="m-0 max-w-[72ch] text-sm leading-[1.65] text-[var(--color-fg-muted)]">
                  {key === 'selfHost'
                    ? t(`landing.faq.selfHost.${canRegister ? 'aOpen' : 'aClosed'}`)
                    : t(`landing.faq.${key}.a`)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 py-[76px] text-center">
        <h2 className="max-w-[26ch] text-[26px] font-extrabold tracking-tight text-balance">
          {t('landing.cta.title')}
        </h2>
        <p className="max-w-[52ch] text-[15px] leading-[1.6] text-[var(--color-fg-muted)]">
          {canRegister ? t('landing.cta.bodyOpen') : t('landing.cta.bodyClosed')}
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-1.5">
          <a href="#self-host" className={primaryCta} style={{ backgroundImage: GRADIENT }}>
            {t('landing.selfHostCta')}
          </a>
          <Link to={secondaryCtaTo} className={secondaryCta}>
            {secondaryCtaLabel}
          </Link>
        </div>
      </section>

      <footer className="border-t border-[var(--color-border)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-7 px-5 pt-11 pb-10">
          <div className="flex flex-wrap items-start justify-between gap-10">
            <div className="flex max-w-[36ch] flex-col gap-2.5">
              <div className="flex items-center gap-2.5">
                <img src="/favicon.svg" alt="" className="h-[18px] w-[18px]" />
                <span className="text-[14.5px] font-bold">{t('app.name')}</span>
              </div>
              <p className="text-[13.5px] leading-[1.6] text-[var(--color-fg-muted)]">
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
              <div className="flex flex-col gap-2.5 text-[13.5px]">
                <span className="font-bold">{t('landing.footer.product')}</span>
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
              <div className="flex flex-col gap-2.5 text-[13.5px]">
                <span className="font-bold">{t('landing.footer.project')}</span>
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
