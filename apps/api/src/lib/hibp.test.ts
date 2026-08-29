import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { isPasswordPwned } from './hibp.js'

afterEach(() => vi.unstubAllGlobals())

function sha1Upper(value: string): string {
  return createHash('sha1').update(value).digest('hex').toUpperCase()
}

describe('isPasswordPwned', () => {
  it('returns true when the suffix appears in the range response', async () => {
    const password = 'correct-horse-battery-staple'
    const suffix = sha1Upper(password).slice(5)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(`${suffix}:42\nSOMEOTHERSUFFIX0000000000000000000:1`)),
    )
    expect(await isPasswordPwned(password)).toBe(true)
  })

  it('returns false when the suffix is absent from the range response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('SOMEOTHERSUFFIX0000000000000000000:1')),
    )
    expect(await isPasswordPwned('a-genuinely-unique-passphrase')).toBe(false)
  })

  it('only ever sends the 5-character prefix, never the full hash or plaintext', async () => {
    const password = 'correct-horse-battery-staple'
    const fetchMock = vi.fn().mockResolvedValue(new Response(''))
    vi.stubGlobal('fetch', fetchMock)

    await isPasswordPwned(password)

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${sha1Upper(password).slice(0, 5)}`)
    expect(url).not.toContain(password)
    expect(url.length).toBeLessThan('https://api.pwnedpasswords.com/range/'.length + 6)
  })

  it('fails open on a network error rather than blocking the caller', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.pwnedpasswords.com')),
    )
    expect(await isPasswordPwned('anything')).toBe(false)
  })

  it('fails open on a non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    expect(await isPasswordPwned('anything')).toBe(false)
  })

  it('fails open on a timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        const err = new DOMException('The operation was aborted.', 'TimeoutError')
        return Promise.reject(err)
      }),
    )
    expect(await isPasswordPwned('anything')).toBe(false)
  })
})
