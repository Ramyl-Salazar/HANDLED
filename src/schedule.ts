export type ShiftCode = "morning" | "afternoon" | "night";
export type PreferenceLevel =
  | "preferred"
  | "available"
  | "avoid"
  | "unavailable"
  | "leave"
  | "sick"
  | "absent";

export interface Nurse {
  id: string;
  name: string;
  firstName?: string;
  surname?: string;
  initials: string;
  role: "Charge nurse" | "Staff nurse";
  targetShifts: number;
  dateHired?: string;
  employmentEndDate?: string;
}

export interface ScheduleDay {
  key: string;
  label: string;
  shortLabel: string;
  date: string;
  year?: number;
  isoDate?: string;
  weekend?: boolean;
}

export interface ShiftDefinition {
  code: ShiftCode;
  label: string;
  shortLabel: string;
  time: string;
  start: string;
  end: string;
  enabled: boolean;
}

export type PreferenceMap = Record<string, PreferenceLevel>;
export type AssignmentMap = Record<string, string[]>;
export type WorkRequest = { overtime: boolean; doubleShift: boolean };
export type WorkRequestMap = Record<string, WorkRequest>;

export interface Candidate {
  nurse: Nurse;
  preference: PreferenceLevel;
  assignedShifts: number;
  nightShifts: number;
  score: number;
  reasons: string[];
  overtime: boolean;
  doubleShift: boolean;
}

export interface SchedulingOptions {
  maximumShifts: number;
  requireChargeNurse: boolean;
  preventNightToMorning: boolean;
}

export const defaultSchedulingOptions: SchedulingOptions = {
  maximumShifts: 7,
  requireChargeNurse: true,
  preventNightToMorning: true,
};

export const days: ScheduleDay[] = [
  {
    key: "sun",
    label: "Sunday",
    shortLabel: "Sun",
    date: "Sep 6",
    weekend: true,
  },
  { key: "mon", label: "Monday", shortLabel: "Mon", date: "Sep 7" },
  { key: "tue", label: "Tuesday", shortLabel: "Tue", date: "Sep 8" },
  { key: "wed", label: "Wednesday", shortLabel: "Wed", date: "Sep 9" },
  { key: "thu", label: "Thursday", shortLabel: "Thu", date: "Sep 10" },
  { key: "fri", label: "Friday", shortLabel: "Fri", date: "Sep 11" },
  {
    key: "sat",
    label: "Saturday",
    shortLabel: "Sat",
    date: "Sep 12",
    weekend: true,
  },
];

export const shifts: ShiftDefinition[] = [
  {
    code: "morning",
    label: "Morning",
    shortLabel: "AM",
    time: "6:00 AM–2:00 PM",
    start: "06:00",
    end: "14:00",
    enabled: true,
  },
  {
    code: "afternoon",
    label: "Afternoon",
    shortLabel: "PM",
    time: "2:00 PM–10:00 PM",
    start: "14:00",
    end: "22:00",
    enabled: true,
  },
  {
    code: "night",
    label: "Night",
    shortLabel: "N",
    time: "10:00 PM–6:00 AM",
    start: "22:00",
    end: "06:00",
    enabled: true,
  },
];

const minutesFromClock = (clock: string) => {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
};

