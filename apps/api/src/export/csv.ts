/**
 * Minimal RFC 4180 CSV writer — no dependency pulled in for this, the
 * escaping rules are a handful of lines. CRLF line endings and a leading
 * UTF-8 BOM (`writeCsv`'s job) match what Excel expects to render non-ASCII
 * titles correctly rather than mangling them.
 */

function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One CSV file's worth of rows, header included as the first row. */
export function writeCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvField).join(','))
  // BOM first, so a viewer that only sniffs encoding from the very start
  // of the file (Excel) picks UTF-8 rather than guessing a legacy codepage.
  return '﻿' + lines.join('\r\n') + '\r\n'
}
