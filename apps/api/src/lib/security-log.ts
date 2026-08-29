/**
 * Minimal security-event logging (M3 security review) — auth events a
 * self-hoster might reasonably want to grep for or feed into their own
 * log aggregation, distinct from ordinary application output. Plain
 * `console.log`, matching this codebase's existing logging style
 * throughout — a real structured request-logging pipeline is a bigger
 * piece of work than this review covers (see docs/TODO.md's Security
 * section). Never takes an email or other PII, only opaque ids — same
 * reasoning as F-17 (don't log what a stolen log file shouldn't have).
 */
export function logSecurityEvent(event: string, meta: Record<string, string> = {}): void {
  console.log(`[security] ${event}`, JSON.stringify({ ...meta, at: new Date().toISOString() }))
}
