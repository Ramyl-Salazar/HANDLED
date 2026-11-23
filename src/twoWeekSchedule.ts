import {
  nurseActiveOnDate,
  shifts,
  type AssignmentMap,
  type Nurse,
  type PreferenceMap,
  type ScheduleDay,
  type ShiftCode,
  type ShiftDefinition,
} from "./schedule";

export type DutyCode =
  | ShiftCode
  | "rest"
  | "birthday_leave"
  | "personal_leave"
  | "training"
  | "leave";
export type RequestStatus = "requested" | "mandatory";
export type ScheduleRequest = {
  choice: DutyCode;
  status: RequestStatus;
};
export type ScheduleRequestMap = Record<string, ScheduleRequest>;

export type ScheduleIssue = {
  id: string;
  severity: "warning" | "error";
  title: string;
  detail: string;
  nurseId?: string;
  dayKey?: string;
};

export type DraftResult = {
  assignments: AssignmentMap;
  issues: ScheduleIssue[];
};

export type RequestFairnessRecord = {
  granted: number;
  denied: number;
  grantedByChoice: Partial<Record<DutyCode, number>>;
  deniedByChoice: Partial<Record<DutyCode, number>>;
};

export type RequestFairnessHistory = Record<string, RequestFairnessRecord>;

export type RequestOutcome = {
  status: "pending" | "granted" | "unmet";
  label: string;
  reason: string;
};

export type HistoricalRequestPeriod = {
  requests?: ScheduleRequestMap;
  assignments: AssignmentMap;
};

export type TwoWeekRules = {
  restDaysPerWeek: number;
  maxRestPerDay: number;
  maxDailyShiftDifference: number;
  maxIndividualShiftDifference: number;
  preventNightToMorning: boolean;
  preventAfternoonRestMorning: boolean;
  maxConsecutiveHours: number;
  minHoursPerPeriod: number;
  maxHoursPerPeriod: number;
};

export type DailyCoverage = Record<
  string,
  Record<ShiftCode, number>
>;

export type OvertimeCoverage = {
  id: string;
  dayKey: string;
  shiftCode: ShiftCode;
  nurseIds: [string, string];
  hoursEach: 4;
  createdAt: string;
};

export type OvertimeDutyWindow = {
  nurseId: string;
  regularShift: ShiftCode;
  coveredShift: ShiftCode;
  start: string;
  end: string;
  regularHours: number;
  overtimeHours: 4;
  totalHours: number;
};

const overtimeAdjacentShifts: Record<ShiftCode, [ShiftCode, ShiftCode]> = {
  morning: ["night", "afternoon"],
  afternoon: ["morning", "night"],
  night: ["afternoon", "morning"],
};

function clockMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesClock(value: number): string {
  const normalized = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function shiftHours(shift: ShiftDefinition): number {
  const start = clockMinutes(shift.start);
  let end = clockMinutes(shift.end);
  if (end <= start) end += 1440;
  return (end - start) / 60;
}

export function overtimeDutyWindow(
  coverage: OvertimeCoverage,
  nurseId: string,
  shiftDefinitions: ShiftDefinition[] = shifts,
): OvertimeDutyWindow | null {
  const nurseIndex = coverage.nurseIds.indexOf(nurseId);
  if (nurseIndex < 0) return null;
  const [beforeShift, afterShift] = overtimeAdjacentShifts[coverage.shiftCode];
  const regularShift = nurseIndex === 0 ? beforeShift : afterShift;
  const regular = shiftDefinitions.find((shift) => shift.code === regularShift);
  const missing = shiftDefinitions.find(
    (shift) => shift.code === coverage.shiftCode,
  );
  if (!regular || !missing) return null;
  const handoff = minutesClock(clockMinutes(missing.start) + 4 * 60);
  const regularHours = shiftHours(regular);
  return {
    nurseId,
    regularShift,
    coveredShift: coverage.shiftCode,
    start: nurseIndex === 0 ? regular.start : handoff,
    end: nurseIndex === 0 ? handoff : regular.end,
    regularHours,
    overtimeHours: 4,
    totalHours: regularHours + 4,
  };
}

export const defaultTwoWeekRules: TwoWeekRules = {
  restDaysPerWeek: 2,
  maxRestPerDay: 7,
  maxDailyShiftDifference: 1,
  maxIndividualShiftDifference: 1,
  preventNightToMorning: true,
  preventAfternoonRestMorning: true,
  maxConsecutiveHours: 12,
  minHoursPerPeriod: 80,
  maxHoursPerPeriod: 112,
};

export function createDailyCoverage(
  morning = 4,
  afternoon = 4,
  night = 4,
): DailyCoverage {
  return Object.fromEntries(
    planningDays.map((day) => [
      day.key,
      { morning, afternoon, night },
    ]),
  );
}

export function requirementMapFromDailyCoverage(
  coverage: DailyCoverage,
): Record<string, number> {
  return Object.fromEntries(
    planningDays.flatMap((day) =>
      (["morning", "afternoon", "night"] as ShiftCode[]).map((shift) => [
        dutyKey(day.key, shift),
        coverage[day.key]?.[shift] ?? 0,
      ]),
    ),
  );
}

export function overtimeHistoryHours(
  periods: Array<{ overtimeCoverage?: OvertimeCoverage[] }>,
): Record<string, number> {
  const result: Record<string, number> = {};
  periods.forEach((period) =>
    (period.overtimeCoverage ?? []).forEach((coverage) =>
      coverage.nurseIds.forEach((nurseId) => {
        result[nurseId] = (result[nurseId] ?? 0) + coverage.hoursEach;
      }),
    ),
  );
  return result;
}

export function overtimePositionsCovered(
  overtime: OvertimeCoverage[],
  dayKey: string,
  shiftCode: ShiftCode,
): number {
  return overtime.filter(
    (entry) => entry.dayKey === dayKey && entry.shiftCode === shiftCode,
  ).length;
}

export function recommendForcedOvertime(
  assignments: AssignmentMap,
  nurseList: Nurse[],
  dayKey: string,
  shiftCode: ShiftCode,
  positions: number,
  existing: OvertimeCoverage[] = [],
  historicalHours: Record<string, number> = {},
  shiftDefinitions: ShiftDefinition[] = shifts,
): OvertimeCoverage[] {
  const [beforeShift, afterShift] = overtimeAdjacentShifts[shiftCode];
  const beforeDefinition = shiftDefinitions.find(
    (shift) => shift.code === beforeShift && shift.enabled,
  );
  const afterDefinition = shiftDefinitions.find(
    (shift) => shift.code === afterShift && shift.enabled,
  );
  const missingDefinition = shiftDefinitions.find(
    (shift) => shift.code === shiftCode && shift.enabled,
  );
  if (
    !beforeDefinition ||
    !afterDefinition ||
    !missingDefinition ||
    shiftHours(beforeDefinition) + 4 > 12 ||
    shiftHours(afterDefinition) + 4 > 12
  )
    return [];
  const usedToday = new Set(
    existing
      .filter((entry) => entry.dayKey === dayKey)
      .flatMap((entry) => entry.nurseIds),
  );
  const currentHours = { ...historicalHours };
  existing.forEach((entry) =>
    entry.nurseIds.forEach((nurseId) => {
      currentHours[nurseId] = (currentHours[nurseId] ?? 0) + entry.hoursEach;
    }),
  );
  const rank = (firstId: string, secondId: string) => {
    const hourDifference =
      (currentHours[firstId] ?? 0) - (currentHours[secondId] ?? 0);
    if (hourDifference) return hourDifference;
    const first = nurseList.find((nurse) => nurse.id === firstId);
    const second = nurseList.find((nurse) => nurse.id === secondId);
    const hireDifference = (second?.dateHired ?? "0000-00-00").localeCompare(
      first?.dateHired ?? "0000-00-00",
    );
    if (hireDifference) return hireDifference;
    return firstId.localeCompare(secondId);
  };
  const candidates = (shift: ShiftCode) =>
    [...(assignments[dutyKey(dayKey, shift)] ?? [])]
      .filter((id) => !usedToday.has(id))
      .sort(rank);
  const result: OvertimeCoverage[] = [];
  for (let index = 0; index < positions; index += 1) {
    const before = candidates(beforeShift)[0];
    const after = candidates(afterShift)[0];
    if (!before || !after || before === after) break;
    const entry: OvertimeCoverage = {
      id: `${dayKey}-${shiftCode}-${before}-${after}-${existing.length + index}`,
      dayKey,
      shiftCode,
      nurseIds: [before, after],
      hoursEach: 4,
      createdAt: new Date().toISOString(),
    };
    result.push(entry);
    usedToday.add(before);
    usedToday.add(after);
    currentHours[before] = (currentHours[before] ?? 0) + 4;
    currentHours[after] = (currentHours[after] ?? 0) + 4;
  }
  return result;
}

export const officialShifts = shifts.map((shift) => ({
  ...shift,
  label:
    shift.code === "morning"
      ? "6 Morning"
      : shift.code === "afternoon"
        ? "2 Afternoon"
        : "N Night",
  shortLabel:
    shift.code === "morning" ? "6" : shift.code === "afternoon" ? "2" : "N",
  start:
    shift.code === "morning"
      ? "06:00"
      : shift.code === "afternoon"
        ? "14:00"
        : "22:00",
  end:
    shift.code === "morning"
      ? "14:00"
      : shift.code === "afternoon"
        ? "22:00"
        : "06:00",
  time:
    shift.code === "morning"
      ? "6:00 AM–2:00 PM"
      : shift.code === "afternoon"
        ? "2:00 PM–10:00 PM"
        : "10:00 PM–6:00 AM",
  enabled: true,
}));

const weekdayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const scheduleAnchorUtc = Date.UTC(2026, 8, 13);
const millisecondsPerDay = 24 * 60 * 60 * 1000;

export const planningDays: ScheduleDay[] = Array.from(
  { length: 14 },
  (_, index) => {
    const date = new Date(scheduleAnchorUtc + index * millisecondsPerDay);
    const weekdayIndex = date.getUTCDay();
    return {
      key: `d${index}`,
      label: weekdayNames[weekdayIndex],
      shortLabel: weekdayNames[weekdayIndex].slice(0, 3),
      date: "",
      weekend: weekdayIndex === 0 || weekdayIndex === 6,
    };
  },
);

export const requestKey = (nurseId: string, dayKey: string) =>
  `${nurseId}-${dayKey}`;

export const dutyKey = (dayKey: string, duty: DutyCode) =>
  `${dayKey}-${duty}`;

export const dutyLabels: Record<DutyCode, string> = {
  morning: "6 Morning",
  afternoon: "2 Afternoon",
  night: "N Night",
  rest: "REST",
  birthday_leave: "Birthday Leave",
  personal_leave: "Personal Leave",
  training: "Training",
  leave: "Personal Leave",
};

export const dutyShortLabels: Record<DutyCode, string> = {
  morning: "6",
  afternoon: "2",
  night: "N",
  rest: "REST",
  birthday_leave: "BDAY LEAVE",
  personal_leave: "PERSONAL LEAVE",
  training: "TRAINING",
  leave: "PERSONAL LEAVE",
};

export const dutyCodes: DutyCode[] = [
  "morning",
  "afternoon",
  "night",
  "rest",
  "birthday_leave",
  "personal_leave",
  "training",
  "leave",
];

export const leaveDutyCodes: DutyCode[] = [
  "birthday_leave",
  "personal_leave",
  "leave",
];

export function isLeaveDuty(duty: DutyCode | null | undefined): boolean {
  return Boolean(duty && leaveDutyCodes.includes(duty));
}

export function datesForPeriod(offset: number): ScheduleDay[] {
  return planningDays.map((day, index) => {
    const date = new Date(
      scheduleAnchorUtc + (offset * 14 + index) * millisecondsPerDay,
    );
    const weekdayIndex = date.getUTCDay();
    return {
      ...day,
      label: weekdayNames[weekdayIndex],
      shortLabel: weekdayNames[weekdayIndex].slice(0, 3),
      weekend: weekdayIndex === 0 || weekdayIndex === 6,
      isoDate: date.toISOString().slice(0, 10),
      date: date.toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
      }),
      year: date.getUTCFullYear(),
    };
  });
}

export function periodRangeLabel(periodDays: ScheduleDay[]): string {
  const first = periodDays[0];
  const last = periodDays.at(-1);
  if (!first || !last) return "Two-week schedule";
  return first.year === last.year
    ? `${first.date}–${last.date}, ${first.year}`
    : `${first.date}, ${first.year}–${last.date}, ${last.year}`;
}

function exactDateLabel(dayKey: string, periodDays: ScheduleDay[]): string {
  const day = periodDays.find((item) => item.key === dayKey);
  if (!day) return dayKey;
  return [day.label, day.date, day.year].filter(Boolean).join(", ");
}

export function assignedDutyOnDay(
  assignments: AssignmentMap,
  nurseId: string,
  dayKey: string,
): DutyCode | null {
  return dutyCodes.find((duty) => assignments[dutyKey(dayKey, duty)]?.includes(nurseId)) ?? null;
}

