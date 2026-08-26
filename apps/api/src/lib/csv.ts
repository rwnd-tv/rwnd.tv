/**
 * Minimal RFC 4180 CSV reader/writer — no dependency pulled in for this,
 * the escaping rules are a handful of lines each way. Shared by
 * apps/api/src/export/build.ts (writer) and apps/api/src/import/
 * csv-zip-parse.ts (reader), so the format has one home rather than two
 * independently-maintained implementations of the same escaping rules.
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

/**
 * Parses RFC 4180 CSV text into rows of raw cell strings (the first row is
 * the header — callers combine it with `rowsToObjects` below rather than
 * this function assuming a header exists, so it stays reusable for a
 * headerless caller too). Strips a leading UTF-8 BOM if present (`writeCsv`
 * always writes one, but a hand-edited or externally-produced file might
 * not). A small hand-rolled state machine rather than a naive `.split(',')`
 * — a quoted field can itself contain commas, quotes (escaped as `""`), and
 * literal CRLF/LF, all of which a naive split would break on.
 */
export function parseCsv(text: string): string[][] {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  function endField() {
    row.push(field)
    field = ''
  }
  function endRow() {
    endField()
    rows.push(row)
    row = []
  }

  while (i < withoutBom.length) {
    const char = withoutBom[i]
    if (inQuotes) {
      if (char === '"') {
        if (withoutBom[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }
    if (char === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (char === ',') {
      endField()
      i += 1
      continue
    }
    if (char === '\r') {
      // Bare \r or \r\n — either way, one row ends here; a following \n is
      // swallowed so it doesn't start a spurious blank row.
      endRow()
      i += withoutBom[i + 1] === '\n' ? 2 : 1
      continue
    }
    if (char === '\n') {
      endRow()
      i += 1
      continue
    }
    field += char
    i += 1
  }
  // A trailing newline (writeCsv always emits one) leaves nothing after the
  // last endRow() — only flush a final partial row/field if there's
  // genuinely unterminated content left over.
  if (field.length > 0 || row.length > 0) endRow()

  return rows
}

/**
 * Combines `parseCsv`'s raw rows into header-keyed objects — every caller
 * should go through this rather than indexing columns by position, so
 * adding a column (e.g. a future metadata provider's id, see
 * export/build.ts's own PROVIDER_SOURCES) never silently shifts what a
 * fixed column index means. Rows shorter than the header get `''` for the
 * missing trailing cells rather than `undefined`, so callers can treat
 * every field as a plain string.
 */
export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  const [header, ...dataRows] = rows
  if (!header) return []
  return dataRows.map((row) => {
    const obj: Record<string, string> = {}
    header.forEach((key, index) => {
      obj[key] = row[index] ?? ''
    })
    return obj
  })
}
