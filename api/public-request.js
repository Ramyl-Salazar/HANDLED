import { database, ensureSchema } from "../server/db.js";
import {
  createRequestToken,
  isSameOrigin,
  json,
  readRequestToken,
} from "../server/auth.js";
import {
  cleanWorkspace,
  cleanWorkspaceCollection,
  workspaceEntry,
} from "./workspace.js";

const choices = new Set([
  "morning",
  "afternoon",
  "night",
  "rest",
  "birthday_leave",
  "personal_leave",
]);
const leaveChoices = new Set(["birthday_leave", "personal_leave"]);
const attempts = new Map();
const ATTEMPT_WINDOW = 10 * 60 * 1000;
const MAX_ATTEMPTS = 30;

function allowRequest(request) {
  const key = (request.headers.get("x-forwarded-for") || "unknown")
    .split(",")[0]
    .trim();
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter(
    (timestamp) => now - timestamp < ATTEMPT_WINDOW,
  );
  if (recent.length >= MAX_ATTEMPTS) return false;
  recent.push(now);
  attempts.set(key, recent);
  return true;
}

function normalizedIdentity(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function surnameFor(nurse) {
  return normalizedIdentity(
    nurse?.surname || String(nurse?.name ?? "").trim().split(/\s+/).at(-1),
  );
}

function activeOn(nurse, isoDate) {
  return (
    (!nurse.dateHired || isoDate >= nurse.dateHired) &&
    (!nurse.employmentEndDate || isoDate <= nurse.employmentEndDate)
  );
}

function periodDays(weekOffset) {
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 8, 13 + weekOffset * 14 + index));
    return {
      key: `d${index}`,
      isoDate: date.toISOString().slice(0, 10),
      label: date.toLocaleDateString("en-US", {
        timeZone: "UTC",
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    };
  });
}

async function loadPortal(request) {
  const token = new URL(request.url).searchParams.get("token");
  const payload = readRequestToken(token, process.env.ACE_SESSION_SECRET);
  if (!payload || payload.nurseId) return null;
  const sql = database();
  if (!sql) return null;
  await ensureSchema(sql);
  const rows =
    await sql`SELECT data FROM ace_workspaces WHERE account_username = ${payload.username} LIMIT 1`;
  if (!rows[0]?.data) return null;
  const collection = cleanWorkspaceCollection(rows[0].data, {
    username: payload.username,
  });
  const entry = workspaceEntry(collection, payload.workspaceId ?? "primary");
  if (!entry) return null;
  const workspace = entry.data;
  const record = workspace.weeks[String(payload.weekOffset)];
  if (
    !record?.requestPortal?.enabled ||
    record.requestPortal.version !== payload.version
  )
    return null;
  return { token, payload, sql, collection, entry, workspace, record };
}

export async function GET(request) {
  try {
    const context = await loadPortal(request);
    if (!context)
      return json({ error: "This request link is invalid or closed." }, 404);
    return json({
      days: periodDays(context.payload.weekOffset),
      maxRequests: context.record.requestPortal.maxRequests,
    });
  } catch {
    return json({ error: "The request form is temporarily unavailable." }, 503);
  }
}

