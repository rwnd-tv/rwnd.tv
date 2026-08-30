import { relations, sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Case-insensitive text, backed by the Postgres `citext` extension (bundled
 * with the official postgres image's contrib modules). Used for email so
 * login/lookup doesn't depend on the case a user happened to type.
 */
const citext = customType<{ data: string }>({
  dataType() {
    return 'citext'
  },
})

/** Raw binary, for an uploaded profile picture (users.avatarImage) — stored
 * inline rather than on a volume-mounted directory (unlike BACKUP_DIR), so
 * self-hosting an avatar needs no new env var or bind mount. */
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum('user_role', ['admin', 'user'])
export const themeEnum = pgEnum('theme', ['system', 'light', 'dark'])
export const credentialTypeEnum = pgEnum('credential_type', ['local', 'oidc'])
export const registrationModeEnum = pgEnum('registration_mode', ['open', 'invite', 'closed'])
export const metadataEntityTypeEnum = pgEnum('metadata_entity_type', ['movie', 'show', 'episode'])
export const externalIdSourceEnum = pgEnum('external_id_source', ['tmdb', 'imdb', 'tvdb', 'trakt'])
export const playSourceEnum = pgEnum('play_source', ['manual', 'plex', 'import'])
export const webhookSourceEnum = pgEnum('webhook_source', ['plex'])
export const importSourceEnum = pgEnum('import_source', ['trakt', 'trakt_zip', 'csv'])
export const importJobStatusEnum = pgEnum('import_job_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
])

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  locale: text('locale').notNull().default('en-US'),
  timezone: text('timezone').notNull().default('UTC'),
  theme: themeEnum('theme').notNull().default('system'),
  /** Blurs unwatched episode stills/titles/overviews and not-fully-watched
   * show/season descriptions until the viewer explicitly reveals them (or
   * watches them) — see SpoilerGuard.tsx. On by default. */
  spoilerProtectionEnabled: boolean('spoiler_protection_enabled').notNull().default(true),
  /** Off by default: the Dashboard's On Deck row normally only surfaces the
   * episode right after the latest one a viewer has watched for a show
   * (apps/api/src/lib/media.ts's findNextUnwatchedEpisode). On, it also
   * surfaces an earlier aired-but-unwatched episode the viewer skipped
   * over — for someone who deliberately "fills gaps" in a show rather than
   * watching it strictly in order. */
  onDeckFillGaps: boolean('on_deck_fill_gaps').notNull().default(false),
  role: userRoleEnum('role').notNull().default('user'),
  // Uploaded profile picture — all three null until one is uploaded, all
  // three cleared together on removal (apps/api/src/routes/auth.ts). No
  // resizing/compression on upload (no image-processing dependency in this
  // codebase yet); `POST /auth/me/avatar` caps the raw upload size instead.
  // avatarMimeType is what the serving route sends as Content-Type;
  // avatarUpdatedAt is what the frontend uses both as a "has an avatar?"
  // flag (via serializeUser, which never sends the bytes/mimetype
  // themselves) and as a cache-busting query param on the image URL.
  avatarImage: bytea('avatar_image'),
  avatarMimeType: text('avatar_mime_type'),
  avatarUpdatedAt: timestamp('avatar_updated_at', { withTimezone: true }),
  // Null until the address is confirmed via a clicked emailVerificationTokens
  // link (apps/api/src/routes/auth.ts). Every row that existed before this
  // column was added is backfilled to its own createdAt by migration 0017 —
  // already-in-use accounts aren't retroactively asked to reverify something
  // that was working fine. Doesn't gate login/use of the app (a self-hoster
  // without SMTP configured at all would otherwise have no way to ever
  // clear it) — informational only today (shown on ProfilePage.tsx with a
  // resend option), not enforced anywhere.
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * One row per way a user can authenticate. Kept separate from `users` so
 * OIDC support is a new adapter + new rows, not a schema migration:
 * see docs/adr/0003-auth-model.md.
 */
export const userCredentials = pgTable(
  'user_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: credentialTypeEnum('type').notNull(),
    passwordHash: text('password_hash'),
    oidcIssuer: text('oidc_issuer'),
    oidcSubject: text('oidc_subject'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // At most one local credential per user.
    uniqueIndex('user_credentials_local_user_id_idx')
      .on(table.userId)
      .where(sql`${table.type} = 'local'`),
    // An OIDC identity (issuer + subject) maps to exactly one user.
    uniqueIndex('user_credentials_oidc_issuer_subject_idx')
      .on(table.oidcIssuer, table.oidcSubject)
      .where(sql`${table.type} = 'oidc'`),
    check(
      'user_credentials_local_has_password',
      sql`${table.type} <> 'local' OR ${table.passwordHash} IS NOT NULL`,
    ),
    check(
      'user_credentials_oidc_has_identity',
      sql`${table.type} <> 'oidc' OR (${table.oidcIssuer} IS NOT NULL AND ${table.oidcSubject} IS NOT NULL)`,
    ),
  ],
)

/**
 * TOTP MFA (M3 security review follow-up, V4.3.1, docs/TODO.md) — a
 * separate table rather than a third `user_credentials` type: TOTP is a
 * *second factor on top of* a local credential, not an alternative primary
 * one, so folding it into that table would muddy the adapter semantics ADR
 * 0003 established there (see that ADR's update). One row per user
 * (enforced by `userId`'s `.unique()`), created at enrollment with
 * `confirmedAt` null — login only checks TOTP for a user once `confirmedAt`
 * is set, so a mis-scanned QR code during enrollment can't lock anyone out
 * of an account that was never actually protected. `secretEncrypted` uses
 * the same AES-256-GCM `encryptSecret`/`decryptSecret` (`lib/crypto.ts`) as
 * Trakt OAuth tokens — unlike a password or session token, the server has
 * to recompute codes from this, so it must be recoverable, not just
 * hashed.
 */
export const userTotp = pgTable('user_totp', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  secretEncrypted: text('secret_encrypted').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Single-use recovery codes for the TOTP MFA above — generated once at
 * enrollment confirmation, shown to the user exactly once. `usedAt` rather
 * than deleting on use (unlike a password-reset token) so a user can see
 * how many they've already burned through, same reasoning as `invites`'
 * `usedBy` over an outright delete. */
export const userRecoveryCodes = pgTable(
  'user_recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('user_recovery_codes_user_idx').on(table.userId)],
)

/** The short-lived second step of a login for an account with TOTP MFA
 * confirmed — `POST /auth/login` no longer creates a session directly for
 * such an account; it creates one of these instead and the client
 * exchanges it (plus a TOTP or recovery code) at `POST /auth/login/mfa`
 * for the real session. Same "hash at rest, single-use, delete on
 * redemption" shape as `password_reset_tokens` below. 5-minute TTL — long
 * enough to type a code, short enough to bound how long a stolen challenge
 * token (e.g. from a compromised client before the second factor was
 * entered) stays useful. */
export const mfaChallenges = pgTable('mfa_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Browser sessions. The cookie holds the raw token; only its hash is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Backs the session list UI (GET /auth/me/sessions) — nullable rather
    // than defaulting to createdAt's value, so "never used since login" is
    // representable rather than indistinguishable from "used at login
    // time". Bumped by resolveSession() (lib/session.ts), throttled to at
    // most once a minute so an ordinary browsing session doesn't turn every
    // request into a write. M3 security review follow-up (F-24, ASVS
    // V3.3.2), docs/TODO.md.
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  // Backs "sign out" / "sign out everywhere" (apps/api/src/lib/session.ts),
  // both delete-by-userId.
  (table) => [index('sessions_user_idx').on(table.userId)],
)

/** Long-lived tokens for webhooks/scrobblers (Plex/Tautulli in M2, CLI/export clients later). */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Backs every load of the API-tokens settings page
  // (apps/api/src/routes/tokens.ts).
  (table) => [index('api_tokens_user_idx').on(table.userId)],
)

/** Maps one external account (a Plex user, on one specific webhook
 * integration) to the rwnd.tv user its plays should be logged against.
 * Scoped to `tokenId`, not globally — Plex's `Account.id` is only
 * unique *within one server*, so two unrelated Plex-server integrations
 * on the same rwnd.tv instance must not collide. Every account starts
 * (and, in practice, stays — live-verified 2026-08-24: Plex's own docs'
 * claim that "the server owner is always account 1" does not hold for
 * real payloads, so there's no reliable auto-link) with `userId` null,
 * meaning "seen, not yet claimed" — created automatically the first
 * time an unrecognized account shows up in a webhook event
 * (`apps/api/src/lib/webhook-accounts.ts`), so a self-hoster never has
 * to somehow discover a Plex account's numeric id themselves before
 * they can link it (Settings > API tokens' per-token "Linked accounts"
 * list is where that claim actually happens — see
 * `apps/api/src/lib/webhook-plays.ts` for what happens to any watch
 * that arrived while still unclaimed). Deleting the parent token
 * cascades — a revoked webhook's account mappings have nothing left to
 * attach to. */
export const webhookAccountLinks = pgTable(
  'webhook_account_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenId: uuid('token_id')
      .notNull()
      .references(() => apiTokens.id, { onDelete: 'cascade' }),
    source: webhookSourceEnum('source').notNull(),
    externalAccountId: text('external_account_id').notNull(),
    // Display-only (Plex's Account.title, i.e. username) — never the
    // match key, just so the claim UI shows a human a name instead of a
    // bare number. Refreshed on every sighting in case it changes.
    externalAccountName: text('external_account_name').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('webhook_account_links_token_source_account_idx').on(
      table.tokenId,
      table.source,
      table.externalAccountId,
    ),
  ],
)