export function replaceNurseDuty(
  assignments: AssignmentMap,
  nurseId: string,
  dayKey: string,
  duty: DutyCode | null,
): AssignmentMap {
  const next = Object.fromEntries(
    Object.entries(assignments).map(([key, ids]) => [key, [...ids]]),
  );
  dutyCodes.forEach(
    (code) => {
      const key = dutyKey(dayKey, code);
      next[key] = (next[key] ?? []).filter((id) => id !== nurseId);
    },
  );
  if (duty) {
    const key = dutyKey(dayKey, duty);
    next[key] = [...new Set([...(next[key] ?? []), nurseId])];
  }
  return next;
}

export function countRequestsForNurse(
  requests: ScheduleRequestMap,
  nurseId: string,
): number {
  return planningDays.filter((day) => requests[requestKey(nurseId, day.key)])
    .length;
}

export function copyRequestsForRoster(
  source: ScheduleRequestMap,
  nurseList: Nurse[],
): ScheduleRequestMap {
  const copied: ScheduleRequestMap = {};
  nurseList.forEach((nurse) =>
    planningDays.forEach((day) => {
      const key = requestKey(nurse.id, day.key);
      if (source[key]) copied[key] = { ...source[key] };
    }),
  );
  return copied;
}

export function buildRequestFairnessHistory(
  periods: HistoricalRequestPeriod[],
): RequestFairnessHistory {
  const history: RequestFairnessHistory = {};
  periods.forEach((period) => {
    if (!Object.values(period.assignments).some((ids) => ids.length)) return;
    Object.entries(period.requests ?? {}).forEach(([key, request]) => {
      if (request.status === "mandatory") return;
      const separator = key.lastIndexOf("-");
      const nurseId = key.slice(0, separator);
      const dayKey = key.slice(separator + 1);
      const granted = Boolean(
        period.assignments[dutyKey(dayKey, request.choice)]?.includes(nurseId),
      );
      const record = history[nurseId] ?? {
        granted: 0,
        denied: 0,
        grantedByChoice: {},
        deniedByChoice: {},
      };
      const bucket = granted ? record.grantedByChoice : record.deniedByChoice;
      bucket[request.choice] = (bucket[request.choice] ?? 0) + 1;
      if (granted) record.granted += 1;
      else record.denied += 1;
      history[nurseId] = record;
    });
  });
  return history;
}

export function createSeedRequests(
  nurseList: Nurse[],
): ScheduleRequestMap {
  const result: ScheduleRequestMap = {};
  nurseList.forEach((nurse, index) => {
    const preferredDay = (index * 3 + 1) % 14;
    const restDay = (index * 2 + 5) % 14;
    result[requestKey(nurse.id, `d${preferredDay}`)] = {
      choice: (["morning", "afternoon", "night"] as ShiftCode[])[index % 3],
      status: "requested",
    };
    result[requestKey(nurse.id, `d${restDay}`)] = {
      choice: "rest",
      status: "requested",
    };
  });
  if (nurseList[2]) {
    result[requestKey(nurseList[2].id, "d10")] = {
      choice: "personal_leave",
      status: "mandatory",
    };
  }
  return result;
}

export function legacyPreferencesFromRequests(
  requests: ScheduleRequestMap,
  nurseList: Nurse[],
): PreferenceMap {
  const preferences: PreferenceMap = {};
  nurseList.forEach((nurse) =>
    planningDays.forEach((day) => {
      const request = requests[requestKey(nurse.id, day.key)];
      officialShifts.forEach((shift) => {
        const key = `${nurse.id}-${day.key}-${shift.code}`;
        preferences[key] =
          isLeaveDuty(request?.choice)
            ? "leave"
            : request?.choice === "rest"
              ? "unavailable"
              : request?.choice === shift.code
                ? "preferred"
                : "available";
      });
    }),
  );
  return preferences;
}

function addAssignment(
  assignments: AssignmentMap,
  dayKey: string,
  duty: DutyCode,
  nurseId: string,
) {
  const key = dutyKey(dayKey, duty);
  assignments[key] = [...(assignments[key] ?? []), nurseId];
}

export function transitionAllowed(
  previous: DutyCode | null,
  beforePrevious: DutyCode | null,
  next: ShiftCode,
  _rules: TwoWeekRules = defaultTwoWeekRules,
): boolean {
  // These recovery rules are safety constraints and cannot be disabled.
  if (previous === "training" || isLeaveDuty(previous)) return true;
  if (previous === "night") return next === "night";
  if (previous === "afternoon" && next === "morning") return false;
  if (
    previous === "rest" &&
    (beforePrevious === "afternoon" || beforePrevious === "night") &&
    next === "morning"
  ) return false;
  return true;
}

function requestFor(
  requests: ScheduleRequestMap,
  nurseId: string,
  dayKey: string,
) {
  return requests[requestKey(nurseId, dayKey)];
}

function rotatingRank(
  nurseId: string,
  orderedNurseIds: string[],
  rotationOffset: number,
) {
  if (!orderedNurseIds.length) return 0;
  const index = Math.max(0, orderedNurseIds.indexOf(nurseId));
  const start =
    ((rotationOffset % orderedNurseIds.length) + orderedNurseIds.length) %
    orderedNurseIds.length;
  return (index - start + orderedNurseIds.length) % orderedNurseIds.length;
}

function fairnessChoiceDebt(
  history: RequestFairnessHistory,
  nurseId: string,
  choice: DutyCode | null,
) {
  if (!choice) return 0;
  const record = history[nurseId];
  return (
    (record?.deniedByChoice[choice] ?? 0) -
    (record?.grantedByChoice[choice] ?? 0)
  );
}

function compareFairness(
  firstId: string,
  secondId: string,
  firstChoice: DutyCode | null,
  secondChoice: DutyCode | null,
  fulfilled: Map<string, number>,
  history: RequestFairnessHistory,
  orderedNurseIds: string[],
  rotationOffset: number,
) {
  const currentDifference =
    (fulfilled.get(firstId) ?? 0) - (fulfilled.get(secondId) ?? 0);
  if (currentDifference) return currentDifference;
  const choiceDebtDifference =
    fairnessChoiceDebt(history, secondId, secondChoice) -
    fairnessChoiceDebt(history, firstId, firstChoice);
  if (choiceDebtDifference) return choiceDebtDifference;
  const firstHistory = history[firstId];
  const secondHistory = history[secondId];
  const firstDebt =
    (firstHistory?.denied ?? 0) - (firstHistory?.granted ?? 0);
  const secondDebt =
    (secondHistory?.denied ?? 0) - (secondHistory?.granted ?? 0);
  if (firstDebt !== secondDebt) return secondDebt - firstDebt;
  const historicalGrantDifference =
    (firstHistory?.granted ?? 0) - (secondHistory?.granted ?? 0);
  if (historicalGrantDifference) return historicalGrantDifference;
  return (
    rotatingRank(firstId, orderedNurseIds, rotationOffset) -
    rotatingRank(secondId, orderedNurseIds, rotationOffset)
  );
}

