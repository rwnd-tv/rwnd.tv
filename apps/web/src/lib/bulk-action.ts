import { ApiError } from './api-client.js'

interface BulkFailure {
  id: string
  label: string
  reason: string
}

export interface BulkResult<T> {
  succeeded: T[]
  failures: BulkFailure[]
}

/**
 * Runs `action` against every item independently (`Promise.allSettled`, not
 * `Promise.all`) and reports which ones failed and why — the client-side
 * loop UsersPanel.tsx's bulk actions use in place of a dedicated bulk API
 * route, since the admin-users single-item routes already carry the
 * per-user refusals (owner immunity, last-admin, no local credential) that
 * a batch needs to report individually rather than fail wholesale on.
 *
 * `allSettled` resolves in the same order as `items`, regardless of which
 * promise actually settles first — that stable ordering is the only thing
 * tying a rejection at index `i` back to `items[i]`'s label below. Don't
 * "simplify" this to `Promise.all` + a `.catch` per item without keeping
 * that same index pairing; it's easy to accidentally attribute a failure
 * to the wrong item once retries or reordering enter the picture.
 *
 * Never rejects: used as a `mutationFn`, so the outcome always lives in the
 * resolved `BulkResult`, never in the mutation's own `isError`.
 */
export async function runBulkAction<T extends { id: string }>(
  items: readonly T[],
  action: (item: T) => Promise<unknown>,
  labelOf: (item: T) => string,
  fallbackReason: string,
): Promise<BulkResult<T>> {
  const settled = await Promise.allSettled(items.map((item) => action(item)))

  const succeeded: T[] = []
  const failures: BulkFailure[] = []

  settled.forEach((outcome, index) => {
    const item = items[index]!
    if (outcome.status === 'fulfilled') {
      succeeded.push(item)
    } else {
      const reason = outcome.reason instanceof ApiError ? outcome.reason.message : fallbackReason
      failures.push({ id: item.id, label: labelOf(item), reason })
    }
  })

  return { succeeded, failures }
}
