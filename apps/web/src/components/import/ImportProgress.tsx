import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { ImportJobFailure, ImportJobStatus } from '@rwnd/shared'
import { api } from '../../lib/api-client.js'
import { Card } from '../ui/Card.js'

const ACTIVE_STATUSES: ReadonlySet<ImportJobStatus> = new Set(['pending', 'running'])

interface FailureEpisodeNode {
  episode: number
  failures: ImportJobFailure[]
}
interface FailureSeasonNode {
  season: number
  /** Season-level failures (e.g. a `season`-type watchlist entry) that
   * have no specific episode to nest under. */
  direct: ImportJobFailure[]
  episodes: FailureEpisodeNode[]
  /** Total failures at and beneath this season, for the tree's count badge. */
  total: number
}
interface FailureShowNode {
  name: string
  /** Movie failures, and show-level failures with no season/episode. */
  direct: ImportJobFailure[]
  seasons: FailureSeasonNode[]
  /** Total failures at and beneath this show, for the tree's count badge. */
  total: number
}

/** " (N)" once there's more than one failure to distinguish — a single
 * failure is already fully described by its own line, so the count would
 * just repeat "(1)" next to every leaf. */
function countBadge(count: number): string {
  return count > 1 ? ` (${count})` : ''
}

/**
 * Groups a flat failure list into show/movie > season > episode, the shape
 * requested for the failures UI. Shows/movies sort alphabetically by name;
 * seasons and episodes sort numerically — an alphabetical sort would put
 * "Season 10" before "Season 2", which isn't what anyone means by "sorted"
 * for numbers.
 */
function buildFailureTree(failures: ImportJobFailure[]): FailureShowNode[] {
  const shows = new Map<
    string,
    {
      direct: ImportJobFailure[]
      seasons: Map<
        number,
        { direct: ImportJobFailure[]; episodes: Map<number, ImportJobFailure[]> }
      >
    }
  >()

  for (const failure of failures) {
    const name = failure.show ?? failure.title ?? failure.reason
    let show = shows.get(name)
    if (!show) {
      show = { direct: [], seasons: new Map() }
      shows.set(name, show)
    }
    if (failure.season == null) {
      show.direct.push(failure)
      continue
    }
    let season = show.seasons.get(failure.season)
    if (!season) {
      season = { direct: [], episodes: new Map() }
      show.seasons.set(failure.season, season)
    }
    if (failure.episode == null) {
      season.direct.push(failure)
      continue
    }
    const episodeFailures = season.episodes.get(failure.episode)
    if (episodeFailures) episodeFailures.push(failure)
    else season.episodes.set(failure.episode, [failure])
  }

  return [...shows.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, show]) => {
      const seasons = [...show.seasons.entries()]
        .sort(([a], [b]) => a - b)
        .map(([season, seasonData]) => {
          const episodes = [...seasonData.episodes.entries()]
            .sort(([a], [b]) => a - b)
            .map(([episode, epFailures]) => ({ episode, failures: epFailures }))
          const seasonTotal =
            seasonData.direct.length + episodes.reduce((sum, ep) => sum + ep.failures.length, 0)
          return { season, direct: seasonData.direct, episodes, total: seasonTotal }
        })
      const showTotal = show.direct.length + seasons.reduce((sum, season) => sum + season.total, 0)
      return { name, direct: show.direct, seasons, total: showTotal }
    })
}

const PHASE_CHIP_CLASSES: Record<string, string> = {
  history: 'border-sky-500/40 bg-sky-500/15 text-sky-500',
  ratings: 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-500',
  watchlist: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-500',
  dropped: 'border-amber-500/40 bg-amber-500/15 text-amber-500',
}

/** Same pill shape as EnvironmentBadge, one colour per import phase so a
 * failure's origin (watch history vs a rating vs the watchlist) is visible
 * without reading the full line. */
function PhaseChip({ phase }: { phase: string }) {
  const { t } = useTranslation()
  const classes =
    PHASE_CHIP_CLASSES[phase] ?? 'border-[var(--color-border)] text-[var(--color-fg-muted)]'
  return (
    <span
      title={t(`import.progress.phaseLabel.${phase}`, phase)}
      className={`mr-1.5 inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${classes}`}
    >
      {t(`import.progress.phase.${phase}`, phase)}
    </span>
  )
}

/** `<li>` items only — the caller supplies the wrapping `<ul>`, since these
 * sometimes sit directly inside a parent list (show/season direct
 * failures) rather than under their own heading. */