/** A webhook event that arrived for an account not yet linked to a
 * rwnd.tv user (see `webhookAccountLinks` above) — stored in full so it
 * can become a real `plays` row retroactively the moment that account
 * gets claimed, instead of being lost. `event` is the parsed,
 * source-agnostic shape (`apps/api/src/webhooks/plex.ts`'s
 * `IncomingWatchEvent`, or any future source's own equivalent) —
 * defined structurally here rather than imported, since this package
 * has no dependency on the app layer. `watchedAt` is when the event
 * actually happened, not when it's eventually replayed — see
 * `apps/api/src/lib/webhook-plays.ts`. Retention: a daily sweep
 * (apps/api/src/lib/webhook-retention.ts) deletes rows older than 90
 * days for a link that's never been claimed — see that file's doc
 * comment for why an account left permanently unclaimed shouldn't grow
 * this table forever (M3 security review). */
export const pendingWebhookEvents = pgTable(
  'pending_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenId: uuid('token_id')
      .notNull()
      .references(() => apiTokens.id, { onDelete: 'cascade' }),
    source: webhookSourceEnum('source').notNull(),
    externalAccountId: text('external_account_id').notNull(),
    watchedAt: timestamp('watched_at', { withTimezone: true }).notNull(),
    event: jsonb('event')
      .$type<{
        ids: { imdb?: string | null; tmdb?: string | number | null; tvdb?: string | number | null }
        ratingKey: string
        media:
          | { type: 'movie' }
          | { type: 'episode'; showTitle: string; seasonNumber: number; episodeNumber: number }
      }>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('pending_webhook_events_token_source_account_idx').on(
      table.tokenId,
      table.source,
      table.externalAccountId,
    ),
  ],
)

