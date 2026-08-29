export type SniffedImageType = 'image/jpeg' | 'image/png' | 'image/webp'

/**
 * Identifies an image by its actual file-signature bytes rather than
 * trusting the client-declared `File#type` (M3 security review, F-06) —
 * a multipart upload's `Content-Type` for a given part is whatever the
 * browser (or an attacker's own request) chose to send, not a property
 * of the bytes. The result of this is what gets stored as
 * `users.avatar_mime_type` and later served back as the real
 * `Content-Type` (routes/auth.ts's avatar routes), so it has to be
 * derived from the file itself, not the label on the wrapper.
 *
 * Deliberately hand-rolled rather than a dependency — three fixed byte
 * signatures is the entire set this app needs to recognize (the same
 * three ALLOWED_AVATAR_TYPES already enforced), not a general-purpose
 * image-format sniffer.
 */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 && // 'RIFF'
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 // 'WEBP'
  ) {
    return 'image/webp'
  }
  return undefined
}

const EXTENSIONS: Record<SniffedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Takes a plain string (e.g. straight off a DB column) rather than the
 * narrowed union — callers reading back a stored MIME type don't have a
 * static guarantee it's still one of the three sniffImageType recognizes
 * (though in practice nothing else ever writes that column). Falls back
 * to a generic extension rather than throwing. */
export function extensionFor(type: string): string {
  return (EXTENSIONS as Record<string, string>)[type] ?? 'bin'
}
