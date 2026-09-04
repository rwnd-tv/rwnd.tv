import { describe, expect, it, vi } from 'vitest'
import { ApiError } from './api-client.js'
import { runBulkAction } from './bulk-action.js'

interface Item {
  id: string
  name: string
}

const items: Item[] = [
  { id: '1', name: 'Alpha' },
  { id: '2', name: 'Bravo' },
  { id: '3', name: 'Charlie' },
]

describe('runBulkAction', () => {
  it('reports every item as succeeded when the action resolves for all of them', async () => {
    const action = vi.fn().mockResolvedValue(undefined)

    const result = await runBulkAction(items, action, (i) => i.name, 'fallback')

    expect(result.succeeded).toEqual(items)
    expect(result.failures).toEqual([])
    expect(action).toHaveBeenCalledTimes(3)
    items.forEach((item) => expect(action).toHaveBeenCalledWith(item))
  })

  it('maps an ApiError rejection to its own message', async () => {
    const action = vi.fn().mockRejectedValue(new ApiError(400, "Can't delete the owner's account"))

    const result = await runBulkAction([items[0]!], action, (i) => i.name, 'fallback')

    expect(result.succeeded).toEqual([])
    expect(result.failures).toEqual([
      { id: '1', label: 'Alpha', reason: "Can't delete the owner's account" },
    ])
  })

  it('falls back to the supplied reason for a non-ApiError rejection', async () => {
    const action = vi.fn().mockRejectedValue(new Error('network exploded'))

    const result = await runBulkAction([items[0]!], action, (i) => i.name, 'Something went wrong')

    expect(result.failures).toEqual([{ id: '1', label: 'Alpha', reason: 'Something went wrong' }])
  })

  it('resolves to empty results and never calls the action for empty input', async () => {
    const action = vi.fn()

    const result = await runBulkAction([], action, (i: Item) => i.name, 'fallback')

    expect(result).toEqual({ succeeded: [], failures: [] })
    expect(action).not.toHaveBeenCalled()
  })

  it('attributes a failure to the item that actually failed, not one that resolved later', async () => {
    // The one test that would catch an index-zip regression: item 1 rejects
    // while items 2 and 3 resolve, deliberately out of settle order (item 3
    // resolves fastest) to prove the pairing is positional, not by
    // completion order.
    const action = vi.fn((item: Item) => {
      if (item.id === '1') {
        return new Promise((_, reject) =>
          setTimeout(() => reject(new ApiError(404, 'Not found')), 30),
        )
      }
      if (item.id === '2') {
        return new Promise((resolve) => setTimeout(resolve, 20))
      }
      return Promise.resolve()
    })

    const result = await runBulkAction(items, action, (i) => i.name, 'fallback')

    expect(result.failures).toEqual([{ id: '1', label: 'Alpha', reason: 'Not found' }])
    expect(result.succeeded).toEqual([items[1], items[2]])
  })
})
