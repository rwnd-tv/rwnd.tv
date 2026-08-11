import type { TraktDeviceCodeResponse, TraktTokenResponse } from './types.js'

/**
 * Device authentication flow (docs.trakt.tv/reference/auth), for apps with
 * no browser-redirect story — exactly rwnd.tv's self-hosted-API situation.
 * All OAuth traffic goes to TRAKT_AUTH_BASE_URL (auth.trakt.tv), which is a
 * *different host* from the api.trakt.tv used for everything else in
 * client.ts — sending these calls to the API host 404s.
 */

export interface TraktAuthOptions {
  authBaseUrl: string
  clientId: string
  clientSecret: string
}

export async function requestDeviceCode(
  options: TraktAuthOptions,
): Promise<TraktDeviceCodeResponse> {
  const res = await fetch(`${options.authBaseUrl}/oauth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: options.clientId }),
  })
  if (!res.ok) {
    throw new Error(`Trakt device code request failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as TraktDeviceCodeResponse
}

export type DevicePollResult =
  | { status: 'authorized'; token: TraktTokenResponse }
  | { status: 'pending' }
  | { status: 'denied' | 'expired' }

/**
 * A single poll of /oauth/device/token. Trakt's documented response codes:
 * 200 authorized, 400 still pending, 404 unknown device_code, 409 already
 * used, 410 expired, 418 user explicitly denied, 429 poll too fast. The
 * caller (routes/imports.ts) drives the interval/expiry loop — this
 * function just classifies one response.
 */
export async function pollDeviceToken(
  options: TraktAuthOptions,
  deviceCode: string,
): Promise<DevicePollResult> {
  const res = await fetch(`${options.authBaseUrl}/oauth/device/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: deviceCode,
      client_id: options.clientId,
      client_secret: options.clientSecret,
    }),
  })

  if (res.status === 200) {
    return { status: 'authorized', token: (await res.json()) as TraktTokenResponse }
  }
  if (res.status === 400) return { status: 'pending' }
  if (res.status === 404 || res.status === 409 || res.status === 410) {
    return { status: 'expired' }
  }
  if (res.status === 418) return { status: 'denied' }
  if (res.status === 429) return { status: 'pending' } // caller's interval already paces polling
  throw new Error(`Unexpected Trakt device token response: ${res.status}`)
}

export async function refreshAccessToken(
  options: TraktAuthOptions,
  refreshToken: string,
): Promise<TraktTokenResponse> {
  const res = await fetch(`${options.authBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: refreshToken,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    throw new Error(`Trakt token refresh failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as TraktTokenResponse
}
