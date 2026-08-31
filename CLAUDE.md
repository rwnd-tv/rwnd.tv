# Working conventions for rwnd.tv

## Contact / identity

Use **james.bulman@rwnd.tv** for any public-facing contact address in this
repo (CODE_OF_CONDUCT.md, SECURITY.md, package metadata, etc.), never the
project owner's personal email. This is a project with its own identity;
keep it separate from the person building it.

## Deploying to dev.rwnd.tv

**No git commit or push is needed to deploy to dev.** `rwnd-tv-dev` builds
from a mirrored source tree on the home-server, not from a pushed/pulled
image. Never gate a dev deploy on committing first, and never ask whether
to commit first before offering to deploy to dev. To deploy the current
local source:

```
robocopy I:\rwnd.tv W:\rwnd-tv-dev\src /MIR /XD .git node_modules dist .turbo /XF .env
ssh home-server 'cd /pool/docker && docker compose build rwnd-tv-dev && docker compose up -d rwnd-tv-dev'
```

Notes:

- Run `robocopy` from **PowerShell**, not Git Bash: Git Bash mangles
  slash-prefixed flags like `/MIR` (tries to resolve them as paths).
- Use `/c/Windows/System32/OpenSSH/ssh.exe` when invoking `ssh` from Git
  Bash. The MSYS `ssh` binary doesn't see the Windows OpenSSH agent
  (Bitwarden-served key) and fails with "Permission denied". PowerShell's
  native `ssh` works fine as-is.
- The container's entrypoint runs DB migrations automatically on start, so
  schema changes deploy correctly too; no separate migration step.
- Committing/pushing is a separate, later decision, batched to end of
  session, always with its own explicit go-ahead. Deploying to dev is not
  that decision; do it freely to verify a change actually works.

## Deploying to rwnd.tv (prod)

Unlike dev, this one goes through the real published image, and needs a
real release cut first. A plain push to `main` only moves the `edge`
image tag; `latest` (and prod, which is pinned to a specific digest, not
a floating tag) only updates on a version tag push:

1. Bump the `version` field in all five `package.json` files (root,
   `apps/api`, `apps/web`, `packages/db`, `packages/shared`) to the same
   new version, commit as "Bump version to X.Y.Z", tag that commit
   `vX.Y.Z`, push both the commit and the tag.
2. Wait for the tag-triggered Release workflow to finish (`gh run watch
   <run-id> --exit-status`, or `gh run list` to find it): it builds,
   scans, signs, and publishes the new image, and moves `latest`.
3. Verify the published image is actually signed by this repo's own
   release workflow before touching prod. See
   `docs/self-hosting.md#verifying-the-image` for the exact `cosign
   verify` command. cosign isn't installed everywhere; if missing on the
   home-server, install to `~/bin/cosign` (a user-writable path, since
   `sudo` isn't available non-interactively over SSH) rather than skip
   the check.
4. Prod's `rwnd-tv` service lives in the home-server's single shared
   `/pool/docker/docker-compose.yaml` (alongside every other service
   there, so edit only the one `image:` line), pinned by digest rather
   than by a floating tag: a digest can't be silently swapped out from
   under the running container the way even `:latest` itself could be,
   matching the cosign verification's own point. Resolve the digest from
   a real semver-tagged release, not from `:edge` alone: the release
   workflow's GHCR cleanup job prunes untagged images, and an
   edge-only digest has already caused a near-miss once (see the
   `cleanup` job's comment in `.github/workflows/release.yml`). Get the
   new digest from either the
   `cosign verify` output or `docker buildx imagetools inspect
   ghcr.io/rwnd-tv/rwnd.tv:X.Y.Z`, replace the old digest in that one
   `image:` line, then:

   ```
   ssh home-server 'cd /pool/docker && docker compose pull rwnd-tv && docker compose up -d rwnd-tv'
   ```

Deploy to dev the same way afterward (see above) so both instances track
the same released version, not just prod.

## Public-facing design surfaces

An earlier version of the landing page converged too closely, in
structure and visual treatment, on another project's marketing site.
Unintentional, no copied text or code, but close enough to be worth
avoiding going forward.

Before a new marketing/landing surface (or a substantial redesign of an
existing one) is hand-off-integrated from Claude Design (or any other
AI-generated draft) into the app, check it against comparable existing
projects: structure and section order, not just copy. Change anything
that reads as a close match before it ships, not after. Do this as a
fresh check each time rather than by keeping a standing list anywhere,
public or private; the check is a one-off step in the process, not an
artifact to maintain.

The landing page is the obvious case, but the same risk applies to any
other public-facing surface built the same way with little existing
precedent in this app to anchor it: the README's structure, an
onboarding flow, and so on.
