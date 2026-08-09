# 0003: Local accounts with an OIDC-ready credentials table

## Status

Accepted

## Context

Multi-user support is a stated aim, so the data model has to be multi-tenant from the start — retrofitting a `user_id` onto every table later is the kind of change that's cheap now and expensive after the fact. Login itself has three common approaches in the self-hosted space:

- **Local accounts** (email + password): zero external dependencies, works out of the box for anyone running `docker compose up`.
- **OIDC / SSO** (Authelia, Authentik, Keycloak, or a hosted IdP): the homelab crowd asks for this constantly, and it inherits whatever 2FA/passkey policy the provider enforces — but a full redirect flow and account-linking logic is real scope.
- **Reverse-proxy header auth**: almost no application code, but a footgun if the container is ever reachable without going through the proxy that's supposed to authenticate it first.

Separately, media-player webhooks (Plex/Tautulli in M2) can't fill in a login form — they need a bearer credential, not a session.

## Decision

Ship local accounts only in M1, but split the schema so OIDC is a later _adapter_, not a later _migration_:

- `users` — the identity that owns data (display name, locale, timezone, theme, role). Nothing about how the user logs in lives here.
- `user_credentials` — one row per way a user can authenticate. Today only `type = 'local'` (email + Argon2id password hash) is populated; `type = 'oidc'` (issuer + subject) is modelled in the schema and constrained via check constraints, but no OIDC flow exists yet.
- `sessions` / `api_tokens` — both key off `user_id` alone and store only a hash of the bearer secret, never the raw value. Browser sessions use httpOnly cookies; `api_tokens` exist specifically for webhooks and other non-interactive clients, and are the mechanism M2's Plex/Tautulli ingestion will authenticate with.

Registration is admin-configurable (`instance_settings.registration_mode`: `open` / `invite` / `closed`), defaulting to `closed` so a self-hosted instance exposed to the internet doesn't accidentally accept public signups. The very first admin account is created through a one-time `POST /setup` flow, not through registration.

## Consequences

- Adding OIDC later means writing a new adapter and inserting `user_credentials` rows, not migrating the `users` table or any query that joins against it.
- Proxy-header auth (Authelia in front of nginx-pm, for example) is not implemented in M1. If added, it must be opt-in and paired with a trusted-proxy allowlist — trusting a `Remote-User`-style header unconditionally is unsafe the moment the app is reachable by any other path.
- Every login failure returns the same generic "Invalid email or password" (see `apps/api/src/routes/auth.ts`) regardless of whether the email exists, so the endpoint can't be used to enumerate accounts.
