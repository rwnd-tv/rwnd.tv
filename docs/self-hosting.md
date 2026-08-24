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

| Variable              | Required                         | Notes                                                                              |
| --------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`        | Yes                              | Postgres connection string                                                         |
| `TMDB_API_KEY`        | At least one of TMDB/TVDB        | Free at themoviedb.org                                                             |
| `TVDB_API_KEY`        | At least one of TMDB/TVDB        | Commercial or free "user-supported" key from thetvdb.com                           |
| `TVDB_PIN`            | Only for a "user-supported" key  | Your TheTVDB subscriber PIN — leave unset for a commercial key                     |
| `COOKIE_SECURE`       | Recommended in production        | Set `true` once served over HTTPS — browsers drop `Secure` cookies over plain HTTP |
| `SESSION_COOKIE_NAME` | No                               | Defaults to `rwnd_session`                                                         |
| `TRAKT_CLIENT_ID`     | No                               | Enables Trakt import (Settings > Import) — free app at trakt.tv/oauth/applications |
| `TRAKT_CLIENT_SECRET` | Only if `TRAKT_CLIENT_ID` is set | Paired with the client id above                                                    |
| `ENCRYPTION_KEY`      | Only if `TRAKT_CLIENT_ID` is set | 32 bytes, base64 (`openssl rand -base64 32`) — encrypts stored Trakt tokens        |
| `BACKUP_DIR`          | No                               | Enables per-user backup/restore (Settings > Database) — see Backups below          |

## Putting it behind a reverse proxy

Point your proxy at `http://<container>:3000` and terminate TLS in front of it. Nothing rwnd.tv-specific is required beyond forwarding `Host` and `X-Forwarded-For` headers, which most reverse proxies (including nginx-pm) do by default.

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
  BACKUP_DIR: /data/backups
volumes:
  - ./backups:/data/backups
```

Then `docker compose up -d`. The container runs as an unprivileged user, so `./backups` needs to be writable by it — if you hit permission errors, `chown` the host directory to match rather than loosening it further. Leave both commented out (the default) and the Backups section of the Database panel just doesn't appear.
