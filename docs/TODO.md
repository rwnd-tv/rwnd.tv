# TODO

Smaller, non-milestone work — things to do, watch, or decide. For the
feature roadmap see [ROADMAP.md](ROADMAP.md); for why past decisions
were made see [adr/](adr/).

Format:

- `- [ ] **Title** (YYYY-MM-DD HH:MM added)\`, then details on the next line (trailing `\` forces the line break).
- An item also tracked in [ROADMAP.md](ROADMAP.md) gets a milestone suffix on the title line — `— M2`, `— M3`, `— Not yet scheduled` — so a listing of this file alone is a complete view of outstanding work, roadmap included. Omit the suffix for TODO-only items.
- Blank line between each item.
- Lists sorted oldest to newest.
- Completed items move to [TODO_ARCHIVE.md](TODO_ARCHIVE.md) rather than staying checked off here.

## Repo hygiene

- [ ] **Hold TS 7 bump** (2026-08-09 20:40)\
      `typescript-eslint` doesn't support TS 7 yet; leave any TS 7.0
      Dependabot bump open until it does.

## Code review follow-ups (2026-08-28)

Findings from the M3 code review pass (see `docs/TODO_ARCHIVE.md`'s "Code
review & tidy-up pass" for the full pass) that need a design decision
rather than a mechanical fix, so they were logged here instead of fixed
inline. Cross-confirmed by two independent review passes (a holistic
per-area audit plus `/code-review`) unless noted otherwise.

- [ ] **API: `findNextUnwatchedEpisode`/`findNextAiringEpisode` are ~90%
      duplicated** (2026-08-28 added)\
      `apps/api/src/lib/media.ts` — both scan seasons forward from
      `startSeasonNumber`, call `resolveSeason`, build the same
      `watchedIds` set, and `.find()` with only the predicate (and the
      gap-filling `minEpisodeNumberInStartSeason` logic) differing. Powers
      the Dashboard's On Deck/Up Next rows (`routes/library/queue.ts`).
      Unifying them means designing a shared scan/predicate signature that
      still reads clearly for both callers — a real, if small, design
      decision, not a pure extraction.
- [ ] **API: watchlist add/remove and the `watchedRange` aggregate are
      each duplicated between `shows.ts` and `movies.ts`** (2026-08-28
      added)\
      `routes/library/shows.ts`/`movies.ts` each independently implement
      the PUT/DELETE watchlist-membership handlers (differing only in
      table/entityType) and the same 1900-01-01-Trakt-sentinel-excluding
      `watchedRange` SQL fragment. Both are real duplication with the same
      "a fix applied to one and not the other" risk the split's
      `shared.ts` helpers (added in this pass) were meant to close off —
      worth a follow-up pass once the shape of a good shared
      show/movie-agnostic abstraction is clearer.
- [ ] **API: several show/movie detail-route queries could run via
      `Promise.all` instead of sequentially** (2026-08-28 added)\
      `GET /library/shows/{slug}` (5 queries) and `GET /library/movies/{slug}`
      (8 queries) each await mutually-independent lookups (external ids,
      watched range, rating, watchlist ids) one after another — a real,
      avoidable latency cost on two of the app's highest-traffic pages.
      Predates the library.ts split; not fixed inline because it touches
      the two busiest detail routes and deserves its own focused pass
      rather than being buried in a dedup commit.
- [ ] **Shared: `uuidSchema` is unused, and the "1-10 int rating" shape is
      duplicated ~10 times** (2026-08-28 added)\
      `packages/shared/src/schemas/common.ts`'s `uuidSchema` has zero
      importers — `z.string().uuid()` is hand-written 27 more times across
      8 files instead. Separately, `z.number().int().min(1).max(10)`
      (rating range, matching the DB's `ratings_rating_range` check) is
      defined inline 10 times with no shared base to compose the
      nullable/non-nullable variants from. Both are mechanical but touch
      `library.ts` heavily enough (10+ of the sites) to warrant a
      deliberate sweep rather than a silent inline edit — and worth
      deciding whether to delete `uuidSchema` instead of wiring it up, if
      nothing actually wants it.
- [ ] **DB: `sessions`, `apiTokens`, `emailVerificationTokens`, and
      `emailChangeTokens` have no index on `userId`, unlike sibling
      per-user tables** (2026-08-28 added)\
      `packages/db/src/schema.ts` — `plays`/`ratings`/`watchlistItems` all
      carry a `<table>_user_<col>_idx` because per-user queries filter on
      it; these four don't, despite `apps/api/src/lib/session.ts` (sign
      out / sign out everywhere), `routes/tokens.ts` (every load of the
      API-tokens settings page), and `lib/account-tokens.ts` (delete-by-
      userId before issuing a new token) all filtering by `userId`.
      `sessions` is the strongest case — no session-expiry cleanup job
      exists anywhere in `apps/api`, so it only grows. Needs a migration
      (`pnpm db:generate`), so logged rather than fixed inline.
- [ ] **Web: the watch-history table (checkbox list + delete-selected
      dialog) is duplicated across all four detail pages** (2026-08-28
      added)\
      `ShowDetailPage.tsx`, `SeasonDetailPage.tsx`, `MovieDetailPage.tsx`,
      and `EpisodeDetailPage.tsx` each independently reimplement the same
      `selectedWatchIds`/`deleteSelectedConfirmOpen` state pair, an
      identical `toggleWatchSelected` closure, a checkbox/date/time/source
      `<table>`, and the same delete-confirmation `<Dialog>` — ~90-110
      lines duplicated four times, unlike this codebase's other,
      deliberately-documented small-icon duplication. Extracting a shared
      `<WatchHistoryTable>` needs a real design decision (which optional
      columns to expose — Season/Episode aren't present on every page —
      and how the delete mutation is threaded through), so it's a backlog
      item, not a quick fix. Related, lower priority: `ShowsPage.tsx`/
      `MoviesPage.tsx` also duplicate their sort/filter-cookie wiring
      (~380-480 lines each) despite sharing well-factored filter logic
      (`lib/library-filter.ts`) — the duplication is page-level glue, not
      business logic.
- [ ] **Web: the M1 auth pages (Login/Register/Setup/ForgotPassword/
      ResetPassword) still hand-roll `async`/`try`/`catch` instead of the
      `useMutation` pattern every M3 mutation uses** (2026-08-28 added)\
      Confirmed across all five pages plus every M3-era mutation
      (`DeleteAccountCard.tsx` and the rest of `components/account/`,
      `settings/`, `import/`, `library/`) — a real, consistent split along
      the M1/M3 line, not a one-off. Converting is mechanical per page but
      touches five files' control flow, so logged rather than blind
      find/replace. Related: three of those same files
      (`LoginPage.tsx`, `DeleteAccountCard.tsx`, `LogoutButton.tsx`)
      independently hand-roll the identical `removeQueries` + `invalidateQueries`
      "wipe stale cross-account cache" sequence — worth extracting
      alongside the `useMutation` conversion, given how security-sensitive
      that logic is to keep in sync (see `LogoutButton.tsx`'s own doc
      comment on why the exact ordering matters).

## TV Shows / Movies gallery follow-ups

- [ ] **Virtualize the gallery grid if libraries grow** (2026-08-19 15:25)\
      Shipped without `content-visibility`/windowing — real libraries are
      ~500 shows/movies, comfortably fine for the DOM. Revisit if a
      self-hoster's library gets meaningfully larger and scroll performance
      suffers.
- [ ] **Title-sort article stripping** (2026-08-19 15:25)\
      The gallery's title sort ("Sort by: Title") is a plain locale-aware
      string compare — "The Wire" sorts under T, not W. Real per-language
      leading-article rules are a bigger job than this feature needed; left
      as a known simplification.

## Documentation

- [ ] **Refresh the GitHub-facing docs, and a self-hosting readiness pass** (2026-08-23 14:40 added, self-hosting pass folded in 2026-08-28) — M3\
      `README.md`'s "Status" section still says M1 is the only thing
      shipped and Trakt import is "next" — both M1 and M2 are done now
      (see `docs/TODO_ARCHIVE.md` for the real history). Update
      `README.md`/`docs/vision.md`/`docs/ROADMAP.md` to reflect where the
      project actually is, give the roadmap more visibility (right now
      it's just a linked doc, easy to miss from the README), and
      generally make the repo read as more current and inviting to
      someone landing on it cold. Last of the M3 content items — run
      after the code review and security review so it describes the
      actual end state instead of needing a second pass. Also confirm
      `docker-compose.yml`/`.env.example`/`docs/self-hosting.md` actually
      work end to end for a real self-hoster.

## Auth & accounts

- [ ] **Passkey (WebAuthn) support** (2026-08-23 15:45 added)\
      Another `user_credentials` adapter type alongside `local`/`oidc`
      (see [ADR 0003](adr/0003-auth-model.md)) — sign in/register with a
      device passkey instead of a password. Not on ROADMAP.md yet; pairs
      naturally with the OIDC login item below since both plug into the
      same credentials schema, but it's its own protocol (WebAuthn, no
      external identity provider or redirect involved).
- [ ] **Explore OAuth device-flow login (for a future TV app)** (2026-08-23 16:00 added)\
      The RFC 8628 device authorization grant — the "enter this code on
      your phone" / QR flow BBC iPlayer, Disney+, and `gh auth login`
      all use for devices with no comfortable keyboard. Only relevant
      once there's an actual rwnd.tv TV app to log into, which doesn't
      exist yet — this is groundwork, not urgent. Needs a device-
      authorization endpoint, a short human-typeable code + polling on
      the device side, and a verification page. Worth designing the
      approval page carefully — device-code flows have a known phishing
      pattern where someone's talked into approving a code that isn't
      theirs, so the page should make clear what's being authorized
      rather than a bare yes/no.

## Self-hosting & deployment

- [ ] **Cut the first tagged release** (2026-08-26 added) — M3\
      `SECURITY.md` says rwnd.tv is "pre-1.0... until the first stable
      release," and `docker-compose.yml`'s own comment already
      anticipates this: "`edge` tracks main until the first tagged
      release exists, after which `latest` will track the newest release
      instead — see release.yml." M3 — ready for real use — is the
      natural point to actually do this. Needs deciding: version number
      (v1.0.0?), what "stable" means for a pre-1.0 project moving this
      fast (semver commitment level), and whether `release.yml` needs
      changes beyond what the existing comment already implies.

## Security

- [ ] **Full security review before M3 closes** (2026-08-26 added) — M3\
      James, 2026-08-26: wants a full security review as part of "ready
      for real use," not just the existing `SECURITY.md` policy
      (reporting process) and its named areas of interest (session
      handling, API token handling, multi-user data isolation). Scope not
      yet defined — worth deciding whether this is a self-review, an
      external audit, or a structured pass (e.g. OWASP ASVS/Top 10
      checklist) against auth, session/cookie handling, API tokens,
      webhook ingestion auth, multi-user data isolation, secrets handling
      (`ENCRYPTION_KEY`, SMTP/OAuth credentials), and dependency
      vulnerabilities, before scheduling the work itself.

## Roadmap

Every open item from [ROADMAP.md](ROADMAP.md) that doesn't already have a
more specific TODO elsewhere in this file. Kept brief — ROADMAP.md is the
source of truth for scope; this is just so a TODO listing is complete.

- [ ] **Tautulli/Jellyfin/Emby/Kodi webhook ingestion** (2026-08-24 16:25 added, un-M2'd 2026-08-24, M4'd 2026-08-28) — M4\
      Plex's own webhook shipped 2026-08-24 (see `docs/TODO_ARCHIVE.md`) —
      the entity-resolution/auth core it's built on
      (`apps/api/src/lib/external-match.ts`,
      `apps/api/src/lib/api-tokens.ts`) is deliberately source-agnostic,
      so each of these is "write one payload parser + one route," not a
      rework. Tautulli's webhook body is fully user-templated (no fixed
      shape — needs its own JSON template + setup docs, unlike Plex's
      fixed format), which is why it wasn't bundled into the same pass.
      James, 2026-08-24: not needed to close out M2 — ROADMAP.md's own M2
      "Plex webhook ingestion" bullet only ever mentioned these in
      passing as future work, not as a separate required checkbox, so
      this was over-tagged M2 when first added. Left unmilestoned rather
      than reassigned to M3 — no strong reason it belongs there either.
- [ ] **Stats and insights** (2026-08-23 15:32 added, un-M3'd 2026-08-26) — Not yet scheduled\
      The reason to log anything in the first place, but not essential to
      the core logging loop M3 was narrowed to (2026-08-26 — see
      ROADMAP.md's M3 framing).
- [ ] **Calendar of upcoming episodes** (2026-08-23 15:33 added, un-M3'd 2026-08-26, M4'd 2026-08-28) — M4\
      A view of what's airing next across the shows you're following.
- [ ] **OIDC login** (2026-08-23 15:34 added, un-M3'd 2026-08-26) — Not yet scheduled\
      The `user_credentials` schema was designed for this from M1 — see
      [ADR 0003](adr/0003-auth-model.md).
- [ ] **Additional locales beyond English** (2026-08-26 added) — Not yet scheduled\
      en-GB/en-US both ship today; more locales is pure expansion, not
      something the core logging loop needs.
- [ ] **Mobile-friendly PWA installability** (2026-08-23 15:37 added) — Not yet scheduled\
      Installable/add-to-home-screen support.
- [ ] **Public/shareable profile pages** (2026-08-23 15:38 added) — Not yet scheduled\
      A public view of a user's watch history/stats.
