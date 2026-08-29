import { createHash } from 'node:crypto'

const RANGE_URL = 'https://api.pwnedpasswords.com/range/'
const REQUEST_TIMEOUT_MS = 3000

/**
 * Have I Been Pwned's k-anonymity range API (ASVS V2.1.7, M3 security
 * review follow-up, docs/TODO.md): the password itself never leaves this
 * server — only the first 5 hex characters of its SHA-1 hash go out over
 * the network, and the API responds with every suffix sharing that prefix
 * (typically several hundred), so no single request tells the API which
 * password was actually checked.
 *
 * Fails open: any network error, timeout, or non-200 response returns
 * `false` (not breached) rather than blocking the caller. A self-hosted
 * instance with no internet access (a legitimate, documented deployment —
 * docs/self-hosting.md) must still be able to register a user or change a
 * password; this is a best-effort enhancement, not a hard gate. Logged so
 * a self-hoster can notice a persistent problem, but never surfaced to the
 * end user as an error — a slow/unreachable third party shouldn't degrade
 * this instance's own core functionality.
 */
export async function isPasswordPwned(password: string): Promise<boolean> {
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase()
  const prefix = sha1.slice(0, 5)
  const suffix = sha1.slice(5)

  let res: Response
  try {
    res = await fetch(`${RANGE_URL}${prefix}`, {
      // Recommended by HIBP's own docs: the response is padded with extra
      // fake suffix:count lines so its size doesn't itself leak how many
      // real matches there were to a network observer.
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    console.warn('HIBP breached-password check unreachable, allowing password:', err)
    return false
  }
  if (!res.ok) {
    console.warn(`HIBP breached-password check returned HTTP ${res.status}, allowing password`)
    return false
  }

  const body = await res.text()
  return body.split('\n').some((line) => line.split(':')[0]?.trim() === suffix)
}
