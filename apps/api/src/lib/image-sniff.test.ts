import { describe, expect, it } from 'vitest'
import { extensionFor, sniffImageType } from './image-sniff.js'

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

describe('sniffImageType', () => {
  it('recognizes a JPEG signature', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe('image/jpeg')
  })

  it('recognizes a PNG signature', () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00))).toBe(
      'image/png',
    )
  })

  it('recognizes a WebP signature (RIFF....WEBP)', () => {
    const riffWebp = new Uint8Array(16)
    riffWebp.set([0x52, 0x49, 0x46, 0x46], 0) // 'RIFF'
    riffWebp.set([0, 0, 0, 0], 4) // file size, irrelevant here
    riffWebp.set([0x57, 0x45, 0x42, 0x50], 8) // 'WEBP'
    expect(sniffImageType(riffWebp)).toBe('image/webp')
  })

  it('rejects a zero-filled buffer regardless of size', () => {
    expect(sniffImageType(new Uint8Array(1024))).toBeUndefined()
  })

  it('rejects a plain-text file even with an image extension implied', () => {
    expect(sniffImageType(new TextEncoder().encode('<script>alert(1)</script>'))).toBeUndefined()
  })

  it('rejects a RIFF container that is not WEBP (e.g. a WAV file)', () => {
    const riffWav = new Uint8Array(16)
    riffWav.set([0x52, 0x49, 0x46, 0x46], 0) // 'RIFF'
    riffWav.set([0, 0, 0, 0], 4)
    riffWav.set([0x57, 0x41, 0x56, 0x45], 8) // 'WAVE', not 'WEBP'
    expect(sniffImageType(riffWav)).toBeUndefined()
  })

  it('rejects a too-short buffer even with a matching prefix', () => {
    expect(sniffImageType(bytes(0x89, 0x50))).toBeUndefined()
  })
})

describe('extensionFor', () => {
  it('maps each recognized type to its extension', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg')
    expect(extensionFor('image/png')).toBe('png')
    expect(extensionFor('image/webp')).toBe('webp')
  })

  it('falls back to a generic extension for an unrecognized value', () => {
    expect(extensionFor('image/gif')).toBe('bin')
  })
})
