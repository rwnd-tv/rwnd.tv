import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { CALENDAR_EVENT_KINDS, type CalendarEventKind } from '@rwnd/shared'
import { api } from '../lib/api-client.js'
import { useAuth } from '../lib/use-auth.js'
import { useSortCookie } from '../lib/use-sort-cookie.js'
import { useKindFilterCookie } from '../lib/use-kind-filter-cookie.js'
import { localDayStartISO, localDayEndISO, toDateInputValue } from '../lib/date.js'
import { Spinner } from '../components/ui/Spinner.js'
import { Button } from '../components/ui/Button.js'
import { CalendarAgenda } from '../components/calendar/CalendarAgenda.js'
import { CalendarMonthGrid } from '../components/calendar/CalendarMonthGrid.js'
import { CALENDAR_KIND_DOT_CLASS } from '../components/calendar/calendar-shared.js'

const CALENDAR_VIEWS = ['agenda', 'month'] as const
type CalendarView = (typeof CALENDAR_VIEWS)[number]

// Back on (2026-09-09), after being temporarily off from 2026-09-06 while
// Agenda had a list of known issues James wanted fixed before it was
// user-facing again.
//
// The switch is kept rather than deleted: it's a one-line flip either way,
// and Agenda is being actively worked on. While off, the toggle button
// stays visible but disabled/greyed-out with a tooltip explaining why
// (`calendar.view.agendaDisabled`), rather than disappearing outright, and
// `effectiveView` below overrides a cookie that still says 'agenda' so a
// returning user doesn't land on a disabled view.
const AGENDA_VIEW_ENABLED = true

/** Which i18n key labels each event kind's filter toggle — 'watch' reads as
 * "History" here (the merged timeline's only past-facing kind), not its
 * ActivityKind namesake, which covers ratings/watchlist/dropped too. */
const CALENDAR_FILTER_LABEL_KEYS: Record<CalendarEventKind, string> = {
  watch: 'calendar.filter.history',
  episode: 'calendar.filter.shows',
  release: 'calendar.filter.movies',
}

// Agenda starts at today and only looks forward (2026-09-09): History
// already fully covers the past on its own page, and what's still to come
// is what this view uniquely offers. 90 days comfortably covers a season's
// remaining run and most announced release dates, extended in the same
// step by the "Load later" button.
const AGENDA_DEFAULT_DAYS_FORWARD = 90
const AGENDA_EXTEND_DAYS = 90
// Matches the API's own MAX_CALENDAR_WINDOW_DAYS (routes/calendar.ts) —
// buttons disable before a request would actually 400.
const MAX_WINDOW_DAYS = 1095

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/**
 * The in-app calendar (Settings > Calendar feeds' deferred in-app UI,
 * docs/TODO.md) — a merged timeline of past watches and upcoming episodes/
 * releases, toggle-able between an Agenda (day-grouped list) and a Month
 * grid (the default; see `AGENDA_VIEW_ENABLED` above — Agenda's toggle is
 * temporarily hidden), both fed by one `GET /calendar-events` query per
 * visible window (apps/api/src/calendar/build.ts's `buildCalendarTimeline`).
 *
 * One `useQuery` per window, not a `useInfiniteQuery` — the payload for
 * any one window is small and bounded by construction (a month, or a
 * ~120-day agenda), the server has no cursor to thread, and TanStack
 * caches per window key so paging back to an already-visited month is
 * instant. `keepPreviousData` is load-bearing for the same reason
 * HistoryPage.tsx needs it: without it, changing the window flips
 * `isLoading` true and the loading early-return unmounts the tree,
 * flashing on every navigation.
 */
