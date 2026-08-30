import { beforeEach, describe, expect, it } from 'vitest'
import { extractCookie, resetDb, testApp, testDb } from './helpers.js'

const db = testDb()
const app = testApp()

async function createUserAndLogin(): Promise<string> {
  const res = await app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'user@example.com',
      password: 'correct-horse-battery-staple',
      displayName: 'Test User',
    }),
  })
  return extractCookie(res)!
}

// Explicit `ArrayBuffer` generic (not bare `Uint8Array`) — @types/node's
// ambient global redeclares `Uint8Array` as `Uint8Array<ArrayBufferLike>`,
// which `new File([...])`/`BlobPart` (lib.dom) no longer accept.
function jpegBytes(): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(64)
  buf[0] = 0xff
  buf[1] = 0xd8
  buf[2] = 0xff
  return buf
}

function pngBytes(): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(64)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

async function uploadAvatar(cookie: string, file: File) {
  const form = new FormData()
  form.set('file', file)
  return app.request('/api/v1/auth/me/avatar', { method: 'PUT', headers: { cookie }, body: form })
}

describe('avatar upload/get/delete', () => {
  beforeEach(() => resetDb(db))

  it('uploads a real JPEG and serves it back with the sniffed Content-Type', async () => {
    const cookie = await createUserAndLogin()
    const upload = await uploadAvatar(
      cookie,
      new File([jpegBytes()], 'photo.jpg', { type: 'image/jpeg' }),
    )
    expect(upload.status).toBe(200)

    const get = await app.request('/api/v1/auth/me/avatar', { headers: { cookie } })
    expect(get.status).toBe(200)
    expect(get.headers.get('content-type')).toBe('image/jpeg')
  })

  it('trusts the real file bytes over a mismatched declared Content-Type (M3 security review, F-06)', async () => {
    const cookie = await createUserAndLogin()
    // Real PNG bytes, but the browser/attacker claims it's a JPEG.
    const upload = await uploadAvatar(
      cookie,
      new File([pngBytes()], 'photo.jpg', { type: 'image/jpeg' }),
    )
    expect(upload.status).toBe(200)

    const get = await app.request('/api/v1/auth/me/avatar', { headers: { cookie } })
    // The stored/served type reflects what the bytes actually are, not
    // what the upload claimed.
    expect(get.headers.get('content-type')).toBe('image/png')
  })

  it('rejects a file whose bytes match no known image signature, regardless of its declared type', async () => {
    const cookie = await createUserAndLogin()
    const notAnImage = new TextEncoder().encode('<script>alert(document.cookie)</script>')
    const res = await uploadAvatar(
      cookie,
      new File([notAnImage], 'photo.jpg', { type: 'image/jpeg' }),
    )
    expect(res.status).toBe(400)
  })

  it('serves the avatar with an inline Content-Disposition naming its real extension', async () => {
    const cookie = await createUserAndLogin()
    await uploadAvatar(cookie, new File([pngBytes()], 'x', { type: 'image/jpeg' }))

    const get = await app.request('/api/v1/auth/me/avatar', { headers: { cookie } })
    expect(get.headers.get('content-disposition')).toBe('inline; filename="avatar.png"')
  })

  it('404s when no avatar has been set', async () => {
    const cookie = await createUserAndLogin()
    const res = await app.request('/api/v1/auth/me/avatar', { headers: { cookie } })
    expect(res.status).toBe(404)
  })

  it('deletes a set avatar', async () => {
    const cookie = await createUserAndLogin()
    await uploadAvatar(cookie, new File([jpegBytes()], 'x.jpg', { type: 'image/jpeg' }))

    const del = await app.request('/api/v1/auth/me/avatar', {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(del.status).toBe(200)

    const get = await app.request('/api/v1/auth/me/avatar', { headers: { cookie } })
    expect(get.status).toBe(404)
  })

  it('rejects an upload with no file field', async () => {
    const cookie = await createUserAndLogin()
    const res = await app.request('/api/v1/auth/me/avatar', {
      method: 'PUT',
      headers: { cookie },
      body: new FormData(),
    })
    expect(res.status).toBe(400)
  })
})