export function explainRequestOutcome(
  assignments: AssignmentMap,
  requests: ScheduleRequestMap,
  nurseList: Nurse[],
  nurseId: string,
  dayKey: string,
): RequestOutcome | null {
  const request = requestFor(requests, nurseId, dayKey);
  if (!request) return null;
  if (!Object.values(assignments).some((ids) => ids.length))
    return {
      status: "pending",
      label: "Not evaluated",
      reason: "Generate the two-week draft to evaluate this request.",
    };
  const assignedDuties = dutyCodes.filter((duty) =>
    assignments[dutyKey(dayKey, duty)]?.includes(nurseId),
  );
  if (assignedDuties.includes(request.choice)) {
    if (request.status === "mandatory")
      return {
        status: "granted",
        label: request.choice === "training" ? "Training protected" : "Leave protected",
        reason: request.choice === "training"
          ? "Training is placed before REST and working shifts."
          : "Mandatory leave is protected before REST and shift preferences.",
      };
    const contenders = nurseList.filter(
      (nurse) => requestFor(requests, nurse.id, dayKey)?.choice === request.choice,
    );
    const grantedContenders = contenders.filter((nurse) =>
      assignments[dutyKey(dayKey, request.choice)]?.includes(nurse.id),
    ).length;
    return {
      status: "granted",
      label: "Granted",
      reason:
        contenders.length > grantedContenders
          ? `Granted among ${contenders.length} competing ${dutyLabels[request.choice]} requests using current-period fulfillment, prior denials, and rotating priority.`
          : "The generated schedule matches this preference.",
    };
  }
  const nurse = nurseList.find((item) => item.id === nurseId);
  const assignedLabel = assignedDuties.length
    ? assignedDuties.map((duty) => dutyLabels[duty]).join(" and ")
    : "no assignment";
  if (request.status === "mandatory")
    return {
      status: "unmet",
      label: "Mandatory conflict",
      reason: `${nurse?.name ?? nurseId} was assigned ${assignedLabel}; the mandatory non-working entry must be restored before publishing.`,
    };
  if (request.choice === "rest") {
    const restTotal = assignments[dutyKey(dayKey, "rest")]?.length ?? 0;
    const weekIndex = Math.max(0, Math.floor(Number(dayKey.slice(1)) / 7));
    const weeklyRestTotal = planningDays
      .slice(weekIndex * 7, weekIndex * 7 + 7)
      .filter((day) =>
        assignments[dutyKey(day.key, "rest")]?.includes(nurseId),
      ).length;
    return {
      status: "unmet",
      label: "REST not granted",
      reason:
        restTotal >= 7
          ? `The seven-nurse REST limit was reached. HANDLED prioritized nurses with fewer granted requests, then prior denials, then the rotating tie-breaker.`
          : weeklyRestTotal >= 2
            ? `Two REST days were assigned on other dates to distribute coverage and preferences fairly.`
            : `REST could not be placed without breaking a staffing or weekly REST rule.`,
    };
  }
  if (assignedDuties.includes("rest"))
    return {
      status: "unmet",
      label: "Shift not granted",
      reason: `REST was assigned to preserve the nurse’s two required REST days this week.`,
    };
  if (isLeaveDuty(request.choice))
    return {
      status: "unmet",
      label: "Leave not protected",
      reason: `${dutyLabels[request.choice]} was not protected, so ${assignedLabel} was assigned instead. Save the leave entry again before publishing.`,
    };
  if (request.choice === "training")
    return {
      status: "unmet",
      label: "Training conflict",
      reason: `Training could not be protected, so ${assignedLabel} was assigned instead. Review the preceding night duty and save the training entry again.`,
    };
  if (!["morning", "afternoon", "night"].includes(request.choice)) return null;
  const dayIndex = Number(dayKey.slice(1));
  const previous =
    dayIndex > 0
      ? assignedDutyOnDay(assignments, nurseId, planningDays[dayIndex - 1].key)
      : null;
  const beforePrevious =
    dayIndex > 1
      ? assignedDutyOnDay(assignments, nurseId, planningDays[dayIndex - 2].key)
      : null;
  if (!transitionAllowed(previous, beforePrevious, request.choice as ShiftCode))
    return {
      status: "unmet",
      label: "Recovery rule",
      reason: `${dutyLabels[request.choice]} would create an unsafe shift transition, so ${assignedLabel} was used instead.`,
    };
  const contenders = nurseList.filter(
    (item) => requestFor(requests, item.id, dayKey)?.choice === request.choice,
  );
  const grantedContenders = contenders.filter((item) =>
    assignments[dutyKey(dayKey, request.choice)]?.includes(item.id),
  ).length;
  if (contenders.length > grantedContenders)
    return {
      status: "unmet",
      label: "Competing request",
      reason: `${contenders.length} nurses requested ${dutyLabels[request.choice]}; ${grantedContenders} received it after staffing balance, current fulfilled requests, prior denials, and rotating priority were applied.`,
    };
  return {
    status: "unmet",
    label: "Balance rule",
    reason: `${assignedLabel} was used to keep daily staffing and the nurse’s two-week shift mix balanced.`,
  };
}

function personalBalancePenalty(
  assignments: AssignmentMap,
  nurseList: Nurse[],
): number {
  return nurseList.reduce((total, nurse) => {
    const counts = (["morning", "afternoon", "night"] as ShiftCode[]).map(
      (shift) =>
        planningDays.filter(
          (day) => assignedDutyOnDay(assignments, nurse.id, day.key) === shift,
        ).length,
    );
    return total + counts.reduce((sum, count) => sum + count * count, 0);
  }, 0);
}

function transitionsValidForNurse(
  assignments: AssignmentMap,
  nurseId: string,
  rules: TwoWeekRules = defaultTwoWeekRules,
): boolean {
  return planningDays.every((day, index) => {
    const duty = assignedDutyOnDay(assignments, nurseId, day.key);
    const previous =
      index > 0
        ? assignedDutyOnDay(assignments, nurseId, planningDays[index - 1].key)
        : null;
    const beforePrevious =
      index > 1
        ? assignedDutyOnDay(assignments, nurseId, planningDays[index - 2].key)
        : null;
    if (duty === "training") return previous !== "night";
    if (!duty || !["morning", "afternoon", "night"].includes(duty)) return true;
    return transitionAllowed(previous, beforePrevious, duty as ShiftCode, rules);
  });
}

