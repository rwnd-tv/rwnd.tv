# Self-hosting rwnd.tv

rwnd.tv ships as a single Docker image plus a PostgreSQL database.

## Requirements

- Docker and Docker Compose
- At least one metadata provider: a free [TMDB API key](https://www.themoviedb.org/settings/api) (Settings → API → "API Key (v3 auth)"), and/or a [TheTVDB API key](https://www.thetvdb.com/api-information) (a commercial key, or a free "user-supported" key paired with your subscriber PIN)
- A reverse proxy for TLS if you're exposing this beyond your local network (e.g. nginx-pm, Caddy, Traefik)

## Quick start

```sh
curl -O https://raw.githubusercontent.com/rwnd-tv/rwnd.tv/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/rwnd-tv/rwnd.tv/main/.env.example
mv .env.example .env
# edit .env: set POSTGRES_PASSWORD, a metadata provider key (TMDB_API_KEY
# and/or TVDB_API_KEY), and DATABASE_URL to match
docker compose up -d
```

Visit `http://<host>:3000`. The first person to load the app is walked through creating the admin account — after that, whether anyone else can register is controlled from Settings → Instance (admin only), or by editing `instance_settings` directly.

## Configuration

All configuration is environment variables, set in `.env`. `.env.example` covers everything below except a handful of dev-only overrides (`PORT`, `CORS_ORIGINS`, and the `*_BASE_URL` vars) that aren't wired through `docker-compose.yml` — those only matter for local development, not a Docker deployment.

| Variable              | Required                         | Notes                                                                                                                                                                                |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POSTGRES_USER`       | Yes                              | Username for the bundled `db` service. Only used by that container — the app reads `DATABASE_URL` instead, which needs to match                                                      |
| `POSTGRES_PASSWORD`   | Yes                              | Password for the bundled `db` service — change this from the shipped default                                                                                                         |
| `POSTGRES_DB`         | Yes                              | Database name for the bundled `db` service                                                                                                                                           |
| `DATABASE_URL`        | Yes                              | Postgres connection string the app itself uses                                                                                                                                       |
| `DATABASE_SSL`        | No                               | Set `true` to require TLS on the connection to Postgres. Irrelevant for the bundled `db` service (same Docker network), relevant if you point `DATABASE_URL` at an external database |
| `TMDB_API_KEY`        | At least one of TMDB/TVDB        | Free at themoviedb.org                                                                                                                                                               |
| `TVDB_API_KEY`        | At least one of TMDB/TVDB        | Commercial or free "user-supported" key from thetvdb.com                                                                                                                             |
| `TVDB_PIN`            | Only for a "user-supported" key  | Your TheTVDB subscriber PIN — leave unset for a commercial key                                                                                                                       |
| `COOKIE_SECURE`       | Recommended in production        | Set `true` once served over HTTPS — browsers drop `Secure` cookies over plain HTTP. Defaults to `true` in production if left unset                                                   |
| `TRUST_PROXY`         | No                               | Set `true` only if a reverse proxy you trust sits in front and sets `X-Forwarded-For` itself — see [Securing your instance](#securing-your-instance)                                 |
| `BIND_ADDRESS`        | No                               | Which host interface `docker-compose.yml` binds port 3000 to — defaults to all interfaces (`0.0.0.0`)                                                                                |
| `SESSION_COOKIE_NAME` | No                               | Defaults to `rwnd_session`                                                                                                                                                           |
| `ENVIRONMENT_LABEL`   | No                               | A small badge in the header plus a browser-tab-title prefix — handy for telling a staging/dev instance apart from production at a glance                                             |
| `TRAKT_CLIENT_ID`     | No                               | Enables Trakt import (Settings > Import) — free app at trakt.tv/oauth/applications                                                                                                   |
| `TRAKT_CLIENT_SECRET` | Only if `TRAKT_CLIENT_ID` is set | Paired with the client id above                                                                                                                                                      |
| `ENCRYPTION_KEY`      | Only if `TRAKT_CLIENT_ID` is set | 32 bytes, base64 (`openssl rand -base64 32`) — encrypts stored Trakt tokens, and is also required for anyone to enable two-factor authentication                                     |
| `BACKUP_DIR`          | No                               | Enables per-user backup/restore (Settings > Database) — see Backups below                                                                                                            |
| `SMTP_HOST`           | No                               | Enables account verification and "Forgot password?" emails — see Email below                                                                                                         |
| `SMTP_PORT`           | Only if `SMTP_HOST` is set       | Defaults to `587`                                                                                                                                                                    |
| `SMTP_USER`           | Only if `SMTP_HOST` is set       | Mail relay username                                                                                                                                                                  |
| `SMTP_PASS`           | Only if `SMTP_HOST` is set       | Mail relay password (e.g. a Gmail App Password)                                                                                                                                      |
| `SMTP_FROM`           | Only if `SMTP_HOST` is set       | Sender shown on outgoing mail, e.g. `"rwnd.tv <noreply@example.com>"`                                                                                                                |
| `APP_URL`             | Only if `SMTP_HOST` is set       | This instance's own public URL — what verification/reset links point at                                                                                                              |

## Putting it behind a reverse proxy

Point your proxy at `http://<container>:3000` and terminate TLS in front of it. Nothing rwnd.tv-specific is required beyond forwarding `Host` and `X-Forwarded-For` headers, which most reverse proxies (including nginx-pm) do by default.

## Securing your instance

rwnd.tv holds personal data (your watch history, email address, and — if you connect Trakt — OAuth tokens), so if you're exposing it beyond your own machine, a few things are worth getting right:

- **Use HTTPS.** Put a reverse proxy in front (see above) and terminate TLS there — rwnd.tv itself never does. Without it, login credentials and session cookies travel in plaintext.
- **Set `COOKIE_SECURE=true`** once you're on HTTPS. It already defaults to `true` in production if you leave it unset, so this only matters if you've explicitly set it to `false` (e.g. while testing) and forgot to change it back once you added TLS. Flipping it on renames the session cookie (it gains a `__Host-` prefix, a browser-enforced guarantee that only applies to a cookie actually sent over HTTPS) — expect everyone, yourself included, to be logged out once as part of that change.
- **Have your reverse proxy set `X-Forwarded-For`**, and only set `TRUST_PROXY=true` once it does. rwnd.tv uses that header to rate-limit login/registration/etc. per client IP — trusting it without a proxy actually setting it lets any client spoof its own rate-limit bucket, and a proxy that silently drops or doesn't set the header makes every request look like it's coming from one IP, rate-limiting all your users together.
- **Don't expose port 3000 directly** if a reverse proxy is meant to be the only way in — set `BIND_ADDRESS=127.0.0.1` so the container only accepts connections from the host itself, and let the proxy be the sole path from outside. Leave it unset (the default, all interfaces) for a pure-LAN deployment with no proxy in front.
- **Registration defaults to closed.** The first person to load the app becomes the admin (see Quick start above); after that, nobody else can create an account until you open registration from Settings → Instance, or switch it to invite-only and create invites from Settings → Invites (admin only — each invite is single-use and shows its code once).
- **Passwords are checked against [Have I Been Pwned](https://haveibeenpwned.com/)'s breach database** whenever one is set (first-admin setup, registration, password change, password reset) — only the first 5 characters of the password's SHA-1 hash are ever sent (the [k-anonymity range API](https://haveibeenpwned.com/API/v3#PwnedPasswords)), never the password itself. If this instance has no outbound internet access, the check simply fails open and allows the password — it's an enhancement, not a requirement, so an air-gapped or LAN-only deployment isn't blocked from setting passwords at all.
- **Two-factor authentication (TOTP) is available to any user**, opt-in, from Account → Two-factor authentication — requires `ENCRYPTION_KEY` to be set (see the table above), and hides itself in the UI otherwise. Worth turning on for admin accounts especially.
- **Verify the image you're running.** Every published image is cosign-signed, with an SBOM and build provenance attached — see [Verifying the image](#verifying-the-image) below.

## Connecting Plex

Plex webhooks (Plex Pass required) let rwnd.tv log a watch automatically as you watch it, instead of logging manually:

1. Sign in, go to **Settings → API tokens**, and create a token (name it something like "Plex").
2. Copy the webhook URL shown next to it — it's `https://<your-instance>/api/v1/webhooks/plex/<token>`. The token lives in the URL path rather than a header because Plex's webhook feature can't send custom headers.
3. In Plex, go to **Settings → Webhooks** and add that URL.

**Multi-user Plex servers are a first-class case.** rwnd.tv doesn't guess which Plex account is "the owner" — the first webhook event from each distinct Plex account shows up in Settings → API tokens as unclaimed, and you claim it to a rwnd.tv user (yourself, or another account on this instance) from there. Any watch that arrived before an account was claimed is logged retroactively the moment it's claimed, so you don't lose history by claiming an account a little late.

## Importing from Trakt

Two independent paths, both under **Import** in the sidebar:

- **Connect a Trakt account** (needs `TRAKT_CLIENT_ID`/`TRAKT_CLIENT_SECRET`/`ENCRYPTION_KEY` set — see the config table above): an OAuth device-flow connection ("go to this URL, enter this code") that needs no callback URL or public server, then imports history, ratings, and watchlist directly from Trakt's API.
- **Upload a Trakt export ZIP**: on trakt.tv, go to Settings → Data → "Export now" to download a ZIP of your data, then upload it here. Needs no credentials at all.

Both exist because Trakt's 2026 "Community App" policy caps a free Trakt account at one connected third-party OAuth app at a time — the ZIP path is there for whenever that's already spent on something else.

## Verifying the image

Every image published to `ghcr.io/rwnd-tv/rwnd.tv` is signed with [cosign](https://docs.sigstore.dev/cosign/overview/) (keyless, via GitHub Actions' OIDC identity) and carries an SBOM and build provenance attestation. To verify the image you're about to run actually came from this repo's release workflow, you'll need **cosign v3 or newer** — v2 reports a false "no signatures found" against these images, since it doesn't recognize the format v3 signs in:

```sh
cosign verify ghcr.io/rwnd-tv/rwnd.tv:latest \
  --certificate-identity-regexp 'https://github.com/rwnd-tv/rwnd\.tv/.github/workflows/release\.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Upgrading

```sh
docker compose pull
docker compose up -d
```

Database migrations run automatically on container startup (see `docker-entrypoint.sh`) — there's no separate migration step to run by hand.

`docker-compose.yml` pulls `:latest`, which always points at the newest tagged release. If you'd rather track unreleased changes on `main` between releases, point it at `:edge` instead — but expect it to move more often and skip the release notes a tagged version gets.

If something looks wrong after upgrading: `docker compose logs app` for the application log, and `docker compose ps` to confirm both containers report healthy (the `db` service has a `pg_isready` healthcheck the `app` service waits on before starting).

## Backups

Everything that matters lives in the `db-data` volume (the Postgres data directory). Back it up like any other Postgres instance, e.g.:

```sh
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql
```

Restoring is the reverse — with the `app` service stopped so nothing writes mid-restore:

```sh
docker compose stop app
docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB" < backup.sql
docker compose start app
```

### Per-user backup/restore

Settings > Database also lets each user back up (and restore) their own watch history, ratings, watchlist, and dropped shows as a single portable file — independent of the Postgres dump above, and not a substitute for it: it covers one user's tracked activity, not accounts, instance settings, or anything another user has done. It's off by default. To enable it, uncomment the `BACKUP_DIR` environment variable and the matching `volumes:` line under the `app` service in `docker-compose.yml`, pointing the host side of that mount at a real directory:

```yaml
environment:
  - BACKUP_DIR=/data/backups
volumes:
  - ./backups:/data/backups
```

Then `docker compose up -d`. The container runs as an unprivileged user, so `./backups` needs to be writable by it — if you hit permission errors, `chown` the host directory to match rather than loosening it further. Leave both commented out (the default) and the Backups section of the Database panel just doesn't appear.

## Email

Set `SMTP_HOST` (and its four companion variables above) to enable account verification emails on registration and the "Forgot password?" link on the login page. Off by default — leave `SMTP_HOST` unset and those hide themselves entirely rather than erroring; accounts created before email was ever configured are treated as already-verified, so turning this on later doesn't retroactively ask existing users to reverify.

Plain SMTP, not a specific provider's SDK — point it at whatever mail relay you already have: a Gmail account with an [App Password](https://myaccount.google.com/apppasswords) (`smtp.gmail.com`, port `587`), a transactional-email provider's own SMTP endpoint (Brevo, Resend, Mailgun, ...), or a mail server you run yourself. Fine to change later — nothing about the setup locks you into whichever relay you start with.
