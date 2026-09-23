# TODO

Smaller, non-milestone work: things to do, watch, or decide. For the
feature roadmap see [ROADMAP.md](ROADMAP.md); for why past decisions
were made see [adr/](adr/).

Format:

- `- [ ] **Title** (YYYY-MM-DD HH:MM added)`, then a blank line, then the body.
- Break the body into short paragraphs at its natural seams (what/why, what's blocking it, the decision) rather than one dense block, each separated by a real blank line (indented the same as the surrounding text), not a trailing `\`. A trailing `\` only shows up as a break in a rendered Markdown view; a real blank line reads correctly in a raw, unrendered view too (e.g. GitHub Desktop's diff view). Same convention as `I:\Game\Akari\TODO.md`.
- An item also tracked in [ROADMAP.md](ROADMAP.md) gets a milestone tag folded into the trailing date parenthetical, e.g. `(2026-08-23 added; M2)` or `(2026-08-23 added; Not yet scheduled)`, so a listing of this file alone is a complete view of outstanding work, roadmap included. Omit the tag for TODO-only items.
- Blank line between each item too, same as between paragraphs within one; a new item is distinguished by its un-indented `- [ ]` marker, not by the blank line alone.
- Lists sorted oldest to newest.
- Completed items move to [TODO_ARCHIVE.md](TODO_ARCHIVE.md) rather than staying checked off here.

## Repo hygiene

- [ ] **Hold TS 7 bump** (2026-08-09 20:40 added, ignore rule added 2026-08-30, rationale revised 2026-09-09, exit condition corrected 2026-09-22)

      `typescript-eslint` doesn't support TS 7. A Dependabot PR
      (`dev-dependencies` group) bundled a `typescript` 5.9.3→7.0.2 bump in
      with 13 unrelated safe updates, failing CI (lint) for the whole
      group. Added a `typescript` major-version `ignore` rule to
      `.github/dependabot.yml` so Dependabot stops proposing it.

      The bundling half of that reasoning no longer applies. Since
      2026-09-09 the `dev-dependencies` group carries
      `update-types: ['minor', 'patch']`, so a major never joins the
      group at all: a TS 7 bump would now arrive as its own PR and fail on
      its own, taking nothing else down with it.

      The ignore rule is still worth keeping, on the narrower grounds that
      it stops Dependabot reopening a PR that can only be closed again
      until `typescript-eslint` catches up.

      Correction 2026-09-22: `typescript-eslint` has closed the TS 7
      support request as "not planned", not just "not yet" - TS 7 ships
      without a stable programmatic API, which their type-aware rules
      depend on structurally. "Remove the ignore once `typescript-eslint`
      supports TS 7" may therefore never trigger as worded. Revisit if
      `typescript-eslint` reverses that position, or consider whether a
      TS 7 bump is ever wanted enough to work around the incompatibility
      some other way (e.g. installing it alongside TS 6 rather than
      replacing it).

## TV Shows / Movies gallery follow-ups

- [ ] **Virtualize the gallery grid if libraries grow** (2026-08-19 15:25)

      Shipped without `content-visibility`/windowing: real libraries are
      ~500 shows/movies, comfortably fine for the DOM. Revisit if a
      self-hoster's library gets meaningfully larger and scroll performance
      suffers.

## Watchlists