function repairPersonalBalance(
  assignments: AssignmentMap,
  requests: ScheduleRequestMap,
  nurseList: Nurse[],
  rules: TwoWeekRules = defaultTwoWeekRules,
) {
  let penalty = personalBalancePenalty(assignments, nurseList);
  for (let pass = 0; pass < 12; pass += 1) {
    let improved = false;
    candidateSearch:
    for (const day of planningDays) {
      for (let firstIndex = 0; firstIndex < nurseList.length; firstIndex += 1) {
        const first = nurseList[firstIndex];
        const firstDuty = assignedDutyOnDay(assignments, first.id, day.key);
        if (!firstDuty || !["morning", "afternoon", "night"].includes(firstDuty))
          continue;
        const firstRequest = requestFor(requests, first.id, day.key);
        if (firstRequest?.choice === firstDuty) continue;
        for (
          let secondIndex = firstIndex + 1;
          secondIndex < nurseList.length;
          secondIndex += 1
        ) {
          const second = nurseList[secondIndex];
          const secondDuty = assignedDutyOnDay(assignments, second.id, day.key);
          if (
            !secondDuty ||
            firstDuty === secondDuty ||
            !["morning", "afternoon", "night"].includes(secondDuty)
          )
            continue;
          const secondRequest = requestFor(requests, second.id, day.key);
          if (secondRequest?.choice === secondDuty) continue;
          const tentative = replaceNurseDuty(
            replaceNurseDuty(assignments, first.id, day.key, secondDuty),
            second.id,
            day.key,
            firstDuty,
          );
          if (
            !transitionsValidForNurse(tentative, first.id, rules) ||
            !transitionsValidForNurse(tentative, second.id, rules)
          )
            continue;
          const nextPenalty = personalBalancePenalty(tentative, nurseList);
          if (nextPenalty >= penalty) continue;
          Object.keys(assignments).forEach((key) => delete assignments[key]);
          Object.assign(assignments, tentative);
          penalty = nextPenalty;
          improved = true;
          break candidateSearch;
        }
      }
    }
    if (!improved) break;
  }
}

