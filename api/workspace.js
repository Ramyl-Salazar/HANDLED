import { randomBytes } from "node:crypto";
import { database, ensureSchema } from "../server/db.js";
import { isSameOrigin, json, userFromRequest } from "../server/auth.js";

const preferenceValues = new Set([
  "preferred",
  "available",
  "avoid",
  "unavailable",
  "leave",
  "sick",
  "absent",
]);
const legacyShiftKeys = [
  "mon-morning",
  "mon-afternoon",
  "mon-night",
  "tue-morning",
  "tue-afternoon",
  "tue-night",
  "wed-morning",
  "wed-afternoon",
  "wed-night",
  "thu-morning",
  "thu-afternoon",
  "thu-night",
  "fri-morning",
  "fri-afternoon",
  "fri-night",
  "sat-morning",
  "sat-afternoon",
  "sat-night",
  "sun-morning",
  "sun-afternoon",
  "sun-night",
];
const periodDayKeys = Array.from({ length: 14 }, (_, index) => `d${index}`);
const dutyCodes = [
  "morning",
  "afternoon",
  "night",
  "rest",
  "birthday_leave",
  "personal_leave",
  "training",
  "leave",
];
const protectedDutyCodes = new Set([
  "birthday_leave",
  "personal_leave",
  "training",
  "leave",
]);
const shiftKeys = new Set([
  ...legacyShiftKeys,
  ...periodDayKeys.flatMap((day) => dutyCodes.map((duty) => `${day}-${duty}`)),
]);
const requestChoices = new Set(dutyCodes);
const requestStatuses = new Set(["requested", "approved", "mandatory"]);
const coverageRuleTargets = new Set([
  "weekend",
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
]);
const shiftCodes = ["morning", "afternoon", "night"];
const defaultShifts = [
  {
    code: "morning",
    label: "Morning",
    shortLabel: "AM",
    start: "06:00",
    end: "14:00",
    enabled: true,
  },
  {
    code: "afternoon",
    label: "Afternoon",
    shortLabel: "PM",
    start: "14:00",
    end: "22:00",
    enabled: true,
  },
  {
    code: "night",
    label: "Night",
    shortLabel: "N",
    start: "22:00",
    end: "06:00",
    enabled: true,
  },
];
const clockPattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (clock) =>
  Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const shiftDurationHours = (shift) => {
  const start = toMinutes(shift.start);
  let end = toMinutes(shift.end);
  if (end <= start) end += 1440;
  return (end - start) / 60;
};
const shiftsHaveGap = (definitions) => {
  const intervals = definitions
    .filter((shift) => shift.enabled)
    .flatMap((shift) => {
      const start = toMinutes(shift.start);
      const end = toMinutes(shift.end);
      return end > start
        ? [[start, end]]
        : [
            [start, 1440],
            [0, end],
          ];
    })
    .sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  for (const [start, end] of intervals) {
    if (start > cursor) return true;
    cursor = Math.max(cursor, end);
  }
  return cursor < 1440;
};

const workspaceCollectionVersion = 2;
const workspaceIdPattern = /^(primary|ws_[a-z0-9]{16,48})$/;
const workspaceTypes = new Set(["nurses", "orderlies"]);
const maximumWorkspaces = 12;

function workspaceName(value, fallback = "Emergency Department") {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) return fallback;
  return name;
}

function defaultWorkspaceName(user) {
  if (user?.seeded) return "HANDLED Test Workspace";
  return "Salazar ER Workspace";
}

function cleanWorkspaceEntry(entry, fallbackId, fallbackName, now) {
  const id = workspaceIdPattern.test(String(entry?.id ?? ""))
    ? String(entry.id)
    : fallbackId;
  const createdAt = /^\d{4}-\d{2}-\d{2}T/.test(String(entry?.createdAt ?? ""))
    ? String(entry.createdAt)
    : now;
  const updatedAt = /^\d{4}-\d{2}-\d{2}T/.test(String(entry?.updatedAt ?? ""))
    ? String(entry.updatedAt)
    : createdAt;
  return {
    id,
    name: workspaceName(entry?.name, fallbackName),
    staffType: workspaceTypes.has(entry?.staffType) ? entry.staffType : "nurses",
    createdAt,
    updatedAt,
    data: cleanWorkspace(entry?.data),
  };
}

export function cleanWorkspaceCollection(input, user = {}, now = new Date().toISOString()) {
  if (input?.schemaVersion === workspaceCollectionVersion) {
    const rawEntries = Array.isArray(input.workspaces) ? input.workspaces : [];
    if (!rawEntries.length || rawEntries.length > maximumWorkspaces)
      throw new Error("Invalid workspace collection");
    const seen = new Set();
    const workspaces = rawEntries.map((entry, index) => {
      const cleaned = cleanWorkspaceEntry(
        entry,
        index === 0 ? "primary" : `ws_${randomBytes(12).toString("hex")}`,
        index === 0 ? defaultWorkspaceName(user) : `Workspace ${index + 1}`,
        now,
      );
      if (seen.has(cleaned.id)) throw new Error("Duplicate workspace ID");
      seen.add(cleaned.id);
      return cleaned;
    });
    const activeWorkspaceId = seen.has(input.activeWorkspaceId)
      ? input.activeWorkspaceId
      : workspaces[0].id;
    return { schemaVersion: workspaceCollectionVersion, activeWorkspaceId, workspaces };
  }
  return {
    schemaVersion: workspaceCollectionVersion,
    activeWorkspaceId: "primary",
    workspaces: [
      {
        id: "primary",
        name: defaultWorkspaceName(user),
        staffType: "nurses",
        createdAt: now,
        updatedAt: now,
        data: cleanWorkspace(input),
      },
    ],
  };
}

