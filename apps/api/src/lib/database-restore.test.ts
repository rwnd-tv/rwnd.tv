import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PRE_RESTORE_RE,
  extractOwnerRole,
  hasCompleteTrailer,
  hasPendingRestore,
  parseDumpHeader,
  preflightCheckDump,
} from './database-restore.js'

describe('parseDumpHeader', () => {
  it('reads the pg_dump major from a real header line', () => {
    expect(
      parseDumpHeader([
        '--',
        '-- PostgreSQL database dump',
        '--',
        '',
        '-- Dumped from database version 16.4 (Debian 16.4-1.pgdg120+1)',
        '-- Dumped by pg_dump version 17.2 (Debian 17.2-1.pgdg120+1)',
      ]),
    ).toEqual({ pgDumpMajor: 17 })
  })

  it('returns null when the header is missing or not from pg_dump at all', () => {
    expect(parseDumpHeader(['-- some other file', ''])).toEqual({ pgDumpMajor: null })
    expect(parseDumpHeader([])).toEqual({ pgDumpMajor: null })
  })
})

describe('extractOwnerRole', () => {
  it('reads a bare role name', () => {
    expect(extractOwnerRole('ALTER TABLE public.movies OWNER TO rwnd;')).toBe('rwnd')
  })

  it('reads a quoted role name, unquoting it', () => {
    expect(extractOwnerRole('ALTER TABLE public.movies OWNER TO "some role";')).toBe('some role')
  })

  it('returns null for a line with no ownership statement', () => {
    expect(extractOwnerRole('CREATE TABLE public.movies (id uuid);')).toBeNull()
  })
})

describe('hasCompleteTrailer', () => {
  it('finds the trailer as the last line', () => {
    expect(hasCompleteTrailer(['SELECT 1;', '-- PostgreSQL database dump complete'])).toBe(true)
  })

  it('finds the trailer even when pg_dump 16.10+/17.6+ appends \\unrestrict after it', () => {
    expect(
      hasCompleteTrailer([
        'SELECT 1;',
        '-- PostgreSQL database dump complete',
        '',
        '\\unrestrict abc123',
      ]),
    ).toBe(true)
  })

  it('is false for a truncated dump with no trailer at all', () => {
    expect(hasCompleteTrailer(['SELECT 1;', 'INSERT INTO movies'])).toBe(false)
  })
})

describe('hasPendingRestore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rwnd-tv-test-pending-restore-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('is false when neither marker file exists', async () => {
    expect(await hasPendingRestore(dir)).toBe(false)
  })

  it('is true when a request is queued', async () => {
    await writeFile(join(dir, 'rwnd-restore-request.json'), '{}')
    expect(await hasPendingRestore(dir)).toBe(true)
  })

  it('is true when a request has been claimed (.attempted) but not yet resolved', async () => {
    await writeFile(join(dir, 'rwnd-restore-attempted.json'), '{}')
    expect(await hasPendingRestore(dir)).toBe(true)
  })

  it('is false once only a result file is left (a finished restore)', async () => {
    await writeFile(join(dir, 'rwnd-restore-result.json'), '{}')
    expect(await hasPendingRestore(dir)).toBe(false)
  })
})

describe('preflightCheckDump', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rwnd-tv-test-preflight-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("rejects a corrupt (non-gzip) file without crashing the process (regression: readline re-emits its input stream's own error, which otherwise goes unhandled)", async () => {
    const path = join(dir, 'corrupt.sql.gz')
    await writeFile(path, 'not gzip at all')

    const result = await preflightCheckDump(path, { serverMajor: 16, role: 'rwnd' })
    expect(result).toEqual({
      ok: false,
      reason: 'corrupt',
      detail: expect.stringContaining('Not a valid gzip file'),
    })
  })

  it('rejects a valid gzip with no complete trailer as incomplete', async () => {
    const path = join(dir, 'truncated.sql.gz')
    await writeFile(path, gzipSync('SELECT 1;'))

    const result = await preflightCheckDump(path, { serverMajor: 16, role: 'rwnd' })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('incomplete')
  })

  it('accepts a well-formed dump with no owner statements and no version header', async () => {
    const path = join(dir, 'good.sql.gz')
    await writeFile(
      path,
      gzipSync(['SELECT 1;', '-- PostgreSQL database dump complete', ''].join('\n')),
    )

    expect(await preflightCheckDump(path, { serverMajor: 16, role: 'rwnd' })).toEqual({ ok: true })
  })

  it('rejects a dump whose pg_dump major is newer than the running server', async () => {
    const path = join(dir, 'newer.sql.gz')
    await writeFile(
      path,
      gzipSync(
        [
          '-- Dumped by pg_dump version 17.2',
          'SELECT 1;',
          '-- PostgreSQL database dump complete',
          '',
        ].join('\n'),
      ),
    )

    const result = await preflightCheckDump(path, { serverMajor: 16, role: 'rwnd' })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('newer_pg_dump')
  })

  it('rejects a dump recording ownership for a different role', async () => {
    const path = join(dir, 'wrong-owner.sql.gz')
    await writeFile(
      path,
      gzipSync(
        [
          'ALTER TABLE public.movies OWNER TO someone_else;',
          '-- PostgreSQL database dump complete',
          '',
        ].join('\n'),
      ),
    )

    const result = await preflightCheckDump(path, { serverMajor: 16, role: 'rwnd' })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('owner_mismatch')
  })
})

describe('PRE_RESTORE_RE', () => {
  it('matches a real pre-restore snapshot name', () => {
    expect(PRE_RESTORE_RE.test('rwnd-pre-restore-20260909T183012Z.sql.gz')).toBe(true)
  })

  it('does not match a regular scheduled/manual backup name', () => {
    expect(PRE_RESTORE_RE.test('rwnd-20260909T183012Z.sql.gz')).toBe(false)
  })

  it('does not match an unrelated or malformed name', () => {
    expect(PRE_RESTORE_RE.test('rwnd-pre-restore-20260909T183012Z.sql.gz.partial')).toBe(false)
    expect(PRE_RESTORE_RE.test('notes.txt')).toBe(false)
  })
})