function FailureItems({ failures }: { failures: ImportJobFailure[] }) {
  return (
    <>
      {failures.map((failure, i) => (
        <li key={i}>
          <PhaseChip phase={failure.phase} />
          {failure.reason}
        </li>
      ))}
    </>
  )
}

/** "M:SS" under an hour, "H:MM:SS" beyond — digits and colons need no
 * translation, so this sidesteps building out proper duration i18n for
 * what's meant to be a simple estimate. */
function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

export function ImportProgress() {
  const { t } = useTranslation()

  const { data } = useQuery({
    queryKey: ['import', 'jobs'],
    queryFn: () => api.imports.jobs(),
    refetchInterval: (query) => {
      const latest = query.state.data?.jobs[0]
      return latest && ACTIVE_STATUSES.has(latest.status) ? 1500 : false
    },
  })

  const latest = data?.jobs[0]
  if (!latest) return null

  const total = latest.itemsTotal

  // Elapsed re-derives from startedAt/finishedAt/now on every render, which
  // is driven by the 1.5s poll above while active — no separate ticking
  // timer needed to "keep updating" the estimate. A simple linear
  // projection: whatever rate got us to itemsProcessed so far is assumed
  // to hold for the rest.
  const startedAtMs = latest.startedAt ? new Date(latest.startedAt).getTime() : null
  const endedAtMs = latest.finishedAt ? new Date(latest.finishedAt).getTime() : Date.now()
  const elapsedSeconds = startedAtMs != null ? (endedAtMs - startedAtMs) / 1000 : null
  const remainingSeconds =
    latest.status === 'running' && elapsedSeconds != null && total && latest.itemsProcessed > 0
      ? (elapsedSeconds * (total - latest.itemsProcessed)) / latest.itemsProcessed
      : null
  // Trakt's own X-Pagination-Item-Count can slightly overcount relative to
  // what actually comes back across all pages, so itemsProcessed sometimes
  // never quite reaches itemsTotal even once the job has genuinely
  // finished — force the bar to 100% once we know that for a fact.
  const percent =
    latest.status === 'completed'
      ? 100
      : total
        ? Math.min(100, Math.round((latest.itemsProcessed / total) * 100))
        : null

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">{t('import.progress.title')}</h2>
      <div className="mb-1 flex items-baseline justify-between gap-4 text-sm text-[var(--color-fg-muted)]">
        <span>
          {t(`import.progress.status.${latest.status}`)}
          {' · '}
          {t(`import.progress.source.${latest.source}`)}
        </span>
        {elapsedSeconds != null && (
          <span className="text-right">
            {t('import.progress.elapsed', { duration: formatDuration(elapsedSeconds) })}
            {remainingSeconds != null &&
              ` · ${t('import.progress.remaining', { duration: formatDuration(remainingSeconds) })}`}
          </span>
        )}
      </div>

      <div
        role="progressbar"
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mb-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]"
      >
        <div
          className="h-full rounded-full bg-[var(--color-primary)] transition-all"
          style={{ width: percent != null ? `${percent}%` : '0%' }}
        />
      </div>
      <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
        {t('import.progress.counts', {
          processed: latest.itemsProcessed,
          imported: latest.itemsImported,
        })}
      </p>

      {latest.failures.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            {t('import.progress.failuresSummary', { count: latest.failures.length })}
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-[var(--color-fg-muted)]">
            {buildFailureTree(latest.failures).map((show) => (
              <li key={show.name}>
                <details>
                  <summary className="cursor-pointer">
                    {show.name}
                    {countBadge(show.total)}
                  </summary>
                  <ul className="mt-1 flex flex-col gap-1 pl-4">
                    <FailureItems failures={show.direct} />
                    {show.seasons.map((season) => (
                      <li key={season.season}>
                        <details>
                          <summary className="cursor-pointer">
                            {t('import.progress.season', { number: season.season })}
                            {countBadge(season.total)}
                          </summary>
                          <ul className="mt-1 flex flex-col gap-1 pl-4">
                            <FailureItems failures={season.direct} />
                            {season.episodes.map((ep) => (
                              <li key={ep.episode}>
                                <details>
                                  <summary className="cursor-pointer">
                                    {t('import.progress.episode', { number: ep.episode })}
                                    {countBadge(ep.failures.length)}
                                  </summary>
                                  <ul className="mt-1 flex flex-col gap-1 pl-4">
                                    <FailureItems failures={ep.failures} />
                                  </ul>
                                </details>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </details>
      )}

      {latest.error && <p className="mt-2 text-sm text-[var(--color-danger)]">{latest.error}</p>}
    </Card>
  )
}