/** Singleton row (id is always 1) holding instance-wide configuration. */
export const instanceSettings = pgTable(
  'instance_settings',
  {
    id: smallint('id').primaryKey().default(1),
    instanceName: text('instance_name').notNull().default('rwnd.tv'),
    registrationMode: registrationModeEnum('registration_mode').notNull().default('closed'),
    defaultLocale: text('default_locale').notNull().default('en-US'),
    // Ordered list of metadata provider sources, highest priority first.
    // Plain text[] rather than a pg enum array, following defaultLocale
    // above — the valid set is an app-level concern (which providers this
    // instance has credentials for), and an ordered list doesn't fit an
    // enum's model anyway. Unknown/unconfigured entries are filtered on
    // read — see apps/api/src/routes/settings.ts's serializeSettings.
    metadataProviderPriority: text('metadata_provider_priority')
      .array()
      .notNull()
      .default(['tmdb']),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('instance_settings_singleton', sql`${table.id} = 1`)],
)

/** Per-account exponential login backoff (M3 security review — nothing
 * throttled failed logins before this). One row per email that has ever
 * failed a login, upserted rather than one-row-per-attempt so this stays
 * a fixed-size table rather than growing unbounded. Keyed by the
 * *attempted* email, not `users.id` — this has to apply identically
 * whether or not that email belongs to a real account, or the lockout
 * itself becomes a new account-enumeration side channel (see
 * apps/api/src/lib/login-lockout.ts). Deliberately DB-backed rather than
 * in-memory (unlike the IP-based limiters in
 * apps/api/src/middleware/rate-limit.ts) — this is the credential-stuffing
 * defence, so it needs to survive a container restart. Cleared (row
 * deleted) on a successful login. */