export function CalendarPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const locale = user?.locale ?? 'en-GB'

  // Agenda is the default (2026-09-09): forward-looking is what this page
  // uniquely offers over History, and its dense list surfaces far more of
  // what's coming than a month grid's capped cells do. Month stays one
  // click away, and the cookie remembers whichever the user picks.
  const [view, setView] = useSortCookie<CalendarView>(
    'rwnd_calendar_view',
    CALENDAR_VIEWS,
    'agenda',
  )
  const effectiveView: CalendarView = AGENDA_VIEW_ENABLED ? view : 'month'
  const [agendaForwardDays, setAgendaForwardDays] = useState(AGENDA_DEFAULT_DAYS_FORWARD)
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(new Date()))
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [shownKinds, setShownKinds] = useKindFilterCookie<CalendarEventKind>(
    'rwnd_calendar_filter',
    CALENDAR_EVENT_KINDS,
  )

  function toggleKind(kind: CalendarEventKind) {
    const next = new Set(shownKinds)
    if (next.has(kind)) next.delete(kind)
    else next.add(kind)
    setShownKinds(next)
  }

  const { afterDay, beforeDay } = useMemo(() => {
    if (effectiveView === 'agenda') {
      // Agenda is forward-looking: today is its first day, so nothing
      // earlier is fetched at all rather than fetched and filtered out.
      return {
        afterDay: toDateInputValue(new Date()),
        beforeDay: toDateInputValue(addDays(new Date(), agendaForwardDays)),
      }
    }
    // Padding days from adjacent months that fill the 6x7 grid are
    // included by CalendarMonthGrid's own math — recomputed here from the
    // same locale/anchor so every visible cell's data is actually fetched.
    const firstOfMonth = startOfMonth(monthAnchor)
    const daysInView = 42
    // A generous fixed padding (rather than re-deriving the exact
    // locale-aware grid start) keeps this in sync with
    // CalendarMonthGrid.tsx's own gridStartFor by construction: the widest
    // possible offset a week-start convention can introduce is 6 days
    // either side of the calendar month.
    return {
      afterDay: toDateInputValue(addDays(firstOfMonth, -6)),
      beforeDay: toDateInputValue(addDays(firstOfMonth, daysInView + 6)),
    }
  }, [effectiveView, agendaForwardDays, monthAnchor])

  const afterISO = localDayStartISO(afterDay)
  const beforeISO = localDayEndISO(beforeDay)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['calendar-events', afterISO, beforeISO],
    queryFn: () => api.calendar.events({ after: afterISO, before: beforeISO }),
    placeholderData: keepPreviousData,
  })

  const nearWindowCap = agendaForwardDays + AGENDA_EXTEND_DAYS > MAX_WINDOW_DAYS
  const events = useMemo(
    () => (data?.events ?? []).filter((event) => shownKinds.has(event.kind)),
    [data, shownKinds],
  )

  if (isLoading) return <Spinner label={t('common.loading')} />

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('calendar.title')}</h1>

      {isError && (
        <p role="alert" className="text-[var(--color-danger)]">
          {t('common.somethingWentWrong')}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t('calendar.view.label')} className="flex gap-2">
          <Button
            type="button"
            variant={effectiveView === 'agenda' ? 'primary' : 'secondary'}
            aria-pressed={effectiveView === 'agenda'}
            disabled={!AGENDA_VIEW_ENABLED}
            title={AGENDA_VIEW_ENABLED ? undefined : t('calendar.view.agendaDisabled')}
            onClick={() => setView('agenda')}
          >
            {t('calendar.view.agenda')}
          </Button>
          <Button
            type="button"
            variant={effectiveView === 'month' ? 'primary' : 'secondary'}
            aria-pressed={effectiveView === 'month'}
            onClick={() => setView('month')}
          >
            {t('calendar.view.month')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <div role="group" aria-label={t('calendar.filter.label')} className="flex gap-2">
            {CALENDAR_EVENT_KINDS.map((kind) => {
              const active = shownKinds.has(kind)
              return (
                // Always the "secondary" (bordered) variant, active or not —
                // toggling the "ghost" variant in/out changed the border's
                // presence and shifted the button's width by a couple of
                // pixels on every click. Dimming with opacity instead (same
                // treatment Button.tsx's own :disabled state uses) changes
                // no box-model property, so the width never moves.
                <Button
                  key={kind}
                  type="button"
                  variant="secondary"
                  aria-pressed={active}
                  onClick={() => toggleKind(kind)}
                  className={active ? '' : 'opacity-60'}
                >
                  <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${CALENDAR_KIND_DOT_CLASS[kind]}`}
                    aria-hidden="true"
                  />
                  {t(CALENDAR_FILTER_LABEL_KEYS[kind])}
                </Button>
              )
            })}
          </div>

          {effectiveView === 'month' && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                aria-label={t('calendar.previousMonth')}
                onClick={() => setMonthAnchor((anchor) => startOfMonth(addDays(anchor, -1)))}
              >
                ‹
              </Button>
              {/* A fixed (not min-) width sized for "September 2026" — the
                  longest month name in either supported locale — so the
                  widget doesn't resize as the anchor month changes. */}
              <span className="w-40 shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-center text-sm font-medium">
                {new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
                  monthAnchor,
                )}
              </span>
              <Button
                type="button"
                variant="secondary"
                aria-label={t('calendar.nextMonth')}
                onClick={() => setMonthAnchor((anchor) => startOfMonth(addDays(anchor, 32)))}
              >
                ›
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setMonthAnchor(startOfMonth(new Date()))}
              >
                {t('calendar.today')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {!isError &&
        (effectiveView === 'agenda' ? (
          <CalendarAgenda
            events={events}
            locale={locale}
            onLoadLater={() => setAgendaForwardDays((days) => days + AGENDA_EXTEND_DAYS)}
            canLoadLater={!nearWindowCap}
          />
        ) : (
          <CalendarMonthGrid
            monthAnchor={monthAnchor}
            events={events}
            locale={locale}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
          />
        ))}
    </div>
  )
}
