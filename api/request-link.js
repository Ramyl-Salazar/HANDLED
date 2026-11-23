import { randomBytes } from "node:crypto";
import {
  cleanWorkspaceCollection,
  workspaceEntry,
} from "./workspace.js";
import { database, ensureSchema } from "../server/db.js";
import {
  createRequestToken,
  isSameOrigin,
  json,
  userFromRequest,
} from "../server/auth.js";

function linkDetails(request, user, workspaceId, weekOffset, portal) {
  if (!portal?.enabled) return { portal: portal ?? null, url: null };
  const token = createRequestToken(
    {
      username: user.username,
      workspaceId,
      weekOffset,
      version: portal.version,
    },
    process.env.ACE_SESSION_SECRET,
  );
  return {
    portal,
    url: `${new URL(request.url).origin}/?request=${encodeURIComponent(token)}`,
  };
}

async function loadWorkspaceCollection(sql, username, user) {
  const rows =
    await sql`SELECT data FROM ace_workspaces WHERE account_username = ${username} LIMIT 1`;
  return rows[0]?.data ? cleanWorkspaceCollection(rows[0].data, user) : null;
}

export async function GET(request) {
  const user = userFromRequest(request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (user.isDemo)
    return json({ portal: null, url: null, requests: {}, submissions: {}, comments: {} });
  const weekOffset = Number(new URL(request.url).searchParams.get("week"));
  const requestedWorkspaceId = new URL(request.url).searchParams.get("workspace");
  if (!Number.isInteger(weekOffset) || Math.abs(weekOffset) > 520)
    return json({ error: "Invalid planning period." }, 400);
  const sql = database();
  if (!sql) return json({ error: "Database is unavailable." }, 503);
  try {
    await ensureSchema(sql);
    const collection = await loadWorkspaceCollection(sql, user.username, user);
    const entry = collection ? workspaceEntry(collection, requestedWorkspaceId) : null;
    const record = entry?.data.weeks?.[String(weekOffset)];
    return json({
      ...linkDetails(
        request,
        user,
        entry?.id,
        weekOffset,
        record?.requestPortal,
      ),
      requests: record?.requests ?? {},
      submissions: record?.requestSubmissions ?? {},
      comments: record?.requestComments ?? {},
    });
  } catch {
    return json({ error: "The request link could not be loaded." }, 503);
  }
}

export async function POST(request) {
  if (!isSameOrigin(request))
    return json({ error: "Request origin was rejected." }, 403);
  const user = userFromRequest(request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (user.isDemo)
    return json(
      { error: "Create staff links from a private workspace." },
      403,
    );
  if (Number(request.headers.get("content-length") || 0) > 4096)
    return json({ error: "Request is too large." }, 413);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const weekOffset = Number(body?.weekOffset);
  const requestedWorkspaceId = body?.workspaceId
    ? String(body.workspaceId)
    : undefined;
  const action = String(body?.action ?? "create");
  const maxRequests = Number(body?.maxRequests ?? 5);
  if (
    !Number.isInteger(weekOffset) ||
    Math.abs(weekOffset) > 520 ||
    !["create", "update", "revoke"].includes(action) ||
    !Number.isInteger(maxRequests) ||
    maxRequests < 1 ||
    maxRequests > 14
  )
    return json({ error: "Invalid link settings." }, 400);
  const sql = database();
  if (!sql) return json({ error: "Database is unavailable." }, 503);
  try {
    await ensureSchema(sql);
    const collection = await loadWorkspaceCollection(sql, user.username, user);
    const entry = collection ? workspaceEntry(collection, requestedWorkspaceId) : null;
    if (!entry) return json({ error: "Workspace not found." }, 404);
    const workspace = entry.data;
    if (!workspace.nurses.length)
      return json({ error: "Add the nursing team before creating a link." }, 400);
    const week = String(weekOffset);
    const record = workspace.weeks[week] ?? {
      preferences: {},
      requests: {},
      workRequests: {},
      assignments: {},
      published: false,
      incidents: [],
      issues: [],
      requestSubmissions: {},
      requestComments: {},
    };
    const now = new Date().toISOString();
    const previous = record.requestPortal;
    record.requestPortal = {
      enabled: action !== "revoke",
      version:
        action === "create" || !previous
          ? randomBytes(24).toString("base64url")
          : previous.version,
      maxRequests,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    workspace.weeks[week] = record;
    entry.data = workspace;
    entry.updatedAt = now;
    collection.activeWorkspaceId = entry.id;
    const cleaned = cleanWorkspaceCollection(collection, user, now);
    await sql.transaction([
      sql`INSERT INTO ace_workspaces (account_username, data) VALUES (${user.username}, ${cleaned}) ON CONFLICT (account_username) DO UPDATE SET data = EXCLUDED.data, version = ace_workspaces.version + 1, updated_at = NOW()`,
      sql`INSERT INTO ace_audit_log (account_username, action, metadata) VALUES (${user.username}, ${action === "revoke" ? "request_link_revoked" : "request_link_updated"}, ${{ workspaceId: entry.id, weekOffset, maxRequests }})`,
    ]);
    const savedEntry = workspaceEntry(cleaned, entry.id);
    return json({
      ...linkDetails(
        request,
        user,
        entry.id,
        weekOffset,
        savedEntry.data.weeks[week].requestPortal,
      ),
      requests: savedEntry.data.weeks[week].requests,
      submissions: savedEntry.data.weeks[week].requestSubmissions,
      comments: savedEntry.data.weeks[week].requestComments,
    });
  } catch {
    return json({ error: "The request link could not be updated." }, 503);
  }
}
