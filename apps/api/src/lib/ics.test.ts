import { describe, expect, it } from 'vitest'
import { buildIcs, type IcsEvent, type IcsTimedEvent } from './ics.js'

const STAMP = new Date('2026-09-04T10:15:00.000Z')

function event(overrides: Partial<IcsEvent> = {}): IcsEvent {
  return {
    uid: 'episode-11111111-1111-1111-1111-111111111111@rwnd.tv',
    date: '2026-09-04',
    summary: 'Breaking Bad — S01E01 Pilot',
    stamp: STAMP,
    ...overrides,
  }
}

/** Reverses foldLine's continuation-line folding without touching escape
 * sequences — proves a fold never corrupts the underlying content. */
function unfold(ics: string): string {
  return ics.replace(/\r\n /g, '')
}

describe('buildIcs', () => {
  it('wraps events in a VCALENDAR with the required subscription properties', () => {
    const ics = buildIcs({ name: 'rwnd.tv — TV Shows', events: [event()] })

    expect(ics).toContain('BEGIN:VCALENDAR\r\n')
    expect(ics).toContain('VERSION:2.0\r\n')
    expect(ics).toContain('PRODID:-//rwnd.tv//rwnd.tv Calendar Feed//EN\r\n')
    expect(ics).toContain('CALSCALE:GREGORIAN\r\n')
    expect(ics).toContain('METHOD:PUBLISH\r\n')
    expect(unfold(ics)).toContain('X-WR-CALNAME:rwnd.tv — TV Shows\r\n')
    expect(ics.trimEnd()).toMatch(/END:VCALENDAR$/)
  })

  it('uses CRLF line endings throughout, including the final line', () => {
    const ics = buildIcs({ name: 'History', events: [event()] })
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.includes('\n') && !ics.includes('\r\n')).toBe(false)
    // Every \n is preceded by \r.
    const bareLineFeeds = ics.split('\r\n').join('').includes('\n')
    expect(bareLineFeeds).toBe(false)
  })

  it('produces a valid, parseable VCALENDAR for an empty event list', () => {
    const ics = buildIcs({ name: 'History', events: [] })
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics).not.toContain('BEGIN:VEVENT')
  })

  it('emits one VEVENT per event with UID, DTSTAMP, all-day DTSTART/DTEND, SUMMARY', () => {
    const ics = unfold(buildIcs({ name: 'History', events: [event()] }))

    expect(ics).toContain('BEGIN:VEVENT\r\n')
    expect(ics).toContain('UID:episode-11111111-1111-1111-1111-111111111111@rwnd.tv\r\n')
    expect(ics).toContain('DTSTAMP:20260904T101500Z\r\n')
    expect(ics).toContain('SUMMARY:Breaking Bad — S01E01 Pilot\r\n')
    expect(ics).toContain('TRANSP:TRANSPARENT\r\n')
    expect(ics).toContain('END:VEVENT\r\n')
  })

  it('DTEND is the day after DTSTART for a single all-day event', () => {
    const ics = buildIcs({ name: 'History', events: [event({ date: '2026-09-04' })] })
    expect(ics).toContain('DTSTART;VALUE=DATE:20260904')
    expect(ics).toContain('DTEND;VALUE=DATE:20260905')
  })

  it('DTEND rolls over correctly across a month boundary', () => {
    const ics = buildIcs({ name: 'History', events: [event({ date: '2026-12-31' })] })
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231')
    expect(ics).toContain('DTEND;VALUE=DATE:20270101')
  })

  it('DTEND rolls over correctly across a leap day', () => {
    const ics = buildIcs({ name: 'History', events: [event({ date: '2028-02-28' })] })
    expect(ics).toContain('DTSTART;VALUE=DATE:20280228')
    expect(ics).toContain('DTEND;VALUE=DATE:20280229')
  })

  it('escapes backslash, semicolon, comma, and newline in SUMMARY, backslash first', () => {
    const ics = unfold(
      buildIcs({
        name: 'History',
        events: [event({ summary: 'A\\B; C, D\nE' })],
      }),
    )
    // A\B; C, D\nE with backslash escaped first, then ; , and newline.
    expect(ics).toContain('SUMMARY:A\\\\B\\; C\\, D\\nE\r\n')
  })

  it('does not escape a colon', () => {
    const ics = unfold(buildIcs({ name: 'History', events: [event({ summary: 'Time: 8pm' })] }))
    expect(ics).toContain('SUMMARY:Time: 8pm\r\n')
  })

  it('strips a control character from a title without corrupting the rest', () => {
    const ics = unfold(
      buildIcs({ name: 'History', events: [event({ summary: 'Weird\x07Title' })] }),
    )
    expect(ics).toContain('SUMMARY:WeirdTitle\r\n')
  })

  it('folds a SUMMARY over 75 octets, and unfolding reproduces the exact escaped value', () => {
    const longTitle = 'A'.repeat(120)
    const ics = buildIcs({ name: 'History', events: [event({ summary: longTitle })] })

    // The raw (folded) output has a continuation line starting with a
    // single space.
    expect(ics).toMatch(/\r\n [A-Z]/)

    const unfolded = unfold(ics)
    expect(unfolded).toContain(`SUMMARY:${longTitle}\r\n`)
  })

  it('folds on octets, not characters, and never splits a multi-byte codepoint', () => {
    // 'é' is 2 octets in UTF-8: 40 chars = 80 octets, over the 75 limit.
    const accented = 'é'.repeat(40)
    const ics = buildIcs({ name: 'History', events: [event({ summary: accented })] })
    expect(unfold(ics)).toContain(`SUMMARY:${accented}\r\n`)

    // An emoji is a 4-octet UTF-8 sequence encoded as a surrogate pair in
    // JS strings — splitting it mid-codepoint would corrupt the string or
    // throw on decode.
    const emoji = '🎬'.repeat(30)
    const icsEmoji = buildIcs({ name: 'History', events: [event({ summary: emoji })] })
    expect(unfold(icsEmoji)).toContain(`SUMMARY:${emoji}\r\n`)
  })

  it('omits DESCRIPTION entirely when absent, rather than an empty line', () => {
    const ics = buildIcs({ name: 'History', events: [event()] })
    expect(ics).not.toContain('DESCRIPTION')
  })

  it('emits an escaped DESCRIPTION when present', () => {
    const ics = unfold(
      buildIcs({
        name: 'History',
        events: [event({ description: 'A synopsis; with a comma, and a\nnewline.' })],
      }),
    )
    expect(ics).toContain('DESCRIPTION:A synopsis\\; with a comma\\, and a\\nnewline.\r\n')
  })

  it('produces byte-identical output across two calls with the same input', () => {
    const calendar = { name: 'History', events: [event(), event({ uid: 'play-2@rwnd.tv' })] }
    expect(buildIcs(calendar)).toBe(buildIcs(calendar))
  })

  describe('timed events', () => {
    function timedEvent(overrides: Partial<IcsTimedEvent> = {}): IcsTimedEvent {
      return {
        uid: 'play-11111111-1111-1111-1111-111111111111@rwnd.tv',
        summary: 'A Movie (2020)',
        stamp: STAMP,
        start: new Date('2026-09-04T19:00:00.000Z'),
        end: new Date('2026-09-04T20:30:00.000Z'),
        ...overrides,
      }
    }

    it('emits DTSTART/DTEND as UTC instants rather than VALUE=DATE', () => {
      const ics = unfold(buildIcs({ name: 'History', events: [timedEvent()] }))
      expect(ics).toContain('DTSTART:20260904T190000Z\r\n')
      expect(ics).toContain('DTEND:20260904T203000Z\r\n')
      expect(ics).not.toContain('VALUE=DATE')
    })

    it('keeps TRANSP:TRANSPARENT on a timed event, same as an all-day one', () => {
      const ics = buildIcs({ name: 'History', events: [timedEvent()] })
      expect(ics).toContain('TRANSP:TRANSPARENT\r\n')
    })

    it('escapes and folds a timed event the same way as an all-day one', () => {
      const longTitle = 'B'.repeat(120)
      const ics = buildIcs({ name: 'History', events: [timedEvent({ summary: longTitle })] })
      expect(ics).toMatch(/\r\n [B]/)
      expect(unfold(ics)).toContain(`SUMMARY:${longTitle}\r\n`)
    })

    it('mixes all-day and timed events in the same calendar', () => {
      const ics = unfold(
        buildIcs({ name: 'History', events: [event({ date: '2026-09-04' }), timedEvent()] }),
      )
      expect(ics).toContain('DTSTART;VALUE=DATE:20260904\r\n')
      expect(ics).toContain('DTSTART:20260904T190000Z\r\n')
    })

    it('produces byte-identical output across two calls with the same input', () => {
      const calendar = { name: 'History', events: [timedEvent()] }
      expect(buildIcs(calendar)).toBe(buildIcs(calendar))
    })
  })
})