export function buildTwoWeekDraft(
  requests: ScheduleRequestMap,
  nurseList: Nurse[],
  fairnessHistory: RequestFairnessHistory = {},
  rotationOffset = 0,
  rules: TwoWeekRules = defaultTwoWeekRules,
): DraftResult {
  const assignments: AssignmentMap = {};
  const issues: ScheduleIssue[] = [];
  const restCounts = new Map<string, number>();
  const personalCounts = new Map(
    nurseList.map((nurse) => [
      nurse.id,
      { morning: 0, afternoon: 0, night: 0 },
    ]),
  );
  const dutyHistory = new Map<string, DutyCode[]>();
  const fulfilledRequests = new Map(
    nurseList.map((nurse) => [nurse.id, 0]),
  );
  const orderedNurseIds = nurseList.map((nurse) => nurse.id).sort();
  const shiftOrder: ShiftCode[] = ["morning", "afternoon", "night"];
  const stableShiftFor = (nurseId: string): ShiftCode =>
    shiftOrder[
      (orderedNurseIds.indexOf(nurseId) + rotationOffset) % shiftOrder.length
    ];
  const periodDays = datesForPeriod(rotationOffset);

  // Pass 1: protect both leave types before any other duty is assigned.
  planningDays.forEach((day) => {
    nurseList.forEach((nurse) => {
      const request = requestFor(requests, nurse.id, day.key);
      if (
        isLeaveDuty(request?.choice) &&
        nurseActiveOnDate(nurse, periodDays.find((item) => item.key === day.key)?.isoDate)
      )
        addAssignment(assignments, day.key, request!.choice, nurse.id);
    });
  });

  // Pass 2: protect training. It is a non-working day but never counts as REST.
  planningDays.forEach((day) => {
    nurseList.forEach((nurse) => {
      const request = requestFor(requests, nurse.id, day.key);
      if (
        request?.choice === "training" &&
        nurseActiveOnDate(nurse, periodDays.find((item) => item.key === day.key)?.isoDate)
      )
        addAssignment(assignments, day.key, "training", nurse.id);
    });
  });

  for (let week = 0; week < 2; week += 1) {
    const weekDays = planningDays.slice(week * 7, week * 7 + 7);
    const restAssignments = new Map(
      nurseList.map((nurse) => [nurse.id, 0]),
    );
    const requiredRest = new Map(
      nurseList.map((nurse) => {
        const activeDays = weekDays.filter((day) =>
          nurseActiveOnDate(
            nurse,
            periodDays.find((item) => item.key === day.key)?.isoDate,
          ),
        ).length;
        return [
          nurse.id,
          Math.min(rules.restDaysPerWeek, Math.floor(activeDays / 3)),
        ];
      }),
    );
    const pendingRequestedRest = nurseList.flatMap((nurse) =>
      weekDays
        .filter(
          (day) =>
            requestFor(requests, nurse.id, day.key)?.choice === "rest" &&
            nurseActiveOnDate(
              nurse,
              periodDays.find((item) => item.key === day.key)?.isoDate,
            ) &&
            !assignedDutyOnDay(assignments, nurse.id, day.key),
        )
        .map((day) => ({ nurse, day })),
    );
    while (true) {
      const eligible = pendingRequestedRest
        .filter(
          ({ nurse, day }) =>
            (restAssignments.get(nurse.id) ?? 0) < (requiredRest.get(nurse.id) ?? 0) &&
            (restCounts.get(day.key) ?? 0) < rules.maxRestPerDay,
        )
        .sort((first, second) => {
          const fairness = compareFairness(
            first.nurse.id,
            second.nurse.id,
            "rest",
            "rest",
            fulfilledRequests,
            fairnessHistory,
            orderedNurseIds,
            rotationOffset,
          );
          if (fairness) return fairness;
          const loadDifference =
            (restCounts.get(first.day.key) ?? 0) -
            (restCounts.get(second.day.key) ?? 0);
          if (loadDifference) return loadDifference;
          return first.day.key.localeCompare(second.day.key);
        });
      const selected = eligible[0];
      if (!selected) break;
      addAssignment(assignments, selected.day.key, "rest", selected.nurse.id);
      restCounts.set(
        selected.day.key,
        (restCounts.get(selected.day.key) ?? 0) + 1,
      );
      restAssignments.set(
        selected.nurse.id,
        (restAssignments.get(selected.nurse.id) ?? 0) + 1,
      );
      fulfilledRequests.set(
        selected.nurse.id,
        (fulfilledRequests.get(selected.nurse.id) ?? 0) + 1,
      );
      pendingRequestedRest.splice(pendingRequestedRest.indexOf(selected), 1);
    }

    const fillOrder = [...nurseList].sort((first, second) =>
      compareFairness(
        first.id,
        second.id,
        "rest",
        "rest",
        fulfilledRequests,
        fairnessHistory,
        orderedNurseIds,
        rotationOffset,
      ),
    );
    fillOrder.forEach((nurse) => {
      while (
        (restAssignments.get(nurse.id) ?? 0) <
        (requiredRest.get(nurse.id) ?? 0)
      ) {
        const nurseIndex = orderedNurseIds.indexOf(nurse.id);
        const existingRestIndices = weekDays
          .map((day, index) =>
            assignedDutyOnDay(assignments, nurse.id, day.key) === "rest"
              ? index
              : -1,
          )
          .filter((index) => index >= 0);
        const available = weekDays
          .filter(
            (day) => {
              const candidateIndex = weekDays.findIndex(
                (weekDay) => weekDay.key === day.key,
              );
              const globalCandidateIndex = planningDays.findIndex(
                (planningDay) => planningDay.key === day.key,
              );
              const touchesAnotherRest = planningDays.some(
                (planningDay, index) =>
                  Math.abs(index - globalCandidateIndex) === 1 &&
                  (assignedDutyOnDay(
                    assignments,
                    nurse.id,
                    planningDay.key,
                  ) === "rest" ||
                    requestFor(requests, nurse.id, planningDay.key)?.choice ===
                      "rest"),
              );
              return (
                !assignedDutyOnDay(assignments, nurse.id, day.key) &&
                nurseActiveOnDate(
                  nurse,
                  periodDays.find((item) => item.key === day.key)?.isoDate,
                ) &&
                (restCounts.get(day.key) ?? 0) < rules.maxRestPerDay &&
                !touchesAnotherRest &&
                !existingRestIndices.some(
                  (restIndex) => Math.abs(restIndex - candidateIndex) === 1,
                )
              );
            },
          )
          .sort((first, second) => {
            const stableShift = stableShiftFor(nurse.id);
            const restLoadForStableShift = (dayKey: string) =>
              nurseList.filter(
                (teamMember) =>
                  stableShiftFor(teamMember.id) === stableShift &&
                  assignedDutyOnDay(
                    assignments,
                    teamMember.id,
                    dayKey,
                  ) === "rest",
              ).length;
            const groupLoadDifference =
              restLoadForStableShift(first.key) -
              restLoadForStableShift(second.key);
            if (groupLoadDifference) return groupLoadDifference;
            const firstIndex = weekDays.findIndex((day) => day.key === first.key);
            const secondIndex = weekDays.findIndex((day) => day.key === second.key);
            const firstPairDistance = existingRestIndices.length
              ? Math.min(...existingRestIndices.map((index) => Math.abs(index - firstIndex)))
              : 0;
            const secondPairDistance = existingRestIndices.length
              ? Math.min(...existingRestIndices.map((index) => Math.abs(index - secondIndex)))
              : 0;
            if (firstPairDistance !== secondPairDistance)
              return secondPairDistance - firstPairDistance;
            const loadDifference =
              (restCounts.get(first.key) ?? 0) -
              (restCounts.get(second.key) ?? 0);
            if (loadDifference) return loadDifference;
            const firstPattern =
              (Number(first.key.slice(1)) - nurseIndex * 3 + 14) % 7;
            const secondPattern =
              (Number(second.key.slice(1)) - nurseIndex * 3 + 14) % 7;
            return firstPattern - secondPattern;
          });
        const selected = available[0];
        if (!selected) break;
        addAssignment(assignments, selected.key, "rest", nurse.id);
        restCounts.set(selected.key, (restCounts.get(selected.key) ?? 0) + 1);
        restAssignments.set(
          nurse.id,
          (restAssignments.get(nurse.id) ?? 0) + 1,
        );
      }
      if (
        (restAssignments.get(nurse.id) ?? 0) <
        (requiredRest.get(nurse.id) ?? 0)
      ) {
        issues.push({
          id: `rest-shortage-${nurse.id}-${week}`,
          severity: "error",
          title: "Rest requirement could not be met",
          detail: `${nurse.name} received only ${restAssignments.get(nurse.id) ?? 0} of ${requiredRest.get(nurse.id) ?? 0} required REST days from ${exactDateLabel(weekDays[0].key, periodDays)} through ${exactDateLabel(weekDays[6].key, periodDays)}.`,
          nurseId: nurse.id,
        });
      }
    });
  }

  planningDays.forEach((day, dayIndex) => {
    const dayCounts: Record<ShiftCode, number> = {
      morning: 0,
      afternoon: 0,
      night: 0,
    };
    const working = nurseList.filter(
      (nurse) =>
        nurseActiveOnDate(
          nurse,
          periodDays.find((item) => item.key === day.key)?.isoDate,
        ) && !assignedDutyOnDay(assignments, nurse.id, day.key),
    );
    const ordered = [...working].sort((first, second) => {
      const firstRequest = requestFor(requests, first.id, day.key);
      const secondRequest = requestFor(requests, second.id, day.key);
      const firstChoice =
        firstRequest && ["morning", "afternoon", "night"].includes(firstRequest.choice)
          ? firstRequest.choice
          : null;
      const secondChoice =
        secondRequest && ["morning", "afternoon", "night"].includes(secondRequest.choice)
          ? secondRequest.choice
          : null;
      if (Boolean(firstChoice) !== Boolean(secondChoice))
        return firstChoice ? -1 : 1;
      return compareFairness(
        first.id,
        second.id,
        firstChoice,
        secondChoice,
        fulfilledRequests,
        fairnessHistory,
        orderedNurseIds,
        rotationOffset,
      );
    });

    const candidateMap = new Map<string, Array<{ shift: ShiftCode; score: number }>>();
    ordered.forEach((nurse) => {
      const history = dutyHistory.get(nurse.id) ?? [];
      const previous = history.at(-1) ?? null;
      const beforePrevious = history.at(-2) ?? null;
      const request = requestFor(requests, nurse.id, day.key);
      const requestedShift = ["morning", "afternoon", "night"].includes(
        request?.choice ?? "",
      )
        ? (request!.choice as ShiftCode)
        : null;
      const candidates = (["morning", "afternoon", "night"] as ShiftCode[])
        .filter((shift) => transitionAllowed(previous, beforePrevious, shift, rules))
        .filter((shift) => {
          const nextDay = planningDays[dayIndex + 1];
          return !(
            shift === "night" &&
            nextDay &&
            assignedDutyOnDay(assignments, nurse.id, nextDay.key) === "training"
          );
        })
        .map((shift) => {
          const personal = personalCounts.get(nurse.id)!;
          const preferenceBonus = requestedShift === shift ? 800 : 0;
          const mostRecentWorkingShift = [...history]
            .reverse()
            .find((duty): duty is ShiftCode =>
              ["morning", "afternoon", "night"].includes(duty),
            );
          const consistentShiftBonus = mostRecentWorkingShift === shift ? 2_000 : 0;
          const stableShiftBonus = !mostRecentWorkingShift && stableShiftFor(nurse.id) === shift ? 500 : 0;
          const rotationBonus = shift === shiftOrder[(dayIndex + Number(nurse.id.replace(/\D/g, "") || 0)) % 3] ? 2 : 0;
          const nextDay = planningDays[dayIndex + 1];
          const nextFixedDuty = nextDay
            ? assignedDutyOnDay(assignments, nurse.id, nextDay.key)
            : null;
          const worksNextDay = Boolean(
            nextDay &&
            !nextFixedDuty &&
            nurseActiveOnDate(
              nurse,
              periodDays.find((item) => item.key === nextDay.key)?.isoDate,
            ),
          );
          const continuityBonus =
            shift === "morning"
              ? worksNextDay
                ? 160
                : -80
              : shift === "night"
                ? worksNextDay
                  ? -80
                  : 160
                : 0;
          return {
            shift,
            score:
              preferenceBonus -
              personal[shift] * 120 +
              consistentShiftBonus +
              stableShiftBonus +
              continuityBonus +
              rotationBonus,
          };
        })
        .sort((a, b) => b.score - a.score);
      candidateMap.set(nurse.id, candidates);
    });

    const constrained = [...ordered].sort((first, second) =>
      (candidateMap.get(first.id)?.length ?? 0) -
      (candidateMap.get(second.id)?.length ?? 0),
    );
    const base = Math.floor(working.length / 3);
    const remainder = working.length % 3;
    const distributions = new Set<string>();
    for (let morningExtra = 0; morningExtra <= 1; morningExtra += 1)
      for (let afternoonExtra = 0; afternoonExtra <= 1; afternoonExtra += 1)
        for (let nightExtra = 0; nightExtra <= 1; nightExtra += 1)
          if (morningExtra + afternoonExtra + nightExtra === remainder)
            distributions.add(
              `${base + morningExtra},${base + afternoonExtra},${base + nightExtra}`,
            );

    let bestPlan: { score: number; duties: Record<string, ShiftCode> } | null = null;
    for (const distribution of distributions) {
      const [morning, afternoon, night] = distribution.split(",").map(Number);
      const memo = new Map<string, { score: number; duties: Record<string, ShiftCode> } | null>();
      const solve = (
        index: number,
        remaining: Record<ShiftCode, number>,
      ): { score: number; duties: Record<string, ShiftCode> } | null => {
        if (index === constrained.length)
          return Object.values(remaining).every((count) => count === 0)
            ? { score: 0, duties: {} }
            : null;
        const key = `${index}:${remaining.morning},${remaining.afternoon},${remaining.night}`;
        if (memo.has(key)) return memo.get(key) ?? null;
        const nurse = constrained[index];
        let best: { score: number; duties: Record<string, ShiftCode> } | null = null;
        for (const candidate of candidateMap.get(nurse.id) ?? []) {
          if (remaining[candidate.shift] <= 0) continue;
          const tail = solve(index + 1, {
            ...remaining,
            [candidate.shift]: remaining[candidate.shift] - 1,
          });
          if (!tail) continue;
          const score = candidate.score + tail.score;
          if (!best || score > best.score)
            best = {
              score,
              duties: { ...tail.duties, [nurse.id]: candidate.shift },
            };
        }
        memo.set(key, best);
        return best;
      };
      const plan = solve(0, { morning, afternoon, night });
      if (plan && (!bestPlan || plan.score > bestPlan.score)) bestPlan = plan;
    }

    ordered.forEach((nurse) => {
      const requestedShift = ["morning", "afternoon", "night"].includes(
        requestFor(requests, nurse.id, day.key)?.choice ?? "",
      )
        ? (requestFor(requests, nurse.id, day.key)!.choice as ShiftCode)
        : null;
      const chosen = bestPlan?.duties[nurse.id] ?? candidateMap.get(nurse.id)?.[0]?.shift;
      if (!chosen) {
        issues.push({
          id: `recovery-unfilled-${nurse.id}-${day.key}`,
          severity: "error",
          title: "Recovery rule left a duty unfilled",
          detail: `${nurse.name} could not be safely assigned on ${periodDays[dayIndex]?.label}, ${periodDays[dayIndex]?.date}, ${periodDays[dayIndex]?.year}. Review the surrounding Night, REST, or Training entries.`,
          nurseId: nurse.id,
          dayKey: day.key,
        });
        return;
      }
      addAssignment(assignments, day.key, chosen, nurse.id);
      dayCounts[chosen] += 1;
      personalCounts.get(nurse.id)![chosen] += 1;
      if (requestedShift === chosen)
        fulfilledRequests.set(
          nurse.id,
          (fulfilledRequests.get(nurse.id) ?? 0) + 1,
        );
    });

    nurseList.forEach((nurse) => {
      const duty = assignedDutyOnDay(assignments, nurse.id, day.key);
      dutyHistory.set(nurse.id, [...(dutyHistory.get(nurse.id) ?? []), duty ?? "rest"]);
    });
  });

  repairPersonalBalance(assignments, requests, nurseList, rules);

  return {
    assignments,
    issues: [
      ...issues,
      ...validateTwoWeekSchedule(
        assignments,
        requests,
        nurseList,
        rules,
        periodDays,
      ),
    ],
  };
}