export const loginAttempts = pgTable('login_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  failedCount: integer('failed_count').notNull().default(0),
  lastFailedAt: timestamp('last_failed_at', { withTimezone: true }).notNull().defaultNow(),
})

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  codeHash: text('code_hash').notNull().unique(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** One-shot password reset link (Settings/ProfilePage's "Forgot password?"
 * flow, apps/api/src/routes/auth.ts). Unlike `invites` above, there's no
 * `usedBy`/accountability need for this — the row is just deleted once
 * redeemed (same as sessions/apiTokens on revoke), rather than kept around
 * marked used. `tokenHash` is the same generateSecret()/hashSecret() pair
 * sessions and API tokens use — the raw token only ever exists in the
 * emailed link, never stored. */
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** One-shot email-verification link (`users.emailVerifiedAt` above) — same
 * shape and reasoning as `passwordResetTokens` immediately above (deleted
 * on redemption, hashed-opaque-token). A user can have more than one of
 * these outstanding at once isn't prevented at the schema level, but
 * `POST /auth/resend-verification` deletes any existing row for the user
 * before issuing a new one, so in practice there's only ever one live. */
export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Backs createEmailVerificationToken's delete-by-userId
  // (apps/api/src/lib/account-tokens.ts), which drops any token already
  // outstanding for this user before issuing a new one.
  (table) => [index('email_verification_tokens_user_idx').on(table.userId)],
)

/** One-shot email-*change* confirmation link — deliberately a separate
 * table from `emailVerificationTokens` above rather than reusing it with
 * an implicit "does this user have a pending new address?" branch: same
 * hashed-opaque-token/deleted-on-redemption shape, but this one also
 * carries the candidate `newEmail` itself, since `users.email` isn't
 * touched until the link is actually clicked (apps/api/src/routes/auth.ts
 * — POST /auth/me/email creates the row and emails *newEmail*, not the
 * account's current address; POST /auth/confirm-email-change redeems it
 * and only then updates `users.email`/`emailVerifiedAt`). `newEmail` is
 * `citext` to match `users.email`'s case-insensitive uniqueness — the
 * confirm route re-checks it's still free at redemption time, in case
 * someone else claimed it in the meantime. */
export const emailChangeTokens = pgTable(
  'email_change_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    newEmail: citext('new_email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Backs createEmailChangeToken's delete-by-userId
  // (apps/api/src/lib/account-tokens.ts), same reasoning as
  // emailVerificationTokens above.
  (table) => [index('email_change_tokens_user_idx').on(table.userId)],
)

// ---------------------------------------------------------------------------
// Metadata (sourced from a MetadataProvider — TMDB today, see
// apps/api/src/providers)
// ---------------------------------------------------------------------------

