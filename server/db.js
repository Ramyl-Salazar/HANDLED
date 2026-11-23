import { neon } from '@neondatabase/serverless'

let schemaReady = false

export function database() {
  if (!process.env.DATABASE_URL) return null
  return neon(process.env.DATABASE_URL, { fetchOptions: { cache: 'no-store' } })
}

export async function ensureSchema(sql) {
  if (schemaReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS ace_workspaces (
      account_username TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS ace_audit_log (
      id BIGSERIAL PRIMARY KEY,
      account_username TEXT NOT NULL,
      action TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS ace_audit_account_created_idx ON ace_audit_log (account_username, created_at DESC)`
  schemaReady = true
}
