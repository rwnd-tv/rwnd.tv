import { describe, expect, it } from 'vitest'
import {
  createdComparatorAsc,
  createdComparatorDesc,
  filterByMfa,
  filterByNameOrEmail,
  filterByRole,
  filterByVerified,
  lastLoginComparatorAsc,
  lastLoginComparatorDesc,
  nameComparatorAsc,
  roleComparatorAsc,
  roleComparatorDesc,
} from './admin-user-filter.js'

describe('filterByNameOrEmail', () => {
  const users = [
    { displayName: 'Amélie Poulain', email: 'amelie@example.com' },
    { displayName: 'Bob Ross', email: 'happy.trees@example.com' },
  ]

  it('matches on displayName, case- and accent-insensitively', () => {
    expect(filterByNameOrEmail(users, 'amelie')).toEqual([users[0]])
  })

  it('matches on email even when displayName does not match', () => {
    expect(filterByNameOrEmail(users, 'happy.trees')).toEqual([users[1]])
  })

  it('returns everything for a blank query', () => {
    expect(filterByNameOrEmail(users, '   ')).toEqual(users)
  })

  it('matches nothing when neither field contains the query', () => {
    expect(filterByNameOrEmail(users, 'zzz')).toEqual([])
  })
})

describe('filterByRole', () => {
  const users = [{ role: 'owner' as const }, { role: 'admin' as const }, { role: 'user' as const }]

  it('no rules returns everything', () => {
    expect(filterByRole(users, {})).toEqual(users)
  })

  it('include narrows to exactly the included role(s), OR-ed together', () => {
    expect(filterByRole(users, { admin: 'include', owner: 'include' })).toEqual([
      { role: 'owner' },
      { role: 'admin' },
    ])
  })

  it('exclude hides the excluded role, letting everything else through', () => {
    expect(filterByRole(users, { user: 'exclude' })).toEqual([{ role: 'owner' }, { role: 'admin' }])
  })
})

describe('filterByMfa', () => {
  const users = [{ mfaEnabled: true }, { mfaEnabled: false }]

  it("'neutral' returns everything", () => {
    expect(filterByMfa(users, 'neutral')).toEqual(users)
  })

  it("'include' returns only mfaEnabled users", () => {
    expect(filterByMfa(users, 'include')).toEqual([{ mfaEnabled: true }])
  })

  it("'exclude' returns only non-mfaEnabled users", () => {
    expect(filterByMfa(users, 'exclude')).toEqual([{ mfaEnabled: false }])
  })
})

describe('filterByVerified', () => {
  const users = [{ emailVerifiedAt: '2026-01-01T00:00:00.000Z' }, { emailVerifiedAt: null }]

  it("'neutral' returns everything", () => {
    expect(filterByVerified(users, 'neutral')).toEqual(users)
  })

  it("'include' returns only users with a non-null emailVerifiedAt", () => {
    expect(filterByVerified(users, 'include')).toEqual([users[0]])
  })

  it("'exclude' returns only users with a null emailVerifiedAt", () => {
    expect(filterByVerified(users, 'exclude')).toEqual([users[1]])
  })
})

describe('nameComparatorAsc', () => {
  it('sorts case- and locale-insensitively', () => {
    const users = [{ displayName: 'bob' }, { displayName: 'Amy' }]
    expect([...users].sort(nameComparatorAsc('en-GB'))).toEqual([
      { displayName: 'Amy' },
      { displayName: 'bob' },
    ])
  })
})

describe('roleComparatorAsc / roleComparatorDesc', () => {
  const users = [
    { role: 'user' as const, displayName: 'Zed' },
    { role: 'owner' as const, displayName: 'Owen' },
    { role: 'admin' as const, displayName: 'Amy' },
  ]

  it('asc ranks owner, then admin, then user', () => {
    expect([...users].sort(roleComparatorAsc('en-GB')).map((u) => u.role)).toEqual([
      'owner',
      'admin',
      'user',
    ])
  })

  it('desc ranks user, then admin, then owner', () => {
    expect([...users].sort(roleComparatorDesc('en-GB')).map((u) => u.role)).toEqual([
      'user',
      'admin',
      'owner',
    ])
  })

  it('ties on role fall back to a locale-aware name comparison', () => {
    const admins = [
      { role: 'admin' as const, displayName: 'Zed' },
      { role: 'admin' as const, displayName: 'Amy' },
    ]
    expect([...admins].sort(roleComparatorAsc('en-GB')).map((u) => u.displayName)).toEqual([
      'Amy',
      'Zed',
    ])
  })
})

describe('lastLoginComparatorDesc / lastLoginComparatorAsc', () => {
  const users = [
    { lastLoginAt: '2026-01-01T00:00:00.000Z' },
    { lastLoginAt: null },
    { lastLoginAt: '2026-06-01T00:00:00.000Z' },
  ]

  it('desc sorts most-recent first, with never-signed-in last', () => {
    expect([...users].sort(lastLoginComparatorDesc).map((u) => u.lastLoginAt)).toEqual([
      '2026-06-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      null,
    ])
  })

  it('asc sorts least-recent first, with never-signed-in still last (not first)', () => {
    expect([...users].sort(lastLoginComparatorAsc).map((u) => u.lastLoginAt)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
      null,
    ])
  })
})

describe('createdComparatorDesc / createdComparatorAsc', () => {
  const users = [
    { createdAt: '2026-01-01T00:00:00.000Z' },
    { createdAt: '2026-06-01T00:00:00.000Z' },
  ]

  it('desc sorts newest first', () => {
    expect([...users].sort(createdComparatorDesc).map((u) => u.createdAt)).toEqual([
      '2026-06-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ])
  })

  it('asc sorts oldest first', () => {
    expect([...users].sort(createdComparatorAsc).map((u) => u.createdAt)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
    ])
  })
})
