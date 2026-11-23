import { cookieValue, json, readSession, SESSION_COOKIE } from '../server/auth.js'

export function GET(request) {
  const user = readSession(cookieValue(request.headers.get('cookie'), SESSION_COOKIE), process.env.ACE_SESSION_SECRET)
  return user ? json({ user }, 200, { Vary: 'Cookie' }) : json({ error: 'Not signed in.' }, 401, { Vary: 'Cookie' })
}

export function POST() {
  return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET' })
}
