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

- [ ] **Hold TS 7 bump** (2026-08-09 20:40 added, ignore rule added 2026-08-30)\
      `typescript-eslint` doesn't support TS 7 yet. A Dependabot PR
      (`dev-dependencies` group) bundled a `typescript` 5.9.3→7.0.2 bump in
      with 13 unrelated safe updates, failing CI (lint) for the whole
      group. Added a `typescript` major-version `ignore` rule to
      `.github/dependabot.yml` so Dependabot stops proposing it — remove
      that ignore once `typescript-eslint` supports TS 7.
- [ ] **`release.yml`'s `cleanup` job can delete another concurrent run's not-yet-merged digests** (2026-08-30 added)\
      Found cutting v1.0.1: pushing a commit to `main` and then immediately
      tagging `v1.0.1` against it triggers two `Release` runs at once (one
      per trigger — `push: branches` and `push: tags`). Both build their
      own per-platform images and push them by digest, untagged, until
      their own `merge` job ties them into a manifest list. `cleanup`
      (`needs: merge`) deletes _every_ untagged package version
      unconditionally — so if run A's `merge`+`cleanup` finish while run
      B's images are still untagged (B's own `merge` hasn't run yet), A's
      cleanup deletes B's images out from under it. Confirmed live:
      `v1.0.1`'s tag-triggered run failed 3 times in a row on
      `docker buildx imagetools create` with `... not found` (a different
      digest each time), while the concurrent `main`-push run for the same
      commit succeeded end to end including cleanup. Re-running just the
      failed jobs can never work once this happens (the digests are
      permanently gone) — only a full rebuild (fresh digests, run in
      isolation) recovers. Fix needs `cleanup` to not run (or not delete)
      while another `Release` run for the same workflow is still
      in-flight — a concurrency group keyed on the workflow rather than
      the ref, or gating `cleanup` on no other active run, would both
      work; hasn't been designed yet. Workaround for now: don't push a
      version-bump commit and its tag as two separate `git push`
      invocations back to back — or if it happens, just fully re-run the
      workflow (not `--failed`) once nothing else is running.

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
- [ ] **Poster thumbnail briefly resizes on "Refresh metadata"** (2026-08-30 13:55 added)\
      On a TV Show page, clicking the manual refresh-metadata button
      momentarily changes the poster thumbnail's size before it settles
      back — a layout-shift bug, not yet root-caused. James's repro:
      https://dev.rwnd.tv/shows/the-ghost-in-the-shell-2026.

## Documentation

- [ ] **Drop the vestigial Playwright entries in `eslint.config.js`/`.gitignore`** (2026-08-30 added)\
      `eslint.config.js`'s ignores and `.gitignore` both carry
      `playwright-report/`/`test-results/` patterns left over from a
      Playwright setup that was never actually added — there's no `e2e/`
      directory anywhere. `tools/screenshots/` now uses Playwright for
      real, but as a screenshot tool, not a test runner, so it doesn't
      produce either of those directories. Low priority: harmless as
      long as they stay accurate to _something_ Playwright-shaped in the
      repo, but worth removing or reworking now that the "planned but
      never added" reading no longer applies cleanly.
- [ ] **Tidy up em-dash usage in the docs** (2026-08-31 18:40 added)\
      Scoped to `docs/` (README, ADRs, self-hosting/contributing guides,
      etc.) — source code comments are out of scope, not fussed about
      those.

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

## Internationalization

- [ ] **Landing page locale gets stuck on first-detected language** (2026-08-30 14:28 added)\
      `i18next-browser-languagedetector` (`apps/web/src/i18n/index.ts`) uses
      its default detection order (`localStorage` before `navigator`) and
      caches whatever it first detects into `localStorage['i18nextLng']`.
      Once a browser has been detected as `en-GB` (or `en-US`), it stays
      pinned there on every later visit and never re-checks
      `navigator.language` again — so changing the browser/OS language
      afterward has no effect on the landing page (or anywhere else in the
      app) until that localStorage key is cleared manually. Confirmed live
      on dev.rwnd.tv: cleared the key, reloaded, it re-detected from
      `navigator.language` as expected; setting it explicitly to `en-US`
      then correctly switched both the landing page copy and its embedded
      per-locale screenshots. Fix: probably drop the `localStorage` cache
      (or the whole custom `caches`/`order` config) so it always re-derives
      from the browser's current language on each load — there's no
      in-app language switcher yet, so nothing actually depends on the
      cached value today.

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
