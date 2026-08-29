export * from './constants.js'
export * from './schemas/common.js'
export * from './schemas/auth.js'
export * from './schemas/tokens.js'
export * from './schemas/search.js'
export * from './schemas/plays.js'
export * from './schemas/activity.js'
export * from './schemas/settings.js'
export * from './schemas/imports.js'
export * from './schemas/library.js'
export * from './schemas/watchlists.js'
export * from './schemas/account.js'
export * from './schemas/backups.js'
export * from './schemas/sessions.js'
// Only the top-level file schema/type of each frozen format is a real public
// export — every sub-schema (backupShowSchemaV1, backupWatchlistItemSchemaV2,
// etc.) exists solely to compose these and has no consumer outside its own
// file (verified by grep across apps/api and apps/web).
export { backupFileSchemaV1 } from './schemas/backups-v1.js'
export type { BackupFileV1 } from './schemas/backups-v1.js'
export { backupFileSchemaV2 } from './schemas/backups-v2.js'
export type { BackupFileV2 } from './schemas/backups-v2.js'
