import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCopyFeedback } from './use-copy-feedback.js'

// Same clipboard mock shape as CalendarFeedsPanel.test.tsx's own beforeEach.
beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

describe('useCopyFeedback', () => {
  it('boolean mode: sets copied true on copy, then clears it after the timeout', () => {
    const { result } = renderHook(() => useCopyFeedback())

    expect(result.current.copied).toBeUndefined()
    act(() => result.current.copy('hello'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
    expect(result.current.copied).toBe(true)

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.copied).toBeUndefined()
  })

  it('keyed mode: tracks which key was copied via isCopied', () => {
    const { result } = renderHook(() => useCopyFeedback<'url' | 'template'>())

    act(() => result.current.copy('a', 'url'))
    expect(result.current.isCopied('url')).toBe(true)
    expect(result.current.isCopied('template')).toBe(false)
  })

  it("keyed mode: a second copy with a different key is not cleared by the first key's pending timeout", () => {
    const { result } = renderHook(() => useCopyFeedback<'url' | 'template'>())

    act(() => result.current.copy('a', 'url'))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    act(() => result.current.copy('b', 'template'))
    // The 'url' copy's timeout still has 1s left to run — it must not clear
    // the newer 'template' copy when it fires.
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.isCopied('template')).toBe(true)
    expect(result.current.isCopied('url')).toBe(false)
  })

  it('reset clears the copied flag immediately, without waiting for the timeout', () => {
    const { result } = renderHook(() => useCopyFeedback())

    act(() => result.current.copy('hello'))
    expect(result.current.copied).toBe(true)

    act(() => result.current.reset())
    expect(result.current.copied).toBeUndefined()
  })
})
