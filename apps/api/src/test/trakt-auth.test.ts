import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pollDeviceToken, refreshAccessToken, requestDeviceCode } from '../trakt/auth.js'

const options = {
  authBaseUrl: 'https://auth.trakt.test',
  clientId: 'client-id',
  clientSecret: 'client-secret',
}

// Cloudflare in front of auth.trakt.tv answers 403 with an HTML block page
// when a request lacks an identifying User-Agent, so every OAuth call must
// send one.
describe('Trakt OAuth requests', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['requestDeviceCode', () => requestDeviceCode(options)],
    ['pollDeviceToken', () => pollDeviceToken(options, 'device-code')],
    ['refreshAccessToken', () => refreshAccessToken(options, 'refresh-token')],
  ])('%s sends an identifying User-Agent', async (_name, call) => {
    await call()

    expect(fetchMock).toHaveBeenCalledOnce()
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('User-Agent')).toBe('rwnd.tv (+https://rwnd.tv)')
  })
})