export function validateTwoWeekSchedule(
  assignments: AssignmentMap,
  requests: ScheduleRequestMap,
  nurseList: Nurse[],
  rules: TwoWeekRules = defaultTwoWeekRules,
  periodDays: ScheduleDay[] = datesForPeriod(0),
  overtimeCoverage: OvertimeCoverage[] = [],
): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  planningDays.forEach((day) => {
    const counts = (["morning", "afternoon", "night"] as ShiftCode[]).map(
      (shift) =>
        (assignments[dutyKey(day.key, shift)]?.length ?? 0) +
        overtimePositionsCovered(overtimeCoverage, day.key, shift),
    );
    if (
      Math.max(...counts) - Math.min(...counts) >
      rules.maxDailyShiftDifference
    )
      issues.push({
        id: `daily-balance-${day.key}`,
        severity: "error",
        title: "Daily shifts are not balanced",
        detail: `${exactDateLabel(day.key, periodDays)} has 6: ${counts[0]}, 2: ${counts[1]}, and N: ${counts[2]}. The configured difference limit is ${rules.maxDailyShiftDifference}.`,
        dayKey: day.key,
      });
    const rests = assignments[dutyKey(day.key, "rest")]?.length ?? 0;
    if (rests > rules.maxRestPerDay)
      issues.push({
        id: `rest-cap-${day.key}`,
        severity: "error",
        title: "Daily REST limit exceeded",
        detail: `${rests} nurses are resting on ${exactDateLabel(day.key, periodDays)}; the configured maximum is ${rules.maxRestPerDay}.`,
        dayKey: day.key,
      });
  });

  nurseList.forEach((nurse) => {
    planningDays.forEach((day) => {
      const actualDay = periodDays.find((item) => item.key === day.key);
      if (
        !nurseActiveOnDate(nurse, actualDay?.isoDate) &&
        assignedDutyOnDay(assignments, nurse.id, day.key)
      )
        issues.push({
          id: `inactive-${nurse.id}-${day.key}`,
          severity: "error",
          title: "Assignment outside employment dates",
          detail: `${nurse.name} is not active on ${exactDateLabel(day.key, periodDays)}. Remove this assignment or update the employee record.`,
          nurseId: nurse.id,
          dayKey: day.key,
        });
    });
    for (let week = 0; week < 2; week += 1) {
      const activeDays = planningDays
        .slice(week * 7, week * 7 + 7)
        .filter((day) =>
          nurseActiveOnDate(
            nurse,
            periodDays.find((item) => item.key === day.key)?.isoDate,
          ),
        ).length;
      const requiredRest = Math.min(
        rules.restDaysPerWeek,
        Math.floor(activeDays / 3),
      );
      const restCount = planningDays
        .slice(week * 7, week * 7 + 7)
        .filter((day) => assignedDutyOnDay(assignments, nurse.id, day.key) === "rest").length;
      if (restCount !== requiredRest)
        issues.push({
          id: `rest-count-${nurse.id}-${week}`,
          severity: "error",
          title: "Weekly REST rule not met",
          detail: `${nurse.name} has ${restCount} of ${requiredRest} required REST days from ${exactDateLabel(planningDays[week * 7].key, periodDays)} through ${exactDateLabel(planningDays[week * 7 + 6].key, periodDays)}. Employment dates are included in this calculation.`,
          nurseId: nurse.id,
        });
    }
    const shiftCounts = (["morning", "afternoon", "night"] as ShiftCode[]).map(
      (shift) =>
        planningDays.filter(
          (day) => assignedDutyOnDay(assignments, nurse.id, day.key) === shift,
        ).length,
    );
    const activeDays = planningDays.filter((day) =>
      nurseActiveOnDate(
        nurse,
        periodDays.find((item) => item.key === day.key)?.isoDate,
      ),
    ).length;
    const overtimeHours = overtimeCoverage.reduce(
      (total, entry) =>
        entry.nurseIds.includes(nurse.id) ? total + entry.hoursEach : total,
      0,
    );
    const scheduledHours =
      shiftCounts.reduce((total, count) => total + count * 8, 0) + overtimeHours;
    const minimumHours = Math.floor(
      (rules.minHoursPerPeriod * activeDays) / 14,
    );
    const maximumHours = Math.ceil(
      (rules.maxHoursPerPeriod * activeDays) / 14,
    );
    if (activeDays && scheduledHours < minimumHours)
      issues.push({
        id: `minimum-hours-${nurse.id}`,
        severity: "warning",
        title: "Minimum schedule hours not reached",
        detail: `${nurse.name} has ${scheduledHours} of ${minimumHours} prorated minimum hours.`,
        nurseId: nurse.id,
      });
    if (scheduledHours > maximumHours)
      issues.push({
        id: `maximum-hours-${nurse.id}`,
        severity: "error",
        title: "Maximum schedule hours exceeded",
        detail: `${nurse.name} has ${scheduledHours} hours; the prorated maximum is ${maximumHours}.`,
        nurseId: nurse.id,
      });
    if (
      Math.max(...shiftCounts) - Math.min(...shiftCounts) >
      rules.maxIndividualShiftDifference
    )
      issues.push({
        id: `personal-balance-${nurse.id}`,
        severity: "warning",
        title: "Individual shift mix needs review",
        detail: `${nurse.name} has 6: ${shiftCounts[0]}, 2: ${shiftCounts[1]}, and N: ${shiftCounts[2]}.`,
        nurseId: nurse.id,
      });
    planningDays.forEach((day, index) => {
      const request = requestFor(requests, nurse.id, day.key);
      const assigned = assignedDutyOnDay(assignments, nurse.id, day.key);
      if (
        request &&
        request.status === "mandatory" &&
        request.choice !== assigned
      )
        issues.push({
          id: `request-${nurse.id}-${day.key}`,
          severity: "error",
          title: "Mandatory leave not met",
          detail: `${nurse.name} requested ${dutyLabels[request.choice]} on ${exactDateLabel(day.key, periodDays)} but was assigned ${assigned ? dutyLabels[assigned] : "nothing"}.`,
          nurseId: nurse.id,
          dayKey: day.key,
        });
      const previous = index > 0 ? assignedDutyOnDay(assignments, nurse.id, planningDays[index - 1].key) : null;
      const beforePrevious = index > 1 ? assignedDutyOnDay(assignments, nurse.id, planningDays[index - 2].key) : null;
      if (assigned === "rest" && previous === "rest") {
        const previousDay = planningDays[index - 1];
        const bothRestDaysRequested =
          requestFor(requests, nurse.id, previousDay.key)?.choice === "rest" &&
          request?.choice === "rest";
        if (!bothRestDaysRequested)
          issues.push({
            id: `consecutive-rest-${nurse.id}-${day.key}`,
            severity: "warning",
            title: "Consecutive REST days were not requested",
            detail: `${nurse.name} has REST on ${exactDateLabel(previousDay.key, periodDays)} and ${exactDateLabel(day.key, periodDays)}. Separate these REST days unless the nurse requested both dates.`,
            nurseId: nurse.id,
            dayKey: day.key,
          });
      }
      if (assigned === "training" && previous === "night")
        issues.push({
          id: `training-transition-${nurse.id}-${day.key}`,
          severity: "error",
          title: "Training cannot follow a Night shift",
          detail: `${nurse.name}'s Training on ${exactDateLabel(day.key, periodDays)} follows an N shift. Replace the preceding N shift or move the Training entry.`,
          nurseId: nurse.id,
          dayKey: day.key,
        });
      if (
        assigned &&
        ["morning", "afternoon", "night"].includes(assigned) &&
        !transitionAllowed(
          previous,
          beforePrevious,
          assigned as ShiftCode,
          rules,
        )
      )
        issues.push({
          id: `transition-${nurse.id}-${day.key}`,
          severity: "error",
          title: "Unsafe shift transition",
          detail: `${nurse.name}'s assignment on ${exactDateLabel(day.key, periodDays)} does not provide the required 16-hour recovery time.`,
          nurseId: nurse.id,
          dayKey: day.key,
        });
    });
  });
  return Array.from(new Map(issues.map((issue) => [issue.id, issue])).values());
}
