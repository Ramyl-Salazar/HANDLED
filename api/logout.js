import { clearSessionCookie, isSameOrigin, json } from '../server/auth.js'

export function POST(request) {
  if (!isSameOrigin(request)) return json({ error: 'Request origin was rejected.' }, 403)
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() })
}

export function GET() {
  return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' })
}