export function workspaceDirectory(collection) {
  return collection.workspaces.map(({ id, name, staffType, createdAt, updatedAt, data }) => ({
    id,
    name,
    staffType,
    createdAt,
    updatedAt,
    memberCount: data.nurses.length,
  }));
}

export function workspaceEntry(collection, requestedId) {
  const id = requestedId || collection.activeWorkspaceId;
  return collection.workspaces.find((entry) => entry.id === id) ?? null;
}

function collectionResponse(collection, entry, extra = {}) {
  return {
    workspace: entry?.data ?? null,
    workspaces: workspaceDirectory(collection),
    activeWorkspaceId: entry?.id ?? collection.activeWorkspaceId,
    ...extra,
  };
}

async function saveCollection(sql, username, collection, action, metadata = {}) {
  await sql.transaction([
    sql`INSERT INTO ace_workspaces (account_username, data) VALUES (${username}, ${collection}) ON CONFLICT (account_username) DO UPDATE SET data = EXCLUDED.data, version = ace_workspaces.version + 1, updated_at = NOW()`,
    sql`INSERT INTO ace_audit_log (account_username, action, metadata) VALUES (${username}, ${action}, ${metadata})`,
  ]);
}

export function cleanWorkspace(input) {
  if (!input || typeof input !== "object") throw new Error("Invalid workspace");
  const rawNurses = Array.isArray(input.nurses) ? input.nurses : [];
  if (rawNurses.length > 500) throw new Error("Roster limit exceeded");
  const seen = new Set();
  const nurses = rawNurses.map((item) => {
    const id = String(item?.id ?? "")
      .trim()
      .toUpperCase();
    const legacyName = String(item?.name ?? "").trim();
    const legacyParts = legacyName.split(/\s+/).filter(Boolean);
    const firstName = String(
      item?.firstName ?? legacyParts.slice(0, -1).join(" "),
    ).trim();
    const surname = String(item?.surname ?? legacyParts.at(-1) ?? "").trim();
    const name = `${firstName} ${surname}`.trim();
    const dateHired = String(item?.dateHired ?? "");
    const employmentEndDate = item?.employmentEndDate
      ? String(item.employmentEndDate)
      : undefined;
    const role =
      item?.role === "Charge nurse"
        ? "Charge nurse"
        : item?.role === "Staff nurse"
          ? "Staff nurse"
          : "";
    const targetShifts = Number(item?.targetShifts);
    if (
      !/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(id) ||
      seen.has(id) ||
      name.length < 2 ||
      name.length > 120 ||
      firstName.length < 1 ||
      surname.length < 1 ||
      (dateHired && !/^\d{4}-\d{2}-\d{2}$/.test(dateHired)) ||
      (employmentEndDate &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(employmentEndDate) ||
          (dateHired && employmentEndDate < dateHired))) ||
      !role ||
      !Number.isInteger(targetShifts) ||
      targetShifts < 1 ||
      targetShifts > 7
    )
      throw new Error("Invalid nurse record");
    seen.add(id);
    return {
      id,
      name,
      firstName,
      surname,
      initials: name
        .split(/\s+/)
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase(),
      role,
      targetShifts,
      dateHired,
      ...(employmentEndDate ? { employmentEndDate } : {}),
    };
  });
  const ids = new Set(nurses.map((nurse) => nurse.id));
  const rawSettings = input.settings ?? {};
  const rawShiftDefinitions = Array.isArray(rawSettings.shiftDefinitions)
    ? rawSettings.shiftDefinitions
    : [];
  const shiftDefinitions = defaultShifts.map((fallback) => {
    const raw =
      rawShiftDefinitions.find((shift) => shift?.code === fallback.code) ??
      fallback;
    const label = String(raw.label ?? "").trim();
    const shortLabel = String(raw.shortLabel ?? fallback.shortLabel).trim();
    const start = String(raw.start ?? fallback.start);
    const end = String(raw.end ?? fallback.end);
    if (
      label.length < 1 ||
      label.length > 24 ||
      shortLabel.length < 1 ||
      shortLabel.length > 4 ||
      !clockPattern.test(start) ||
      !clockPattern.test(end) ||
      start === end
    )
      throw new Error("Invalid shift definition");
    return {
      code: fallback.code,
      label,
      shortLabel,
      start,
      end,
      enabled: raw.enabled !== false,
      time: `${start}-${end}`,
    };
  });
  if (!shiftDefinitions.some((shift) => shift.enabled))
    throw new Error("At least one shift is required");
  const chargeNursesPerShift = Number(
    rawSettings.chargeNursesPerShift ??
      (rawSettings.requireChargeNurse ? 1 : 0),
  );
  const rawOverrides = Array.isArray(rawSettings.coverageOverrides)
    ? rawSettings.coverageOverrides
    : [];
  if (rawOverrides.length > coverageRuleTargets.size)
    throw new Error("Too many coverage exceptions");
  const seenTargets = new Set();
  const coverageOverrides = rawOverrides.map((rule) => {
    const target = String(rule?.target ?? "");
    const normalized = {
      target,
      morningCoverage: Number(rule?.morningCoverage),
      afternoonCoverage: Number(rule?.afternoonCoverage),
      nightCoverage: Number(rule?.nightCoverage),
      chargeNurses: Number(rule?.chargeNurses),
    };
    if (!coverageRuleTargets.has(target) || seenTargets.has(target))
      throw new Error("Invalid coverage exception");
    seenTargets.add(target);
    return normalized;
  });
  const rawTwoWeekRules = rawSettings.twoWeekRules ?? {};
  const twoWeekRules = {
    restDaysPerWeek: Number(rawTwoWeekRules.restDaysPerWeek ?? 2),
    maxRestPerDay: Number(rawTwoWeekRules.maxRestPerDay ?? 7),
    maxDailyShiftDifference: Number(
      rawTwoWeekRules.maxDailyShiftDifference ?? 1,
    ),
    maxIndividualShiftDifference: Number(
      rawTwoWeekRules.maxIndividualShiftDifference ?? 1,
    ),
    preventNightToMorning: true,
    preventAfternoonRestMorning: true,
    maxConsecutiveHours: 12,
    minHoursPerPeriod: Number(rawTwoWeekRules.minHoursPerPeriod ?? 80),
    maxHoursPerPeriod: Number(rawTwoWeekRules.maxHoursPerPeriod ?? 112),
  };
  if (
    !Number.isInteger(twoWeekRules.restDaysPerWeek) ||
    twoWeekRules.restDaysPerWeek < 0 ||
    twoWeekRules.restDaysPerWeek > 3 ||
    !Number.isInteger(twoWeekRules.maxRestPerDay) ||
    twoWeekRules.maxRestPerDay < 0 ||
    twoWeekRules.maxRestPerDay > 50 ||
    !Number.isInteger(twoWeekRules.maxDailyShiftDifference) ||
    twoWeekRules.maxDailyShiftDifference < 0 ||
    twoWeekRules.maxDailyShiftDifference > 10 ||
    !Number.isInteger(twoWeekRules.maxIndividualShiftDifference) ||
    twoWeekRules.maxIndividualShiftDifference < 0 ||
    twoWeekRules.maxIndividualShiftDifference > 10 ||
    !Number.isInteger(twoWeekRules.minHoursPerPeriod) ||
    twoWeekRules.minHoursPerPeriod < 0 ||
    twoWeekRules.minHoursPerPeriod > 168 ||
    !Number.isInteger(twoWeekRules.maxHoursPerPeriod) ||
    twoWeekRules.maxHoursPerPeriod < twoWeekRules.minHoursPerPeriod ||
    twoWeekRules.maxHoursPerPeriod > 168
  )
    throw new Error("Invalid two-week scheduling rules");
  const settings = {
    erBeds: Number(rawSettings.erBeds),
    morningCoverage: Number(rawSettings.morningCoverage),
    afternoonCoverage: Number(rawSettings.afternoonCoverage),
    nightCoverage: Number(rawSettings.nightCoverage),
    chargeNursesPerShift,
    coverageOverrides,
    maximumShifts: Number(rawSettings.maximumShifts),
    requireChargeNurse:
      chargeNursesPerShift > 0 ||
      coverageOverrides.some((rule) => rule.chargeNurses > 0),
    preventNightToMorning: true,
    shiftDefinitions,
    twoWeekRules,
  };
  const activeCoverage = shiftDefinitions
    .filter((shift) => shift.enabled)
    .map((shift) =>
      shift.code === "morning"
        ? settings.morningCoverage
        : shift.code === "afternoon"
          ? settings.afternoonCoverage
          : settings.nightCoverage,
    );
  if (
    !Number.isInteger(settings.erBeds) ||
    settings.erBeds < 1 ||
    settings.erBeds > 200 ||
    ![
      settings.morningCoverage,
      settings.afternoonCoverage,
      settings.nightCoverage,
    ].every((value) => Number.isInteger(value) && value >= 1 && value <= 50) ||
    !Number.isInteger(settings.chargeNursesPerShift) ||
    settings.chargeNursesPerShift < 0 ||
    settings.chargeNursesPerShift > Math.min(...activeCoverage) ||
    !Number.isInteger(settings.maximumShifts) ||
    settings.maximumShifts < 1 ||
    settings.maximumShifts > 14
  )
    throw new Error("Invalid coverage settings");
  const bedFloor = 1;
  if (
    coverageOverrides.some((rule) => {
      const values = shiftDefinitions
        .filter((shift) => shift.enabled)
        .map((shift) =>
          shift.code === "morning"
            ? rule.morningCoverage
            : shift.code === "afternoon"
              ? rule.afternoonCoverage
              : rule.nightCoverage,
        );
      return (
        !values.every(
          (value) =>
            Number.isInteger(value) && value >= bedFloor && value <= 50,
        ) ||
        !Number.isInteger(rule.chargeNurses) ||
        rule.chargeNurses < 0 ||
        rule.chargeNurses > Math.min(...values)
      );
    })
  )
    throw new Error("Invalid coverage exception");
  const weekOffset =
    Number.isInteger(input.weekOffset) && Math.abs(input.weekOffset) <= 520
      ? input.weekOffset
      : 0;
  const rawWeeks =
    input.weeks && typeof input.weeks === "object" ? input.weeks : {};
  const entries = Object.entries(rawWeeks);
  if (entries.length > 104) throw new Error("Week limit exceeded");
  const weeks = Object.fromEntries(
    entries.map(([week, record]) => {
      if (!/^-?\d{1,3}$/.test(week) || !record || typeof record !== "object")
        throw new Error("Invalid week record");
      const preferences = Object.fromEntries(
        Object.entries(record.preferences ?? {})
          .filter(([key, value]) => {
            const nurseId = nurses.find((nurse) =>
              key.startsWith(`${nurse.id}-`),
            )?.id;
            return ids.has(nurseId) && preferenceValues.has(value);
          })
          .slice(0, nurses.length * 21),
      );
      const cleanedRequestEntries = Object.entries(record.requests ?? {})
          .filter(([key, request]) => {
            const separator = key.lastIndexOf("-");
            const nurseId = key.slice(0, separator);
            const dayKey = key.slice(separator + 1);
            return (
              ids.has(nurseId) &&
              periodDayKeys.includes(dayKey) &&
              request &&
              requestChoices.has(request.choice) &&
              requestStatuses.has(request.status) &&
              (!protectedDutyCodes.has(request.choice) ||
                request.status === "mandatory")
            );
          })
          .map(([key, request]) => [
            key,
            {
              choice: request.choice === "leave" ? "personal_leave" : request.choice,
              status: protectedDutyCodes.has(request.choice)
                ? "mandatory"
                : "requested",
            },
          ]);
      const requests = Object.fromEntries(cleanedRequestEntries);
      const rawPortal = record.requestPortal;
      const requestPortal =
        rawPortal &&
        typeof rawPortal === "object" &&
        typeof rawPortal.version === "string" &&
        /^[A-Za-z0-9_-]{16,120}$/.test(rawPortal.version) &&
        Number.isInteger(rawPortal.maxRequests) &&
        rawPortal.maxRequests >= 1 &&
        rawPortal.maxRequests <= 14 &&
        !Number.isNaN(Date.parse(rawPortal.createdAt)) &&
        !Number.isNaN(Date.parse(rawPortal.updatedAt))
          ? {
              enabled: rawPortal.enabled === true,
              version: rawPortal.version,
              maxRequests: rawPortal.maxRequests,
              createdAt: new Date(rawPortal.createdAt).toISOString(),
              updatedAt: new Date(rawPortal.updatedAt).toISOString(),
            }
          : undefined;
      const requestSubmissions = Object.fromEntries(
        Object.entries(record.requestSubmissions ?? {})
          .filter(
            ([nurseId, submittedAt]) =>
              ids.has(nurseId) &&
              typeof submittedAt === "string" &&
              !Number.isNaN(Date.parse(submittedAt)),
          )
          .map(([nurseId, submittedAt]) => [
            nurseId,
            new Date(submittedAt).toISOString(),
          ]),
      );
      const requestComments = Object.fromEntries(
        Object.entries(record.requestComments ?? {})
          .filter(
            ([nurseId, comment]) =>
              ids.has(nurseId) &&
              typeof comment === "string" &&
              comment.trim().length > 0,
          )
          .map(([nurseId, comment]) => [
            nurseId,
            comment.normalize("NFKC").trim().slice(0, 500),
          ]),
      );
      const workRequests = {};
      const rawDailyCoverage = record.dailyCoverage ?? {};
      const dailyCoverage = Object.fromEntries(
        periodDayKeys.map((dayKey) => {
          const rule = rawDailyCoverage[dayKey] ?? {};
          const normalized = Object.fromEntries(
            shiftCodes.map((code) => [
              code,
              Number.isInteger(rule[code]) && rule[code] >= 0 && rule[code] <= 50
                ? rule[code]
                : 4,
            ]),
          );
          return [dayKey, normalized];
        }),
      );
      const assignments = Object.entries(record.assignments ?? {})
        .filter(([key, value]) => shiftKeys.has(key) && Array.isArray(value))
        .reduce((cleaned, [key, value]) => {
          const normalizedKey = key.endsWith("-leave")
            ? `${key.slice(0, -"leave".length)}personal_leave`
            : key;
          cleaned[normalizedKey] = [
            ...new Set([
              ...(cleaned[normalizedKey] ?? []),
              ...value.filter((id) => ids.has(id)),
            ]),
          ].slice(0, 50);
          return cleaned;
        }, {});
      const adjacent = {
        morning: ["night", "afternoon"],
        afternoon: ["morning", "night"],
        night: ["afternoon", "morning"],
      };
      const overtimeUsed = new Set();
      const overtimeCoverage = (
        Array.isArray(record.overtimeCoverage) ? record.overtimeCoverage : []
      )
        .slice(0, 200)
        .map((entry, index) => {
          const dayKey = String(entry?.dayKey ?? "");
          const shiftCode = String(entry?.shiftCode ?? "");
          const nurseIds = Array.isArray(entry?.nurseIds)
            ? entry.nurseIds.map((id) => String(id).toUpperCase())
            : [];
          const adjacentDefinitions = (adjacent[shiftCode] ?? []).map((code) =>
            shiftDefinitions.find((shift) => shift.code === code && shift.enabled),
          );
          if (
            !periodDayKeys.includes(dayKey) ||
            !shiftCodes.includes(shiftCode) ||
            nurseIds.length !== 2 ||
            nurseIds[0] === nurseIds[1] ||
            nurseIds.some((id) => !ids.has(id)) ||
            nurseIds.some((id) => overtimeUsed.has(`${dayKey}-${id}`)) ||
            adjacentDefinitions.length !== 2 ||
            adjacentDefinitions.some(
              (shift) =>
                !shift ||
                shiftDurationHours(shift) + 4 >
                  settings.twoWeekRules.maxConsecutiveHours,
            ) ||
            !assignments[`${dayKey}-${adjacent[shiftCode][0]}`]?.includes(nurseIds[0]) ||
            !assignments[`${dayKey}-${adjacent[shiftCode][1]}`]?.includes(nurseIds[1])
          )
            throw new Error("Invalid forced overtime coverage");
          nurseIds.forEach((id) => overtimeUsed.add(`${dayKey}-${id}`));
          return {
            id: String(entry?.id ?? `overtime-${index}`).slice(0, 160),
            dayKey,
            shiftCode,
            nurseIds,
            hoursEach: 4,
            createdAt: !Number.isNaN(Date.parse(entry?.createdAt))
              ? new Date(entry.createdAt).toISOString()
              : new Date(0).toISOString(),
          };
        });
      for (const dayKey of periodDayKeys) {
        const restCount = assignments[`${dayKey}-rest`]?.length ?? 0;
        if (restCount > settings.twoWeekRules.maxRestPerDay)
          throw new Error("Daily REST limit exceeded");
        for (const nurse of nurses) {
          const assignedDuties = dutyCodes.filter((duty) =>
            assignments[`${dayKey}-${duty}`]?.includes(nurse.id),
          );
          if (assignedDuties.length > 1)
            throw new Error("Only one assignment is allowed per nurse and date");
        }
      }
      for (const dayKey of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) {
        for (const nurse of nurses) {
          const assignedCodes = shiftCodes.filter((shiftCode) =>
            assignments[`${dayKey}-${shiftCode}`]?.includes(nurse.id),
          );
          if (
            assignedCodes.length > 2 ||
            (assignedCodes.length === 2 && !workRequests[nurse.id]?.doubleShift)
          )
            throw new Error("Double shift was not approved");
          if (assignedCodes.length === 2) {
            const [first, second] = assignedCodes.map((code) =>
              shiftDefinitions.find((shift) => shift.code === code),
            );
            if (first.end !== second.start && second.end !== first.start)
              throw new Error("Double shifts must be consecutive");
          }
        }
      }
      for (const nurse of nurses) {
        const count = Object.entries(assignments).filter(
          ([key, nurseIds]) =>
            shiftCodes.some((code) => key.endsWith(`-${code}`)) &&
            nurseIds.includes(nurse.id),
        ).length;
        if (
          !Object.keys(assignments).some((key) => key.startsWith("d")) &&
          (count > settings.maximumShifts ||
            (count > nurse.targetShifts && !workRequests[nurse.id]?.overtime))
          )
          throw new Error("Weekly workload was not approved");
      }
      const incidents = [];
      const published = Boolean(record.published);
      if (
        published &&
        week === String(weekOffset) &&
        shiftsHaveGap(shiftDefinitions)
      )
        throw new Error("Cannot publish with a shift time gap");
      if (
        published &&
        week === String(weekOffset) &&
        Object.keys(assignments).some((key) => key.startsWith("d"))
      ) {
        const rules = settings.twoWeekRules;
        const periodOffset = Number(week);
        const isoForDay = (dayIndex) => {
          const date = new Date(Date.UTC(2026, 8, 13 + periodOffset * 14 + dayIndex));
          return date.toISOString().slice(0, 10);
        };
        const activeOn = (nurse, dayIndex) => {
          const isoDate = isoForDay(dayIndex);
          return (
            (!nurse.dateHired || isoDate >= nurse.dateHired) &&
            (!nurse.employmentEndDate || isoDate <= nurse.employmentEndDate)
          );
        };
        for (const [dayIndex, dayKey] of periodDayKeys.entries()) {
          const counts = shiftCodes.map(
            (code) =>
              (assignments[`${dayKey}-${code}`]?.length ?? 0) +
              overtimeCoverage.filter(
                (entry) => entry.dayKey === dayKey && entry.shiftCode === code,
              ).length,
          );
          if (
            Math.max(...counts) - Math.min(...counts) >
            rules.maxDailyShiftDifference
          )
            throw new Error("Published daily staffing must be balanced");
          for (const [shiftIndex, code] of shiftCodes.entries()) {
            if (
              counts[shiftIndex] < dailyCoverage[dayKey][code]
            )
              throw new Error("Published schedules must meet daily staffing minimums");
          }
          for (const nurse of nurses) {
            const assigned = dutyCodes.some((duty) =>
              assignments[`${dayKey}-${duty}`]?.includes(nurse.id),
            );
            if (assigned && !activeOn(nurse, dayIndex))
              throw new Error("Employees cannot be scheduled outside employment dates");
          }
        }
        for (const nurse of nurses) {
          for (let weekIndex = 0; weekIndex < 2; weekIndex += 1) {
            const activeDays = periodDayKeys
              .slice(weekIndex * 7, weekIndex * 7 + 7)
              .filter((_, index) => activeOn(nurse, weekIndex * 7 + index)).length;
            const requiredRest = Math.min(
              rules.restDaysPerWeek,
              Math.floor(activeDays / 3),
            );
            const rests = periodDayKeys
              .slice(weekIndex * 7, weekIndex * 7 + 7)
              .filter((dayKey) =>
                assignments[`${dayKey}-rest`]?.includes(nurse.id),
              ).length;
            if (rests !== requiredRest)
              throw new Error("Published schedules do not meet the configured REST rule");
          }
          for (const dayKey of periodDayKeys) {
            const request = requests[`${nurse.id}-${dayKey}`];
            if (!request || request.status === "requested") continue;
            if (!assignments[`${dayKey}-${request.choice}`]?.includes(nurse.id))
              throw new Error("Published schedules must satisfy mandatory leave");
          }
          const dutyOn = (dayIndex) => {
            if (dayIndex < 0) return null;
            const dayKey = periodDayKeys[dayIndex];
            return dutyCodes.find((duty) =>
              assignments[`${dayKey}-${duty}`]?.includes(nurse.id),
            );
          };
          for (let dayIndex = 1; dayIndex < periodDayKeys.length; dayIndex += 1) {
            const currentDuty = dutyOn(dayIndex);
            const previousDuty = dutyOn(dayIndex - 1);
            if (previousDuty === "night" && currentDuty === "training")
              throw new Error("Published schedules cannot place Training after N");
            if (
              previousDuty === "night" &&
              ["morning", "afternoon"].includes(currentDuty)
            )
              throw new Error("After N, the next duty must be N or REST");
            if (previousDuty === "afternoon" && currentDuty === "morning")
              throw new Error("Published schedules must provide 16 hours between duties");
            if (
              dayIndex >= 2 &&
              ["afternoon", "night"].includes(dutyOn(dayIndex - 2)) &&
              previousDuty === "rest" &&
              currentDuty === "morning"
            )
              throw new Error(
                "After N or 2 and one REST day, the next duty must be 2 or N",
              );
          }
          const activeDays = periodDayKeys.filter((_, index) =>
            activeOn(nurse, index),
          ).length;
          const regularHours = Object.entries(assignments).reduce(
            (total, [key, nurseIds]) =>
              shiftCodes.some((code) => key.endsWith(`-${code}`)) &&
              nurseIds.includes(nurse.id)
                ? total + 8
                : total,
            0,
          );
          const overtimeHours = overtimeCoverage.reduce(
            (total, entry) =>
              entry.nurseIds.includes(nurse.id)
                ? total + entry.hoursEach
                : total,
            0,
          );
          const minimum = Math.floor(
            (rules.minHoursPerPeriod * activeDays) / 14,
          );
          const maximum = Math.ceil(
            (rules.maxHoursPerPeriod * activeDays) / 14,
          );
          const hours = regularHours + overtimeHours;
          if (activeDays && (hours < minimum || hours > maximum))
            throw new Error("Published schedule is outside an employee hour limit");
        }
      }
      const issues = (Array.isArray(record.issues) ? record.issues : [])
        .slice(0, 500)
        .map((issue) => ({
          id: String(issue?.id ?? "").slice(0, 160),
          severity: issue?.severity === "error" ? "error" : "warning",
          title: String(issue?.title ?? "").slice(0, 160),
          detail: String(issue?.detail ?? "").slice(0, 500),
          ...(ids.has(issue?.nurseId) ? { nurseId: issue.nurseId } : {}),
          ...(periodDayKeys.includes(issue?.dayKey)
            ? { dayKey: issue.dayKey }
            : {}),
        }));
      return [
        week,
        {
          preferences,
          requests,
          workRequests,
          assignments,
          published,
          incidents,
          issues,
          ...(requestPortal ? { requestPortal } : {}),
          requestSubmissions,
          requestComments,
          dailyCoverage,
          overtimeCoverage,
        },
      ];
    }),
  );
  return { nurses, settings, weeks, weekOffset };
}