export function formatClock(clock: string): string {
  const total = minutesFromClock(clock);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

export function shiftTimeLabel(start: string, end: string): string {
  return `${formatClock(start)}–${formatClock(end)}`;
}

export function normalizeShiftDefinitions(
  value?: Partial<ShiftDefinition>[],
): ShiftDefinition[] {
  return shifts.map((fallback) => {
    const candidate = value?.find((item) => item.code === fallback.code);
    const start = /^([01]\d|2[0-3]):[0-5]\d$/.test(candidate?.start ?? "")
      ? candidate!.start!
      : fallback.start;
    const end = /^([01]\d|2[0-3]):[0-5]\d$/.test(candidate?.end ?? "")
      ? candidate!.end!
      : fallback.end;
    return {
      code: fallback.code,
      label: candidate?.label?.trim().slice(0, 24) || fallback.label,
      shortLabel:
        candidate?.shortLabel?.trim().slice(0, 4) || fallback.shortLabel,
      start,
      end,
      enabled: candidate?.enabled ?? fallback.enabled,
      time: shiftTimeLabel(start, end),
    };
  });
}

export function shiftDurationHours(shift: ShiftDefinition): number {
  const start = minutesFromClock(shift.start);
  const end = minutesFromClock(shift.end);
  const minutes = end > start ? end - start : 1440 - start + end;
  return minutes / 60;
}

export type CoverageGap = {
  start: string;
  end: string;
  minutes: number;
  label: string;
};

export function coverageGaps(
  shiftDefinitions: ShiftDefinition[],
): CoverageGap[] {
  const intervals = shiftDefinitions
    .filter((shift) => shift.enabled && shift.start !== shift.end)
    .flatMap((shift) => {
      const start = minutesFromClock(shift.start);
      const end = minutesFromClock(shift.end);
      return end > start
        ? [[start, end]]
        : [
            [start, 1440],
            [0, end],
          ];
    })
    .sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [];
  intervals.forEach(([start, end]) => {
    const previous = merged.at(-1);
    if (previous && start <= previous[1])
      previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  });
  const gaps: number[][] = [];
  let cursor = 0;
  merged.forEach(([start, end]) => {
    if (start > cursor) gaps.push([cursor, start]);
    cursor = Math.max(cursor, end);
  });
  if (cursor < 1440) gaps.push([cursor, 1440]);
  const asClock = (minutes: number) =>
    `${String(Math.floor((minutes % 1440) / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return gaps.map(([start, end]) => ({
    start: asClock(start),
    end: asClock(end),
    minutes: end - start,
    label: `${formatClock(asClock(start))}–${formatClock(asClock(end))}`,
  }));
}

export function areConsecutiveShifts(
  first: ShiftDefinition,
  second: ShiftDefinition,
): boolean {
  return first.end === second.start || second.end === first.start;
}

export function scheduledHours(
  assignments: AssignmentMap,
  nurseId: string,
  shiftDefinitions: ShiftDefinition[] = shifts,
): number {
  return Object.entries(assignments).reduce((total, [key, ids]) => {
    if (!ids.includes(nurseId)) return total;
    const code = key.slice(key.lastIndexOf("-") + 1) as ShiftCode;
    const shift = shiftDefinitions.find((item) => item.code === code);
    return total + (shift ? shiftDurationHours(shift) : 0);
  }, 0);
}

export const nurses: Nurse[] = [
  {
    id: "N-101",
    name: "Angela Cruz",
    initials: "AC",
    role: "Charge nurse",
    targetShifts: 5,
  },
  {
    id: "N-102",
    name: "Bianca Reyes",
    initials: "BR",
    role: "Staff nurse",
    targetShifts: 5,
  },
  {
    id: "N-103",
    name: "Carlo Mendoza",
    initials: "CM",
    role: "Staff nurse",
    targetShifts: 5,
  },
  {
    id: "N-104",
    name: "Dianne Santos",
    initials: "DS",
    role: "Charge nurse",
    targetShifts: 5,
  },
  {
    id: "N-105",
    name: "Elijah Flores",
    initials: "EF",
    role: "Staff nurse",
    targetShifts: 5,
  },
  {
    id: "N-106",
    name: "Fatima Garcia",
    initials: "FG",
    role: "Staff nurse",
    targetShifts: 5,
  },
  {
    id: "N-107",
    name: "Gabriel Navarro",
    initials: "GN",
    role: "Charge nurse",
    targetShifts: 5,
  },
  {
    id: "N-108",
    name: "Hazel Ramos",
    initials: "HR",
    role: "Staff nurse",
    targetShifts: 5,
  },
  {
    id: "N-109",
    name: "Ian Villanueva",
    initials: "IV",
    role: "Staff nurse",
    targetShifts: 5,
  },
  {
    id: "N-110",
    name: "Julia Aquino",
    initials: "JA",
    role: "Charge nurse",
    targetShifts: 5,
  },
  {
    id: "N-111",
    name: "Kevin Bautista",
    initials: "KB",
    role: "Staff nurse",
    targetShifts: 5,
  },
  {
    id: "N-112",
    name: "Lara Domingo",
    initials: "LD",
    role: "Staff nurse",
    targetShifts: 5,
  },
  {
    id: "N-113",
    name: "Miguel Salazar",
    initials: "MS",
    role: "Charge nurse",
    targetShifts: 5,
  },
  {
    id: "N-114",
    name: "Nina Torres",
    initials: "NT",
    role: "Staff nurse",
    targetShifts: 5,
  },
  {
    id: "N-115",
    name: "Paolo Lim",
    initials: "PL",
    role: "Staff nurse",
    targetShifts: 5,
  },
];

const demoHireDates = [
  "2016-04-11", "2018-07-23", "2019-01-14", "2017-09-05", "2020-02-17",
  "2020-08-03", "2018-11-19", "2021-03-08", "2021-10-25", "2019-06-10",
  "2022-01-31", "2022-07-18", "2023-02-06", "2023-09-11", "2024-05-20",
];

nurses.forEach((nurse, index) => {
  const parts = nurse.name.trim().split(/\s+/);
  nurse.firstName = parts.slice(0, -1).join(" ") || parts[0];
  nurse.surname = parts.at(-1) ?? "";
  nurse.dateHired = demoHireDates[index];
});

export function nurseFirstName(nurse: Nurse): string {
  return nurse.firstName?.trim() || nurse.name.trim().split(/\s+/).slice(0, -1).join(" ") || nurse.name.trim();
}

export function nurseSurname(nurse: Nurse): string {
  return nurse.surname?.trim() || nurse.name.trim().split(/\s+/).at(-1) || "";
}

export function nurseActiveOnDate(nurse: Nurse, isoDate?: string): boolean {
  if (!isoDate) return true;
  if (nurse.dateHired && isoDate < nurse.dateHired) return false;
  if (nurse.employmentEndDate && isoDate > nurse.employmentEndDate) return false;
  return true;
}

export const preferenceLabels: Record<PreferenceLevel, string> = {
  preferred: "Preferred",
  available: "Available",
  avoid: "Prefer not",
  unavailable: "Unavailable",
  leave: "On leave",
  sick: "Sick",
  absent: "Absent",
};

export const shiftKey = (dayKey: string, shiftCode: ShiftCode) =>
  `${dayKey}-${shiftCode}`;
export const preferenceKey = (
  nurseId: string,
  dayKey: string,
  shiftCode: ShiftCode,
) => `${nurseId}-${dayKey}-${shiftCode}`;

export function replaceNurseAssignment(
  assignments: AssignmentMap,
  nurseId: string,
  dayKey: string,
  shiftCodes: ShiftCode | ShiftCode[] | null,
  shiftDefinitions: ShiftDefinition[] = shifts,
): AssignmentMap {
  const next = Object.fromEntries(
    Object.entries(assignments).map(([key, nurseIds]) => [key, [...nurseIds]]),
  );

  shiftDefinitions.forEach((shift) => {
    const key = shiftKey(dayKey, shift.code);
    next[key] = (next[key] ?? []).filter((id) => id !== nurseId);
  });

  const selected = shiftCodes
    ? Array.isArray(shiftCodes)
      ? shiftCodes
      : [shiftCodes]
    : [];
  selected.forEach((shiftCode) => {
    const key = shiftKey(dayKey, shiftCode);
    next[key] = [...new Set([...(next[key] ?? []), nurseId])];
  });

  return next;
}

export function copyPreferencesForRoster(
  source: PreferenceMap,
  nurseList: Nurse[],
  shiftDefinitions: ShiftDefinition[] = shifts,
): PreferenceMap {
  const copied: PreferenceMap = {};
  nurseList.forEach((nurse) =>
    days.forEach((day) =>
      shiftDefinitions
        .filter((shift) => shift.enabled)
        .forEach((shift) => {
          const key = preferenceKey(nurse.id, day.key, shift.code);
          if (source[key]) copied[key] = source[key];
        }),
    ),
  );
  return copied;
}

export function nextNurseId(nurseList: Nurse[]): string {
  const usedIds = new Set(nurseList.map((nurse) => nurse.id.toUpperCase()));
  const numericIds = nurseList
    .map((nurse) => /^N-(\d+)$/.exec(nurse.id.toUpperCase()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => Number(match[1]))
    .filter(Number.isSafeInteger);
  let nextNumber = Math.max(100, ...numericIds) + 1;
  let nextId = `N-${String(nextNumber).padStart(3, "0")}`;
  while (usedIds.has(nextId)) {
    nextNumber += 1;
    nextId = `N-${String(nextNumber).padStart(3, "0")}`;
  }
  return nextId;
}

export const requirements: Record<string, number> = Object.fromEntries(
  days.flatMap((day) =>
    shifts.map((shift) => [
      shiftKey(day.key, shift.code),
      day.key === "wed" && shift.code === "night" ? 4 : 3,
    ]),
  ),
);

const teams = [
  ["N-101", "N-102", "N-103"],
  ["N-104", "N-105", "N-106"],
  ["N-107", "N-108", "N-109"],
  ["N-110", "N-111", "N-112"],
  ["N-113", "N-114", "N-115"],
];
const schedulingDayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function createSeedPreferences(
  nurseList: Nurse[] = nurses,
): PreferenceMap {
  const result: PreferenceMap = {};
  nurseList.forEach((nurse, nurseIndex) => {
    days.forEach((day) => {
      const dayIndex = schedulingDayKeys.indexOf(day.key);
      shifts.forEach((shift, shiftIndex) => {
        const value: PreferenceLevel =
          (nurseIndex + dayIndex + shiftIndex) % 11 === 0
            ? "avoid"
            : "available";
        result[preferenceKey(nurse.id, day.key, shift.code)] = value;
      });
    });
  });

  days.forEach((day) => {
    const dayIndex = schedulingDayKeys.indexOf(day.key);
    shifts.forEach((shift, shiftIndex) => {
      const team = teams[(dayIndex * 3 + shiftIndex) % teams.length];
      team.forEach((nurseId) => {
        if (nurseList.some((nurse) => nurse.id === nurseId))
          result[preferenceKey(nurseId, day.key, shift.code)] = "preferred";
      });
    });
  });

  if (nurseList.some((nurse) => nurse.id === "N-108"))
    result[preferenceKey("N-108", "thu", "morning")] = "unavailable";
  if (nurseList.some((nurse) => nurse.id === "N-105"))
    result[preferenceKey("N-105", "fri", "night")] = "unavailable";
  if (nurseList.some((nurse) => nurse.id === "N-102"))
    result[preferenceKey("N-102", "sun", "afternoon")] = "unavailable";
  return result;
}

export function countAssignments(
  assignments: AssignmentMap,
  nurseId: string,
): number {
  return Object.values(assignments).filter((ids) => ids.includes(nurseId))
    .length;
}

function countNightAssignments(
  assignments: AssignmentMap,
  nurseId: string,
): number {
  return Object.entries(assignments).filter(
    ([key, ids]) => key.endsWith("-night") && ids.includes(nurseId),
  ).length;
}

export function buildDraft(
  preferences: PreferenceMap,
  nurseList: Nurse[] = nurses,
  requirementMap: Record<string, number> = requirements,
  options: SchedulingOptions = defaultSchedulingOptions,
  chargeRequirementMap: Record<string, number> = {},
  workRequests: WorkRequestMap = {},
  shiftDefinitions: ShiftDefinition[] = shifts,
): AssignmentMap {
  const assignments: AssignmentMap = {};
  const loads = new Map(nurseList.map((nurse) => [nurse.id, 0]));

  schedulingDayKeys
    .map((dayKey) => days.find((day) => day.key === dayKey)!)
    .forEach((day) => {
      shiftDefinitions
        .filter((shift) => shift.enabled)
        .forEach((shift) => {
          const key = shiftKey(day.key, shift.code);
          const required = requirementMap[key] ?? 0;
          const eligiblePreferred = nurseList
            .filter(
              (nurse) =>
                preferences[preferenceKey(nurse.id, day.key, shift.code)] ===
                "preferred",
            )
            .filter((nurse) =>
              canTakeShift(
                assignments,
                nurse,
                day.key,
                shift.code,
                options,
                workRequests,
                shiftDefinitions,
              ),
            )
            .filter(
              (nurse) =>
                !options.preventNightToMorning ||
                !hasNightToMorningConflict(
                  assignments,
                  nurse.id,
                  day.key,
                  shift.code,
                ),
            )
            .sort((a, b) => {
              if (a.role !== b.role) return a.role === "Charge nurse" ? -1 : 1;
              return (loads.get(a.id) ?? 0) - (loads.get(b.id) ?? 0);
            });
          const selected = eligiblePreferred.slice(0, required);
          const requiredChargeNurses = Math.min(
            required,
            chargeRequirementMap[key] ?? (options.requireChargeNurse ? 1 : 0),
          );
          let selectedChargeNurses = selected.filter(
            (nurse) => nurse.role === "Charge nurse",
          ).length;
          const unusedChargeNurses = eligiblePreferred.filter(
            (nurse) =>
              nurse.role === "Charge nurse" &&
              !selected.some((selectedNurse) => selectedNurse.id === nurse.id),
          );
          while (
            selectedChargeNurses < requiredChargeNurses &&
            unusedChargeNurses.length
          ) {
            const replaceIndex = selected
              .map((nurse) => nurse.role !== "Charge nurse")
              .lastIndexOf(true);
            if (replaceIndex < 0) break;
            selected[replaceIndex] = unusedChargeNurses.shift()!;
            selectedChargeNurses += 1;
          }
          assignments[key] = selected.map((nurse) => nurse.id);
          selected.forEach((nurse) =>
            loads.set(nurse.id, (loads.get(nurse.id) ?? 0) + 1),
          );
        });
    });

  return assignments;
}

export function assignedShiftsOnDay(
  assignments: AssignmentMap,
  nurseId: string,
  dayKey: string,
  shiftDefinitions: ShiftDefinition[] = shifts,
): ShiftDefinition[] {
  return shiftDefinitions.filter((shift) =>
    assignments[shiftKey(dayKey, shift.code)]?.includes(nurseId),
  );
}

export function canTakeShift(
  assignments: AssignmentMap,
  nurse: Nurse,
  dayKey: string,
  shiftCode: ShiftCode,
  options: SchedulingOptions = defaultSchedulingOptions,
  workRequests: WorkRequestMap = {},
  shiftDefinitions: ShiftDefinition[] = shifts,
): boolean {
  const requested = workRequests[nurse.id] ?? {
    overtime: false,
    doubleShift: false,
  };
  const weeklyLoad = countAssignments(assignments, nurse.id);
  if (weeklyLoad >= options.maximumShifts) return false;
  if (weeklyLoad >= nurse.targetShifts && !requested.overtime) return false;
  const sameDay = assignedShiftsOnDay(
    assignments,
    nurse.id,
    dayKey,
    shiftDefinitions,
  );
  if (!sameDay.length) return true;
  if (!requested.doubleShift || sameDay.length >= 2) return false;
  const selected = shiftDefinitions.find((shift) => shift.code === shiftCode);
  return Boolean(
    selected &&
    sameDay.every((existing) => areConsecutiveShifts(existing, selected)),
  );
}

function hasNightToMorningConflict(
  assignments: AssignmentMap,
  nurseId: string,
  dayKey: string,
  shiftCode: ShiftCode,
): boolean {
  if (shiftCode !== "morning") return false;
  const dayIndex = days.findIndex((day) => day.key === dayKey);
  if (dayIndex <= 0) return false;
  return (
    assignments[shiftKey(days[dayIndex - 1].key, "night")]?.includes(nurseId) ??
    false
  );
}

export function getCandidates(
  assignments: AssignmentMap,
  preferences: PreferenceMap,
  dayKey: string,
  shiftCode: ShiftCode,
  nurseList: Nurse[] = nurses,
  options: SchedulingOptions = defaultSchedulingOptions,
  workRequests: WorkRequestMap = {},
  shiftDefinitions: ShiftDefinition[] = shifts,
): Candidate[] {
  return nurseList
    .filter(
      (nurse) =>
        !["unavailable", "leave", "sick", "absent"].includes(
          preferences[preferenceKey(nurse.id, dayKey, shiftCode)],
        ),
    )
    .filter((nurse) =>
      canTakeShift(
        assignments,
        nurse,
        dayKey,
        shiftCode,
        options,
        workRequests,
        shiftDefinitions,
      ),
    )
    .filter(
      (nurse) =>
        !options.preventNightToMorning ||
        !hasNightToMorningConflict(assignments, nurse.id, dayKey, shiftCode),
    )
    .map((nurse) => {
      const preference =
        preferences[preferenceKey(nurse.id, dayKey, shiftCode)];
      const assignedShifts = countAssignments(assignments, nurse.id);
      const nightShifts = countNightAssignments(assignments, nurse.id);
      const overtime = assignedShifts >= nurse.targetShifts;
      const doubleShift =
        assignedShiftsOnDay(assignments, nurse.id, dayKey, shiftDefinitions)
          .length > 0;
      const preferenceScore =
        preference === "preferred" ? 40 : preference === "available" ? 24 : 4;
      const score =
        preferenceScore +
        Math.max(0, 20 - assignedShifts * 3) +
        (nurse.role === "Charge nurse" ? 3 : 0);
      const reasons = [
        preferenceLabels[preference],
        `${scheduledHours(assignments, nurse.id, shiftDefinitions)} scheduled hours`,
        doubleShift
          ? "Open to a consecutive double shift"
          : shiftCode === "night"
            ? `${nightShifts} night shift${nightShifts === 1 ? "" : "s"} this week`
            : "No same-day assignment",
        ...(overtime ? ["Open to overtime this week"] : []),
      ];
      return {
        nurse,
        preference,
        assignedShifts,
        nightShifts,
        score,
        reasons,
        overtime,
        doubleShift,
      };
    })
    .sort(
      (a, b) => b.score - a.score || a.nurse.name.localeCompare(b.nurse.name),
    );
}

export function completedShiftCount(
  assignments: AssignmentMap,
  requirementMap: Record<string, number> = requirements,
): number {
  return Object.entries(requirementMap).filter(
    ([key, required]) => (assignments[key]?.length ?? 0) >= required,
  ).length;
}

export function preferenceSatisfaction(
  assignments: AssignmentMap,
  preferences: PreferenceMap,
): number {
  const assigned = Object.entries(assignments).flatMap(([key, nurseIds]) => {
    const separator = key.lastIndexOf("-");
    const dayKey = key.slice(0, separator);
    const shiftCode = key.slice(separator + 1) as ShiftCode;
    return nurseIds.map(
      (nurseId) => preferences[preferenceKey(nurseId, dayKey, shiftCode)],
    );
  });
  if (!assigned.length) return 0;
  return Math.round(
    (assigned.filter((value) => value === "preferred").length /
      assigned.length) *
      100,
  );
}

export function createCsvTemplate(
  preferences: PreferenceMap = createSeedPreferences(),
): string {
  const headers = [
    "Nurse ID",
    "Nurse name",
    ...days.flatMap((day) =>
      shifts.map((shift) => `${day.label} ${shift.label}`),
    ),
  ];
  const rows = nurses.map((nurse) => [
    nurse.id,
    nurse.name,
    ...days.flatMap((day) =>
      shifts.map(
        (shift) =>
          preferenceLabels[
            preferences[preferenceKey(nurse.id, day.key, shift.code)]
          ],
      ),
    ),
  ]);
  return [headers, ...rows]
    .map((row) =>
      row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","),
    )
    .join("\n");
}
