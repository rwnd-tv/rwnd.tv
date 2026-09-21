import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMediaQuery } from './use-media-query.js'

/** A minimal fake MediaQueryList whose `matches` can be flipped and whose
 * 'change' listeners can be fired manually — real browsers do this
 * themselves on an actual viewport/media change, jsdom does neither. */
function fakeMediaQueryList(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<() => void>()
  return {
    list: {
      get matches() {
        return matches
      },
      media: '',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_event: string, listener: () => void) => {
        listeners.add(listener)
      },
      removeEventListener: (_event: string, listener: () => void) => {
        listeners.delete(listener)
      },
      dispatchEvent: () => false,
    } as unknown as MediaQueryList,
    setMatches(next: boolean) {
      matches = next
      for (const listener of listeners) listener()
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useMediaQuery', () => {
  it('returns the query result at mount', () => {
    const { list } = fakeMediaQueryList(true)
    vi.stubGlobal('matchMedia', () => list)

    const { result } = renderHook(() => useMediaQuery('(max-width: 639px)'))
    expect(result.current).toBe(true)
  })

  it('re-renders when the query result changes', () => {
    const { list, setMatches } = fakeMediaQueryList(false)
    vi.stubGlobal('matchMedia', () => list)

    const { result } = renderHook(() => useMediaQuery('(max-width: 639px)'))
    expect(result.current).toBe(false)

    act(() => setMatches(true))
    expect(result.current).toBe(true)
  })
})
