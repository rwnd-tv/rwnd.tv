import type { User } from '@rwnd/shared'
import { api } from '../lib/api-client.js'

/** A handful of curated, readable-on-white-text colours (not a continuous
 * hue wheel) so a generated avatar's background stays deliberate rather
 * than landing on something washed-out or clashing — same reasoning as
 * PosterTile.tsx's fixed fallback colour, just one-of-several instead of
 * always the same one, since telling accounts apart at a glance (this
 * component's whole reason to exist) benefits from the variation. */
const AVATAR_PALETTE = [
  '#e11d48',
  '#ea580c',
  '#65a30d',
  '#059669',
  '#0891b2',
  '#4f46e5',
  '#7c3aed',
  '#db2777',
]

function colorForUser(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]!
}

/**
 * The caller's own avatar by default — backed by `GET /auth/me/avatar`,
 * which only ever serves the logged-in user's own image, not an arbitrary
 * user id. Used unadorned in Sidebar.tsx and ProfileForm.tsx, both of which
 * only ever have `useAuth()`'s own `user` to show. `UserRow.tsx`/
 * `AdminUserPage.tsx` (2026-09-03) pass an explicit `avatarUrl` builder
 * instead, pointed at the admin-only `GET /admin/users/{id}/avatar`
 * (routes/admin-users.ts) — the one other route that can serve *someone
 * else's* image, and only to an admin.
 *
 * No image uploaded (or none loaded yet) falls back to a single initial on a
 * colour derived from the user's id — same "no image → fall back to
 * something derived from the title/name" shape as PosterTile.tsx's
 * fallback, just circular (avatars, unlike posters, aren't a fixed
 * aspect ratio with a real "wrong" shape) and with a per-user colour instead
 * of always the same muted grey, since the colour is itself part of what
 * makes two accounts distinguishable at a glance.
 */
export function Avatar({
  user,
  size = 32,
  avatarUrl = api.auth.avatarUrl,
}: {
  user: Pick<User, 'id' | 'displayName' | 'avatarUpdatedAt'>
  size?: number
  avatarUrl?: (avatarUpdatedAt: string) => string
}) {
  return (
    <div
      className="flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: colorForUser(user.id),
        fontSize: size * 0.45,
      }}
    >
      {user.avatarUpdatedAt ? (
        <img src={avatarUrl(user.avatarUpdatedAt)} alt="" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden="true" className="font-semibold">
          {user.displayName.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  )
}
