import { configuredAccounts, createSession, isSameOrigin, json, safeEqual, sessionCookie, verifyPassword } from '../server/auth.js'

const attempts = new Map()
const ATTEMPT_WINDOW = 10 * 60 * 1000
const MAX_ATTEMPTS = 5

function attemptKey(request) {
  return (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim()
}

function recentAttempts(key, now = Date.now()) {
  const recent = (attempts.get(key) || []).filter((timestamp) => now - timestamp < ATTEMPT_WINDOW)
  attempts.set(key, recent)
  return recent
}

export async function POST(request) {
  if (!isSameOrigin(request)) return json({ error: 'Request origin was rejected.' }, 403)
  if (Number(request.headers.get('content-length') || 0) > 2048) return json({ error: 'Request is too large.' }, 413)
  const key = attemptKey(request)
  const failures = recentAttempts(key)
  if (failures.length >= MAX_ATTEMPTS) return json({ error: 'Too many sign-in attempts. Try again later.' }, 429, { 'Retry-After': '600' })
  const accounts = configuredAccounts()
  if (!accounts) return json({ error: 'Sign-in is temporarily unavailable.' }, 503)

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Enter a valid username and password.' }, 400)
  }

  const username = String(body?.username ?? '').trim().toLowerCase()
  const password = String(body?.password ?? '')
  const account = accounts.find((candidate) => safeEqual(candidate.username.toLowerCase(), username))
  const fallbackHash = 'scrypt$bWlzc2luZy1hY2NvdW50$Wca2ts3h3woJtXq0y3V_LqA1Q0eV5C8G9ISvEVo4-pcY1Kv9WRu1emSktqJds2EWVbSvnF2Z5lGmBxPfqtXEnA'
  const validPassword = await verifyPassword(password, account?.passwordHash ?? fallbackHash)
  if (!account || !validPassword) {
    failures.push(Date.now())
    attempts.set(key, failures)
    await new Promise((resolve) => setTimeout(resolve, 650))
    return json({ error: 'Invalid username or password.' }, 401)
  }

  attempts.delete(key)
  const user = { username: account.username, name: account.name, role: account.role, isDemo: account.isDemo, seeded: account.seeded }
  const token = createSession(user, process.env.ACE_SESSION_SECRET)
  return json({ user }, 200, { 'Set-Cookie': sessionCookie(token) })
}

export function GET() {
  return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' })
}
