# Working conventions for rwnd.tv

## Contact / identity

Use **james.bulman@rwnd.tv** for any public-facing contact address in this
repo (CODE_OF_CONDUCT.md, SECURITY.md, package metadata, etc.) — never the
project owner's personal email. This is a project with its own identity;
keep it separate from the person building it.

## Deploying to dev.rwnd.tv

**No git commit or push is needed to deploy to dev.** `rwnd-tv-dev` builds
from a mirrored source tree on the home-server, not from a pushed/pulled
image — never gate a dev deploy on committing first, and never ask whether
to commit first before offering to deploy to dev. To deploy the current
local source:

```
robocopy I:\rwnd.tv W:\rwnd-tv-dev\src /MIR /XD .git node_modules dist .turbo /XF .env
ssh home-server 'cd /pool/docker && docker compose build rwnd-tv-dev && docker compose up -d rwnd-tv-dev'
```

Notes:

- Run `robocopy` from **PowerShell**, not Git Bash — Git Bash mangles
  slash-prefixed flags like `/MIR` (tries to resolve them as paths).
- Use `/c/Windows/System32/OpenSSH/ssh.exe` when invoking `ssh` from Git
  Bash — the MSYS `ssh` binary doesn't see the Windows OpenSSH agent
  (Bitwarden-served key) and fails with "Permission denied". PowerShell's
  native `ssh` works fine as-is.
- The container's entrypoint runs DB migrations automatically on start, so
  schema changes deploy correctly too — no separate migration step.
- Committing/pushing is a separate, later decision — batch to end of
  session, always with its own explicit go-ahead. Deploying to dev is not
  that decision; do it freely to verify a change actually works.
