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

- [ ] **Hold TS 7 bump** (2026-08-09 20:40 added, ignore rule added 2026-08-30)

      `typescript-eslint` doesn't support TS 7 yet. A Dependabot PR
      (`dev-dependencies` group) bundled a `typescript` 5.9.3→7.0.2 bump in
      with 13 unrelated safe updates, failing CI (lint) for the whole
      group. Added a `typescript` major-version `ignore` rule to
      `.github/dependabot.yml` so Dependabot stops proposing it; remove
      that ignore once `typescript-eslint` supports TS 7.

## TV Shows / Movies gallery follow-ups

- [ ] **Virtualize the gallery grid if libraries grow** (2026-08-19 15:25)

      Shipped without `content-visibility`/windowing: real libraries are
      ~500 shows/movies, comfortably fine for the DOM. Revisit if a
      self-hoster's library gets meaningfully larger and scroll performance
      suffers.

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

- [ ] **IMDb ratings on Movies (and maybe TV Shows)** (2026-09-01 13:35 added, shelved 2026-09-01, not on any milestone)

      Would show a rating badge next to the existing plain-text "IMDb"
      link on the detail pages (`MovieDetailPage.tsx`, around line 276;
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

## Roadmap

Every open item from [ROADMAP.md](ROADMAP.md) that doesn't already have a
more specific TODO elsewhere in this file. Kept brief: ROADMAP.md is the
source of truth for scope; this is just so a TODO listing is complete.

- [ ] **Tautulli/Jellyfin/Emby/Kodi webhook ingestion** (2026-08-24 16:25 added, un-M2'd 2026-08-24, M4'd 2026-08-28; M4)

      Plex's own webhook shipped 2026-08-24 (see `docs/TODO_ARCHIVE.md`):
      the entity-resolution/auth core it's built on
      (`apps/api/src/lib/external-match.ts`,
      `apps/api/src/lib/api-tokens.ts`) is deliberately source-agnostic,
      so each of these is "write one payload parser + one route," not a
      rework. Tautulli's webhook body is fully user-templated (no fixed
      shape, needs its own JSON template + setup docs, unlike Plex's
      fixed format), which is why it wasn't bundled into the same pass.

      James, 2026-08-24: not needed to close out M2. ROADMAP.md's own M2
      "Plex webhook ingestion" bullet only ever mentioned these in
      passing as future work, not as a separate required checkbox, so
      this was over-tagged M2 when first added. Left unmilestoned rather
      than reassigned to M3; no strong reason it belongs there either.

- [ ] **Stats and insights** (2026-08-23 15:32 added, un-M3'd 2026-08-26; Not yet scheduled)

      The reason to log anything in the first place, but not essential to
      the core logging loop M3 was narrowed to (2026-08-26, see
      ROADMAP.md's M3 framing).

- [ ] **Calendar of upcoming episodes** (2026-08-23 15:33 added, un-M3'd 2026-08-26, M4'd 2026-08-28; M4)

      A view of what's airing next across the shows you're following.

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

- [ ] **Admin UI for managing user accounts** (2026-09-02 21:59 added, M4'd 2026-09-02; M4)

      There's no admin-facing view of an instance's users at all today:
      the `admin`/`user` split (`packages/db/src/schema.ts`'s
      `userRoleEnum`) only ever gets set once, on the very first account
      at setup (`routes/setup.ts`), with no route or page to list other
      users, see their role or last login, promote/demote, revoke their
      sessions, or delete an account other than your own
      (`DeleteAccountCard.tsx` is self-service only). An admin on a
      shared instance currently has no way to do any of this short of a
      direct database query.

      James, 2026-09-02: needed to actually operate an instance, not
      just a nice-to-have; milestoned M4 straight away rather than left
      unscheduled.
