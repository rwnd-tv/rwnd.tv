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

All configuration is environment variables, set in `.env` (see `.env.example` for the full list with defaults):

| Variable              | Required                         | Notes                                                                                                                                                |
| --------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | Yes                              | Postgres connection string                                                                                                                           |
| `TMDB_API_KEY`        | At least one of TMDB/TVDB        | Free at themoviedb.org                                                                                                                               |
| `TVDB_API_KEY`        | At least one of TMDB/TVDB        | Commercial or free "user-supported" key from thetvdb.com                                                                                             |
| `TVDB_PIN`            | Only for a "user-supported" key  | Your TheTVDB subscriber PIN — leave unset for a commercial key                                                                                       |
| `COOKIE_SECURE`       | Recommended in production        | Set `true` once served over HTTPS — browsers drop `Secure` cookies over plain HTTP. Defaults to `true` in production if left unset                   |
| `TRUST_PROXY`         | No                               | Set `true` only if a reverse proxy you trust sits in front and sets `X-Forwarded-For` itself — see [Securing your instance](#securing-your-instance) |
| `BIND_ADDRESS`        | No                               | Which host interface `docker-compose.yml` binds port 3000 to — defaults to all interfaces (`0.0.0.0`)                                                |
| `SESSION_COOKIE_NAME` | No                               | Defaults to `rwnd_session`                                                                                                                           |
| `TRAKT_CLIENT_ID`     | No                               | Enables Trakt import (Settings > Import) — free app at trakt.tv/oauth/applications                                                                   |
| `TRAKT_CLIENT_SECRET` | Only if `TRAKT_CLIENT_ID` is set | Paired with the client id above                                                                                                                      |
| `ENCRYPTION_KEY`      | Only if `TRAKT_CLIENT_ID` is set | 32 bytes, base64 (`openssl rand -base64 32`) — encrypts stored Trakt tokens                                                                          |
| `BACKUP_DIR`          | No                               | Enables per-user backup/restore (Settings > Database) — see Backups below                                                                            |
| `SMTP_HOST`           | No                               | Enables account verification and "Forgot password?" emails — see Email below                                                                         |
| `SMTP_PORT`           | Only if `SMTP_HOST` is set       | Defaults to `587`                                                                                                                                    |
| `SMTP_USER`           | Only if `SMTP_HOST` is set       | Mail relay username                                                                                                                                  |
| `SMTP_PASS`           | Only if `SMTP_HOST` is set       | Mail relay password (e.g. a Gmail App Password)                                                                                                      |
| `SMTP_FROM`           | Only if `SMTP_HOST` is set       | Sender shown on outgoing mail, e.g. `"rwnd.tv <noreply@example.com>"`                                                                                |
| `APP_URL`             | Only if `SMTP_HOST` is set       | This instance's own public URL — what verification/reset links point at                                                                              |

## Putting it behind a reverse proxy

Point your proxy at `http://<container>:3000` and terminate TLS in front of it. Nothing rwnd.tv-specific is required beyond forwarding `Host` and `X-Forwarded-For` headers, which most reverse proxies (including nginx-pm) do by default.

## Securing your instance

rwnd.tv holds personal data (your watch history, email address, and — if you connect Trakt — OAuth tokens), so if you're exposing it beyond your own machine, a few things are worth getting right:

- **Use HTTPS.** Put a reverse proxy in front (see above) and terminate TLS there — rwnd.tv itself never does. Without it, login credentials and session cookies travel in plaintext.
- **Set `COOKIE_SECURE=true`** once you're on HTTPS. It already defaults to `true` in production if you leave it unset, so this only matters if you've explicitly set it to `false` (e.g. while testing) and forgot to change it back once you added TLS. Flipping it on renames the session cookie (it gains a `__Host-` prefix, a browser-enforced guarantee that only applies to a cookie actually sent over HTTPS) — expect everyone, yourself included, to be logged out once as part of that change.
- **Have your reverse proxy set `X-Forwarded-For`**, and only set `TRUST_PROXY=true` once it does. rwnd.tv uses that header to rate-limit login/registration/etc. per client IP — trusting it without a proxy actually setting it lets any client spoof its own rate-limit bucket, and a proxy that silently drops or doesn't set the header makes every request look like it's coming from one IP, rate-limiting all your users together.
- **Don't expose port 3000 directly** if a reverse proxy is meant to be the only way in — set `BIND_ADDRESS=127.0.0.1` so the container only accepts connections from the host itself, and let the proxy be the sole path from outside. Leave it unset (the default, all interfaces) for a pure-LAN deployment with no proxy in front.
- **Registration defaults to closed.** The first person to load the app becomes the admin (see Quick start above); after that, nobody else can create an account until you open it from Settings → Instance or switch to invite-only.

## Upgrading

```sh
docker compose pull
docker compose up -d
```

Database migrations run automatically on container startup (see `docker-entrypoint.sh`) — there's no separate migration step to run by hand.

## Backups

Everything that matters lives in the `db-data` volume (the Postgres data directory). Back it up like any other Postgres instance, e.g.:

```sh
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql
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