export function mergeNewerPublicSubmissions(incoming, existing) {
  if (!existing) return incoming;
  const merged = structuredClone(incoming);
  for (const [week, existingRecord] of Object.entries(existing.weeks ?? {})) {
    const incomingRecord = merged.weeks?.[week];
    if (!incomingRecord) continue;
    const existingPortal = existingRecord.requestPortal;
    const incomingPortal = incomingRecord.requestPortal;
    if (
      existingPortal &&
      (!incomingPortal || existingPortal.updatedAt > incomingPortal.updatedAt)
    )
      incomingRecord.requestPortal = existingPortal;
    incomingRecord.requestSubmissions ??= {};
    for (const [nurseId, submittedAt] of Object.entries(
      existingRecord.requestSubmissions ?? {},
    )) {
      const incomingAt = incomingRecord.requestSubmissions[nurseId];
      if (incomingAt && incomingAt >= submittedAt) continue;
      incomingRecord.requests = Object.fromEntries(
        Object.entries(incomingRecord.requests ?? {}).filter(
          ([key]) => !key.startsWith(`${nurseId}-`),
        ),
      );
      Object.assign(
        incomingRecord.requests,
        Object.fromEntries(
          Object.entries(existingRecord.requests ?? {}).filter(([key]) =>
            key.startsWith(`${nurseId}-`),
          ),
        ),
      );
      incomingRecord.requestComments ??= {};
      if (existingRecord.requestComments?.[nurseId])
        incomingRecord.requestComments[nurseId] =
          existingRecord.requestComments[nurseId];
      else delete incomingRecord.requestComments[nurseId];
      incomingRecord.requestSubmissions[nurseId] = submittedAt;
    }
  }
  return merged;
}