export const movies = pgTable('movies', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  // URL-friendly identifier (e.g. "the-matrix-1999"), generated once from
  // title+year when the movie is first resolved (see
  // generateUniqueMovieSlug() in apps/api/src/lib/slug.ts) and never
  // recomputed afterwards, so a movie keeps the same URL even if a later
  // metadata refresh changes its title. Unique per-instance only, same as
  // shows.slug below. Existing rows were backfilled by migration 0009,
  // whose SQL must stay in sync with slugify().
  slug: text('slug').notNull().unique(),
  year: integer('year'),
  runtimeMinutes: integer('runtime_minutes'),
  overview: text('overview'),
  posterPath: text('poster_path'),
  // TMDB's genre names verbatim — same fixed-vocabulary reasoning as
  // shows.genres below (a plain string array, no normalised genres table).
  // Backs the movie detail page's fact line today; a movies-gallery genre
  // filter panel is a deliberate follow-up, not built yet.
  genres: text('genres').array().notNull().default([]),
  // TMDB's raw vote_average (0-10, one decimal place in their UI). Null
  // until the metadata refresher has cached this movie, or genuinely null
  // for a movie TMDB has no votes for yet — same convention as
  // shows.voteAverage below. Not the user's own rating of the movie —
  // that's the separate `ratings` table.
  voteAverage: real('vote_average'),
  // Which provider last wrote the fields above — recorded at write time
  // rather than derived from external_ids + the priority order at read
  // time, since those two answer different questions once the priority
  // order can change after the fact (see docs/adr/0006). Null only for a
  // row written before this column existed and never refreshed since;
  // backfilled for everything else by migration 0012.
  metadataSource: externalIdSourceEnum('metadata_source'),
  // Never older than the provider's max cache lifetime (6 months for TMDB).
  metadataRefreshedAt: timestamp('metadata_refreshed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const shows = pgTable('shows', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  // URL-friendly identifier (e.g. "battlestar-galactica-1978"), generated
  // once from title+year when the show is first resolved (see
  // generateUniqueShowSlug() in apps/api/src/lib/media.ts) and never
  // recomputed afterwards, so a show keeps the same URL even if a later
  // metadata refresh changes its title. Unique per-instance only — nothing
  // needs slugs to agree across separate rwnd.tv installs.
  slug: text('slug').notNull().unique(),
  year: integer('year'),
  overview: text('overview'),
  posterPath: text('poster_path'),
  // TMDB's raw status string ('Returning Series', 'Ended', 'Canceled', ...).
  // Null for shows resolved before this column existed, until next refresh.
  // Drives the metadata refresher: airing shows refresh far more often than
  // ended ones — see apps/api/src/metadata/refresh.ts.
  status: text('status'),
  // TMDB's genre names verbatim (e.g. 'Drama', 'Animation') — from a fixed
  // ~16-value vocabulary, so a plain string array rather than a normalised
  // genres table: nothing else needs to reference a genre by id, and there's
  // no per-genre metadata beyond the name. Backs the shows gallery's genre
  // filter panel (apps/web/src/components/library/GenreFilterPanel.tsx).
  genres: text('genres').array().notNull().default([]),
  // TMDB's raw vote_average (0-10, one decimal place in their UI). Null
  // until the metadata refresher has cached this show, or genuinely null
  // for a show TMDB has no votes for yet — both cases are treated the same
  // by the gallery (see ShowsPage.tsx's rating filter/sort). Not a user's
  // own rating of the show — that's the separate `ratings` table below.
  voteAverage: real('vote_average'),
  // See movies.metadataSource above for what this means and why it's
  // stored rather than derived.
  metadataSource: externalIdSourceEnum('metadata_source'),
  metadataRefreshedAt: timestamp('metadata_refreshed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Per-season episode counts, cached from the metadata provider so the shows
 * library gallery can compute "154 / 212 episodes" without ever calling
 * TMDB itself (apps/api/src/routes/library.ts). Populated by the metadata
 * refresher (apps/api/src/metadata/refresh.ts), not by resolveShow() — a
 * show can exist locally (because you watched an episode of it) long before
 * its season breakdown has been fetched.
 */
export const seasons = pgTable(
  'seasons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    name: text('name'),
    episodeCount: integer('episode_count').notNull(),
    // How many of this season's episodes had actually aired as of the last
    // metadata refresh — null until the refresher computes it (see
    // apps/api/src/metadata/refresh.ts). Distinct from episodeCount, which
    // is TMDB's eventual/planned total and includes unaired episodes for a
    // still-airing season.
    airedEpisodeCount: integer('aired_episode_count'),
    airDate: date('air_date'),
    posterPath: text('poster_path'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('seasons_show_season_idx').on(table.showId, table.seasonNumber)],
)

export const episodes = pgTable(
  'episodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    episodeNumber: integer('episode_number').notNull(),
    title: text('title'),
    runtimeMinutes: integer('runtime_minutes'),
    firstAired: date('first_aired'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('episodes_show_season_episode_idx').on(
      table.showId,
      table.seasonNumber,
      table.episodeNumber,
    ),
  ],
)

/**
 * Polymorphic map from an rwnd.tv movie/show/episode to an ID in an external
 * system. No FK on (entityType, entityId) — Postgres can't express a
 * cross-table polymorphic reference — so referential integrity there is
 * enforced in application code. Load-bearing for M2: Trakt exports carry
 * tmdb/imdb/tvdb/trakt IDs, which is how imported history is matched against
 * records that already exist locally.
 */
export const externalIds = pgTable(
  'external_ids',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: metadataEntityTypeEnum('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    source: externalIdSourceEnum('source').notNull(),
    externalId: text('external_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('external_ids_entity_source_idx').on(
      table.entityType,
      table.entityId,
      table.source,
    ),
    uniqueIndex('external_ids_source_lookup_idx').on(
      table.entityType,
      table.source,
      table.externalId,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export const plays = pgTable(
  'plays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    movieId: uuid('movie_id').references(() => movies.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),
    watchedAt: timestamp('watched_at', { withTimezone: true }).notNull(),
    source: playSourceEnum('source').notNull().default('manual'),
    // Opaque identifier for the play in its originating system (a Trakt
    // history item id today, a Plex/Tautulli event id later). Only
    // populated for non-manual sources — it's what makes re-running an
    // import, or a webhook retry, idempotent instead of double-logging.
    sourceRef: text('source_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('plays_user_watched_at_idx').on(table.userId, table.watchedAt.desc()),
    uniqueIndex('plays_user_source_ref_idx')
      .on(table.userId, table.source, table.sourceRef)
      .where(sql`${table.sourceRef} IS NOT NULL`),
    check(
      'plays_exactly_one_media_ref',
      sql`(${table.movieId} IS NOT NULL)::int + (${table.episodeId} IS NOT NULL)::int = 1`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Trakt import (M2, see docs/adr/0004-trakt-import.md)
// ---------------------------------------------------------------------------

/**
 * One row per user's linked Trakt account. Tokens are encrypted (not
 * hashed, unlike sessions/api_tokens) because the import job has to
 * present them back to Trakt — see apps/api/src/lib/crypto.ts.
 */
export const traktConnections = pgTable('trakt_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  traktUsername: text('trakt_username').notNull(),
  accessTokenEncrypted: text('access_token_encrypted').notNull(),
  refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * A (potentially long-running, resumable) import run. `cursor` records
 * where in the history/ratings/watchlist sequence the job got to, so a
 * restart (see apps/api/src/index.ts) picks back up rather than starting
 * over. `failures` records every unmatched item, uncapped — users want to
 * see everything that didn't come across, not a truncated sample.
 */
export const importJobs = pgTable(
  'import_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: importSourceEnum('source').notNull().default('trakt'),
    status: importJobStatusEnum('status').notNull().default('pending'),
    includeHistory: boolean('include_history').notNull().default(true),
    includeRatings: boolean('include_ratings').notNull().default(true),
    includeWatchlist: boolean('include_watchlist').notNull().default(true),
    includeDropped: boolean('include_dropped').notNull().default(true),
    cursor: jsonb('cursor').$type<{
      phase: 'history' | 'ratings' | 'watchlist' | 'dropped'
      page: number
    }>(),
    itemsTotal: integer('items_total'),
    itemsProcessed: integer('items_processed').notNull().default(0),
    itemsImported: integer('items_imported').notNull().default(0),
    itemsSkipped: integer('items_skipped').notNull().default(0),
    failures: jsonb('failures')
      .$type<
        Array<{
          phase: string
          reason: string
          title?: string
          show?: string
          season?: number
          episode?: number
        }>
      >()
      .notNull()
      .default([]),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A user can only have one import in flight at a time.
    uniqueIndex('import_jobs_user_active_idx')
      .on(table.userId)
      .where(sql`${table.status} IN ('pending', 'running')`),
    index('import_jobs_user_created_at_idx').on(table.userId, table.createdAt.desc()),
  ],
)

/**
 * Polymorphic like `external_ids` (schema comment above applies here too):
 * no FK on (entityType, entityId) since Postgres can't express a
 * cross-table reference, so integrity is enforced in application code.
 */
export const ratings = pgTable(
  'ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entityType: metadataEntityTypeEnum('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    rating: smallint('rating').notNull(),
    ratedAt: timestamp('rated_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ratings_user_entity_idx').on(table.userId, table.entityType, table.entityId),
    check('ratings_rating_range', sql`${table.rating} BETWEEN 1 AND 10`),
    // Backs GET /activity's rating branch (apps/api/src/routes/activity.ts),
    // which orders/paginates the merged feed by occurredAt — ratedAt here.
    index('ratings_user_rated_at_idx').on(table.userId, table.ratedAt.desc()),
  ],
)

/**
 * A named list a user keeps titles on — "Watchlist" (2026-08-27) widened
 * `watchlist_items` below from a single flat per-user list into any number
 * of named ones. Every user always has exactly one list with
 * `isDefault: true` (`ensureDefaultWatchlist`, apps/api/src/lib/watchlists.ts),
 * created at registration and never renameable/deletable — it's what the
 * one-click watchlist toggle on a show/movie page writes to. Custom lists
 * are freely created/renamed/deleted by the user, added via a secondary
 * "manage lists" dialog rather than the one-click toggle (James, 2026-08-27:
 * wanted single-click for the common case, more UI is fine for the rest).
 */
export const watchlists = pgTable(
  'watchlists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    // The pinned cover item, if the user chose one — null means "fall back
    // to the most recently added item", resolved at read time rather than
    // stored, so removing or un-pinning the cover item can't leave a list
    // with no art. ON DELETE SET NULL for the same reason: removing the
    // pinned item from the list falls back automatically instead of
    // dangling or cascading the whole list away.
    coverItemId: uuid('cover_item_id').references((): AnyPgColumn => watchlistItems.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Names are unique per user, not globally (James, 2026-08-27) — two
    // users can each have a list called "Cool Sci-fi Stuff!". If sharing
    // lists ever happens, disambiguate in the UI via the owner's username
    // rather than constraining the data.
    uniqueIndex('watchlists_user_name_idx').on(table.userId, table.name),
    // Partial unique index: at most one row per user can have
    // isDefault = true, so a bug can't silently create a second Default.
    uniqueIndex('watchlists_user_default_idx')
      .on(table.userId)
      .where(sql`${table.isDefault}`),
  ],
)

/** Polymorphic like `ratings` above. */
export const watchlistItems = pgTable(
  'watchlist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Denormalised alongside watchlistId (always written together) rather
    // than dropped in favour of a join — every existing per-user scoped
    // query (activity feed, backup, export, clear-data, data-counts)
    // filters on userId directly, and every one of those would need a new
    // join to `watchlists` for no gain if this were removed.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    watchlistId: uuid('watchlist_id')
      .notNull()
      .references(() => watchlists.id, { onDelete: 'cascade' }),
    entityType: metadataEntityTypeEnum('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    listedAt: timestamp('listed_at', { withTimezone: true }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Was (userId, entityType, entityId) before named lists — widening it
    // to key on watchlistId instead of userId is what lets the same title
    // sit on several of a user's lists at once, one row each.
    uniqueIndex('watchlist_items_watchlist_entity_idx').on(
      table.watchlistId,
      table.entityType,
      table.entityId,
    ),
    // Same reasoning as ratings_user_rated_at_idx above, for the watchlist
    // branch of GET /activity.
    index('watchlist_items_user_listed_at_idx').on(table.userId, table.listedAt.desc()),
  ],
)

/**
 * A show the user has partially watched but doesn't intend to finish —
 * mirrors Trakt's own "Dropped" feature (apps/api/src/trakt/types.ts's
 * TraktHiddenItem, imported from `/users/hidden/dropped`). Unlike
 * `ratings`/`watchlist_items` above, this is **not** polymorphic — Trakt's
 * drop concept only applies to shows, so a real FK to `shows.id` is simpler
 * and stricter than reusing the (entityType, entityId) pattern for a
 * single entity type. Settable either by importing from Trakt or via a
 * manual toggle in rwnd.tv itself (apps/api/src/routes/library.ts) — the
 * first piece of per-user state that isn't Trakt-import-only.
 *
 * Trakt's state and the user's own manual choice are tracked as two
 * separate, independently-updated pairs rather than one collapsed
 * `dropped`/`source` value (which is what this table originally shipped
 * with, 2026-08-21) — `traktDropped` is always freely overwritten by the
 * next import, and `manualDropped` (nullable: null means "no override,
 * defer to Trakt") is only ever set by the manual toggle routes in
 * apps/api/src/routes/library.ts. The effective state read everywhere
 * else is `manualDropped ?? traktDropped ?? false`.
 *
 * The reason for the split: a single collapsed value made a manual
 * override "sticky" forever once set, even after toggling it back to
 * exactly what Trakt already said — there was no way to tell the system
 * "I'm not overriding anymore." With two fields, both the manual routes
 * and the importer can each *clear* `manualDropped` back to null the
 * moment it matches the (possibly just-updated) `traktDropped` value,
 * so an override only persists for as long as a real disagreement exists
 * (James, 2026-08-21).
 */
export const droppedShows = pgTable(
  'dropped_shows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    // Trakt's own state as of the last import that processed this show —
    // null until an import has ever reported it. Always kept in sync by
    // apps/api/src/import/trakt.ts, never blocked by a manual override.
    traktDropped: boolean('trakt_dropped'),
    traktDroppedAt: timestamp('trakt_dropped_at', { withTimezone: true }),
    // The user's own explicit choice, when it disagrees with (or predates)
    // Trakt's state — null means no override. Set by the manual
    // drop/undrop routes, auto-cleared back to null (by either the manual
    // routes or the importer) the moment it stops disagreeing with
    // `traktDropped`.
    manualDropped: boolean('manual_dropped'),
    manualDroppedAt: timestamp('manual_dropped_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('dropped_shows_user_show_idx').on(table.userId, table.showId)],
)

// ---------------------------------------------------------------------------
// Relations (for Drizzle's relational query API)
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many, one }) => ({
  credentials: many(userCredentials),
  sessions: many(sessions),
  apiTokens: many(apiTokens),
  webhookAccountLinks: many(webhookAccountLinks),
  plays: many(plays),
  traktConnection: one(traktConnections, {
    fields: [users.id],
    references: [traktConnections.userId],
  }),
  importJobs: many(importJobs),
  ratings: many(ratings),
  watchlists: many(watchlists),
  droppedShows: many(droppedShows),
}))

export const traktConnectionsRelations = relations(traktConnections, ({ one }) => ({
  user: one(users, { fields: [traktConnections.userId], references: [users.id] }),
}))

export const importJobsRelations = relations(importJobs, ({ one }) => ({
  user: one(users, { fields: [importJobs.userId], references: [users.id] }),
}))

export const ratingsRelations = relations(ratings, ({ one }) => ({
  user: one(users, { fields: [ratings.userId], references: [users.id] }),
}))

export const watchlistsRelations = relations(watchlists, ({ one, many }) => ({
  user: one(users, { fields: [watchlists.userId], references: [users.id] }),
  items: many(watchlistItems),
  coverItem: one(watchlistItems, {
    fields: [watchlists.coverItemId],
    references: [watchlistItems.id],
  }),
}))

export const watchlistItemsRelations = relations(watchlistItems, ({ one }) => ({
  user: one(users, { fields: [watchlistItems.userId], references: [users.id] }),
  watchlist: one(watchlists, {
    fields: [watchlistItems.watchlistId],
    references: [watchlists.id],
  }),
}))

export const droppedShowsRelations = relations(droppedShows, ({ one }) => ({
  user: one(users, { fields: [droppedShows.userId], references: [users.id] }),
  show: one(shows, { fields: [droppedShows.showId], references: [shows.id] }),
}))

export const userCredentialsRelations = relations(userCredentials, ({ one }) => ({
  user: one(users, { fields: [userCredentials.userId], references: [users.id] }),
}))

export const userTotpRelations = relations(userTotp, ({ one }) => ({
  user: one(users, { fields: [userTotp.userId], references: [users.id] }),
}))

export const userRecoveryCodesRelations = relations(userRecoveryCodes, ({ one }) => ({
  user: one(users, { fields: [userRecoveryCodes.userId], references: [users.id] }),
}))

export const mfaChallengesRelations = relations(mfaChallenges, ({ one }) => ({
  user: one(users, { fields: [mfaChallenges.userId], references: [users.id] }),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))

export const apiTokensRelations = relations(apiTokens, ({ one, many }) => ({
  user: one(users, { fields: [apiTokens.userId], references: [users.id] }),
  webhookAccountLinks: many(webhookAccountLinks),
  pendingWebhookEvents: many(pendingWebhookEvents),
}))

export const webhookAccountLinksRelations = relations(webhookAccountLinks, ({ one }) => ({
  token: one(apiTokens, { fields: [webhookAccountLinks.tokenId], references: [apiTokens.id] }),
  user: one(users, { fields: [webhookAccountLinks.userId], references: [users.id] }),
}))

export const pendingWebhookEventsRelations = relations(pendingWebhookEvents, ({ one }) => ({
  token: one(apiTokens, { fields: [pendingWebhookEvents.tokenId], references: [apiTokens.id] }),
}))

export const showsRelations = relations(shows, ({ many }) => ({
  episodes: many(episodes),
  seasons: many(seasons),
  droppedShows: many(droppedShows),
}))

export const seasonsRelations = relations(seasons, ({ one }) => ({
  show: one(shows, { fields: [seasons.showId], references: [shows.id] }),
}))

export const episodesRelations = relations(episodes, ({ one, many }) => ({
  show: one(shows, { fields: [episodes.showId], references: [shows.id] }),
  plays: many(plays),
}))

export const moviesRelations = relations(movies, ({ many }) => ({
  plays: many(plays),
}))

export const playsRelations = relations(plays, ({ one }) => ({
  user: one(users, { fields: [plays.userId], references: [users.id] }),
  movie: one(movies, { fields: [plays.movieId], references: [movies.id] }),
  episode: one(episodes, { fields: [plays.episodeId], references: [episodes.id] }),
}))
