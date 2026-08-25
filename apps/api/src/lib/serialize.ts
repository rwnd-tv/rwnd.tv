import type { User } from '@rwnd/shared'
import type { UserRecord } from '../types.js'

export function serializeUser(user: UserRecord): User {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    locale: user.locale as User['locale'],
    timezone: user.timezone,
    theme: user.theme,
    spoilerProtectionEnabled: user.spoilerProtectionEnabled,
    onDeckFillGaps: user.onDeckFillGaps,
    role: user.role,
    avatarUpdatedAt: user.avatarUpdatedAt?.toISOString() ?? null,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  }
}