export async function GET(request) {
  const user = userFromRequest(request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (user.isDemo)
    return json({
      workspace: null,
      workspaces: [],
      activeWorkspaceId: "demo",
      readOnly: true,
    });
  const sql = database();
  if (!sql)
    return json({ error: "Database setup is still being completed." }, 503);
  try {
    await ensureSchema(sql);
    const rows =
      await sql`SELECT data, updated_at FROM ace_workspaces WHERE account_username = ${user.username} LIMIT 1`;
    if (!rows[0]?.data)
      return json({
        workspace: null,
        workspaces: [],
        activeWorkspaceId: null,
        updatedAt: null,
      });
    const collection = cleanWorkspaceCollection(rows[0].data, user);
    const requestedId = new URL(request.url).searchParams.get("workspace");
    if (requestedId && !workspaceIdPattern.test(requestedId))
      return json({ error: "Invalid workspace." }, 400);
    const entry = workspaceEntry(collection, requestedId);
    if (!entry) return json({ error: "Workspace not found." }, 404);
    return json(
      collectionResponse(collection, entry, {
        updatedAt: rows[0].updated_at ?? null,
      }),
    );
  } catch {
    return json({ error: "The workspace could not be loaded." }, 503);
  }
}

export async function PUT(request) {
  if (!isSameOrigin(request))
    return json({ error: "Request origin was rejected." }, 403);
  const user = userFromRequest(request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (user.isDemo)
    return json({ error: "The shared demo workspace is read-only." }, 403);
  if (Number(request.headers.get("content-length") || 0) > 1_000_000)
    return json({ error: "Workspace is too large." }, 413);
  const sql = database();
  if (!sql)
    return json({ error: "Database setup is still being completed." }, 503);
  let workspace;
  let requestedWorkspaceId;
  try {
    const body = await request.json();
    requestedWorkspaceId = body?.workspaceId
      ? String(body.workspaceId)
      : new URL(request.url).searchParams.get("workspace");
    if (requestedWorkspaceId && !workspaceIdPattern.test(requestedWorkspaceId))
      return json({ error: "Invalid workspace." }, 400);
    workspace = cleanWorkspace(body?.workspace ?? body);
  } catch {
    return json({ error: "The workspace data is invalid." }, 400);
  }
  try {
    await ensureSchema(sql);
    const existingRows =
      await sql`SELECT data FROM ace_workspaces WHERE account_username = ${user.username} LIMIT 1`;
    const now = new Date().toISOString();
    let collection;
    let entry;
    if (existingRows[0]?.data) {
      collection = cleanWorkspaceCollection(existingRows[0].data, user, now);
      entry = workspaceEntry(collection, requestedWorkspaceId);
      if (!entry) return json({ error: "Workspace not found." }, 404);
      workspace = mergeNewerPublicSubmissions(workspace, entry.data);
      entry.data = workspace;
      entry.updatedAt = now;
    } else {
      const id = requestedWorkspaceId || "primary";
      collection = {
        schemaVersion: workspaceCollectionVersion,
        activeWorkspaceId: id,
        workspaces: [
          {
            id,
            name: defaultWorkspaceName(user),
            staffType: "nurses",
            createdAt: now,
            updatedAt: now,
            data: workspace,
          },
        ],
      };
      entry = collection.workspaces[0];
    }
    collection.activeWorkspaceId = entry.id;
    await saveCollection(sql, user.username, collection, "workspace_saved", {
      workspaceId: entry.id,
      nurseCount: workspace.nurses.length,
      weekOffset: workspace.weekOffset,
    });
    return json({
      ok: true,
      savedAt: now,
      workspaces: workspaceDirectory(collection),
      activeWorkspaceId: entry.id,
    });
  } catch {
    return json({ error: "The workspace could not be saved." }, 503);
  }
}

export async function DELETE(request) {
  if (!isSameOrigin(request))
    return json({ error: "Request origin was rejected." }, 403);
  const user = userFromRequest(request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (user.isDemo)
    return json({ error: "The demo workspace cannot be deleted." }, 403);
  const sql = database();
  if (!sql)
    return json({ error: "Database setup is still being completed." }, 503);
  try {
    await ensureSchema(sql);
    const requestedId = new URL(request.url).searchParams.get("workspace");
    if (requestedId) {
      if (!workspaceIdPattern.test(requestedId))
        return json({ error: "Invalid workspace." }, 400);
      const rows =
        await sql`SELECT data FROM ace_workspaces WHERE account_username = ${user.username} LIMIT 1`;
      if (!rows[0]?.data) return json({ error: "Workspace not found." }, 404);
      const collection = cleanWorkspaceCollection(rows[0].data, user);
      const index = collection.workspaces.findIndex((entry) => entry.id === requestedId);
      if (index < 0) return json({ error: "Workspace not found." }, 404);
      if (collection.workspaces.length === 1)
        return json({ error: "The last workspace cannot be deleted." }, 400);
      const [removed] = collection.workspaces.splice(index, 1);
      const current = workspaceEntry(collection, collection.activeWorkspaceId);
      const next = current ??
        collection.workspaces[Math.min(index, collection.workspaces.length - 1)];
      collection.activeWorkspaceId = next.id;
      await saveCollection(sql, user.username, collection, "workspace_deleted", {
        workspaceId: removed.id,
      });
      return json(collectionResponse(collection, next, { ok: true }));
    }
    await sql.transaction([
      sql`DELETE FROM ace_workspaces WHERE account_username = ${user.username}`,
      sql`DELETE FROM ace_audit_log WHERE account_username = ${user.username}`,
    ]);
    return json({ ok: true });
  } catch {
    return json({ error: "The workspace could not be deleted." }, 503);
  }
}

export async function POST(request) {
  if (!isSameOrigin(request))
    return json({ error: "Request origin was rejected." }, 403);
  const user = userFromRequest(request);
  if (!user) return json({ error: "Not signed in." }, 401);
  if (user.isDemo)
    return json({ error: "The shared demo workspace is read-only." }, 403);
  if (Number(request.headers.get("content-length") || 0) > 100_000)
    return json({ error: "Request is too large." }, 413);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const action = String(body?.action ?? "");
  if (!["create", "rename", "select"].includes(action))
    return json({ error: "Invalid workspace action." }, 400);
  const sql = database();
  if (!sql)
    return json({ error: "Database setup is still being completed." }, 503);
  try {
    await ensureSchema(sql);
    const rows =
      await sql`SELECT data FROM ace_workspaces WHERE account_username = ${user.username} LIMIT 1`;
    const now = new Date().toISOString();
    let collection = rows[0]?.data
      ? cleanWorkspaceCollection(rows[0].data, user, now)
      : null;
    if (action === "create") {
      const data = cleanWorkspace(body?.workspace);
      if (!collection) {
        collection = {
          schemaVersion: workspaceCollectionVersion,
          activeWorkspaceId: "primary",
          workspaces: [],
        };
      }
      if (collection.workspaces.length >= maximumWorkspaces)
        return json({ error: `An account can have up to ${maximumWorkspaces} workspaces.` }, 400);
      const id = `ws_${randomBytes(12).toString("hex")}`;
      const entry = {
        id,
        name: workspaceName(body?.name, "New workspace"),
        staffType: workspaceTypes.has(body?.staffType) ? body.staffType : "nurses",
        createdAt: now,
        updatedAt: now,
        data,
      };
      collection.workspaces.push(entry);
      collection.activeWorkspaceId = id;
      await saveCollection(sql, user.username, collection, "workspace_created", {
        workspaceId: id,
        staffType: entry.staffType,
      });
      return json(collectionResponse(collection, entry, { ok: true }), 201);
    }
    if (!collection) return json({ error: "Workspace not found." }, 404);
    const requestedId = String(body?.workspaceId ?? "");
    if (!workspaceIdPattern.test(requestedId))
      return json({ error: "Invalid workspace." }, 400);
    const entry = workspaceEntry(collection, requestedId);
    if (!entry) return json({ error: "Workspace not found." }, 404);
    if (action === "rename") {
      const name = String(body?.name ?? "").trim().replace(/\s+/g, " ");
      if (name.length < 2 || name.length > 60)
        return json({ error: "Workspace name must contain 2–60 characters." }, 400);
      entry.name = name;
      entry.updatedAt = now;
    } else {
      collection.activeWorkspaceId = entry.id;
    }
    await saveCollection(
      sql,
      user.username,
      collection,
      action === "rename" ? "workspace_renamed" : "workspace_selected",
      { workspaceId: entry.id },
    );
    const selected = workspaceEntry(collection, collection.activeWorkspaceId);
    return json(collectionResponse(collection, selected, { ok: true }));
  } catch {
    return json({ error: "The workspace action could not be completed." }, 503);
  }
}
