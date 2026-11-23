import { describe, expect, it } from 'vitest'
import { cookieValue, createRequestToken, createSession, hashPassword, isSameOrigin, readRequestToken, readSession, safeEqual, sessionCookie, verifyPassword } from './auth.js'

describe('HANDLED session authentication', () => {
  const user = { username: 'demo', name: 'Demo Head Nurse', role: 'Demo account', isDemo: true, seeded: true }

  it('creates and verifies a signed session', () => {
    const token = createSession(user, 'test-secret', 1_000)
    expect(readSession(token, 'test-secret', 2_000)).toEqual(user)
  })

  it('rejects changed and expired sessions', () => {
    const token = createSession(user, 'test-secret', 1_000)
    expect(readSession(`${token}changed`, 'test-secret', 2_000)).toBeNull()
    expect(readSession(token, 'test-secret', 1_000 + (8 * 60 * 60 * 1000) + 1)).toBeNull()
  })

  it('reads the requested cookie and compares credentials safely', () => {
    expect(cookieValue('theme=blue; ace_session=abc.def; x=1', 'ace_session')).toBe('abc.def')
    expect(safeEqual('SAMPLE-PASSWORD', 'SAMPLE-PASSWORD')).toBe(true)
    expect(safeEqual('SAMPLE-PASSWORD', 'sample-password')).toBe(false)
  })

  it('hashes passwords and rejects the wrong password', async () => {
    const encoded = await hashPassword('a-long-example-password', 'fixed-test-salt')
    expect(encoded).not.toContain('a-long-example-password')
    expect(await verifyPassword('a-long-example-password', encoded)).toBe(true)
    expect(await verifyPassword('wrong-password', encoded)).toBe(false)
  })

  it('uses a strict cookie and rejects cross-origin mutations', () => {
    expect(sessionCookie('token', true)).toContain('SameSite=Strict')
    expect(isSameOrigin(new Request('https://ace.example/api/login', { headers: { Origin: 'https://ace.example' } }))).toBe(true)
    expect(isSameOrigin(new Request('https://ace.example/api/login', { headers: { Origin: 'https://attacker.example' } }))).toBe(false)
  })

  it('signs scoped staff-request tokens and rejects tampering', () => {
    const payload = {
      username: 'head-nurse',
      weekOffset: 2,
      version: 'portal-version-123456',
      nurseId: 'N-201',
      exp: 10_000,
    }
    const token = createRequestToken(payload, 'test-secret')
    expect(readRequestToken(token, 'test-secret', 2_000)).toMatchObject(payload)
    expect(readRequestToken(`${token}changed`, 'test-secret', 2_000)).toBeNull()
    expect(readRequestToken(token, 'test-secret', 11_000)).toBeNull()
  })
})
