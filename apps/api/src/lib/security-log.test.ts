import { afterEach, describe, expect, it, vi } from 'vitest'
import { logSecurityEvent } from './security-log.js'

describe('logSecurityEvent', () => {
  afterEach(() => vi.restoreAllMocks())

  it('logs the event name and metadata as a [security]-prefixed line', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logSecurityEvent('login_success', { userId: 'abc-123' })

    expect(spy).toHaveBeenCalledTimes(1)
    const [prefix, payload] = spy.mock.calls[0]!
    expect(prefix).toBe('[security] login_success')
    const parsed = JSON.parse(payload as string) as Record<string, string>
    expect(parsed.userId).toBe('abc-123')
    expect(parsed.at).toBeTruthy()
  })

  it('never logs a field named email, even if a caller tried to pass one', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    // TypeScript's Record<string, string> type doesn't stop a caller from
    // passing an arbitrary key at runtime — this just confirms the
    // function itself doesn't special-case or strip anything, i.e. it's
    // the call sites' job (F-17) to never pass one in the first place.
    logSecurityEvent('login_failure', { reason: 'wrong_password' })

    const [, payload] = spy.mock.calls[0]!
    expect(payload).not.toContain('email')
  })
})
