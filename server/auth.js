import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

export const SESSION_COOKIE = 'ace_session'
const SESSION_SECONDS = 4 * 60 * 60
const scrypt = promisify(scryptCallback)

function encode(value) {
  return Buffer.from(value).toString('base64url')
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

export function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left))
  const rightBuffer = Buffer.from(String(right))
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

export async function hashPassword(password, salt = randomBytes(16).toString('base64url')) {
  const derived = await scrypt(String(password), salt, 64)
  return `scrypt$${salt}$${Buffer.from(derived).toString('base64url')}`
}

export async function verifyPassword(password, encoded) {
  const [algorithm, salt, expected] = String(encoded ?? '').split('$')
  if (algorithm !== 'scrypt' || !salt || !expected) return false
  const derived = await scrypt(String(password), salt, 64)
  return safeEqual(Buffer.from(derived).toString('base64url'), expected)
}

export function createSession(user, secret, now = Date.now()) {
  const payload = encode(JSON.stringify({ ...user, exp: now + SESSION_SECONDS * 1000 }))
  return `${payload}.${sign(payload, secret)}`
}

export function readSession(token, secret, now = Date.now()) {
  if (!token || !secret) return null
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra || !safeEqual(signature, sign(payload, secret))) return null
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!value.exp || value.exp <= now || !value.username || !value.name || !value.role) return null
    return { username: value.username, name: value.name, role: value.role, isDemo: Boolean(value.isDemo), seeded: Boolean(value.seeded) }
  } catch {
    return null
  }
}

export function createRequestToken(payload, secret) {
  const value = encode(JSON.stringify({ ...payload, purpose: 'staff-request' }))
  return `${value}.${sign(value, secret)}`
}

export function readRequestToken(token, secret, now = Date.now()) {
  if (!token || !secret) return null
  const [payload, signature, extra] = String(token).split('.')
  if (!payload || !signature || extra || !safeEqual(signature, sign(payload, secret))) return null
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (
      value.purpose !== 'staff-request' ||
      typeof value.username !== 'string' ||
      !Number.isInteger(value.weekOffset) ||
      typeof value.version !== 'string' ||
      value.version.length < 16 ||
      value.version.length > 120 ||
      (value.workspaceId !== undefined &&
        (typeof value.workspaceId !== 'string' ||
          !/^(primary|ws_[a-z0-9]{16,48})$/.test(value.workspaceId))) ||
      (value.nurseId !== undefined && typeof value.nurseId !== 'string') ||
      (value.exp !== undefined && (!Number.isFinite(value.exp) || value.exp <= now))
    ) return null
    return value
  } catch {
    return null
  }
}

export function cookieValue(cookieHeader, name) {
  const entry = String(cookieHeader ?? '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : ''
}

export function sessionCookie(token, production = process.env.VERCEL_ENV !== 'development') {
  const secure = production ? '; Secure' : ''
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`
}

export function clearSessionCookie(production = process.env.VERCEL_ENV !== 'development') {
  const secure = production ? '; Secure' : ''
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  })
}

export function configuredAccounts() {
  if (!process.env.ACE_HEAD_PASSWORD_HASH || !process.env.ACE_DEMO_PASSWORD_HASH || !process.env.ACE_SESSION_SECRET) return null
  const accounts = [
    { username: 'demo', passwordHash: process.env.ACE_DEMO_PASSWORD_HASH, name: 'Demo Head Nurse', role: 'Demo account', isDemo: true, seeded: true },
    { username: process.env.ACE_HEAD_USERNAME || 'acesalazar', passwordHash: process.env.ACE_HEAD_PASSWORD_HASH, name: 'Head Nurse Salazar', role: 'Emergency department', isDemo: false, seeded: false },
  ]
  if (process.env.ACE_TEST_PASSWORD_HASH) accounts.push({
    username: process.env.ACE_TEST_USERNAME || 'ramylsalazarr',
    passwordHash: process.env.ACE_TEST_PASSWORD_HASH,
    name: 'Ramyl Salazar',
    role: 'Test workspace',
    isDemo: false,
    seeded: true,
  })
  return accounts
}

export function isSameOrigin(request) {
  const origin = request.headers.get('origin')
  return Boolean(origin && origin === new URL(request.url).origin)
}

export function userFromRequest(request) {
  return readSession(cookieValue(request.headers.get('cookie'), SESSION_COOKIE), process.env.ACE_SESSION_SECRET)
}
