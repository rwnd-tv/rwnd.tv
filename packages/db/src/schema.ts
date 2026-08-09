import { relations, sql } from 'drizzle-orm'
import {
  check,
  customType,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
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

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  locale: text('locale').notNull().default('en-GB'),
  timezone: text('timezone').notNull().default('UTC'),
  theme: themeEnum('theme').notNull().default('system'),
  role: userRoleEnum('role').notNull().default('user'),
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

/** Browser sessions. The cookie holds the raw token; only its hash is stored. */
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Long-lived tokens for webhooks/scrobblers (Plex/Tautulli in M2, CLI/export clients later). */
export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Singleton row (id is always 1) holding instance-wide configuration. */
export const instanceSettings = pgTable(
  'instance_settings',
  {
    id: smallint('id').primaryKey().default(1),
    instanceName: text('instance_name').notNull().default('rwnd.tv'),
    registrationMode: registrationModeEnum('registration_mode').notNull().default('closed'),
    defaultLocale: text('default_locale').notNull().default('en-GB'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('instance_settings_singleton', sql`${table.id} = 1`)],
)

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

// ---------------------------------------------------------------------------
// Metadata (sourced from a MetadataProvider — TMDB today, see
// apps/api/src/providers)
// ---------------------------------------------------------------------------

export const movies = pgTable('movies', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  year: integer('year'),
  runtimeMinutes: integer('runtime_minutes'),
  overview: text('overview'),
  posterPath: text('poster_path'),
  // Never older than the provider's max cache lifetime (6 months for TMDB).
  metadataRefreshedAt: timestamp('metadata_refreshed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const shows = pgTable('shows', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  year: integer('year'),
  overview: text('overview'),
  posterPath: text('poster_path'),
  metadataRefreshedAt: timestamp('metadata_refreshed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('plays_user_watched_at_idx').on(table.userId, table.watchedAt.desc()),
    check(
      'plays_exactly_one_media_ref',
      sql`(${table.movieId} IS NOT NULL)::int + (${table.episodeId} IS NOT NULL)::int = 1`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Relations (for Drizzle's relational query API)
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  credentials: many(userCredentials),
  sessions: many(sessions),
  apiTokens: many(apiTokens),
  plays: many(plays),
}))

export const userCredentialsRelations = relations(userCredentials, ({ one }) => ({
  user: one(users, { fields: [userCredentials.userId], references: [users.id] }),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))

export const apiTokensRelations = relations(apiTokens, ({ one }) => ({
  user: one(users, { fields: [apiTokens.userId], references: [users.id] }),
}))

export const showsRelations = relations(shows, ({ many }) => ({
  episodes: many(episodes),
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
