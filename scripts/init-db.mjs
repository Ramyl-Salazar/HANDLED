import { database, ensureSchema } from '../server/db.js'

const sql = database()
if (!sql) throw new Error('DATABASE_URL is unavailable.')
await ensureSchema(sql)
const rows = await sql.query("SELECT to_regclass('public.ace_workspaces') AS workspace_table, to_regclass('public.ace_audit_log') AS audit_table")
if (!rows[0]?.workspace_table || !rows[0]?.audit_table) throw new Error('ACE database tables were not created.')
console.log('ACE workspace and audit tables are ready.')
const clientRows = await sql`SELECT COALESCE(jsonb_array_length(data->'nurses'), 0) AS nurse_count FROM ace_workspaces WHERE account_username = 'acesalazar' LIMIT 1`
console.log(`Client workspace nurse records: ${clientRows[0]?.nurse_count ?? 0}`)
const testRows = await sql`SELECT COALESCE(jsonb_array_length(data->'nurses'), 0) AS nurse_count FROM ace_workspaces WHERE account_username = 'ramylsalazarr' LIMIT 1`
console.log(`Test workspace nurse records: ${testRows[0]?.nurse_count ?? 0}`)