export async function POST(request) {
  if (!isSameOrigin(request))
    return json({ error: "Request origin was rejected." }, 403);
  if (!allowRequest(request))
    return json({ error: "Too many attempts. Try again later." }, 429);
  if (Number(request.headers.get("content-length") || 0) > 8192)
    return json({ error: "Request is too large." }, 413);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  try {
    const context = await loadPortal(request);
    if (!context)
      return json({ error: "This request link is invalid or closed." }, 404);
    const action = String(body?.action ?? "");
    if (action === "verify") {
      const nurseId = String(body?.nurseId ?? "").trim().toUpperCase();
      const nurse = context.workspace.nurses.find(
        (item) =>
          item.id === nurseId &&
          surnameFor(item) === normalizedIdentity(body?.surname),
      );
      if (!nurse)
        return json({ error: "The Employee ID and surname did not match." }, 401);
      const requests = Object.fromEntries(
        Object.entries(context.record.requests ?? {})
          .filter(([key]) => key.startsWith(`${nurse.id}-`))
          .map(([key, request]) => [key.slice(key.lastIndexOf("-") + 1), request.choice]),
      );
      return json({
        nurse: { id: nurse.id, name: nurse.name },
        nurseToken: createRequestToken(
          {
            username: context.payload.username,
            workspaceId: context.entry.id,
            weekOffset: context.payload.weekOffset,
            version: context.payload.version,
            nurseId: nurse.id,
            exp: Date.now() + 30 * 60 * 1000,
          },
          process.env.ACE_SESSION_SECRET,
        ),
        requests,
        comment: context.record.requestComments?.[nurse.id] ?? "",
        days: periodDays(context.payload.weekOffset).map((day) => ({
          ...day,
          active: activeOn(nurse, day.isoDate),
        })),
        maxRequests: context.record.requestPortal.maxRequests,
      });
    }
    if (action !== "submit")
      return json({ error: "Invalid request action." }, 400);
    const nursePayload = readRequestToken(
      body?.nurseToken,
      process.env.ACE_SESSION_SECRET,
    );
    if (
      !nursePayload?.nurseId ||
      nursePayload.username !== context.payload.username ||
      (nursePayload.workspaceId ?? "primary") !== context.entry.id ||
      nursePayload.weekOffset !== context.payload.weekOffset ||
      nursePayload.version !== context.payload.version
    )
      return json({ error: "Verify your identity again." }, 401);
    const nurse = context.workspace.nurses.find(
      (item) => item.id === nursePayload.nurseId,
    );
    if (!nurse) return json({ error: "Nurse record not found." }, 404);
    const selected = Object.entries(body?.requests ?? {}).filter(
      ([dayKey, choice]) => /^d(?:[0-9]|1[0-3])$/.test(dayKey) && choices.has(choice),
    );
    const activeDayKeys = new Set(
      periodDays(context.payload.weekOffset)
        .filter((day) => activeOn(nurse, day.isoDate))
        .map((day) => day.key),
    );
    if (
      selected.length !== Object.keys(body?.requests ?? {}).length ||
      selected.length > context.record.requestPortal.maxRequests ||
      selected.some(([dayKey]) => !activeDayKeys.has(dayKey))
    )
      return json(
        {
          error: `Choose no more than ${context.record.requestPortal.maxRequests} dates.`,
        },
        400,
      );
    context.record.requests = Object.fromEntries(
      Object.entries(context.record.requests ?? {}).filter(
        ([key]) => !key.startsWith(`${nurse.id}-`),
      ),
    );
    for (const [dayKey, choice] of selected) {
      context.record.requests[`${nurse.id}-${dayKey}`] = {
        choice,
        status: leaveChoices.has(choice) ? "mandatory" : "requested",
      };
    }
    const submittedAt = new Date().toISOString();
    const comment = String(body?.comment ?? "").normalize("NFKC").trim();
    if (comment.length > 500)
      return json({ error: "The request summary must be 500 characters or fewer." }, 400);
    context.record.requestComments ??= {};
    if (comment) context.record.requestComments[nurse.id] = comment;
    else delete context.record.requestComments[nurse.id];
    context.record.requestSubmissions ??= {};
    context.record.requestSubmissions[nurse.id] = submittedAt;
    context.workspace.weeks[String(context.payload.weekOffset)] = context.record;
    context.entry.data = cleanWorkspace(context.workspace);
    context.entry.updatedAt = submittedAt;
    const cleaned = cleanWorkspaceCollection(
      context.collection,
      { username: context.payload.username },
      submittedAt,
    );
    await context.sql.transaction([
      context.sql`UPDATE ace_workspaces SET data = ${cleaned}, version = version + 1, updated_at = NOW() WHERE account_username = ${context.payload.username}`,
      context.sql`INSERT INTO ace_audit_log (account_username, action, metadata) VALUES (${context.payload.username}, 'staff_requests_submitted', ${{ workspaceId: context.entry.id, weekOffset: context.payload.weekOffset, nurseId: nurse.id, requestCount: selected.length }})`,
    ]);
    return json({ ok: true, submittedAt, requestCount: selected.length });
  } catch {
    return json({ error: "The request could not be saved." }, 503);
  }
}
