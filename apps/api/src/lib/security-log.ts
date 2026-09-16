/**
 * Minimal security-event logging (M3 security review) — auth events a
 * self-hoster might reasonably want to grep for or feed into their own
 * log aggregation, distinct from ordinary application output. Plain
 * `console.log`, matching this codebase's existing logging style
 * throughout. Never takes an email or other PII, only opaque ids — same
 * reasoning as F-17 (don't log what a stolen log file shouldn't have).
 *
 * Deliberately its own stream, not merged with `middleware/request-log.ts`
 * (the general per-request logging pipeline this file's own comment used
 * to say was out of scope — closed in M5): the two answer different
 * questions. This one is semantic and rare (an auth decision worth
 * grepping for by name); that one is per-request and high-volume (every
 * hit, success or not). Giving every request line this file's
 * `[security]`-prefixed shape would also break `LOG_FORMAT=json`'s whole
 * point — one parseable JSON object per line for a log aggregator — so the
 * two stay separate rather than unifying for its own sake. Both follow the
 * same "opaque ids only, never PII" rule either way.
 */
export function logSecurityEvent(event: string, meta: Record<string, string> = {}): void {
  console.log(`[security] ${event}`, JSON.stringify({ ...meta, at: new Date().toISOString() }))
}