- [ ] **Filter the Watchlist detail page by status** (2026-09-21 added, narrowed 2026-09-21, year/rating split off and shipped 2026-09-22; Not yet scheduled)

      Split off from a wider "sort and filter by status, release year, and
      TMDB rating" item once year/rating shipped 2026-09-22 (see
      `docs/TODO_ARCHIVE.md`) - status was never M6 scope to begin with,
      just bundled into the same original ask.

      Turns out "status" isn't watch-progress at all: `LibraryShow`/
      `LibraryMovie`'s `status` field (`packages/shared/src/schemas/
      library.ts`) is TMDB's own raw status string (e.g. "Returning
      Series", "Ended" for shows; TMDB's release status for movies), a
      property of the underlying title, not of whether/how the user has
      watched it - same category as genre/year/rating, all fair game for
      a "what should I watch next" list.

      Needs the same schema/API addition year/rating just got (no
      `status` field on `WatchlistItemMedia` yet) plus a genuine design
      decision James flagged 2026-09-21, still open: the generic
      `components/ui/KeyedFilterPanel.tsx` (renamed from the
      single-purpose `StatusFilterPanel.tsx` during the M5 filter-panel
      consolidation, see `docs/TODO_ARCHIVE.md`), which `ShowsPage.tsx`
      now uses (`keys={availableStatuses}`) for status filtering, has only
      ever been used on `ShowsPage.tsx` for shows alone - `MoviesPage.tsx`
      has no status filter at all today, confirmed by grep. Shows and
      movies use completely different TMDB status value sets ("Returning
      Series"/"Ended"/"Canceled"/"Pilot" for shows vs "Released"/"Post
      Production"/"Planned" for movies), and `WatchlistDetailPage.tsx`
      mixes both types in one list. `filterByStatus`'s include-mode logic
      excludes any item whose status isn't in the include list, so
      picking a show-only status (e.g. "Ended") on a mixed watchlist would
      silently hide every movie in the list, and vice versa for a
      movie-only status - not obviously a bug at a glance, but likely to
      look like one. Needs a decision before building, not just a drop-in
      reuse of the existing single-type panel/logic: options discussed
      2026-09-21 were (a) one merged status list across both types, accepting
      that cross-type hiding effect, or (b) type-aware filtering where a
      show-only status leaves movies unaffected (and vice versa), which
      would need new filter logic rather than reusing `filterByStatus` as
      written. James, 2026-09-21: leave the decision open for now rather
      than picking one.

- [ ] **Rethink the "add to watchlist" UI on the show/movie detail pages**
      (2026-09-21 added)

      James, 2026-09-21: has been adding shows to a custom watchlist and
      isn't happy with the current UI for it. Two problems: (1) no visual
      indicator on the page for "this title is on one of my custom
      lists", unlike the default list, which does get one; (2) it
      "generally feels clunky" - floated maybe merging the default-list
      button with the custom-list button as one path worth exploring, but
      wants real thought put into this rather than a quick patch.

      Current shape, `WatchlistButton.tsx` (shared by both
      `ShowDetailPage.tsx` and `MovieDetailPage.tsx` - this affects
      movies too, not just shows, since it's one component): a primary
      bookmark-icon button that one-click toggles membership in the
      Default list only (filled/`variant="primary"` when `onDefault` is
      true, otherwise `secondary`), plus a separate icon-only "manage
      lists" button that always renders `variant="secondary"` regardless
      of `myWatchlistIds`, opening a dialog with one checkbox per custom
      list. That second button is where the missing indicator lives: it
      never reflects "already on N custom lists" the way the primary
      button reflects default-list membership.

      This split was itself a deliberate call, not an oversight -
      `WatchlistButton.tsx`'s own doc comment: "James, 2026-08-27: wanted
      single-click for the common case, happy for the rest to need more
      UI." Worth reading before redesigning, since whatever replaces it
      should account for why single-click-for-Default mattered in the
      first place, not just fix the missing indicator in isolation.

      James, 2026-09-21, confirmed explicitly: think about the Movie
      detail page's own UI for this too, not just Show. One shared
      component today, but the two pages don't offer it the same amount
      of surrounding room: `ShowDetailPage.tsx`'s action row carries
      Watched, `+`, Drop, and Watchlist (which itself renders two buttons,
      the bookmark toggle and the manage-lists button), plus Refresh - six
      buttons from five named controls, no separate sort-order control
      (corrected 2026-09-22; none exists on this page) - while
      `MovieDetailPage.tsx`'s has Watched, `+`, Watchlist, and Refresh
      (four named controls, five buttons - no Drop, per the phone-width
      audit TODO above), so a redesign that reads fine in Movie's more
      spacious row could still feel cramped in Show's, or vice versa.
      Check the fix against both pages' actual layouts before calling it
      done, not just against whichever page it was designed against
      first.

      Genuinely open on the shape of a fix - no direction picked yet.
      Possible angles worth considering when this gets picked up: a badge/
      dot on the manage-lists button when `myWatchlistIds` has any
      non-default entries; folding Default into the same
      checkbox-per-list dialog instead of a separate one-click button
      (trading away the single-click precedent above); or a single
      combined control that shows current membership count/state at a
      glance and opens straight into management. Decide with James before
      building, same as the watchlist status-filter question above.

## Auth & accounts

- [ ] **Passkey (WebAuthn) support** (2026-08-23 15:45 added)

      Another `user_credentials` adapter type alongside `local`/`oidc`
      (see [ADR 0003](adr/0003-auth-model.md)): sign in/register with a
      device passkey instead of a password. Not on ROADMAP.md yet; pairs
      naturally with the OIDC login item below since both plug into the
      same credentials schema, but it's its own protocol (WebAuthn, no
      external identity provider or redirect involved).

- [ ] **Explore OAuth device-flow login (for a future TV app)** (2026-08-23 16:00 added)

      The RFC 8628 device authorization grant: the "enter this code on
      your phone" / QR flow BBC iPlayer, Disney+, and `gh auth login`
      all use for devices with no comfortable keyboard. Only relevant
      once there's an actual rwnd.tv TV app to log into, which doesn't
      exist yet; this is groundwork, not urgent. Needs a device-
      authorization endpoint, a short human-typeable code + polling on
      the device side, and a verification page.

      Worth designing the approval page carefully: device-code flows have
      a known phishing pattern where someone's talked into approving a
      code that isn't theirs, so the page should make clear what's being
      authorized rather than a bare yes/no.

## Metadata & matching

- [ ] **`resolveSeason`'s runtime upsert only ever fills a null, never corrects a stale one** (2026-09-17 added, scoped into M6 2026-09-22 pending investigation, investigated and un-M6'd 2026-09-22; Not yet scheduled)

      Investigated 2026-09-22 per the M6 plan's own instruction: sampled
      `episodes.runtimeMinutes` against a fresh TMDB fetch on dev.rwnd.tv
      (which mirrors the real reference instance's full watch history), a
      read-only check run inside the container itself so the TMDB key
      never left it. A first 40-episode sample came back clean (0
      mismatches), but a follow-up 150-episode sample found 5 real drifts
      (~3.3%), all TMDB correcting a runtime by 1-3 minutes after the
      fact, e.g. stored 39 vs. live 41, stored 48 vs. live 51 - confirms
      stale non-null runtimes are a real, if uncommon, occurrence, not
      just a theoretical concern.

      Un-M6'd rather than fixed as part of the quick-fix batch: per the
      M6 plan's own framing, since drift is real this is a
      runtime-provenance design question (the schema doesn't track which
      provider wrote a given runtime, which a real fix needs to avoid
      reintroducing the exact bug the fill-only behavior was written to
      prevent - clobbering a cross-provider backfilled value with a
      differently-numbered same-provider one), not a one-line upsert
      flip. Worth its own scoped follow-up rather than a quick-fix.

      Found while fixing the season/episode drift item above (see
      TODO_ARCHIVE.md): `resolveSeason`'s upsert (`apps/api/src/lib/
      media.ts`) writes `runtimeMinutes: coalesce(existing, excluded)` -
      deliberately fill-only, to protect a cross-provider-backfilled value
      from being clobbered by a primary provider that still returns null.
      That reasoning only covers "live value is null"; it doesn't cover
      "live value is non-null but disagrees with what's stored" (a
      provider correcting its own data after the fact), which is exactly
      the case the season route's own new reconciliation step (this
      session) now handles by overwriting only when the live value is
      non-null and different. `resolveSeason`'s callers (the season/show
      "Watched" buttons, Trakt import, `refreshOneShow`'s current/upcoming
      season refresh) could plausibly want the same treatment, but that's
      a separate call site and a separate judgment call from what the
      season-route fix asked for - not changed as part of it.

- [ ] **IMDb ratings on Movies (and maybe TV Shows)** (2026-09-01 13:35 added, shelved 2026-09-01, not on any milestone)

      Would show a rating badge next to the existing plain-text "IMDb"
      link on the detail pages (`MovieDetailPage.tsx`, around line 287 as
      of 2026-09-22, drifted from 276 when this item was first logged;
      that link's own comment currently says "this app holds no IMDb
      rating"). Link groundwork (`imdbId` already resolved for most
      movies/shows) exists; only the rating value itself is missing.
      IMDb has no public ratings API of its own, so this always meant a
      third-party integration, cached rather than fetched live: a new
      `imdbRating` + `imdbRatingCheckedAt` column pair (mirrors
      `episodes.imdbCheckedAt`'s negative-cache pattern), lazy-populated
      on page view with a ~30-day expiry, confirmed as the right shape
      with James before any legal concerns came up.

      **Shelved on legal grounds, not a technical one.** Two routes were
      explored, both blocked:

      **OMDb (omdbapi.com)**, the obvious choice (a thin wrapper API
      other apps use for this). Blocked on a real ToS conflict: their
      general Terms of Use forbid "archiving/distributing Contributions"
      and using them "in connection with any commercial endeavors," while
      their API page separately claims CC BY-NC 4.0 licensing (which
      would permit exactly this). Compounded by real project-health red
      flags: their Change Log hasn't updated since 2019, and their GitHub
      issue tracker has 230 open issues dating back to 2017 with basic
      questions unanswered (confirmed live via `gh api`).

      **IMDb's own official non-commercial datasets**
      (datasets.imdbws.com): a daily-refreshed bulk TSV download,
      keyed by the same `tt...` id already stored, no per-request quota.
      Looked structurally better, but IMDb's own terms bar using the data
      to "create any kind of online/offline database of movie
      information" beyond individual personal use, and their separate
      "Content licensing" page explicitly routes "software developers" to
      paid commercial licensing. A real-world data point backs this up:
      Casey Liss (Callsheet, a well-regarded indie IMDb-alternative app)
      looked into IMDb's own commercial API and called the pricing
      "hilarious," i.e. not viable for an indie/hobby project.

      James, 2026-09-01: not worth building on uncertain legal footing;
      revisit if either provider's terms clarify, a healthier alternative
      turns up, or IMDb gives a direct answer on whether self-hosted OSS
      counts as personal use. Movies-only vs. Movies+TV Shows was never
      decided either, moot until this unblocks.

## Security

- [ ] **Add a request/correlation id to the structured request log** (2026-09-16 added; Not yet scheduled)

      Deliberately deferred while building full structured request logging
      (above): `hono/request-id` and `hono/context-storage` are both
      already bundled with the installed Hono version (zero new
      dependency), but nothing in this codebase consumes a correlation id
      today: single container, single process, no trace aggregation. A
      new field is purely additive later (breaks no existing log
      consumer), so there was no reason to build the plumbing ahead of an
      actual need.

## Roadmap

Every open item from [ROADMAP.md](ROADMAP.md) that doesn't already have a
more specific TODO elsewhere in this file. Kept brief: ROADMAP.md is the
source of truth for scope; this is just so a TODO listing is complete.

- [ ] **Kodi webhook ingestion** (2026-08-24 16:25 added, un-M2'd 2026-08-24, M4'd 2026-08-28, scoped down 2026-09-11, Tautulli split off 2026-09-14, un-M4'd 2026-09-16; Not yet scheduled)

      Tautulli shipped 2026-09-14 (see `docs/TODO_ARCHIVE.md`), leaving
      Kodi as the only source left on what was originally "Tautulli/Kodi
      webhook ingestion." Kodi has no native webhook support at all, so
      it needs an addon-based approach rather than a plain payload
      parser, most likely a small service addon shipped and distributed
      from this repo rather than a config paste.

      M4 closed `✅ done` 2026-09-15 without this item; the `M4` tag went
      stale at that point and is corrected here rather than left pointing
      at a closed milestone. Worth a deliberate call during M5 scoping on
      whether Kodi belongs in M5 or stays unmilestoned again.

      James, 2026-08-24: not needed to close out M2. ROADMAP.md's own M2
      "Plex webhook ingestion" bullet only ever mentioned these in
      passing as future work, not as a separate required checkbox, so
      this was over-tagged M2 when first added. Left unmilestoned rather
      than reassigned to M3; no strong reason it belongs there either.

- [ ] **OIDC login** (2026-08-23 15:34 added, un-M3'd 2026-08-26; Not yet scheduled)

      The `user_credentials` schema was designed for this from M1; see
      [ADR 0003](adr/0003-auth-model.md).

- [ ] **Additional locales beyond English** (2026-08-26 added; Not yet scheduled)

      en-GB/en-US both ship today; more locales is pure expansion, not
      something the core logging loop needs.

- [ ] **Mobile-friendly PWA installability** (2026-08-23 15:37 added; Not yet scheduled)

      Installable/add-to-home-screen support.

- [ ] **Public/shareable profile pages** (2026-08-23 15:38 added; Not yet scheduled)

      A public view of a user's watch history/stats.

- [ ] **Consider federation (ActivityPub/AT Protocol) for cross-instance social features** (2026-09-20 added; Not yet scheduled)

      Surfaced from an r/TraktRejects thread ("Self-hosted federated
      alternatives?",
      reddit.com/r/TraktRejects/comments/1wldavj/selfhosted_federated_alternatives)
      asking whether any self-hosted Trakt alternative also federates, so
      reviews/ratings/lists could be shared across independently-run
      instances rather than staying siloed to each instance's own users.
      rwnd.tv already covers the per-instance social basics (lists,
      ratings) but has no cross-instance story, the same gap the OP called
      out in every self-hosted option they'd tried.

      Two projects came up in the thread as prior art, both built on the
      AT Protocol (the protocol behind Bluesky) rather than ActivityPub:
      Popfeed.social and Opnshelf.xyz, both described by a commenter (who
      is themselves building on the same protocol) as MVP-stage. A
      separate commenter mentioned building their own scrobbling-focused
      alternative, "Scrob." The OP specifically noted neither Popfeed nor
      Opnshelf mentions scrobbling through media servers, which is exactly
      rwnd.tv's core strength already shipped (the multi-user-aware
      Plex/Jellyfin/Emby/Tautulli webhook ingestion work, see
      `docs/TODO_ARCHIVE.md`).

      No decision made here, just capturing the idea and the competitive
      landscape context: worth a deliberate look at ActivityPub vs. AT
      Protocol tradeoffs if/when federation is seriously considered, and
      worth keeping an eye on how Popfeed/Opnshelf/Scrob develop given the
      overlap.

- [ ] **No screenshot of the Stats page** (2026-09-23 added; Not yet scheduled)

      `tools/screenshots/capture.ts`'s page lists (both the README docs
      set and the landing-page gallery set) have no `/stats` entry, found
      scanning for stale docs ahead of the M6 version cut. The page works
      fine without one; this is a visual-completeness gap, not a
      functional one. Needs a seeded reference account with enough real
      watch/rating history for the page to look representative (an empty
      Stats page screenshots badly), then a `/stats` entry added to both
      lists and the tool re-run.

