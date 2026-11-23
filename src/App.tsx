import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  HelpCircle,
  Info,
  LogIn,
  LogOut,
  Link2,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  UserRoundCheck,
  Users,
  WandSparkles,
  X,
} from "lucide-react";

import {
  areConsecutiveShifts,
  assignedShiftsOnDay,
  buildDraft,
  copyPreferencesForRoster,
  countAssignments,
  coverageGaps,
  createSeedPreferences,
  days,
  defaultSchedulingOptions,
  getCandidates,
  nextNurseId,
  nurseActiveOnDate,
  normalizeShiftDefinitions,
  nurses as demoNurses,
  preferenceKey,
  preferenceLabels,
  preferenceSatisfaction,
  replaceNurseAssignment,
  scheduledHours,
  shiftKey,
  shifts,
  type AssignmentMap,
  type Candidate,
  type Nurse,
  type PreferenceLevel,
  type PreferenceMap,
  type ScheduleDay,
  type SchedulingOptions,
  type ShiftCode,
  type ShiftDefinition,
  type WorkRequest,
  type WorkRequestMap,
} from "./schedule";
import {
  assignedDutyOnDay,
  buildRequestFairnessHistory,
  buildTwoWeekDraft,
  copyRequestsForRoster,
  createSeedRequests,
  datesForPeriod,
  dutyKey,
  dutyLabels,
  dutyShortLabels,
  explainRequestOutcome,
  isLeaveDuty,
  legacyPreferencesFromRequests,
  createDailyCoverage,
  defaultTwoWeekRules,
  officialShifts,
  overtimeDutyWindow,
  overtimeHistoryHours,
  overtimePositionsCovered,
  periodRangeLabel,
  planningDays,
  replaceNurseDuty,
  requestKey,
  requirementMapFromDailyCoverage,
  recommendForcedOvertime,
  validateTwoWeekSchedule,
  type DailyCoverage,
  type DutyCode,
  type OvertimeCoverage,
  type ScheduleIssue,
  type ScheduleRequest,
  type ScheduleRequestMap,
  type TwoWeekRules,
} from "./twoWeekSchedule";
import {
  downloadPreferenceWorkbook,
  downloadScheduleWorkbook,
  rowsFromPreferenceWorkbook,
} from "./workbook";

type AppView = "schedule" | "preferences" | "reports" | "team" | "rules";
type SessionUser = {
  username: string;
  name: string;
  role: string;
  isDemo: boolean;
  seeded: boolean;
};
type CoverageRuleTarget =
  "weekend" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
type CoverageOverride = {
  target: CoverageRuleTarget;
  morningCoverage: number;
  afternoonCoverage: number;
  nightCoverage: number;
  chargeNurses: number;
};
type CoverageSettings = SchedulingOptions & {
  erBeds: number;
  morningCoverage: number;
  afternoonCoverage: number;
  nightCoverage: number;
  chargeNursesPerShift: number;
  coverageOverrides: CoverageOverride[];
  shiftDefinitions: ShiftDefinition[];
  twoWeekRules: TwoWeekRules;
};
type ScheduleIncident = {
  id: string;
  nurseId: string;
  dayKey: string;
  shiftCode: ShiftCode;
  status: "awol";
  replacementNurseId?: string;
  createdAt: string;
};
type RequestPortal = {
  enabled: boolean;
  version: string;
  maxRequests: number;
  createdAt: string;
  updatedAt: string;
};
type WeekRecord = {
  preferences: PreferenceMap;
  requests?: ScheduleRequestMap;
  assignments: AssignmentMap;
  published: boolean;
  incidents?: ScheduleIncident[];
  workRequests?: WorkRequestMap;
  issues?: ScheduleIssue[];
  requestPortal?: RequestPortal;
  requestSubmissions?: Record<string, string>;
  requestComments?: Record<string, string>;
  dailyCoverage?: DailyCoverage;
  overtimeCoverage?: OvertimeCoverage[];
};
type PersistedWorkspace = {
  nurses: Nurse[];
  settings: CoverageSettings;
  weeks: Record<string, WeekRecord>;
  weekOffset: number;
};
type WorkspaceStaffType = "nurses" | "orderlies";
type WorkspaceSummary = {
  id: string;
  name: string;
  staffType: WorkspaceStaffType;
  createdAt?: string;
  updatedAt?: string;
  memberCount: number;
};

const defaultCoverageSettings: CoverageSettings = {
  ...defaultSchedulingOptions,
  erBeds: 15,
  morningCoverage: 4,
  afternoonCoverage: 4,
  nightCoverage: 4,
  chargeNursesPerShift: 1,
  coverageOverrides: [],
  shiftDefinitions: officialShifts,
  twoWeekRules: defaultTwoWeekRules,
};

function emptyWorkspace(staffType: WorkspaceStaffType): PersistedWorkspace {
  const settings = normalizeCoverageSettings({
    ...defaultCoverageSettings,
    chargeNursesPerShift:
      staffType === "orderlies"
        ? 0
        : defaultCoverageSettings.chargeNursesPerShift,
    requireChargeNurse: staffType !== "orderlies",
  });
  return {
    nurses: [],
    settings,
    weeks: {},
    weekOffset: 0,
  };
}

function normalizeCoverageSettings(
  settings?: Partial<CoverageSettings>,
): CoverageSettings {
  const validInteger = (value: unknown, fallback: number, maximum: number) =>
    Number.isInteger(value) && Number(value) >= 1 && Number(value) <= maximum
      ? Number(value)
      : fallback;
  const validTargets = new Set<CoverageRuleTarget>([
    "weekend",
    "sun",
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
  ]);
  const seenTargets = new Set<CoverageRuleTarget>();
  const coverageOverrides = (
    Array.isArray(settings?.coverageOverrides) ? settings.coverageOverrides : []
  ).flatMap((override) => {
    if (
      !override ||
      !validTargets.has(override.target) ||
      seenTargets.has(override.target)
    )
      return [];
    seenTargets.add(override.target);
    return [
      {
        target: override.target,
        morningCoverage: validInteger(
          override.morningCoverage,
          defaultCoverageSettings.morningCoverage,
          50,
        ),
        afternoonCoverage: validInteger(
          override.afternoonCoverage,
          defaultCoverageSettings.afternoonCoverage,
          50,
        ),
        nightCoverage: validInteger(
          override.nightCoverage,
          defaultCoverageSettings.nightCoverage,
          50,
        ),
        chargeNurses:
          Number.isInteger(override.chargeNurses) &&
          override.chargeNurses >= 0 &&
          override.chargeNurses <= 20
            ? override.chargeNurses
            : defaultCoverageSettings.chargeNursesPerShift,
      },
    ];
  });
  const chargeNursesPerShift =
    Number.isInteger(settings?.chargeNursesPerShift) &&
    Number(settings?.chargeNursesPerShift) >= 0 &&
    Number(settings?.chargeNursesPerShift) <= 20
      ? Number(settings?.chargeNursesPerShift)
      : settings?.requireChargeNurse === false
        ? 0
        : defaultCoverageSettings.chargeNursesPerShift;
  return {
    erBeds: validInteger(settings?.erBeds, defaultCoverageSettings.erBeds, 200),
    morningCoverage: validInteger(
      settings?.morningCoverage,
      defaultCoverageSettings.morningCoverage,
      50,
    ),
    afternoonCoverage: validInteger(
      settings?.afternoonCoverage,
      defaultCoverageSettings.afternoonCoverage,
      50,
    ),
    nightCoverage: validInteger(
      settings?.nightCoverage,
      defaultCoverageSettings.nightCoverage,
      50,
    ),
    chargeNursesPerShift,
    coverageOverrides,
    maximumShifts: validInteger(
      settings?.maximumShifts,
      defaultCoverageSettings.maximumShifts,
      14,
    ),
    requireChargeNurse: chargeNursesPerShift > 0,
    preventNightToMorning:
      settings?.preventNightToMorning ??
      defaultCoverageSettings.preventNightToMorning,
    shiftDefinitions: officialShifts,
    twoWeekRules: {
      ...defaultTwoWeekRules,
      ...(settings?.twoWeekRules ?? {}),
      maxConsecutiveHours: 12,
    },
  };
}

function ruleForDay(settings: CoverageSettings, dayKey: string) {
  const day = days.find((item) => item.key === dayKey);
  return (
    settings.coverageOverrides.find((rule) => rule.target === dayKey) ??
    (day?.weekend
      ? settings.coverageOverrides.find((rule) => rule.target === "weekend")
      : undefined)
  );
}

const viewMeta: Record<AppView, { eyebrow: string; title: string }> = {
  schedule: { eyebrow: "EMERGENCY NURSES / TWO WEEKS", title: "Two-week schedule" },
  preferences: {
    eyebrow: "GOOGLE FORMS / TWO WEEKS",
    title: "Nurse requests",
  },
  reports: { eyebrow: "WORKFORCE INSIGHTS", title: "Schedule reports" },
  team: { eyebrow: "EMERGENCY DEPARTMENT", title: "Nursing team" },
  rules: { eyebrow: "SCHEDULING CONTROLS", title: "Coverage rules" },
};

const initialRequests = createSeedRequests(demoNurses);
const initialPreferences = legacyPreferencesFromRequests(
  initialRequests,
  demoNurses,
);
const initialRequestSubmissions = Object.fromEntries(
  demoNurses.map((nurse, index) => [
    nurse.id,
    new Date(Date.UTC(2026, 8, 4, 8 + (index % 8))).toISOString(),
  ]),
);
const initialRequestComments = Object.fromEntries(
  demoNurses.slice(0, 4).map((nurse, index) => [
    nurse.id,
    [
      "Family commitment on the requested REST date.",
      "Night shifts fit my transportation schedule this period.",
      "Scheduled personal appointment; leave dates are included above.",
      "Requesting the same shift pattern for childcare planning.",
    ][index],
  ]),
);
const initialWorkRequests: WorkRequestMap = Object.fromEntries(
  demoNurses
    .slice(0, 4)
    .map((nurse, index) => [
      nurse.id,
      { overtime: index < 3, doubleShift: index === 0 || index === 2 },
    ]),
);

function weekRangeLabel(weekDays: ScheduleDay[]) {
  return periodRangeLabel(weekDays);
}

function coverageRequirements(
  nurseList: Nurse[],
  assignments: AssignmentMap,
) {
  return Object.fromEntries(
    planningDays.flatMap((day, dayIndex) => {
      const assignedCounts = officialShifts.map(
        (shift) => assignments[dutyKey(day.key, shift.code)]?.length ?? 0,
      );
      const assignedWork = assignedCounts.reduce((total, count) => total + count, 0);
      const estimatedRest = Math.min(
        7,
        Math.max(0, Math.round((nurseList.length * 2) / 7)),
      );
      const working = assignedWork || Math.max(0, nurseList.length - estimatedRest);
      const base = Math.floor(working / 3);
      const remainder = working % 3;
      return officialShifts.map((shift, shiftIndex) => [
        shiftKey(day.key, shift.code),
        assignedWork
          ? assignedCounts[shiftIndex]
          : base + ((shiftIndex + dayIndex) % 3 < remainder ? 1 : 0),
      ]);
    }),
  );
}

function chargeRequirements() {
  return Object.fromEntries(
    planningDays.flatMap((day) =>
      officialShifts.map((shift) => [shiftKey(day.key, shift.code), 0]),
    ),
  );
}

function completedCoverageCount(
  assignments: AssignmentMap,
  requirementMap: Record<string, number>,
  chargeRequirementMap: Record<string, number>,
  nurseList: Nurse[],
  overtimeCoverage: OvertimeCoverage[] = [],
) {
  const nurseById = new Map(nurseList.map((nurse) => [nurse.id, nurse]));
  return Object.entries(requirementMap).filter(([key, required]) => {
    const assignedIds = assignments[key] ?? [];
    const assignedChargeNurses = assignedIds.filter(
      (id) => nurseById.get(id)?.role === "Charge nurse",
    ).length;
    return (
      assignedIds.length +
          overtimePositionsCovered(
            overtimeCoverage,
            key.slice(0, key.lastIndexOf("-")),
            key.slice(key.lastIndexOf("-") + 1) as ShiftCode,
          ) >=
        required &&
      assignedChargeNurses >= (chargeRequirementMap[key] ?? 0)
    );
  }).length;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function requestsFromRows(
  rows: string[][],
  nurseList: Nurse[],
  periodDays: ScheduleDay[],
): ScheduleRequestMap {
  if (rows.length < 2)
    throw new Error("The CSV does not contain any nurse responses.");
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const idIndex = headers.indexOf("nurse id");
  if (idIndex < 0) throw new Error("The CSV needs a “Employee ID” column.");
  const aliases: Record<string, DutyCode> = {
    "6": "morning",
    morning: "morning",
    "6 morning": "morning",
    "2": "afternoon",
    afternoon: "afternoon",
    "2 afternoon": "afternoon",
    n: "night",
    night: "night",
    "n night": "night",
    rest: "rest",
    leave: "personal_leave",
    "on leave": "personal_leave",
    "personal leave": "personal_leave",
    "birthday leave": "birthday_leave",
    training: "training",
  };
  const next: ScheduleRequestMap = {};
  const matchedIds = new Set<string>();
  rows.slice(1).forEach((row) => {
    const nurse = nurseList.find(
      (item) => item.id.toLowerCase() === row[idIndex]?.toLowerCase(),
    );
    if (!nurse) return;
    matchedIds.add(nurse.id);
    periodDays.forEach((day) => {
      const column = headers.findIndex(
        (header) =>
          header === day.date.toLowerCase() ||
          header === `${day.shortLabel} ${day.date}`.toLowerCase() ||
          header === `${day.label} ${day.date}`.toLowerCase(),
      );
      const value = aliases[row[column]?.trim().toLowerCase()];
      if (column >= 0 && value)
        next[requestKey(nurse.id, day.key)] = {
          choice: value,
          status: isLeaveDuty(value) || value === "training" ? "mandatory" : "requested",
        };
    });
  });
  if (!matchedIds.size)
    throw new Error("No Employee IDs in the file matched the current ER team.");
  return next;
}

function cautionForPreference(preference?: PreferenceLevel) {
  if (!preference || preference === "preferred") return null;
  const details: Record<
    Exclude<PreferenceLevel, "preferred">,
    { title: string; body: string; urgent: boolean }
  > = {
    available: {
      title: "Available, not preferred",
      body: "The nurse can work this shift but did not select it as a preferred time.",
      urgent: false,
    },
    avoid: {
      title: "Prefer not",
      body: "The nurse asked to avoid this shift. Confirm the manual override before publishing.",
      urgent: false,
    },
    unavailable: {
      title: "Unavailable",
      body: "The nurse marked this shift unavailable. Reassign the shift or confirm the exception.",
      urgent: true,
    },
    leave: {
      title: "On leave",
      body: "The nurse is recorded as on leave for this shift and should be replaced.",
      urgent: true,
    },
    sick: {
      title: "Reported sick",
      body: "The nurse is recorded as sick for this shift and should be replaced.",
      urgent: true,
    },
    absent: {
      title: "Absent",
      body: "The nurse is recorded as absent for this shift. Confirm attendance and find coverage.",
      urgent: true,
    },
  };
  return details[preference];
}

function cautionForRequest(
  request: ScheduleRequest | undefined,
  outcome: ReturnType<typeof explainRequestOutcome>,
  day?: ScheduleDay,
) {
  if (!request || !outcome || outcome.status !== "unmet") return null;
  const mandatory = request.status === "mandatory";
  return {
    title: mandatory ? "Protected entry conflict" : "Requested date differs",
    body: day
      ? `${day.label}, ${day.date}${day.year ? `, ${day.year}` : ""}: ${outcome.reason}`
      : outcome.reason,
    urgent: mandatory,
  };
}

function ScheduleView({
  assignments,
  preferences,
  requests,
  scheduleIssues,
  workRequests,
  shiftDefinitions,
  overtimeCoverage,
  nurseList,
  staffType,
  weekDays,
  requirementMap,
  chargeRequirementMap,
  onGenerate,
  onResolve,
  onEditAssignment,
  onReviewDetails,
  onPublish,
  onExport,
  onPreviousWeek,
  onNextWeek,
  published,
}: {
  assignments: AssignmentMap;
  preferences: PreferenceMap;
  requests: ScheduleRequestMap;
  scheduleIssues: ScheduleIssue[];
  workRequests: WorkRequestMap;
  shiftDefinitions: ShiftDefinition[];
  overtimeCoverage: OvertimeCoverage[];
  nurseList: Nurse[];
  staffType: WorkspaceStaffType;
  weekDays: ScheduleDay[];
  requirementMap: Record<string, number>;
  chargeRequirementMap: Record<string, number>;
  onGenerate: () => void;
  onResolve: (dayKey: string, shiftCode: ShiftCode) => void;
  onEditAssignment: (nurseId: string, dayKey: string) => void;
  onReviewDetails: () => void;
  onPublish: () => void;
  onExport: () => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  published: boolean;
}) {
  const staffSingular = staffType === "orderlies" ? "orderly" : "nurse";
  const staffPlural = staffType === "orderlies" ? "orderlies" : "nurses";
  const completed = completedCoverageCount(
    assignments,
    requirementMap,
    chargeRequirementMap,
    nurseList,
    overtimeCoverage,
  );
  const totalPositions = Object.values(requirementMap).reduce(
    (sum, value) => sum + value,
    0,
  );
  const assignedPositions = officialShifts.reduce(
    (sum, shift) =>
      sum +
      weekDays.reduce(
        (dayTotal, day) =>
          dayTotal +
          (assignments[dutyKey(day.key, shift.code)]?.length ?? 0) +
          overtimePositionsCovered(overtimeCoverage, day.key, shift.code),
        0,
      ),
    0,
  );
  const nurseById = new Map(nurseList.map((nurse) => [nurse.id, nurse]));
  const incomplete = Object.entries(requirementMap).filter(
    ([key, required]) => {
      const assignedIds = assignments[key] ?? [];
      const overtimeCount = overtimePositionsCovered(
        overtimeCoverage,
        key.slice(0, key.lastIndexOf("-")),
        key.slice(key.lastIndexOf("-") + 1) as ShiftCode,
      );
      const assignedChargeNurses = assignedIds.filter(
        (id) => nurseById.get(id)?.role === "Charge nurse",
      ).length;
      return (
        assignedIds.length + overtimeCount < required ||
        assignedChargeNurses < (chargeRequirementMap[key] ?? 0)
      );
    },
  );
  const requestEntries = Object.entries(requests);
  const satisfaction = requestEntries.length
    ? Math.round(
        (requestEntries.filter(([key, request]) => {
          const separator = key.lastIndexOf("-");
          return (
            assignedDutyOnDay(
              assignments,
              key.slice(0, separator),
              key.slice(separator + 1),
            ) === request.choice
          );
        }).length /
          requestEntries.length) *
          100,
      )
    : 100;
  const activeShifts = shiftDefinitions.filter((shift) => shift.enabled);
  const timeGaps = coverageGaps(shiftDefinitions);
  const blockingIssues = scheduleIssues.filter(
    (issue) => issue.severity === "error",
  );
  const needsAttention =
    incomplete.length > 0 || blockingIssues.length > 0 || timeGaps.length > 0;
  if (!nurseList.length)
    return (
      <section className="content-panel empty-schedule-view">
        <header>
          <div
            className="week-control"
            data-tutorial="schedule-week"
            aria-label="Selected week"
          >
            <button
              type="button"
              aria-label="Previous week"
              onClick={onPreviousWeek}
            >
              <ChevronLeft size={17} />
            </button>
            <div>
              <strong>{weekRangeLabel(weekDays)}</strong>
              <span>Two-week period</span>
            </div>
            <button type="button" aria-label="Next week" onClick={onNextWeek}>
              <ChevronRight size={17} />
            </button>
          </div>
        </header>
        <div className="view-empty" data-tutorial="schedule-empty">
          <Users size={32} />
          <strong>Start with your {staffType === "orderlies" ? "orderly" : "nursing"} team</strong>
          <p>
            This workspace is intentionally empty. Add {staffPlural}, download the
            Excel request template, then generate the first schedule.
          </p>
          <button className="primary-button" type="button" onClick={onGenerate}>
            <Plus size={16} />
            Set up {staffSingular} team
          </button>
        </div>
      </section>
    );
  if (!Object.keys(assignments).length)
    return (
      <section className="content-panel empty-schedule-view">
        <header>
          <div
            className="week-control"
            data-tutorial="schedule-week"
            aria-label="Selected week"
          >
            <button
              type="button"
              aria-label="Previous week"
              onClick={onPreviousWeek}
            >
              <ChevronLeft size={17} />
            </button>
            <div>
              <strong>{weekRangeLabel(weekDays)}</strong>
              <span>Two-week period</span>
            </div>
            <button type="button" aria-label="Next week" onClick={onNextWeek}>
              <ChevronRight size={17} />
            </button>
          </div>
        </header>
        <div className="view-empty" data-tutorial="schedule-empty">
          <CalendarDays size={32} />
          <strong>No schedule generated for this period</strong>
          <p>
            Generate the complete two-week roster now. Structured {staffSingular}
            requests are optional and will be considered when present.
          </p>
          <button
            className="primary-button"
            data-tutorial="generate-draft"
            type="button"
            onClick={onGenerate}
          >
            <WandSparkles size={16} />
            Generate draft
          </button>
        </div>
      </section>
    );
  return (
    <>
      <section className="summary-band" aria-label="Schedule summary">
        <div className="summary-primary">
          <span
            className={`summary-icon ${needsAttention ? "warning" : "success"}`}
          >
            <ShieldCheck size={19} />
          </span>
          <div>
            <strong>
              {incomplete.length
                ? `${assignedPositions} of ${totalPositions} positions covered`
                : blockingIssues.length
                  ? `${blockingIssues.length} scheduling rule${blockingIssues.length === 1 ? "" : "s"} need attention`
                  : timeGaps.length
                    ? "Shift times leave an uncovered gap"
                : "All positions covered"}
            </strong>
            <small>
              {incomplete.length
                ? `${incomplete.length} shift${incomplete.length === 1 ? "" : "s"} need${incomplete.length === 1 ? "s" : ""} the head nurse’s decision`
                : blockingIssues.length
                  ? "Resolve the rule flags before publishing"
                  : timeGaps.length
                    ? "Correct the shift times before publishing"
                : "Ready for final review and publishing"}
            </small>
          </div>
        </div>
        <div className="summary-stat">
          <span>Complete shifts</span>
          <strong>
            {completed}
            <small>/{Object.keys(requirementMap).length}</small>
          </strong>
        </div>
        <div className="summary-stat">
          <span>Requests met</span>
          <strong>
            {satisfaction}
            <small>%</small>
          </strong>
        </div>
        <div className="summary-stat">
          <span>Conflicts</span>
          <strong>{scheduleIssues.length}</strong>
        </div>
      </section>

      <section className="scheduler-layout">
        <div className="schedule-panel">
          <div className="schedule-toolbar">
            <div
              className="week-control"
              data-tutorial="schedule-week"
              aria-label="Selected week"
            >
              <button
                type="button"
                aria-label="Previous week"
                onClick={onPreviousWeek}
              >
                <ChevronLeft size={17} />
              </button>
              <div>
                <strong>{weekRangeLabel(weekDays)}</strong>
                <span>Two-week period</span>
              </div>
              <button type="button" aria-label="Next week" onClick={onNextWeek}>
                <ChevronRight size={17} />
              </button>
            </div>
            <div className="schedule-actions" data-tutorial="schedule-actions">
              <span className={`status-pill ${published ? "published" : ""}`}>
                <i />
                {published ? "Published" : "Draft"}
              </span>
              <button
                className="secondary-button"
                type="button"
                onClick={onExport}
              >
                <Download size={16} />
                Export Excel
              </button>
              <button
                className="magic-button"
                data-tutorial="generate-draft"
                type="button"
                onClick={onGenerate}
              >
                <WandSparkles size={16} />
                Generate draft
              </button>
            </div>
          </div>
          <div
            className="schedule-scroll"
            tabIndex={0}
            aria-label="Two-week nurse schedule. Scroll horizontally to view all fourteen days."
          >
            <div className="schedule-grid schedule-grid-head">
              <div className="person-column">
                <span>Nurse</span>
                <small>{nurseList.length} team members</small>
              </div>
              {weekDays.map((day) => (
                <div
                  className={`day-heading ${day.weekend ? "weekend" : ""}`}
                  key={day.key}
                >
                  <span>{day.shortLabel}</span>
                  <strong>{day.date.split(" ")[1]}</strong>
                </div>
              ))}
              <div className="hours-heading">Hours</div>
            </div>
            {nurseList.map((nurse, nurseIndex) => {
              const count = countAssignments(assignments, nurse.id);
              return (
                <div className="schedule-grid nurse-row" key={nurse.id}>
                  <div className="person-column">
                    <span className="nurse-avatar">{nurse.initials}</span>
                    <span className="nurse-name">
                      <strong>{nurse.name}</strong>
                      <small>{nurse.id}</small>
                    </span>
                  </div>
                  {weekDays.map((day, dayIndex) => {
                    const assignedShifts = assignedShiftsOnDay(
                      assignments,
                      nurse.id,
                      day.key,
                      shiftDefinitions,
                    );
                    const assignedDuty = assignedDutyOnDay(
                      assignments,
                      nurse.id,
                      day.key,
                    );
                    const overtimeEntries = overtimeCoverage.filter(
                      (entry) =>
                        entry.dayKey === day.key &&
                        entry.nurseIds.includes(nurse.id),
                    );
                    const overtimeHours = overtimeEntries
                      .reduce((total, entry) => total + entry.hoursEach, 0);
                    const extendedDuty = overtimeEntries[0]
                      ? overtimeDutyWindow(
                          overtimeEntries[0],
                          nurse.id,
                          shiftDefinitions,
                        )
                      : null;
                    if (
                      !assignedShifts.length &&
                      assignedDuty &&
                      !["morning", "afternoon", "night"].includes(assignedDuty)
                    ) {
                      return (
                        <button
                          className={`shift-cell ${assignedDuty} ${day.weekend ? "weekend" : ""}`}
                          data-tutorial={
                            nurseIndex === 0 && dayIndex === 0
                              ? "assignment-cell"
                              : undefined
                          }
                          type="button"
                          key={day.key}
                          onClick={() => onEditAssignment(nurse.id, day.key)}
                          aria-label={`Edit ${nurse.name}'s ${day.label} assignment, currently ${dutyLabels[assignedDuty]}`}
                        >
                          <strong>{dutyShortLabels[assignedDuty]}</strong>
                          <Pencil
                            className="shift-edit-icon"
                            size={11}
                            aria-hidden="true"
                          />
                        </button>
                      );
                    }
                    if (!assignedShifts.length)
                      return (
                        <button
                          className={`shift-cell empty ${day.weekend ? "weekend" : ""}`}
                          data-tutorial={
                            nurseIndex === 0 && dayIndex === 0
                              ? "assignment-cell"
                              : undefined
                          }
                          type="button"
                          key={day.key}
                          onClick={() => onEditAssignment(nurse.id, day.key)}
                          aria-label={`Edit ${nurse.name}'s ${day.label} assignment, currently Off`}
                        >
                          <span>Off</span>
                          <Pencil
                            className="shift-edit-icon"
                            size={11}
                            aria-hidden="true"
                          />
                        </button>
                      );
                    const recordedRequest =
                      requests[requestKey(nurse.id, day.key)];
                    const requestOutcome = explainRequestOutcome(
                      assignments,
                      requests,
                      nurseList,
                      nurse.id,
                      day.key,
                    );
                    const requestCaution = cautionForRequest(
                      recordedRequest,
                      requestOutcome,
                      day,
                    );
                    const cautions = requestCaution ? [requestCaution] : [];
                    const cautionText = [
                      ...cautions.map((item) => `${item.title}: ${item.body}`),
                    ].join(" ");
                    return (
                      <button
                        className={`shift-cell ${assignedShifts[0].code} ${overtimeHours ? "overtime" : ""} ${cautionText ? "nonpreferred" : ""} ${day.weekend ? "weekend" : ""}`}
                        data-tutorial={
                          nurseIndex === 0 && dayIndex === 0
                            ? "assignment-cell"
                            : undefined
                        }
                        type="button"
                        key={day.key}
                        onClick={() => onEditAssignment(nurse.id, day.key)}
                        aria-label={`Edit ${nurse.name}'s ${day.label} assignment, currently ${assignedShifts.map((shift) => shift.label).join(" and ")}${extendedDuty ? `. Extended overtime duty ${extendedDuty.start} to ${extendedDuty.end}, covering part of the unavailable ${dutyLabels[extendedDuty.coveredShift]} shift` : ""}${cautionText ? `. Caution: ${cautionText}` : ""}`}
                      >
                        <span className="shift-stack">
                          {assignedShifts.map((shift) => (
                            <span key={shift.code}>
                              <strong>{shift.shortLabel}</strong>
                              <small>
                                {extendedDuty?.regularShift === shift.code
                                  ? `${extendedDuty.start}–${extendedDuty.end}`
                                  : shift.start}
                              </small>
                            </span>
                          ))}
                        </span>
                        {cautionText ? (
                          <i
                            title={cautionText}
                            aria-label={`Caution: ${cautionText}`}
                          >
                            !
                          </i>
                        ) : null}
                        {overtimeHours ? (
                          <em className="overtime-badge">+{overtimeHours}h OT</em>
                        ) : null}
                        <Pencil
                          className="shift-edit-icon"
                          size={11}
                          aria-hidden="true"
                        />
                      </button>
                    );
                  })}
                  <div
                    className={`hours-cell ${count > nurse.targetShifts ? "over" : ""}`}
                  >
                    <strong>
                      {scheduledHours(assignments, nurse.id, shiftDefinitions) +
                        overtimeCoverage.reduce(
                          (total, entry) =>
                            entry.nurseIds.includes(nurse.id)
                              ? total + entry.hoursEach
                              : total,
                          0,
                        )}
                    </strong>
                    <span> hours</span>
                  </div>
                </div>
              );
            })}
            {(["morning", "afternoon", "night", "rest"] as DutyCode[]).map(
              (duty) => (
                <div className="schedule-grid daily-summary-row" key={duty}>
                  <div className="person-column">
                    <strong>{dutyShortLabels[duty]}</strong>
                    <small>Daily count</small>
                  </div>
                  {weekDays.map((day) => {
                    const direct = assignments[dutyKey(day.key, duty)]?.length ?? 0;
                    const overtime = ["morning", "afternoon", "night"].includes(duty)
                      ? overtimePositionsCovered(
                          overtimeCoverage,
                          day.key,
                          duty as ShiftCode,
                        )
                      : 0;
                    const required = ["morning", "afternoon", "night"].includes(duty)
                      ? requirementMap[dutyKey(day.key, duty)] ?? 0
                      : 0;
                    const understaffed = required > direct + overtime;
                    return (
                      <div
                        className={`daily-summary-cell ${duty} ${understaffed ? "understaffed" : ""}`}
                        key={day.key}
                        title={understaffed ? `${direct + overtime} of ${required} required nurses covered` : undefined}
                      >
                        {direct + overtime}{overtime ? <small>+OT</small> : null}
                      </div>
                    );
                  })}
                  <div className="hours-cell summary-total">
                    {weekDays.reduce(
                      (total, day) =>
                        total + (assignments[dutyKey(day.key, duty)]?.length ?? 0),
                      0,
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
          {nurseList.length ? (
            <footer className="schedule-legend">
              {activeShifts.map((shift) => (
                <span key={shift.code}>
                  <i className={`legend-dot ${shift.code}`} />
                  {shift.label} · {shift.time}
                </span>
              ))}
              <span>
                <i className="legend-marker">!</i>Caution
              </span>
              <small>
                Open any cell to edit it. Mandatory leave and rule conflicts
                remain marked until resolved.
              </small>
            </footer>
          ) : (
            <div className="schedule-empty">
              <Users size={27} />
              <strong>No nurses added yet</strong>
              <p>
                Add your nursing team first, then import any requests and
                generate the two-week period.
              </p>
            </div>
          )}
        </div>

        <aside className="attention-panel" aria-label="Schedule decisions">
          <header>
            <div>
              <span
                className={`attention-icon ${needsAttention ? "" : "resolved"}`}
              >
                {needsAttention ? (
                  <AlertTriangle size={18} />
                ) : (
                  <ShieldCheck size={18} />
                )}
              </span>
              <div>
                <span>
                  {needsAttention ? "NEEDS ATTENTION" : "READY FOR REVIEW"}
                </span>
                <h2>
                  {incomplete.length
                    ? `${incomplete.length} coverage decision${incomplete.length === 1 ? "" : "s"}`
                    : blockingIssues.length
                      ? `${blockingIssues.length} blocking rule${blockingIssues.length === 1 ? "" : "s"}`
                      : timeGaps.length
                        ? "Shift coverage gap"
                    : "Schedule complete"}
                </h2>
              </div>
            </div>
            <button
              className="attention-more"
              type="button"
              onClick={onReviewDetails}
              aria-label="Open schedule review details"
            >
              <MoreHorizontal size={18} />
            </button>
          </header>
          {incomplete.length ? (
            incomplete.map(([key, required], decisionIndex) => {
              const separator = key.lastIndexOf("-");
              const dayKey = key.slice(0, separator);
              const shiftCode = key.slice(separator + 1) as ShiftCode;
              const day = weekDays.find((item) => item.key === dayKey)!;
              const shift = shiftDefinitions.find(
                (item) => item.code === shiftCode,
              )!;
              const assigned = assignments[key]?.length ?? 0;
              const overtimeCount = overtimePositionsCovered(
                overtimeCoverage,
                dayKey,
                shiftCode,
              );
              const covered = assigned + overtimeCount;
              const remaining = Math.max(0, required - covered);
              const assignedChargeNurses = (assignments[key] ?? []).filter(
                (id) => nurseById.get(id)?.role === "Charge nurse",
              ).length;
              const missingChargeNurses = Math.max(
                0,
                (chargeRequirementMap[key] ?? 0) - assignedChargeNurses,
              );
              return (
                <article
                  className="coverage-card"
                  data-tutorial={
                    decisionIndex === 0 ? "coverage-decision" : undefined
                  }
                  key={key}
                >
                  <div className="coverage-card-top">
                    <span className={`shift-symbol ${shift.code}`}>
                      <Clock3 size={16} />
                    </span>
                    <div>
                      <strong>
                        {day.label}, {day.date}
                        {day.year ? `, ${day.year}` : ""} · {shift.label}
                      </strong>
                      <span>{shift.time}</span>
                    </div>
                  </div>
                  <div className="coverage-progress">
                    <div>
                      <i
                        style={{
                          width: `${Math.min(100, (covered / required) * 100)}%`,
                        }}
                      />
                    </div>
                    <strong>
                      {covered}/{required}
                    </strong>
                  </div>
                  <p>
                    {remaining > 0
                      ? `${remaining} position${remaining === 1 ? "" : "s"} remain.`
                      : "Minimum headcount is covered."}
                    {overtimeCount > 0
                      ? ` ${overtimeCount} position${overtimeCount === 1 ? " is" : "s are"} covered by converting the adjacent duties into paired 12-hour shifts.`
                      : ""}
                    {missingChargeNurses > 0
                      ? ` ${missingChargeNurses} charge nurse${missingChargeNurses === 1 ? "" : "s"} still required.`
                      : ""}
                  </p>
                  <button
                    type="button"
                    onClick={() => onResolve(dayKey, shiftCode)}
                  >
                    Assign forced overtime
                    <ChevronRight size={16} />
                  </button>
                </article>
              );
            })
          ) : blockingIssues.length || timeGaps.length ? (
            <div className="all-clear needs-review" data-tutorial="coverage-decision">
              <AlertTriangle size={28} />
              <strong>Schedule changes need review</strong>
              <p>
                Read the rule flags below, edit the affected assignments, or
                regenerate the draft before publishing.
              </p>
            </div>
          ) : (
            <div className="all-clear" data-tutorial="coverage-decision">
              <CheckCircle2 size={28} />
              <strong>Every shift is covered</strong>
              <p>
                Open any caution marker to review its exact reason, then publish
                when ready.
              </p>
            </div>
          )}
          {scheduleIssues.length ? (
            <div className="schedule-issue-list" aria-label="Schedule rule checks">
              {scheduleIssues.slice(0, 6).map((issue) => (
                <article className={`schedule-issue ${issue.severity}`} key={issue.id}>
                  <AlertTriangle size={16} />
                  <p><strong>{issue.title}</strong>{issue.detail}</p>
                </article>
              ))}
              {scheduleIssues.length > 6 ? (
                <small>+ {scheduleIssues.length - 6} more checks in review details</small>
              ) : null}
            </div>
          ) : null}
          <div className="decision-note">
            <Sparkles size={16} />
            <p>
              <strong>
                {needsAttention ? "Why HANDLED paused" : "Head-nurse review"}
              </strong>
              {needsAttention
                ? "HANDLED blocks publication when a coverage or scheduling rule is broken and identifies the affected nurse or date."
                : "HANDLED keeps request exceptions and attendance cautions visible so the head nurse controls the final schedule."}
            </p>
          </div>
          {timeGaps.length ? (
            <div className="coverage-time-warning" role="alert">
              <AlertTriangle size={18} />
              <p>
                <strong>ER time coverage gap</strong>No active shift covers{" "}
                {timeGaps.map((gap) => gap.label).join(", ")}. Edit shift times
                before publishing.
              </p>
            </div>
          ) : null}
          <button
            className="publish-button"
            type="button"
            onClick={onPublish}
            disabled={
              incomplete.length > 0 ||
              timeGaps.length > 0 ||
              blockingIssues.length > 0 ||
              published
            }
          >
            <Check size={17} />
            {published ? "Schedule published" : "Publish schedule"}
          </button>
        </aside>
      </section>
    </>
  );
}

function PreferencesView({
  preferences,
  workRequests,
  shiftDefinitions,
  nurseList,
  weekDays,
  canReusePrevious,
  onImport,
  onDownload,
  onReusePrevious,
  onEdit,
}: {
  preferences: PreferenceMap;
  workRequests: WorkRequestMap;
  shiftDefinitions: ShiftDefinition[];
  nurseList: Nurse[];
  weekDays: ScheduleDay[];
  canReusePrevious: boolean;
  onImport: () => void;
  onDownload: () => void;
  onReusePrevious: () => void;
  onEdit: (nurse: Nurse) => void;
}) {
  const hasPreferences = Object.keys(preferences).length > 0;
  const activeShifts = shiftDefinitions.filter((shift) => shift.enabled);
  const expected = days.length * activeShifts.length;
  const matchedCount = nurseList.filter((nurse) =>
    days.every((day) =>
      activeShifts.every((shift) =>
        Boolean(preferences[preferenceKey(nurse.id, day.key, shift.code)]),
      ),
    ),
  ).length;
  return (
    <section className="content-panel preferences-panel">
      <header className="content-heading">
        <div>
          <span>RESPONSE READINESS</span>
          <h2>
            {!nurseList.length
              ? "Set up your first preference file"
              : hasPreferences
                ? `${matchedCount} of ${nurseList.length} responses ready`
                : "No preference responses yet"}
          </h2>
          <p>
            Edit each nurse directly or import the Google Forms file.
            Preferences stay separate for every planning week.
          </p>
        </div>
        <div className="preference-actions" data-tutorial="preferences-actions">
          {!hasPreferences ? (
            <button
              className="secondary-button reuse-button"
              type="button"
              onClick={onReusePrevious}
              disabled={!canReusePrevious}
              title={
                canReusePrevious
                  ? "Copy the previous planning week’s preferences"
                  : "No previous week preferences are available"
              }
            >
              <ChevronLeft size={16} />
              Use previous week
            </button>
          ) : null}
          <button
            className="secondary-button"
            type="button"
            onClick={onDownload}
          >
            <Download size={16} />
            Excel template
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={onImport}
            disabled={!nurseList.length}
          >
            <Upload size={16} />
            Import file
          </button>
        </div>
      </header>
      {nurseList.length ? (
        <>
          <div
            className={`preference-summary ${hasPreferences ? "" : "empty"}`}
          >
            <div>
              {hasPreferences ? (
                <CheckCircle2 size={18} />
              ) : (
                <Clock3 size={18} />
              )}
              <span>
                <strong>
                  {hasPreferences
                    ? "Preferences ready for this week"
                    : "No preferences for this week"}
                </strong>
                {hasPreferences
                  ? "Generate the schedule when the head nurse is ready."
                  : "Import responses, use the previous week, or edit a nurse directly below."}
              </span>
            </div>
            <small>{weekRangeLabel(weekDays)}</small>
          </div>
          <div className="data-table preference-table">
            <div className="data-table-head">
              <span>Nurse</span>
              <span>Preferred</span>
              <span>Available</span>
              <span>Prefer not</span>
              <span>Unavailable</span>
              <span>Not working</span>
              <span>Extra work</span>
              <span>Response</span>
              <span>Edit</span>
            </div>
            {nurseList.map((nurse, nurseIndex) => {
              const values = days.flatMap((day) =>
                activeShifts.map(
                  (shift) =>
                    preferences[preferenceKey(nurse.id, day.key, shift.code)],
                ),
              );
              const count = (level: PreferenceLevel) =>
                values.filter((value) => value === level).length;
              const responded = values.every(Boolean);
              const entered = values.filter(Boolean).length;
              const notWorking =
                count("leave") + count("sick") + count("absent");
              const request = workRequests[nurse.id];
              return (
                <div className="data-table-row" key={nurse.id}>
                  <span className="table-person">
                    <i>{nurse.initials}</i>
                    <span>
                      <strong>{nurse.name}</strong>
                      <small>{nurse.id}</small>
                    </span>
                  </span>
                  <strong>{count("preferred")}</strong>
                  <span>{count("available")}</span>
                  <span>{count("avoid")}</span>
                  <span>{count("unavailable")}</span>
                  <span>{notWorking}</span>
                  <span className="flexibility-status">
                    {request?.overtime ? <em>Overtime</em> : null}
                    {request?.doubleShift ? <em>Double</em> : null}
                    {!request?.overtime && !request?.doubleShift
                      ? "Standard"
                      : null}
                  </span>
                  <span className={responded ? "matched" : "pending-status"}>
                    {responded ? <Check size={14} /> : <Clock3 size={14} />}
                    {responded
                      ? "Ready"
                      : entered
                        ? `${entered}/${expected}`
                        : "Not set"}
                  </span>
                  <span className="row-actions">
                    <button
                      type="button"
                      data-tutorial={
                        nurseIndex === 0 ? "preference-edit" : undefined
                      }
                      onClick={() => onEdit(nurse)}
                      aria-label={`Edit preferences for ${nurse.name}`}
                      title="Edit preferences"
                    >
                      <Pencil size={14} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="view-empty">
          <FileSpreadsheet size={30} />
          <strong>No roster to match yet</strong>
          <p>
            Add nurses under Nursing team. HANDLED will then build a clean Excel
            template with their IDs and names already filled in.
          </p>
        </div>
      )}
    </section>
  );
}

function RequestPreferencesView({
  requests,
  assignments,
  nurseList,
  weekDays,
  requestPortal,
  requestLink,
  requestSubmissions,
  requestComments,
  canManagePortal,
  portalBusy,
  canReusePrevious,
  onImport,
  onDownload,
  onReusePrevious,
  onEdit,
  onUpdatePortal,
  onCopyLink,
  onRefreshResponses,
}: {
  requests: ScheduleRequestMap;
  assignments: AssignmentMap;
  nurseList: Nurse[];
  weekDays: ScheduleDay[];
  requestPortal?: RequestPortal;
  requestLink: string | null;
  requestSubmissions: Record<string, string>;
  requestComments: Record<string, string>;
  canManagePortal: boolean;
  portalBusy: boolean;
  canReusePrevious: boolean;
  onImport: () => void;
  onDownload: () => void;
  onReusePrevious: () => void;
  onEdit: (nurse: Nurse) => void;
  onUpdatePortal: (action: "create" | "update" | "revoke", maxRequests: number) => void;
  onCopyLink: () => void;
  onRefreshResponses: () => void;
}) {
  const hasRequests = Object.keys(requests).length > 0;
  const hasSchedule = Object.values(assignments).some((ids) => ids.length);
  const [staffLimit, setStaffLimit] = useState(requestPortal?.maxRequests ?? 5);
  useEffect(() => {
    setStaffLimit(requestPortal?.maxRequests ?? 5);
  }, [requestPortal?.maxRequests]);
  const responded = nurseList.filter(
    (nurse) => requestSubmissions[nurse.id],
  ).length;
  const hasActivity = hasRequests || responded > 0;
  return (
    <section className="content-panel preferences-panel">
      <header className="content-heading">
        <div>
          <span>TWO-WEEK REQUESTS</span>
          <h2>
            {!nurseList.length
              ? "Set up the nursing team first"
              : hasActivity
                ? `${responded} of ${nurseList.length} staff submitted the form`
                : "No requests for this period"}
          </h2>
          <p>
            Share one protected link for this two-week period, monitor who has
            responded, and review every request before generating.
          </p>
        </div>
        <div className="preference-actions" data-tutorial="preferences-actions">
          {!hasRequests ? (
            <button
              className="secondary-button reuse-button"
              type="button"
              onClick={onReusePrevious}
              disabled={!canReusePrevious}
            >
              <ChevronLeft size={16} />
              Use previous period
            </button>
          ) : null}
          <button className="secondary-button" type="button" onClick={onDownload}>
            <Download size={16} />
            Excel template
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={onImport}
            disabled={!nurseList.length}
          >
            <Upload size={16} />
            Import file
          </button>
        </div>
      </header>
      <div className={`request-portal-panel ${requestPortal?.enabled ? "active" : ""}`}>
        <div className="request-portal-copy">
          <span className="request-portal-icon"><Link2 size={19} /></span>
          <div>
            <span>STAFF REQUEST LINK</span>
            <h3>{requestPortal?.enabled ? "Request form is open" : "Collect requests without a spreadsheet"}</h3>
            <p>
              Nurses verify their Employee ID and surname. The shared link does not
              display the roster, and it accepts scheduling information only.
            </p>
          </div>
        </div>
        <div className="request-portal-controls">
          <label>
            <span>Maximum dates each staff member may request</span>
            <input
              type="number"
              min="1"
              max="14"
              value={staffLimit}
              onChange={(event) =>
                setStaffLimit(Math.max(1, Math.min(14, Number(event.target.value) || 1)))
              }
              disabled={!canManagePortal || portalBusy}
            />
          </label>
          {requestPortal?.enabled && requestLink ? (
            <div className="request-link-row">
              <input value={requestLink} readOnly aria-label="Staff request link" />
              <button className="secondary-button" type="button" onClick={onCopyLink}>
                <Copy size={15} /> Copy link
              </button>
            </div>
          ) : null}
          <div className="request-portal-actions">
            <button
              className="primary-button"
              type="button"
              disabled={!canManagePortal || portalBusy || !nurseList.length}
              onClick={() =>
                onUpdatePortal(requestPortal?.enabled ? "update" : "create", staffLimit)
              }
            >
              <Link2 size={15} />
              {portalBusy
                ? "Saving…"
                : requestPortal?.enabled
                  ? "Save request limit"
                  : "Create request link"}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!canManagePortal || portalBusy || !requestPortal?.enabled}
              onClick={onRefreshResponses}
            >
              <RefreshCw size={15} /> Refresh responses
            </button>
            {requestPortal?.enabled ? (
              <button
                className="text-button danger-text"
                type="button"
                disabled={!canManagePortal || portalBusy}
                onClick={() => onUpdatePortal("revoke", staffLimit)}
              >
                Close form
              </button>
            ) : null}
          </div>
          {!canManagePortal ? (
            <small>Sign in to a private workspace to create a live staff link.</small>
          ) : null}
        </div>
      </div>
      {nurseList.length ? (
        <>
          <div className={`preference-summary ${hasActivity ? "" : "empty"}`}>
            <div>
              {hasActivity ? <CheckCircle2 size={18} /> : <Clock3 size={18} />}
              <span>
                <strong>
                  {hasActivity
                    ? "Staff responses recorded"
                    : "Requests are optional"}
                </strong>
                {hasActivity
                   ? "Review the submitted dates, then generate the two-week schedule."
                  : "Generate now, import a form, or add requests directly below."}
              </span>
            </div>
            <small>{weekRangeLabel(weekDays)}</small>
          </div>
          <div className="data-table preference-table request-table">
            <div className="data-table-head">
              <span>Nurse</span>
              <span>Form status</span>
              <span>Shift</span>
              <span>REST</span>
              <span>Leave</span>
              <span>Summary</span>
              <span>Outcome</span>
              <span>Edit</span>
            </div>
            {nurseList.map((nurse, nurseIndex) => {
              const values = planningDays.flatMap((day) => {
                const request = requests[requestKey(nurse.id, day.key)];
                return request ? [request] : [];
              });
              const shiftsRequested = values.filter((request) =>
                ["morning", "afternoon", "night"].includes(request.choice),
              ).length;
              const rest = values.filter((request) => request.choice === "rest").length;
              const leave = values.filter((request) => isLeaveDuty(request.choice)).length;
              const submittedAt = requestSubmissions[nurse.id];
              const outcomes = planningDays.flatMap((day) => {
                const outcome = explainRequestOutcome(
                  assignments,
                  requests,
                  nurseList,
                  nurse.id,
                  day.key,
                );
                return outcome ? [outcome] : [];
              });
              const granted = outcomes.filter(
                (outcome) => outcome.status === "granted",
              ).length;
              const unmet = outcomes.filter(
                (outcome) => outcome.status === "unmet",
              ).length;
              return (
                <div className="data-table-row" key={nurse.id}>
                  <span className="table-person">
                    <i>{nurse.initials}</i>
                    <span>
                      <strong>{nurse.name}</strong>
                      <small>{nurse.id}</small>
                    </span>
                  </span>
                  <span className={`submission-status ${submittedAt ? "submitted" : "pending"}`}>
                    {submittedAt ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
                    <span>
                      <strong>{submittedAt ? "Submitted" : "Not submitted"}</strong>
                      {submittedAt ? (
                        <small>
                          {new Date(submittedAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </small>
                      ) : null}
                    </span>
                  </span>
                  <strong>{shiftsRequested}</strong>
                  <span>{rest}</span>
                  <span>{leave}</span>
                  <span className="request-comment-preview" title={requestComments[nurse.id]}>
                    {requestComments[nurse.id] || "No comment"}
                  </span>
                  <span
                    className={`request-result-summary ${
                      unmet ? "unmet" : hasSchedule && values.length ? "granted" : "pending"
                    }`}
                    title={
                      unmet
                        ? `${unmet} request${unmet === 1 ? "" : "s"} not granted. Open Edit for reasons.`
                        : undefined
                    }
                  >
                    {hasSchedule && values.length ? (
                      unmet ? <AlertTriangle size={14} /> : <Check size={14} />
                    ) : (
                      <Clock3 size={14} />
                    )}
                    {!values.length
                      ? "No requests"
                      : hasSchedule
                        ? `${granted}/${values.length} granted`
                        : `${values.length} awaiting draft`}
                  </span>
                  <span className="row-actions">
                    <button
                      type="button"
                      data-tutorial={nurseIndex === 0 ? "preference-edit" : undefined}
                      onClick={() => onEdit(nurse)}
                      aria-label={`Edit requests for ${nurse.name}`}
                      title="Edit requests"
                    >
                      <Pencil size={14} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="view-empty">
          <FileSpreadsheet size={30} />
          <strong>No roster to match yet</strong>
          <p>Add nurses first so HANDLED can prepare the structured request file.</p>
        </div>
      )}
    </section>
  );
}

function ReportsView({
  weeks,
  weekOffset,
  requirementMap,
  nurseList,
  shiftDefinitions,
}: {
  weeks: Record<string, WeekRecord>;
  weekOffset: number;
  requirementMap: Record<string, number>;
  nurseList: Nurse[];
  shiftDefinitions: ShiftDefinition[];
}) {
  const [period, setPeriod] = useState<"month" | "year">("month");
  const anchorDate = new Date(2026, 8, 13 + weekOffset * 14);
  const periodStart =
    period === "month"
      ? new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1)
      : new Date(anchorDate.getFullYear(), 0, 1);
  const periodEnd =
    period === "month"
      ? new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 1)
      : new Date(anchorDate.getFullYear() + 1, 0, 1);
  const periodLabel =
    period === "month"
      ? anchorDate.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        })
      : String(anchorDate.getFullYear());
  const generatedWeeks = Object.entries(weeks)
    .map(([key, record]) => {
      const offset = Number(key);
      const start = new Date(2026, 8, 13 + offset * 14);
      const end = new Date(start);
      end.setDate(start.getDate() + 14);
      const assigned = Object.entries(record.assignments).reduce(
        (sum, [key, nurseIds]) =>
          ["morning", "afternoon", "night"].some((code) =>
            key.endsWith(`-${code}`),
          )
            ? sum + nurseIds.length
            : sum,
        0,
      );
      const required = Object.values(
        requirementMapFromDailyCoverage(
          record.dailyCoverage ?? createDailyCoverage(),
        ),
      ).reduce((sum, value) => sum + value, 0);
      const overtimePositions = record.overtimeCoverage?.length ?? 0;
      const requestEntries = Object.entries(record.requests ?? {});
      const requestsMet = requestEntries.filter(([key, request]) => {
        const separator = key.lastIndexOf("-");
        return (
          assignedDutyOnDay(
            record.assignments,
            key.slice(0, separator),
            key.slice(separator + 1),
          ) === request.choice
        );
      }).length;
      return {
        offset,
        record,
        start,
        end,
        assigned: assigned + overtimePositions,
        required,
        requestCount: requestEntries.length,
        requestsMet,
      };
    })
    .filter(
      (week) =>
        week.start < periodEnd &&
        week.end > periodStart &&
        Object.keys(week.record.assignments).length > 0,
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const assignedTotal = generatedWeeks.reduce(
    (sum, week) => sum + week.assigned,
    0,
  );
  const requiredTotal = generatedWeeks.reduce(
    (sum, week) => sum + week.required,
    0,
  );
  const requestTotal = generatedWeeks.reduce(
    (sum, week) => sum + week.requestCount,
    0,
  );
  const requestsMetTotal = generatedWeeks.reduce(
    (sum, week) => sum + week.requestsMet,
    0,
  );
  const coverage = generatedWeeks.length
    ? Math.min(
        100,
        Math.round(
          (assignedTotal / Math.max(1, requiredTotal)) * 100,
        ),
      )
    : 0;
  const requestRate = requestTotal
    ? Math.round((requestsMetTotal / requestTotal) * 100)
    : 100;
  const publishedCount = generatedWeeks.filter(
    (week) => week.record.published,
  ).length;
  const shiftTotals = shiftDefinitions
    .filter((shift) => shift.enabled)
    .map((shift) => ({
      ...shift,
      count: generatedWeeks.reduce(
        (sum, week) =>
          sum +
          planningDays.reduce(
            (daySum, day) =>
              daySum +
              (week.record.assignments[shiftKey(day.key, shift.code)]?.length ??
                0) +
              overtimePositionsCovered(
                week.record.overtimeCoverage ?? [],
                day.key,
                shift.code,
              ),
            0,
          ),
        0,
      ),
    }));
  const maxShiftTotal = Math.max(1, ...shiftTotals.map((shift) => shift.count));
  const nurseHours = nurseList
    .map((nurse) => ({
      nurse,
      shifts: generatedWeeks.reduce(
        (sum, week) =>
          sum + countAssignments(week.record.assignments, nurse.id),
        0,
      ),
      hours: generatedWeeks.reduce(
        (sum, week) =>
          sum +
          scheduledHours(week.record.assignments, nurse.id, shiftDefinitions) +
          (week.record.overtimeCoverage ?? []).reduce(
            (overtime, entry) =>
              entry.nurseIds.includes(nurse.id)
                ? overtime + entry.hoursEach
                : overtime,
            0,
          ),
        0,
      ),
    }))
    .filter((entry) => entry.hours > 0)
    .sort(
      (a, b) => b.hours - a.hours || a.nurse.name.localeCompare(b.nurse.name),
    );
  const scheduledHoursTotal = nurseHours.reduce(
    (sum, entry) => sum + entry.hours,
    0,
  );

  return (
    <section className="content-panel reports-panel">
      <header className="content-heading">
        <div>
          <span>MONTHLY AND YEARLY VIEW</span>
          <h2>{periodLabel} schedule report</h2>
          <p>Summaries use generated schedules saved in this HANDLED workspace.</p>
        </div>
        <div
          className="report-period-toggle"
          data-tutorial="report-period"
          role="group"
          aria-label="Report period"
        >
          <button
            type="button"
            className={period === "month" ? "active" : ""}
            aria-pressed={period === "month"}
            onClick={() => setPeriod("month")}
          >
            Month
          </button>
          <button
            type="button"
            className={period === "year" ? "active" : ""}
            aria-pressed={period === "year"}
            onClick={() => setPeriod("year")}
          >
            Year
          </button>
        </div>
      </header>
      {generatedWeeks.length ? (
        <>
          <div className="report-scope">
            <BarChart3 size={18} />
            <span>
              <strong>
                {generatedWeeks.length} generated period
                {generatedWeeks.length === 1 ? "" : "s"} included
              </strong>
              Periods without a generated schedule are excluded instead of being
              counted as zero staffing.
            </span>
          </div>
          <div
            className="report-metrics"
            data-tutorial="reports-content"
            aria-label={`${periodLabel} report summary`}
          >
            <article>
              <span>Coverage</span>
              <strong>{coverage}%</strong>
              <small>
                {assignedTotal} of {requiredTotal}{" "}
                positions
              </small>
            </article>
            <article>
              <span>Scheduled hours</span>
              <strong>{scheduledHoursTotal}</strong>
              <small>Across {nurseHours.length} nurses</small>
            </article>
            <article>
              <span>Requests met</span>
              <strong>{requestRate}%</strong>
              <small>
                {requestsMetTotal} of {requestTotal} recorded requests
              </small>
            </article>
            <article>
              <span>Published periods</span>
              <strong>
                {publishedCount}
                <small>/{generatedWeeks.length}</small>
              </strong>
              <small>Finalized schedules</small>
            </article>
          </div>
          <div className="report-grid">
            <section className="report-card" aria-labelledby="shift-mix-title">
              <header>
                <span>SHIFT MIX</span>
                <h3 id="shift-mix-title">Assignments by shift</h3>
              </header>
              <div className="report-bars">
                {shiftTotals.map((shift) => (
                  <div className="report-bar" key={shift.code}>
                    <span>{shift.label}</span>
                    <div>
                      <i
                        className={shift.code}
                        style={{
                          width: `${(shift.count / maxShiftTotal) * 100}%`,
                        }}
                      />
                    </div>
                    <strong>{shift.count}</strong>
                  </div>
                ))}
              </div>
            </section>
            <section
              className="report-card"
              aria-labelledby="week-status-title"
            >
              <header>
                <span>PERIOD STATUS</span>
                <h3 id="week-status-title">Included schedules</h3>
              </header>
              <div className="report-week-list">
                {generatedWeeks.map((week) => (
                  <article key={week.offset}>
                    <span>
                      <strong>Period {week.offset + 1}</strong>
                      <small>{weekRangeLabel(datesForPeriod(week.offset))}</small>
                    </span>
                    <strong>
                      {Math.min(
                        100,
                        Math.round((week.assigned / Math.max(1, week.required)) * 100),
                      )}
                      %
                    </strong>
                    <em className={week.record.published ? "published" : ""}>
                      {week.record.published ? "Published" : "Draft"}
                    </em>
                  </article>
                ))}
              </div>
            </section>
          </div>
          <section
            className="report-card report-roster"
            aria-labelledby="workload-title"
          >
            <header>
              <span>WORKLOAD</span>
              <h3 id="workload-title">Nurse hours in this {period}</h3>
            </header>
            <div className="report-table">
              <div className="report-table-head">
                <span>Nurse</span>
                <span>Shifts</span>
                <span>Hours</span>
              </div>
              {nurseHours.map(({ nurse, shifts: shiftCount, hours }) => (
                <div className="report-table-row" key={nurse.id}>
                  <span className="table-person">
                    <i>{nurse.initials}</i>
                    <span>
                      <strong>{nurse.name}</strong>
                      <small>{nurse.id}</small>
                    </span>
                  </span>
                  <span>{shiftCount}</span>
                  <strong>{hours}h</strong>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
        <div className="view-empty" data-tutorial="reports-content">
          <BarChart3 size={32} />
          <strong>No generated schedules in {periodLabel}</strong>
          <p>
            Generate a two-week schedule first. HANDLED will then build monthly and
            yearly totals from real saved assignments.
          </p>
        </div>
      )}
    </section>
  );
}

function TeamView({
  nurseList,
  staffType,
  onAdd,
  onEdit,
  onDelete,
}: {
  nurseList: Nurse[];
  staffType: WorkspaceStaffType;
  onAdd: () => void;
  onEdit: (nurse: Nurse) => void;
  onDelete: (nurse: Nurse) => void;
}) {
  const singular = staffType === "orderlies" ? "orderly" : "nurse";
  const plural = staffType === "orderlies" ? "orderlies" : "nurses";
  const [query, setQuery] = useState("");
  const filtered = nurseList.filter((nurse) =>
    `${nurse.name} ${nurse.id}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className="content-panel team-panel">
      <header className="content-heading">
        <div>
          <span>ACTIVE ROSTER</span>
          <h2>Emergency {staffType === "orderlies" ? "orderly" : "nursing"} team</h2>
          <p>Add, update, or remove the {plural} HANDLED can schedule.</p>
        </div>
        <div>
          <label className="compact-search">
            <Search size={16} />
            <input
              aria-label={`Search ${plural}`}
              placeholder={`Search ${plural}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            className="primary-button"
            data-tutorial="add-nurse"
            type="button"
            onClick={onAdd}
          >
            <Plus size={16} />
            Add {singular}
          </button>
        </div>
      </header>
      {nurseList.length ? (
        <div className="data-table team-table">
          <div className="data-table-head">
            <span>Employee</span>
            <span>Employment</span>
            <span>Actions</span>
          </div>
          {filtered.map((nurse) => (
            <div className="data-table-row" key={nurse.id}>
              <span className="table-person">
                <i>{nurse.initials}</i>
                <span>
                  <strong>{nurse.name}</strong>
                  <small>Employee ID · {nurse.id}</small>
                </span>
              </span>
              <span>
                Hired {nurse.dateHired ?? "Date not recorded"}
                {nurse.employmentEndDate
                  ? ` · Last day ${nurse.employmentEndDate}`
                  : " · Active"}
              </span>
              <span className="row-actions">
                <button
                  type="button"
                  onClick={() => onEdit(nurse)}
                  aria-label={`Edit ${nurse.name}`}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="danger"
                  type="button"
                  onClick={() => onDelete(nurse)}
                  aria-label={`Remove ${nurse.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="view-empty">
          <Users size={30} />
          <strong>Build your {staffType === "orderlies" ? "orderly" : "nursing"} team</strong>
          <p>
            This workspace starts empty. Add the first {singular} to create a private
            roster for this planning session.
          </p>
          <button
            className="primary-button"
            data-tutorial="add-nurse"
            type="button"
            onClick={onAdd}
          >
            <Plus size={16} />
            Add first {singular}
          </button>
        </div>
      )}
    </section>
  );
}

function TwoWeekRulesView({
  settings,
  dailyCoverage,
  weekDays,
  onEdit,
  canDelete,
  onDeleteWorkspace,
}: {
  settings: CoverageSettings;
  dailyCoverage: DailyCoverage;
  weekDays: ScheduleDay[];
  onEdit: () => void;
  canDelete: boolean;
  onDeleteWorkspace: () => void;
}) {
  const enforced = [
    ["Two-week period", "14 consecutive dates", "Every generated roster covers the full period."],
    ["Daily balance", `6, 2, and N differ by no more than ${settings.twoWeekRules.maxDailyShiftDifference}`, "HANDLED distributes working nurses as evenly as possible."],
    ["Weekly REST", `${settings.twoWeekRules.restDaysPerWeek} REST days per nurse, per week`, `No more than ${settings.twoWeekRules.maxRestPerDay} nurses rest on one date.`],
    ["Recovery", "Fixed 16-hour minimum between working duties", "After N, the next duty is N or REST. After N or 2 plus one REST day, the next working duty cannot be 6. Training cannot follow N."],
    ["Hours", `${settings.twoWeekRules.minHoursPerPeriod}–${settings.twoWeekRules.maxHoursPerPeriod} hours per two-week schedule`, `Limits are prorated for employees hired or leaving mid-period; forced overtime never exceeds ${settings.twoWeekRules.maxConsecutiveHours} continuous hours.`],
    ["Individual fairness", `Shift-count difference up to ${settings.twoWeekRules.maxIndividualShiftDifference}`, "A larger difference is flagged for review."],
    ["Competing requests", "Fewer fulfilled requests receive priority", "Prior denials are considered next; any exact tie rotates between two-week periods."],
    ["Requests", "Staff link limit is configurable from 1 to 14 dates", "Head-nurse entry is unlimited; Birthday Leave, Personal Leave, and Training are protected before ordinary scheduling."],
  ];
  return (
    <section className="content-panel rules-panel">
      <header className="content-heading">
        <div>
          <span>HEAD-NURSE SCHEDULING STANDARD</span>
          <h2>Rules HANDLED enforces automatically</h2>
          <p>
            All nurses are scheduled equally. Roles and charge-nurse labels do
            not affect assignment priority.
          </p>
        </div>
        <button className="secondary-button" data-tutorial="edit-rules" type="button" onClick={onEdit}>
          <Settings2 size={16} /> Edit rules
        </button>
      </header>
      <div className="coverage-safe">
        <ShieldCheck size={18} />
        <span>
          <strong>Fixed 24-hour shift cycle</strong>
          6 · 6:00 AM–2:00 PM &nbsp; 2 · 2:00 PM–10:00 PM &nbsp; N · 10:00 PM–6:00 AM
        </span>
      </div>
      <div className="official-shift-cards" aria-label="Official shift codes">
        {officialShifts.map((shift) => (
          <article className={shift.code} key={shift.code}>
            <strong>{shift.shortLabel}</strong>
            <span>{shift.label}</span>
            <small>{shift.time}</small>
          </article>
        ))}
        <article className="rest"><strong>REST</strong><span>Rest day</span><small>Exactly two per week</small></article>
      </div>
      <div className="rule-list" data-tutorial="edit-rules">
        {enforced.map(([title, primary, secondary], index) => (
          <article key={title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div><strong>{title}</strong><p>{primary}</p></div>
            <small>{secondary}</small>
            <ShieldCheck size={17} aria-label="Automatically enforced" />
          </article>
        ))}
      </div>
      <section className="daily-rule-summary" aria-labelledby="daily-rule-title">
        <header>
          <div>
            <span>DAILY STAFFING MINIMUMS</span>
            <h3 id="daily-rule-title">Required nurses for each shift and date</h3>
          </div>
          <button className="secondary-button" type="button" onClick={onEdit}>
            <Pencil size={15} /> Edit daily numbers
          </button>
        </header>
        <div className="daily-rule-grid">
          <span>Date</span><span>6</span><span>2</span><span>N</span>
          {weekDays.flatMap((day) => [
            <strong key={`${day.key}-date`}>{day.shortLabel} {day.date}</strong>,
            <span key={`${day.key}-6`}>{dailyCoverage[day.key]?.morning ?? 0}</span>,
            <span key={`${day.key}-2`}>{dailyCoverage[day.key]?.afternoon ?? 0}</span>,
            <span key={`${day.key}-n`}>{dailyCoverage[day.key]?.night ?? 0}</span>,
          ])}
        </div>
      </section>
      <div className="safety-note">
        <ShieldCheck size={20} />
        <div>
          <strong>Head-nurse review remains required</strong>
          <p>HANDLED flags rules it cannot satisfy, but the head nurse remains responsible for final staffing, competence mix, surge conditions, and hospital policy.</p>
        </div>
      </div>
      {canDelete ? (
        <div className="danger-zone">
          <div><strong>Delete private workspace</strong><p>Permanently removes this account’s nurse roster, requests, schedules, and reports.</p></div>
          <button className="danger-button" type="button" onClick={onDeleteWorkspace}><Trash2 size={15} />Delete workspace</button>
        </div>
      ) : null}
    </section>
  );
}

function RulesView({
  settings,
  nurseList,
  canDelete,
  onEdit,
  onDeleteWorkspace,
}: {
  settings: CoverageSettings;
  nurseList: Nurse[];
  canDelete: boolean;
  onEdit: () => void;
  onDeleteWorkspace: () => void;
}) {
  const bedFloor = Math.ceil(settings.erBeds / 3);
  const requirementMap = coverageRequirements(nurseList, {});
  const chargeRequirementMap = chargeRequirements();
  const weeklyRequired = Object.values(requirementMap).reduce(
    (sum, required) => sum + required,
    0,
  );
  const weeklyChargeRequired = Object.values(chargeRequirementMap).reduce(
    (sum, required) => sum + required,
    0,
  );
  const weeklyCapacity = nurseList.reduce(
    (sum, nurse) => sum + Math.min(nurse.targetShifts, settings.maximumShifts),
    0,
  );
  const weeklyChargeCapacity = nurseList
    .filter((nurse) => nurse.role === "Charge nurse")
    .reduce(
      (sum, nurse) =>
        sum + Math.min(nurse.targetShifts, settings.maximumShifts),
      0,
    );
  const minimumRoster = Math.ceil(weeklyRequired / settings.maximumShifts);
  const activeShifts = settings.shiftDefinitions.filter(
    (shift) => shift.enabled,
  );
  const timeGaps = coverageGaps(settings.shiftDefinitions);
  const coverageFor = (
    code: ShiftCode,
    rule: CoverageSettings | CoverageOverride = settings,
  ) =>
    code === "morning"
      ? rule.morningCoverage
      : code === "afternoon"
        ? rule.afternoonCoverage
        : rule.nightCoverage;
  const rules = [
    ...settings.shiftDefinitions.map((shift) => [
      shift.label,
      shift.enabled
        ? `${shift.time} · ${coverageFor(shift.code)} nurses minimum`
        : "Disabled",
      shift.enabled
        ? `${shift.shortLabel} · active every day unless a day exception changes staffing`
        : "Excluded from preferences, generation, coverage, and exports",
    ]),
    [
      "ER bed baseline",
      `${settings.erBeds} treatment beds`,
      `DOH floor: ${bedFloor} nurses per shift`,
    ],
    [
      "Leadership",
      `${settings.chargeNursesPerShift} charge nurse${settings.chargeNursesPerShift === 1 ? "" : "s"} per shift`,
      "Can be overridden for weekends or individual days",
    ],
    [
      "Rest and workload",
      `${settings.preventNightToMorning ? "Block" : "Allow"} night-to-morning · max ${settings.maximumShifts} shifts`,
      "Overtime and consecutive double shifts require weekly nurse consent",
    ],
  ];
  const targetLabels: Record<CoverageRuleTarget, string> = {
    weekend: "Weekend (Saturday and Sunday)",
    sun: "Sunday",
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
  };
  return (
    <section className="content-panel rules-panel">
      <header className="content-heading">
        <div>
          <span>ER COVERAGE PROFILE</span>
          <h2>Rules HANDLED checks before assigning</h2>
          <p>
            Set active shift times, normal staffing, then add weekend or
            specific-day exceptions.
          </p>
        </div>
        <button
          className="secondary-button"
          data-tutorial="edit-rules"
          type="button"
          onClick={onEdit}
        >
          <Settings2 size={16} />
          Edit rules
        </button>
      </header>
      {timeGaps.length ? (
        <div className="capacity-warning critical">
          <AlertTriangle size={19} />
          <div>
            <strong>Active shifts do not cover the full ER day</strong>
            <p>
              No shift covers{" "}
              {timeGaps
                .map(
                  (gap) =>
                    `${gap.label} (${Math.round((gap.minutes / 60) * 10) / 10}h)`,
                )
                .join(", ")}
              . HANDLED will keep schedules in Draft until these gaps are removed.
            </p>
          </div>
        </div>
      ) : (
        <div className="coverage-safe">
          <ShieldCheck size={18} />
          <span>
            <strong>24-hour shift coverage confirmed</strong>
            {activeShifts
              .map((shift) => `${shift.label} ${shift.time}`)
              .join(" · ")}
          </span>
        </div>
      )}
      <div className="rule-list">
        {rules.map(([title, primary, secondary], index) => (
          <article key={title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{title}</strong>
              <p>{primary}</p>
            </div>
            <small>{secondary}</small>
            <button
              className="rule-edit-button"
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${title} rule`}
            >
              <SlidersHorizontal size={17} />
            </button>
          </article>
        ))}
      </div>
      <section
        className="exception-summary"
        aria-labelledby="exception-summary-title"
      >
        <header>
          <div>
            <span>DAY EXCEPTIONS</span>
            <h3 id="exception-summary-title">Weekend and specific-day rules</h3>
          </div>
          <button className="secondary-button" type="button" onClick={onEdit}>
            <Plus size={15} />
            Add exception
          </button>
        </header>
        {settings.coverageOverrides.length ? (
          <div>
            {settings.coverageOverrides.map((rule) => (
              <article key={rule.target}>
                <span>
                  <strong>{targetLabels[rule.target]}</strong>
                  <small>
                    {activeShifts
                      .map(
                        (shift) =>
                          `${shift.shortLabel} ${coverageFor(shift.code, rule)}`,
                      )
                      .join(" · ")}
                  </small>
                </span>
                <em>
                  {rule.chargeNurses} charge nurse
                  {rule.chargeNurses === 1 ? "" : "s"}/shift
                </em>
                <button
                  className="rule-edit-button"
                  type="button"
                  onClick={onEdit}
                  aria-label={`Edit ${targetLabels[rule.target]} exception`}
                >
                  <SlidersHorizontal size={16} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p>
            No exceptions yet. The normal coverage profile applies to all seven
            days.
          </p>
        )}
      </section>
      {weeklyCapacity < weeklyRequired ? (
        <div className="capacity-warning">
          <AlertTriangle size={19} />
          <div>
            <strong>
              Current roster cannot meet this weekly coverage profile
            </strong>
            <p>
              This profile needs {weeklyRequired} assignments per week, but the
              current roster supplies at most {weeklyCapacity}. At least{" "}
              {minimumRoster} nurses working up to {settings.maximumShifts}{" "}
              shifts each are needed. Overtime volunteers can exceed their
              personal target, but never this safety ceiling.
            </p>
          </div>
        </div>
      ) : null}
      {weeklyChargeCapacity < weeklyChargeRequired ? (
        <div className="capacity-warning">
          <AlertTriangle size={19} />
          <div>
            <strong>Not enough charge-nurse capacity</strong>
            <p>
              The rules require {weeklyChargeRequired} charge-nurse assignments,
              but the roster supplies at most {weeklyChargeCapacity}. Add
              qualified charge nurses or revise the approved leadership rule.
            </p>
          </div>
        </div>
      ) : null}
      <div className="safety-note">
        <ShieldCheck size={20} />
        <div>
          <strong>Confirm locally before clinical use</strong>
          <p>
            HANDLED uses the DOH hospital assessment baseline of one licensed ER
            nurse per three beds per shift, plus reliever planning. Patient
            acuity, arrivals, skill mix, local policy, and surge conditions may
            require more staff.
          </p>
        </div>
      </div>
      {canDelete ? (
        <div className="danger-zone">
          <div>
            <strong>Delete private workspace</strong>
            <p>
              Permanently removes this account’s nurses, preferences, schedules,
              rules, and audit history from the database.
            </p>
          </div>
          <button type="button" onClick={onDeleteWorkspace}>
            <Trash2 size={15} />
            Delete all data
          </button>
        </div>
      ) : null}
    </section>
  );
}

function CandidateSheet({
  dayKey,
  shiftCode,
  replacementFor,
  slotsNeeded,
  chargeNursesNeeded,
  assignments,
  preferences,
  workRequests,
  shiftDefinitions,
  nurseList,
  options,
  weekDays,
  onClose,
  onAssign,
}: {
  dayKey: string;
  shiftCode: ShiftCode;
  replacementFor?: Nurse;
  slotsNeeded: number;
  chargeNursesNeeded: number;
  assignments: AssignmentMap;
  preferences: PreferenceMap;
  workRequests: WorkRequestMap;
  shiftDefinitions: ShiftDefinition[];
  nurseList: Nurse[];
  options: SchedulingOptions;
  weekDays: ScheduleDay[];
  onClose: () => void;
  onAssign: (candidates: Candidate[]) => void;
}) {
  const candidates = useMemo(
    () =>
      getCandidates(
        assignments,
        preferences,
        dayKey,
        shiftCode,
        nurseList,
        options,
        workRequests,
        shiftDefinitions,
      )
        .filter((candidate) => candidate.nurse.id !== replacementFor?.id)
        .sort((a, b) =>
          chargeNursesNeeded > 0 && a.nurse.role !== b.nurse.role
            ? a.nurse.role === "Charge nurse"
              ? -1
              : 1
            : b.score - a.score,
        ),
    [
      assignments,
      preferences,
      dayKey,
      shiftCode,
      nurseList,
      options,
      workRequests,
      shiftDefinitions,
      replacementFor?.id,
      chargeNursesNeeded,
    ],
  );
  const maximumSelection = replacementFor ? 1 : Math.max(1, slotsNeeded);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    candidates[0]?.nurse.id ? [candidates[0].nurse.id] : [],
  );
  const closeButton = useRef<HTMLButtonElement>(null);
  const day = weekDays.find((item) => item.key === dayKey)!;
  const shift = shiftDefinitions.find((item) => item.code === shiftCode)!;
  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const selected = candidates.filter((candidate) =>
    selectedIds.includes(candidate.nurse.id),
  );
  const selectedChargeNurses = selected.filter(
    (candidate) => candidate.nurse.role === "Charge nurse",
  ).length;
  const requiredChargeSelection = Math.min(
    chargeNursesNeeded,
    maximumSelection,
    candidates.filter((candidate) => candidate.nurse.role === "Charge nurse")
      .length,
  );
  const chargeRequirementMet = selectedChargeNurses >= requiredChargeSelection;
  function toggleCandidate(nurseId: string) {
    setSelectedIds((current) => {
      if (current.includes(nurseId))
        return current.filter((id) => id !== nurseId);
      if (maximumSelection === 1) return [nurseId];
      return current.length < maximumSelection
        ? [...current, nurseId]
        : current;
    });
  }
  return (
    <div
      className="sheet-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="candidate-sheet t-panel-slide"
        data-open="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby="candidate-title"
      >
        <header>
          <div>
            <span>
              {replacementFor ? "AWOL REPLACEMENT" : "COMPLETE COVERAGE"}
            </span>
            <h2 id="candidate-title">
              {replacementFor
                ? `Replace ${replacementFor.name}`
                : `Choose up to ${maximumSelection} nurse${maximumSelection === 1 ? "" : "s"}`}
            </h2>
            <p>
              {day.label}, {day.date} · {shift.time}
            </p>
          </div>
          <button
            ref={closeButton}
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close candidate panel"
          >
            <X size={19} />
          </button>
        </header>
        <div className="sheet-context">
          <span className={`shift-symbol ${shift.code}`}>
            <Clock3 size={17} />
          </span>
          <div>
            <strong>
              {replacementFor
                ? `${replacementFor.name} was marked AWOL`
                : `${shift.label} shift needs ${slotsNeeded} more nurse${slotsNeeded === 1 ? "" : "s"}`}
            </strong>
            <p>
              Select several nurses at once. Nurses already working today appear
              only when they opted into a safe consecutive double shift; nurses
              over target appear only when they opted into overtime.
            </p>
            {chargeNursesNeeded > 0 ? (
              <small>
                {chargeNursesNeeded} selected nurse
                {chargeNursesNeeded === 1 ? "" : "s"} must be a charge nurse.
              </small>
            ) : null}
          </div>
        </div>
        <div className="selection-count" role="status">
          <strong>{selected.length}</strong> of {maximumSelection} selected
          {chargeNursesNeeded > 0
            ? ` · ${selectedChargeNurses} charge nurse${selectedChargeNurses === 1 ? "" : "s"}`
            : ""}
        </div>
        <div
          className="candidate-list"
          role="group"
          aria-label="Eligible nurses"
        >
          {candidates.length ? (
            candidates.map((candidate, index) => (
              <label
                className={`candidate-card ${selectedIds.includes(candidate.nurse.id) ? "selected" : ""}`}
                key={candidate.nurse.id}
              >
                <input
                  type="checkbox"
                  name="candidate"
                  value={candidate.nurse.id}
                  checked={selectedIds.includes(candidate.nurse.id)}
                  onChange={() => toggleCandidate(candidate.nurse.id)}
                />
                <span className="candidate-avatar">
                  {candidate.nurse.initials}
                </span>
                <span className="candidate-copy">
                  <span>
                    <strong>{candidate.nurse.name}</strong>
                    {index === 0 ? <em>Recommended</em> : null}
                    {candidate.nurse.role === "Charge nurse" ? (
                      <em className="charge-badge">Charge</em>
                    ) : null}
                  </span>
                  <small>Employee ID · {candidate.nurse.id}</small>
                  <span className="reason-list">
                    {candidate.reasons.map((reason) => (
                      <i key={reason}>{reason}</i>
                    ))}
                  </span>
                </span>
                <span className={`preference-badge ${candidate.preference}`}>
                  {preferenceLabels[candidate.preference]}
                </span>
              </label>
            ))
          ) : (
            <div className="inline-empty">
              <AlertTriangle size={20} />
              <strong>No eligible nurse found</strong>
              <p>
                Review availability, rest rules, or the maximum weekly workload.
              </p>
            </div>
          )}
        </div>
        <div className="explanation-box">
          <Sparkles size={16} />
          <p>
            <strong>Recommendation logic</strong>Charge nurses are listed first
            when leadership coverage is missing, followed by preference,
            workload, rest compatibility, and night-shift balance.
          </p>
        </div>
        {!chargeRequirementMet ? (
          <p className="form-error" role="alert">
            Select at least {requiredChargeSelection} charge nurse
            {requiredChargeSelection === 1 ? "" : "s"} for this shift.
          </p>
        ) : null}
        <footer>
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="publish-button"
            type="button"
            disabled={!selected.length || !chargeRequirementMet}
            onClick={() => onAssign(selected)}
          >
            <UserRoundCheck size={17} />
            {replacementFor
              ? "Assign replacement"
              : `Assign ${selected.length} selected nurse${selected.length === 1 ? "" : "s"}`}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function ImportDialog({
  nurseList,
  weekDays,
  onClose,
  onImport,
  onTemplate,
}: {
  nurseList: Nurse[];
  weekDays: ScheduleDay[];
  onClose: () => void;
  onImport: (requests: ScheduleRequestMap) => void;
  onTemplate: () => void;
}) {
  const [error, setError] = useState("");
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  async function handleFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Choose a CSV or Excel file smaller than 5 MB.");
      const rows = file.name.toLowerCase().endsWith(".xlsx")
        ? await rowsFromPreferenceWorkbook(file)
        : parseCsv(await file.text());
      onImport(requestsFromRows(rows, nurseList, weekDays));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The CSV could not be imported.",
      );
    }
  }
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="import-dialog t-modal is-open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <header>
          <span className="dialog-icon">
            <FileSpreadsheet size={19} />
          </span>
          <div>
            <span>GOOGLE FORMS</span>
            <h2 id="import-title">Import preference responses</h2>
          </div>
          <button
            ref={closeButton}
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close import dialog"
          >
            <X size={19} />
          </button>
        </header>
        <p>
          Upload the HANDLED Excel workbook or a Google Forms CSV. HANDLED matches every
          response using the Employee ID column.
        </p>
        <p className="privacy-note">
          HANDLED reads this file only in your browser for this demo. It is not
          uploaded or stored. Do not include patient information, diagnoses, or
          medical records.
        </p>
        <label className="file-drop">
          <Upload size={24} />
          <strong>Choose an Excel or CSV file</strong>
          <span>.xlsx or .csv · up to 5 MB</span>
          <input
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="format-note">
          <strong>Expected response values</strong>
          <span>
            6 Morning · 2 Afternoon · N Night · REST · Birthday Leave · Personal Leave · Training
          </span>
        </div>
        <footer>
          <button
            className="secondary-button"
            type="button"
            onClick={onTemplate}
          >
            <Download size={16} />
            Download template
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => onImport(createSeedRequests(nurseList))}
          >
            Use example responses
          </button>
        </footer>
      </section>
    </div>
  );
}

function WorkspaceManagerDialog({
  workspaces,
  activeWorkspaceId,
  busy,
  onClose,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  busy: boolean;
  onClose: () => void;
  onSelect: (workspaceId: string) => Promise<void>;
  onCreate: (name: string, staffType: WorkspaceStaffType) => Promise<void>;
  onRename: (workspaceId: string, name: string) => Promise<void>;
  onDelete: (workspace: WorkspaceSummary) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [staffType, setStaffType] =
    useState<WorkspaceStaffType>("nurses");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = name.trim();
    if (normalized.length < 2)
      return setError("Enter a workspace name with at least two characters.");
    setError("");
    await onCreate(normalized, staffType);
  }

  async function rename(workspaceId: string) {
    const normalized = editingName.trim();
    if (normalized.length < 2)
      return setError("Enter a workspace name with at least two characters.");
    setError("");
    await onRename(workspaceId, normalized);
    setEditingId(null);
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="form-dialog workspace-dialog t-modal is-open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-dialog-title"
      >
        <header>
          <div>
            <span>ACCOUNT WORKSPACES</span>
            <h2 id="workspace-dialog-title">Manage workspaces</h2>
            <p>Each workspace keeps a separate roster, rules, requests, and schedules.</p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close workspace manager"
          >
            <X size={19} />
          </button>
        </header>
        <div className="workspace-list" aria-label="Available workspaces">
          {workspaces.map((workspace) => {
            const active = workspace.id === activeWorkspaceId;
            const editing = editingId === workspace.id;
            return (
              <article className={active ? "active" : ""} key={workspace.id}>
                <span className="workspace-avatar" aria-hidden="true">
                  {workspace.staffType === "orderlies" ? "OR" : "RN"}
                </span>
                <div className="workspace-entry-copy">
                  {editing ? (
                    <label>
                      <span className="sr-only">Workspace name</span>
                      <input
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        maxLength={60}
                        autoFocus
                      />
                    </label>
                  ) : (
                    <>
                      <strong>{workspace.name}</strong>
                      <small>
                        {workspace.staffType === "orderlies" ? "Orderlies" : "Nurses"}
                        {` · ${workspace.memberCount} team member${workspace.memberCount === 1 ? "" : "s"}`}
                      </small>
                    </>
                  )}
                </div>
                <div className="workspace-entry-actions">
                  {editing ? (
                    <>
                      <button
                        className="workspace-icon-action"
                        type="button"
                        onClick={() => void rename(workspace.id)}
                        disabled={busy}
                        aria-label={`Save name for ${workspace.name}`}
                      >
                        <Check size={15} />
                      </button>
                      <button
                        className="workspace-icon-action"
                        type="button"
                        onClick={() => setEditingId(null)}
                        disabled={busy}
                        aria-label="Cancel renaming"
                      >
                        <X size={15} />
                      </button>
                    </>
                  ) : (
                    <>
                      {!active ? (
                        <button
                          className="secondary-button workspace-open-button"
                          type="button"
                          onClick={() => void onSelect(workspace.id)}
                          disabled={busy}
                        >
                          Open
                        </button>
                      ) : (
                        <span className="active-workspace-badge">Current</span>
                      )}
                      <button
                        className="workspace-icon-action"
                        type="button"
                        onClick={() => {
                          setEditingId(workspace.id);
                          setEditingName(workspace.name);
                        }}
                        disabled={busy}
                        aria-label={`Rename ${workspace.name}`}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="workspace-icon-action danger"
                        type="button"
                        onClick={() => void onDelete(workspace)}
                        disabled={busy || workspaces.length === 1}
                        aria-label={`Delete ${workspace.name}`}
                        title={
                          workspaces.length === 1
                            ? "The last workspace cannot be deleted"
                            : `Delete ${workspace.name}`
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        <form className="workspace-create" onSubmit={create}>
          <div>
            <span>NEW WORKSPACE</span>
            <strong>Add another scheduling team</strong>
          </div>
          <div className="workspace-create-fields">
            <label>
              <span>Workspace name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={
                  staffType === "orderlies" ? "ER Orderlies" : "ER Nurses"
                }
                maxLength={60}
                disabled={busy || workspaces.length >= 12}
                required
              />
            </label>
            <label>
              <span>Team type</span>
              <select
                value={staffType}
                onChange={(event) =>
                  setStaffType(event.target.value as WorkspaceStaffType)
                }
                disabled={busy || workspaces.length >= 12}
              >
                <option value="nurses">Nurses</option>
                <option value="orderlies">Orderlies</option>
              </select>
            </label>
            <button
              className="primary-button"
              type="submit"
              disabled={busy || workspaces.length >= 12}
            >
              <Plus size={16} />
              {busy ? "Working…" : "Create workspace"}
            </button>
          </div>
          {workspaces.length >= 12 ? (
            <small>An account can contain up to 12 workspaces.</small>
          ) : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </form>
      </section>
    </div>
  );
}

function NurseDialog({
  nurse,
  staffType,
  automaticId,
  existingIds,
  onClose,
  onSave,
}: {
  nurse: Nurse | null;
  staffType: WorkspaceStaffType;
  automaticId: string;
  existingIds: string[];
  onClose: () => void;
  onSave: (nurse: Nurse) => void;
}) {
  const existingParts = nurse?.name.trim().split(/\s+/) ?? [];
  const [firstName, setFirstName] = useState(
    nurse?.firstName ?? existingParts.slice(0, -1).join(" "),
  );
  const [surname, setSurname] = useState(
    nurse?.surname ?? existingParts.at(-1) ?? "",
  );
  const [employeeId, setEmployeeId] = useState(nurse?.id ?? automaticId);
  const [dateHired, setDateHired] = useState(nurse?.dateHired ?? "");
  const [employmentEndDate, setEmploymentEndDate] = useState(
    nurse?.employmentEndDate ?? "",
  );
  const [role, setRole] = useState<Nurse["role"]>(nurse?.role ?? "Staff nurse");
  const [targetShifts, setTargetShifts] = useState(nurse?.targetShifts ?? 5);
  const [error, setError] = useState("");
  const staffName = staffType === "orderlies" ? "orderly" : "nurse";
  const title = nurse ? `Edit ${staffName}` : `Add ${staffName}`;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedFirstName = firstName.trim();
    const normalizedSurname = surname.trim();
    const normalizedId = employeeId.trim().toUpperCase();
    if (normalizedFirstName.length < 1 || normalizedSurname.length < 1)
      return setError("Enter the employee’s first name and surname.");
    if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(normalizedId))
      return setError("Employee ID must use 2–20 letters, numbers, or hyphens.");
    if (existingIds.includes(normalizedId) && normalizedId !== nurse?.id)
      return setError("That Employee ID is already in the roster.");
    if (!dateHired)
      return setError("Enter the employee’s date hired.");
    if (employmentEndDate && employmentEndDate < dateHired)
      return setError("The last working date cannot be before the date hired.");
    const normalizedName = `${normalizedFirstName} ${normalizedSurname}`;
    const initials = normalizedName
      .split(/\s+/)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
    onSave({
      id: normalizedId,
      name: normalizedName,
      firstName: normalizedFirstName,
      surname: normalizedSurname,
      initials,
      role,
      targetShifts,
      dateHired,
      ...(employmentEndDate ? { employmentEndDate } : {}),
    });
  }
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="form-dialog t-modal is-open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nurse-dialog-title"
      >
        <header>
          <div>
            <span>TEAM ROSTER</span>
            <h2 id="nurse-dialog-title">{title}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()} dialog`}
          >
            <X size={19} />
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label>
              <span>Employee ID</span>
              <input
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value.toUpperCase())}
                placeholder="N-101"
                autoFocus
                maxLength={20}
                required
              />
              <small>Editable. Changing it updates saved requests and schedules.</small>
            </label>
            <label>
              <span>First name</span>
              <input
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                autoComplete="given-name"
                required
              />
            </label>
            <label>
              <span>Surname</span>
              <input
                value={surname}
                onChange={(event) => setSurname(event.target.value)}
                autoComplete="family-name"
                required
              />
            </label>
            <label>
              <span>Date hired</span>
              <input
                type="date"
                value={dateHired}
                onChange={(event) => setDateHired(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Last working date</span>
              <input
                type="date"
                min={dateHired || undefined}
                value={employmentEndDate}
                onChange={(event) => setEmploymentEndDate(event.target.value)}
              />
              <small>Optional. Use this when a resignation becomes effective mid-period.</small>
            </label>
          </div>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <footer>
            <button
              className="secondary-button"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="primary-button" type="submit">
              <Check size={16} />
              Save {staffName}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function PreferenceDialog({
  nurse,
  preferences,
  workRequest,
  shiftDefinitions,
  weekDays,
  onClose,
  onSave,
}: {
  nurse: Nurse;
  preferences: PreferenceMap;
  workRequest: WorkRequest;
  shiftDefinitions: ShiftDefinition[];
  weekDays: ScheduleDay[];
  onClose: () => void;
  onSave: (preferences: PreferenceMap, workRequest: WorkRequest) => void;
}) {
  const [draft, setDraft] = useState<PreferenceMap>(() =>
    Object.fromEntries(
      Object.entries(preferences).filter(([key]) =>
        key.startsWith(`${nurse.id}-`),
      ),
    ),
  );
  const [request, setRequest] = useState(workRequest);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function setPreference(key: string, value: string) {
    setDraft((current) => {
      const next = { ...current };
      if (value) next[key] = value as PreferenceLevel;
      else delete next[key];
      return next;
    });
  }

  function setAll(value: PreferenceLevel | null) {
    if (!value) {
      setDraft({});
      return;
    }
    setDraft(
      Object.fromEntries(
        days.flatMap((day) =>
          shiftDefinitions
            .filter((shift) => shift.enabled)
            .map((shift) => [
              preferenceKey(nurse.id, day.key, shift.code),
              value,
            ]),
        ),
      ),
    );
  }

  const entered = Object.keys(draft).length;
  const activeShifts = shiftDefinitions.filter((shift) => shift.enabled);
  const expected = days.length * activeShifts.length;
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="form-dialog preference-dialog t-modal is-open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preference-dialog-title"
      >
        <header>
          <div>
            <span>WEEKLY PREFERENCES</span>
            <h2 id="preference-dialog-title">Edit {nurse.name}</h2>
            <p>
              {weekRangeLabel(weekDays)} · {entered} of {expected} shifts
              entered
            </p>
          </div>
          <button
            ref={closeButton}
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close preference editor"
          >
            <X size={19} />
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave(draft, request);
          }}
        >
          <section
            className="work-request-editor"
            aria-labelledby="extra-work-title"
          >
            <div>
              <span>EXTRA-WORK CHOICES</span>
              <h3 id="extra-work-title">
                What this nurse is willing to work this week
              </h3>
              <p>
                These choices are weekly consent, not a guaranteed assignment.
                The head nurse still approves every schedule.
              </p>
            </div>
            <label>
              <input
                type="checkbox"
                checked={request.overtime}
                onChange={(event) =>
                  setRequest({ ...request, overtime: event.target.checked })
                }
              />
              <span>
                <strong>Open to overtime</strong>
                <small>
                  May exceed the nurse’s personal weekly target, up to the
                  configured maximum.
                </small>
              </span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={request.doubleShift}
                onChange={(event) =>
                  setRequest({ ...request, doubleShift: event.target.checked })
                }
              />
              <span>
                <strong>Open to a double shift</strong>
                <small>
                  May work at most two consecutive active shifts on the same
                  day.
                </small>
              </span>
            </label>
          </section>
          <div className="preference-editor-actions">
            <button
              className="text-button"
              type="button"
              onClick={() => setAll("available")}
            >
              Set all Available
            </button>
            <button
              className="text-button danger-text"
              type="button"
              onClick={() => setAll(null)}
            >
              Clear all
            </button>
          </div>
          <div
            className="preference-editor"
            style={{ "--shift-count": activeShifts.length } as CSSProperties}
          >
            <div className="preference-editor-head">
              <span>Day</span>
              {activeShifts.map((shift) => (
                <span key={shift.code}>{shift.label}</span>
              ))}
            </div>
            {weekDays.map((day) => (
              <div
                className={`preference-editor-row ${day.weekend ? "weekend" : ""}`}
                key={day.key}
              >
                <span>
                  <strong>{day.shortLabel}</strong>
                  <small>{day.date}</small>
                </span>
                {activeShifts.map((shift) => {
                  const key = preferenceKey(nurse.id, day.key, shift.code);
                  return (
                    <label key={shift.code}>
                      <span className="preference-shift-label">
                        {shift.label}
                      </span>
                      <select
                        aria-label={`${nurse.name} ${day.label} ${shift.label} preference`}
                        value={draft[key] ?? ""}
                        onChange={(event) =>
                          setPreference(key, event.target.value)
                        }
                      >
                        <option value="">Not set</option>
                        <option value="preferred">Preferred</option>
                        <option value="available">Available</option>
                        <option value="avoid">Prefer not</option>
                        <option value="unavailable">Unavailable</option>
                        <option value="leave">On leave</option>
                        <option value="sick">Sick</option>
                        <option value="absent">Absent</option>
                      </select>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
          {entered < expected ? (
            <p className="preference-editor-note">
              <Info size={15} />
              Complete all {expected} active shift choices before generating an
              automatic schedule. You can save a partial response and return
              later.
            </p>
          ) : null}
          <footer>
            <button
              className="secondary-button"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="primary-button" type="submit">
              <Check size={16} />
              Save preferences
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function RequestDialog({
  nurse,
  requests,
  assignments,
  nurseList,
  weekDays,
  requestComment,
  onClose,
  onSave,
}: {
  nurse: Nurse;
  requests: ScheduleRequestMap;
  assignments: AssignmentMap;
  nurseList: Nurse[];
  weekDays: ScheduleDay[];
  requestComment: string;
  onClose: () => void;
  onSave: (requests: ScheduleRequestMap, comment: string) => void;
}) {
  const [draft, setDraft] = useState<ScheduleRequestMap>(() =>
    Object.fromEntries(
      Object.entries(requests).filter(([key]) => key.startsWith(`${nurse.id}-`)),
    ),
  );
  const [comment, setComment] = useState(requestComment);
  const closeButton = useRef<HTMLButtonElement>(null);
  const entered = planningDays.filter(
    (day) => draft[requestKey(nurse.id, day.key)],
  ).length;
  const hasSchedule = Object.values(assignments).some((ids) => ids.length);
  const effectiveRequests = {
    ...Object.fromEntries(
      Object.entries(requests).filter(
        ([key]) => !key.startsWith(`${nurse.id}-`),
      ),
    ),
    ...draft,
  };

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function setChoice(dayKey: string, value: string) {
    const key = requestKey(nurse.id, dayKey);
    setDraft((current) => {
      const next = { ...current };
      if (!value) delete next[key];
      else {
        const choice = value as DutyCode;
        next[key] = {
          choice,
          status: isLeaveDuty(choice) || choice === "training" ? "mandatory" : "requested",
        };
      }
      return next;
    });
  }

  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className="form-dialog preference-dialog request-dialog t-modal is-open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-dialog-title"
      >
        <header>
          <div>
            <span>TWO-WEEK REQUESTS</span>
            <h2 id="request-dialog-title">Edit {nurse.name}</h2>
            <p>{weekRangeLabel(weekDays)} · {entered} requested dates</p>
          </div>
          <button ref={closeButton} className="icon-button" type="button" onClick={onClose} aria-label="Close request editor">
            <X size={19} />
          </button>
        </header>
        <form onSubmit={(event) => { event.preventDefault(); onSave(draft, comment.trim()); }}>
          <div className="request-help">
            <Info size={17} />
            <p>
              The head nurse may enter any number of dates. The staff-facing
              request limit does not apply here. Shift and REST requests remain
              preferences; leave and Training are protected automatically.
            </p>
          </div>
          <div className="request-editor">
            <div className="request-editor-head">
              <span>Date</span>
              <span>Request</span>
              <span>Schedule result</span>
            </div>
            {weekDays.map((day) => {
              const key = requestKey(nurse.id, day.key);
              const request = draft[key];
              const savedRequest = requests[key];
              const changed =
                request?.choice !== savedRequest?.choice ||
                request?.status !== savedRequest?.status;
              const outcome = request
                ? changed
                  ? {
                      status: "pending" as const,
                      label: "Changed",
                      reason: "Save and regenerate the draft to evaluate this change.",
                    }
                  : explainRequestOutcome(
                      assignments,
                      effectiveRequests,
                      nurseList,
                      nurse.id,
                      day.key,
                    )
                : null;
              const active = nurseActiveOnDate(nurse, day.isoDate);
              return (
                <div className={`request-editor-row ${day.weekend ? "weekend" : ""}`} key={day.key}>
                  <span>
                    <strong>{day.shortLabel}</strong>
                    <small>{day.date}</small>
                  </span>
                  <select
                    value={request?.choice ?? ""}
                    onChange={(event) => setChoice(day.key, event.target.value)}
                    aria-label={`${nurse.name} request for ${day.label} ${day.date}`}
                    disabled={!active}
                  >
                    <option value="">No request</option>
                    <option value="morning">6 Morning</option>
                    <option value="afternoon">2 Afternoon</option>
                    <option value="night">N Night</option>
                    <option value="rest">REST</option>
                    <option value="birthday_leave">Birthday Leave</option>
                    <option value="personal_leave">Personal Leave</option>
                    <option value="training">Training</option>
                  </select>
                  <span className={`request-outcome ${outcome?.status ?? "empty"}`}>
                    {outcome?.status === "granted" ? (
                      <CheckCircle2 size={15} />
                    ) : outcome?.status === "unmet" ? (
                      <AlertTriangle size={15} />
                    ) : (
                      <Clock3 size={15} />
                    )}
                    <span>
                      <strong>
                        {!active
                          ? "Outside employment dates"
                          : outcome?.label ?? (hasSchedule ? "No request" : "Not evaluated")}
                      </strong>
                      <small>
                        {!active
                          ? "Change the hire or last-working date in Nursing team if this is incorrect."
                          : outcome?.reason ??
                          (hasSchedule
                            ? "No preference was recorded for this date."
                            : "Generate a draft to see request outcomes.")}
                      </small>
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
          <label className="request-comment-field">
            <span>Request summary</span>
            <textarea
              value={comment}
              maxLength={500}
              rows={3}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Briefly explain the scheduling reason or context. Do not include patient information."
            />
            <small>{comment.length}/500 · Visible only to the head nurse. Do not include patient or medical details.</small>
          </label>
          <footer>
            <button className="text-button danger-text" type="button" onClick={() => setDraft({})}>Clear all</button>
            <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
            <button className="primary-button" type="submit">
              <Check size={16} /> Save requests
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function DutyAssignmentDialog({
  nurse,
  day,
  currentDuty,
  request,
  onClose,
  onSave,
}: {
  nurse: Nurse;
  day: ScheduleDay;
  currentDuty: DutyCode | null;
  request?: ScheduleRequest;
  onClose: () => void;
  onSave: (duty: DutyCode) => void;
}) {
  const [selected, setSelected] = useState<DutyCode>(currentDuty ?? "rest");
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const choices: { code: DutyCode; detail: string }[] = [
    { code: "morning", detail: "6:00 AM–2:00 PM" },
    { code: "afternoon", detail: "2:00 PM–10:00 PM" },
    { code: "night", detail: "10:00 PM–6:00 AM" },
    { code: "rest", detail: "Scheduled weekly rest day" },
    { code: "birthday_leave", detail: "Protected birthday leave" },
    { code: "personal_leave", detail: "Protected personal leave" },
    { code: "training", detail: "Non-working training day; does not count as REST" },
  ];
  const conflictsRequest =
    request && request.status !== "requested" && request.choice !== selected;
  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="form-dialog assignment-dialog t-modal is-open" role="dialog" aria-modal="true" aria-labelledby="duty-dialog-title">
        <header>
          <div>
            <span>MANUAL ROSTER EDIT</span>
            <h2 id="duty-dialog-title">Edit {day.label} assignment</h2>
            <p>{nurse.name} · {day.date}</p>
          </div>
          <button ref={closeButton} className="icon-button" type="button" onClick={onClose} aria-label="Close assignment editor"><X size={19} /></button>
        </header>
        <form onSubmit={(event) => { event.preventDefault(); onSave(selected); }}>
          <fieldset className="assignment-options">
            <legend className="sr-only">Choose one duty for {nurse.name}</legend>
            {choices.map((choice) => (
              <label className={`assignment-option ${selected === choice.code ? "selected" : ""}`} key={choice.code}>
                <input type="radio" name="duty" value={choice.code} checked={selected === choice.code} onChange={() => setSelected(choice.code)} />
                <span className={`assignment-option-symbol ${choice.code}`}><Clock3 size={16} /></span>
                <span className="assignment-option-copy"><strong>{dutyLabels[choice.code]}</strong><small>{choice.detail}</small></span>
                {request?.choice === choice.code ? <span className={`assignment-preference ${request.status === "requested" ? "available" : "preferred"}`}>{request.status === "mandatory" ? "Mandatory" : "Requested"}</span> : null}
              </label>
            ))}
          </fieldset>
          {conflictsRequest ? (
            <p className="assignment-warning" role="alert"><AlertTriangle size={16} /><span><strong>Protected entry conflict</strong>This edit conflicts with the recorded {dutyLabels[request.choice]} entry and will remain flagged.</span></p>
          ) : null}
          <p className="assignment-guidance"><ShieldCheck size={16} />HANDLED rechecks daily staffing balance, weekly REST counts, protected leave and Training, and recovery transitions after every edit.</p>
          <footer>
            <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
            <button className="primary-button" type="submit"><Check size={16} />Save assignment</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function AssignmentDialog({
  nurse,
  day,
  currentShifts,
  preferences,
  workRequest,
  shiftDefinitions,
  weeklyAssignments,
  maximumShifts,
  onClose,
  onSave,
  onMarkAwol,
}: {
  nurse: Nurse;
  day: ScheduleDay;
  currentShifts: ShiftDefinition[];
  preferences: PreferenceMap;
  workRequest: WorkRequest;
  shiftDefinitions: ShiftDefinition[];
  weeklyAssignments: number;
  maximumShifts: number;
  onClose: () => void;
  onSave: (shiftCodes: ShiftCode[]) => void;
  onMarkAwol: (shiftCode: ShiftCode) => void;
}) {
  const [selected, setSelected] = useState<ShiftCode[]>(
    currentShifts.map((shift) => shift.code),
  );
  const closeButton = useRef<HTMLButtonElement>(null);
  const selectedCautions = selected.flatMap((code) => {
    const caution = cautionForPreference(
      preferences[preferenceKey(nurse.id, day.key, code)],
    );
    return caution ? [caution] : [];
  });

  useEffect(() => {
    closeButton.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const options = shiftDefinitions.filter((shift) => shift.enabled);
  const invalidPair =
    selected.length === 2 &&
    !areConsecutiveShifts(
      ...(selected.map((code) =>
        options.find((shift) => shift.code === code)!,
      ) as [ShiftDefinition, ShiftDefinition]),
    );
  const projectedWeeklyAssignments =
    weeklyAssignments - currentShifts.length + selected.length;
  const unapprovedOvertime =
    projectedWeeklyAssignments > nurse.targetShifts && !workRequest.overtime;
  const overMaximum = projectedWeeklyAssignments > maximumShifts;
  function toggle(code: ShiftCode) {
    setSelected((current) => {
      if (current.includes(code))
        return current.filter((item) => item !== code);
      if (!workRequest.doubleShift) return [code];
      return current.length < 2 ? [...current, code] : current;
    });
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="form-dialog assignment-dialog t-modal is-open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assignment-dialog-title"
      >
        <header>
          <div>
            <span>MANUAL SCHEDULE EDIT</span>
            <h2 id="assignment-dialog-title">Edit {day.label} assignment</h2>
            <p>
              {nurse.name} · {day.date}
            </p>
          </div>
          <button
            ref={closeButton}
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close assignment editor"
          >
            <X size={19} />
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!invalidPair && !unapprovedOvertime && !overMaximum)
              onSave(selected);
          }}
        >
          <button
            className={`assignment-off ${selected.length === 0 ? "selected" : ""}`}
            type="button"
            onClick={() => setSelected([])}
          >
            <Clock3 size={16} />
            <span>
              <strong>Off</strong>
              <small>No assignment</small>
            </span>
            {selected.length === 0 ? <Check size={16} /> : null}
          </button>
          <fieldset className="assignment-options">
            <legend className="sr-only">
              Choose assignments for {nurse.name}
            </legend>
            {options.map((option) => {
              const preference =
                preferences[preferenceKey(nurse.id, day.key, option.code)];
              return (
                <label
                  className={`assignment-option ${selected.includes(option.code) ? "selected" : ""}`}
                  key={option.code}
                >
                  <input
                    type="checkbox"
                    name="assignment"
                    value={option.code}
                    checked={selected.includes(option.code)}
                    onChange={() => toggle(option.code)}
                    aria-label={`${option.label}${preference ? `, ${preferenceLabels[preference]}` : ""}`}
                  />
                  <span className={`assignment-option-symbol ${option.code}`}>
                    <Clock3 size={16} />
                  </span>
                  <span className="assignment-option-copy">
                    <strong>{option.label}</strong>
                    <small>{option.time}</small>
                  </span>
                  {preference ? (
                    <span className={`assignment-preference ${preference}`}>
                      {preferenceLabels[preference]}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </fieldset>
          {invalidPair ? (
            <p className="assignment-warning" role="alert">
              <AlertTriangle size={16} />
              <span>
                <strong>Unsafe double-shift combination</strong>Double shifts
                must be consecutive: one shift must start exactly when the other
                ends.
              </span>
            </p>
          ) : null}
          {unapprovedOvertime || overMaximum ? (
            <p className="assignment-warning" role="alert">
              <AlertTriangle size={16} />
              <span>
                <strong>
                  {overMaximum
                    ? "Maximum workload reached"
                    : "Overtime was not approved"}
                </strong>
                {overMaximum
                  ? `This would exceed the head nurse’s maximum of ${maximumShifts} shifts.`
                  : `${nurse.name} did not opt into exceeding the ${nurse.targetShifts}-shift weekly target.`}
              </span>
            </p>
          ) : null}
          {selected.length === 2 && !invalidPair ? (
            <p className="assignment-warning mild">
              <Info size={16} />
              <span>
                <strong>Approved double shift</strong>
                {nurse.name} opted in for this week. HANDLED will mark the
                assignment with a caution for final review.
              </span>
            </p>
          ) : null}
          {selectedCautions.map((caution) => (
            <p
              className={`assignment-warning ${caution.urgent ? "" : "mild"}`}
              key={caution.title}
              role={caution.urgent ? "alert" : undefined}
            >
              {caution.urgent ? (
                <AlertTriangle size={16} />
              ) : (
                <Info size={16} />
              )}
              <span>
                <strong>{caution.title}</strong>
                {caution.body} The schedule will keep a caution marker until
                this is resolved.
              </span>
            </p>
          ))}
          <p className="assignment-guidance">
            <ShieldCheck size={16} />
            {workRequest.doubleShift
              ? "This nurse opted into consecutive double shifts for this week. Select up to two."
              : "This nurse did not opt into double shifts. Select one shift or Off."}{" "}
            {workRequest.overtime
              ? "They are also open to overtime up to the configured maximum."
              : "Assignments above their weekly target are blocked."}
          </p>
          <footer>
            {currentShifts.map((shift) => (
              <button
                className="awol-button"
                type="button"
                key={shift.code}
                onClick={() => onMarkAwol(shift.code)}
              >
                <AlertTriangle size={15} />
                AWOL · {shift.shortLabel}
              </button>
            ))}
            <button
              className="secondary-button"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={invalidPair || unapprovedOvertime || overMaximum}
            >
              <Check size={16} />
              Save assignment
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function RulesDialog({
  settings,
  dailyCoverage,
  weekDays,
  onClose,
  onSave,
}: {
  settings: CoverageSettings;
  dailyCoverage: DailyCoverage;
  weekDays: ScheduleDay[];
  onClose: () => void;
  onSave: (settings: CoverageSettings, dailyCoverage: DailyCoverage) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [dailyDraft, setDailyDraft] = useState(dailyCoverage);
  const [error, setError] = useState("");
  const bedFloor = 1;
  const targetLabels: Record<CoverageRuleTarget, string> = {
    weekend: "Weekend (Sat + Sun)",
    sun: "Sunday",
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
  };
  const targets = Object.keys(targetLabels) as CoverageRuleTarget[];
  function addException() {
    const target = targets.find(
      (candidate) =>
        !draft.coverageOverrides.some((rule) => rule.target === candidate),
    );
    if (!target) return;
    setDraft({
      ...draft,
      coverageOverrides: [
        ...draft.coverageOverrides,
        {
          target,
          morningCoverage: draft.morningCoverage,
          afternoonCoverage: draft.afternoonCoverage,
          nightCoverage: draft.nightCoverage,
          chargeNurses: draft.chargeNursesPerShift,
        },
      ],
    });
  }
  function updateException(index: number, values: Partial<CoverageOverride>) {
    setDraft({
      ...draft,
      coverageOverrides: draft.coverageOverrides.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...values } : rule,
      ),
    });
  }
  function updateShift(code: ShiftCode, values: Partial<ShiftDefinition>) {
    setDraft({
      ...draft,
      shiftDefinitions: draft.shiftDefinitions.map((shift) =>
        shift.code === code ? { ...shift, ...values } : shift,
      ),
    });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const activeShifts = draft.shiftDefinitions.filter(
      (shift) => shift.enabled,
    );
    const coverageFor = (
      rule: CoverageSettings | CoverageOverride,
      code: ShiftCode,
    ) =>
      code === "morning"
        ? rule.morningCoverage
        : code === "afternoon"
          ? rule.afternoonCoverage
          : rule.nightCoverage;
    const activeCoverage = activeShifts.map((shift) =>
      coverageFor(draft, shift.code),
    );
    if (!activeShifts.length) {
      setError("Keep at least one shift active.");
      return;
    }
    if (activeShifts.some((shift) => shift.start === shift.end)) {
      setError("A shift cannot start and end at the same time.");
      return;
    }
    if (
      Object.values(dailyDraft).some((day) =>
        Object.values(day).some(
          (value) => !Number.isInteger(value) || value < 0 || value > 50,
        ),
      )
    ) {
      setError("Daily staffing minimums must be whole numbers from 0 to 50.");
      return;
    }
    if (
      draft.twoWeekRules.minHoursPerPeriod >
      draft.twoWeekRules.maxHoursPerPeriod
    ) {
      setError("Minimum hours cannot exceed maximum hours.");
      return;
    }
    if (draft.chargeNursesPerShift > Math.min(...activeCoverage)) {
      setError(
        "The normal charge-nurse requirement cannot exceed the smallest shift minimum.",
      );
      return;
    }
    if (
      new Set(draft.coverageOverrides.map((rule) => rule.target)).size !==
      draft.coverageOverrides.length
    ) {
      setError("Each weekend or day exception can appear only once.");
      return;
    }
    const invalidOverride = draft.coverageOverrides.find(
      (rule) =>
        activeShifts.some(
          (shift) => coverageFor(rule, shift.code) < bedFloor,
        ) ||
        rule.chargeNurses >
          Math.min(
            ...activeShifts.map((shift) => coverageFor(rule, shift.code)),
          ),
    );
    if (invalidOverride) {
      setError(
        `${targetLabels[invalidOverride.target]} must meet the ${bedFloor}-nurse bed floor, and its charge-nurse count cannot exceed a shift minimum.`,
      );
      return;
    }
    onSave(
      {
        ...draft,
        preventNightToMorning: true,
        twoWeekRules: {
          ...draft.twoWeekRules,
          preventNightToMorning: true,
          preventAfternoonRestMorning: true,
          maxConsecutiveHours: 12,
        },
        shiftDefinitions: normalizeShiftDefinitions(draft.shiftDefinitions),
        requireChargeNurse:
          draft.chargeNursesPerShift > 0 ||
          draft.coverageOverrides.some((rule) => rule.chargeNurses > 0),
      },
      dailyDraft,
    );
  }
  const activeCoverageValues = draft.shiftDefinitions
    .filter((shift) => shift.enabled)
    .map((shift) =>
      shift.code === "morning"
        ? draft.morningCoverage
        : shift.code === "afternoon"
          ? draft.afternoonCoverage
          : draft.nightCoverage,
    );
  const draftGaps = coverageGaps(draft.shiftDefinitions);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="form-dialog rules-dialog t-modal is-open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-dialog-title"
      >
        <header>
          <div>
            <span>ER COVERAGE PROFILE</span>
            <h2 id="rules-dialog-title">Edit coverage rules</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close coverage rules dialog"
          >
            <X size={19} />
          </button>
        </header>
        <form onSubmit={submit}>
          <section className="two-week-rule-editor" aria-labelledby="two-week-rule-editor-title">
            <header>
              <div>
                <span>TWO-WEEK RULES</span>
                <h3 id="two-week-rule-editor-title">Editable schedule limits</h3>
                <p>These values control generation, validation, and publication.</p>
              </div>
            </header>
            <div className="coverage-fields">
              <label><span>REST days per nurse / week</span><input type="number" min="0" max="3" value={draft.twoWeekRules.restDaysPerWeek} onChange={(event) => setDraft({ ...draft, twoWeekRules: { ...draft.twoWeekRules, restDaysPerWeek: Number(event.target.value) } })} /></label>
              <label><span>Maximum nurses on REST / day</span><input type="number" min="0" max="50" value={draft.twoWeekRules.maxRestPerDay} onChange={(event) => setDraft({ ...draft, twoWeekRules: { ...draft.twoWeekRules, maxRestPerDay: Number(event.target.value) } })} /></label>
              <label><span>Maximum daily shift difference</span><input type="number" min="0" max="10" value={draft.twoWeekRules.maxDailyShiftDifference} onChange={(event) => setDraft({ ...draft, twoWeekRules: { ...draft.twoWeekRules, maxDailyShiftDifference: Number(event.target.value) } })} /></label>
              <label><span>Maximum individual shift difference</span><input type="number" min="0" max="10" value={draft.twoWeekRules.maxIndividualShiftDifference} onChange={(event) => setDraft({ ...draft, twoWeekRules: { ...draft.twoWeekRules, maxIndividualShiftDifference: Number(event.target.value) } })} /></label>
              <label><span>Minimum hours / two weeks</span><input type="number" min="0" max="168" step="4" value={draft.twoWeekRules.minHoursPerPeriod} onChange={(event) => setDraft({ ...draft, twoWeekRules: { ...draft.twoWeekRules, minHoursPerPeriod: Number(event.target.value) } })} /><small>Prorated for mid-period hiring or resignation.</small></label>
              <label><span>Maximum hours / two weeks</span><input type="number" min={draft.twoWeekRules.minHoursPerPeriod} max="168" step="4" value={draft.twoWeekRules.maxHoursPerPeriod} onChange={(event) => setDraft({ ...draft, twoWeekRules: { ...draft.twoWeekRules, maxHoursPerPeriod: Number(event.target.value) } })} /><small>Forced overtime is included.</small></label>
            </div>
            <div className="fixed-safety-rule"><ShieldCheck size={17} /><span><strong>Recovery rules are always enforced</strong>Every working duty must have at least 16 hours before the next duty. After N, the next duty is N or REST. After N or 2 followed by one REST day, the next working duty cannot be 6. Training cannot follow N.</span></div>
            <div className="fixed-safety-rule"><ShieldCheck size={17} /><span><strong>12-hour continuous-work ceiling</strong>When one shift cannot be filled, adjacent eight-hour duties may each extend four hours and become two 12-hour duties. This safety ceiling is fixed.</span></div>
          </section>
          <section className="daily-coverage-editor" aria-labelledby="daily-coverage-editor-title">
            <header><div><span>DAILY STAFFING</span><h3 id="daily-coverage-editor-title">Nurses needed per shift, per date</h3><p>Set each date independently. Zero means no minimum for that shift.</p></div></header>
            <div className="daily-coverage-table">
              <span>Date</span><span>6 Morning</span><span>2 Afternoon</span><span>N Night</span>
              {weekDays.flatMap((day) => [
                <strong key={`${day.key}-label`}>{day.shortLabel}<small>{day.date}</small></strong>,
                ...(["morning", "afternoon", "night"] as ShiftCode[]).map((shift) => (
                  <label key={`${day.key}-${shift}`}><span className="sr-only">{day.label} {shift} minimum</span><input type="number" min="0" max="50" value={dailyDraft[day.key]?.[shift] ?? 0} onChange={(event) => setDailyDraft({ ...dailyDraft, [day.key]: { ...(dailyDraft[day.key] ?? { morning: 0, afternoon: 0, night: 0 }), [shift]: Number(event.target.value) } })} /></label>
                )),
              ])}
            </div>
          </section>
          <section
            className="shift-structure"
            aria-labelledby="shift-structure-title"
          >
            <header>
              <div>
                <span>SHIFT STRUCTURE</span>
                <h3 id="shift-structure-title">
                  Active shifts and operating times
                </h3>
                <p>
                  Rename shifts, change their times, or turn one off. HANDLED checks
                  that active shifts cover every minute of the 24-hour ER day.
                </p>
              </div>
            </header>
            <div className="shift-config-list">
              {draft.shiftDefinitions.map((shift) => (
                <fieldset
                  className={shift.enabled ? "" : "disabled"}
                  key={shift.code}
                >
                  <legend>{shift.label}</legend>
                  <label className="shift-enabled">
                    <input
                      type="checkbox"
                      checked={shift.enabled}
                      onChange={(event) =>
                        updateShift(shift.code, {
                          enabled: event.target.checked,
                        })
                      }
                    />
                    <span>Active</span>
                  </label>
                  <label>
                    <span>Shift name</span>
                    <input
                      value={shift.label}
                      maxLength={24}
                      disabled={!shift.enabled}
                      onChange={(event) =>
                        updateShift(shift.code, { label: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span>Starts</span>
                    <input
                      type="time"
                      value={shift.start}
                      disabled={!shift.enabled}
                      onChange={(event) =>
                        updateShift(shift.code, { start: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span>Ends</span>
                    <input
                      type="time"
                      value={shift.end}
                      disabled={!shift.enabled}
                      onChange={(event) =>
                        updateShift(shift.code, { end: event.target.value })
                      }
                    />
                  </label>
                </fieldset>
              ))}
            </div>
            {draftGaps.length ? (
              <div className="shift-gap-preview" role="alert">
                <AlertTriangle size={18} />
                <span>
                  <strong>Coverage gap detected</strong>No active nurse shift
                  covers {draftGaps.map((gap) => gap.label).join(", ")}. You can
                  save this configuration, but schedules cannot be published
                  until the gap is closed.
                </span>
              </div>
            ) : (
              <div className="shift-gap-preview safe">
                <ShieldCheck size={18} />
                <span>
                  <strong>Full-day time coverage</strong>The active shifts cover
                  all 24 hours.
                </span>
              </div>
            )}
          </section>
          <div className="coverage-fields">
            <label>
              <span>ER treatment beds</span>
              <input
                type="number"
                min="1"
                max="200"
                value={draft.erBeds}
                onChange={(event) =>
                  setDraft({ ...draft, erBeds: Number(event.target.value) })
                }
              />
              <small>
                Reference capacity only; set actual requirements in the daily table above.
              </small>
            </label>
            <label>
              <span>Morning minimum</span>
              <input
                type="number"
                min={bedFloor}
                max="50"
                disabled={
                  !draft.shiftDefinitions.find(
                    (shift) => shift.code === "morning",
                  )?.enabled
                }
                value={draft.morningCoverage}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    morningCoverage: Number(event.target.value),
                  })
                }
              />
              <small>Default for newly created planning periods.</small>
            </label>
            <label>
              <span>Afternoon minimum</span>
              <input
                type="number"
                min={bedFloor}
                max="50"
                disabled={
                  !draft.shiftDefinitions.find(
                    (shift) => shift.code === "afternoon",
                  )?.enabled
                }
                value={draft.afternoonCoverage}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    afternoonCoverage: Number(event.target.value),
                  })
                }
              />
              <small>Default for newly created planning periods.</small>
            </label>
            <label>
              <span>Night minimum</span>
              <input
                type="number"
                min={bedFloor}
                max="50"
                disabled={
                  !draft.shiftDefinitions.find(
                    (shift) => shift.code === "night",
                  )?.enabled
                }
                value={draft.nightCoverage}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    nightCoverage: Number(event.target.value),
                  })
                }
              />
              <small>Default for newly created planning periods.</small>
            </label>
            <label>
              <span>Charge nurses per shift</span>
              <input
                type="number"
                min="0"
                max={
                  activeCoverageValues.length
                    ? Math.min(...activeCoverageValues)
                    : 0
                }
                value={draft.chargeNursesPerShift}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    chargeNursesPerShift: Number(event.target.value),
                  })
                }
              />
              <small>Set 0 for none, or require more than one.</small>
            </label>
            <label>
              <span>Maximum shifts per nurse</span>
              <input
                type="number"
                min="1"
                max="14"
                value={draft.maximumShifts}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    maximumShifts: Number(event.target.value),
                  })
                }
              />
              <small>Includes overtime and each shift in a double shift.</small>
            </label>
          </div>
          <section
            className="override-section"
            aria-labelledby="override-editor-title"
          >
            <header>
              <div>
                <span>OPTIONAL EXCEPTIONS</span>
                <h3 id="override-editor-title">
                  Weekend or specific-day coverage
                </h3>
                <p>
                  A specific Saturday or Sunday rule takes priority over the
                  general weekend rule.
                </p>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={addException}
                disabled={draft.coverageOverrides.length >= targets.length}
              >
                <Plus size={15} />
                Add exception
              </button>
            </header>
            {draft.coverageOverrides.length ? (
              <div className="override-list">
                {draft.coverageOverrides.map((rule, index) => (
                  <fieldset
                    className="override-editor"
                    key={`${rule.target}-${index}`}
                  >
                    <legend>{targetLabels[rule.target]}</legend>
                    <label>
                      <span>Applies to</span>
                      <select
                        value={rule.target}
                        onChange={(event) =>
                          updateException(index, {
                            target: event.target.value as CoverageRuleTarget,
                          })
                        }
                      >
                        {targets.map((target) => (
                          <option
                            key={target}
                            value={target}
                            disabled={draft.coverageOverrides.some(
                              (item, ruleIndex) =>
                                ruleIndex !== index && item.target === target,
                            )}
                          >
                            {targetLabels[target]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>AM</span>
                      <input
                        type="number"
                        min={bedFloor}
                        max="50"
                        value={rule.morningCoverage}
                        onChange={(event) =>
                          updateException(index, {
                            morningCoverage: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>PM</span>
                      <input
                        type="number"
                        min={bedFloor}
                        max="50"
                        value={rule.afternoonCoverage}
                        onChange={(event) =>
                          updateException(index, {
                            afternoonCoverage: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Night</span>
                      <input
                        type="number"
                        min={bedFloor}
                        max="50"
                        value={rule.nightCoverage}
                        onChange={(event) =>
                          updateException(index, {
                            nightCoverage: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Charge nurses</span>
                      <input
                        type="number"
                        min="0"
                        max={Math.min(
                          rule.morningCoverage,
                          rule.afternoonCoverage,
                          rule.nightCoverage,
                        )}
                        value={rule.chargeNurses}
                        onChange={(event) =>
                          updateException(index, {
                            chargeNurses: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <button
                      className="remove-override"
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          coverageOverrides: draft.coverageOverrides.filter(
                            (_, ruleIndex) => ruleIndex !== index,
                          ),
                        })
                      }
                      aria-label={`Remove ${targetLabels[rule.target]} exception`}
                    >
                      <Trash2 size={15} />
                      Remove
                    </button>
                  </fieldset>
                ))}
              </div>
            ) : (
              <p className="override-empty">
                No exceptions. The normal profile applies every day.
              </p>
            )}
          </section>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="rules-source-note">
            <Info size={15} />
            The percentage mix is a configurable planning guide. The bed-based
            minimum comes from the Philippine DOH hospital assessment tool;
            local policy and real-time acuity can require more.
          </p>
          <footer>
            <button
              className="secondary-button"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="primary-button" type="submit">
              <Check size={16} />
              Save and regenerate
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function InfoDialog({
  kind,
  onClose,
}: {
  kind: "help" | "notifications" | "review";
  onClose: () => void;
}) {
  const help = kind === "help";
  const review = kind === "review";
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="info-dialog t-modal is-open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="info-dialog-title"
      >
        <header>
          <span className="dialog-icon">
            {help ? (
              <HelpCircle size={19} />
            ) : review ? (
              <ShieldCheck size={19} />
            ) : (
              <Bell size={19} />
            )}
          </span>
          <div>
            <span>
              {help
                ? "HANDLED GUIDE"
                : review
                  ? "SCHEDULE REVIEW"
                  : "NOTIFICATIONS"}
            </span>
            <h2 id="info-dialog-title">
              {help
                ? "Build a two-week schedule"
                : review
                  ? "What the review markers mean"
                  : "You’re all caught up"}
            </h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={19} />
          </button>
        </header>
        {help ? (
          <ol>
            <li>
              Add nurses under <strong>Nursing team</strong>.
            </li>
            <li>
              Download or import structured requests under <strong>Preferences</strong>.
            </li>
            <li>
              Review the enforced rules under <strong>Coverage rules</strong>.
            </li>
            <li>Generate, review, and publish the two-week schedule.</li>
          </ol>
        ) : review ? (
          <ol>
            <li>
              <strong>Rule flag:</strong> the draft has a daily balance, REST,
              recovery, fairness, protected-leave, or Training conflict.
            </li>
            <li>
              <strong>Caution (!):</strong> the assignment conflicts with an
              protected leave, Training, or a scheduling rule. Click the cell or read the
              attention panel for the exact reason.
            </li>
            <li>
              <strong>Draft:</strong> the period changed after generation or
              publishing and must be reviewed again.
            </li>
            <li>
              <strong>Understaffing and forced overtime:</strong> use the
              coverage decision beside a short shift. HANDLED converts matched
              adjacent duties into two 12-hour shifts and keeps the shortage
              flagged if a safe pair is unavailable.
            </li>
          </ol>
        ) : (
          <p>
            HANDLED will show coverage decisions and import results here in a future
            release. There are no new alerts.
          </p>
        )}
        <footer>
          <button className="primary-button" type="button" onClick={onClose}>
            Got it
          </button>
        </footer>
      </section>
    </div>
  );
}

type TutorialStep = {
  view: AppView;
  eyebrow: string;
  title: string;
  body: string;
  action: string;
  points: string[];
  targets: string[];
  targetLabel: string;
};

const tutorialSteps: TutorialStep[] = [
  {
    view: "schedule",
    eyebrow: "STEP 1 · TWO-WEEK PERIOD",
    title: "Choose the schedule period",
    body: "HANDLED stores requests and assignments separately for every 14-day period, so confirm the highlighted date range before you begin.",
    action:
      "Use the left and right arrows beside the highlighted date range to move between two-week periods.",
    points: [
      "A new period starts with no requests and no generated schedule.",
      "Copying the previous period is optional and copies requests only.",
      "The default period is Sunday, September 13–Saturday, September 26, 2026.",
    ],
    targets: ['[data-tutorial="schedule-week"]'],
    targetLabel: "Two-week period selector",
  },
  {
    view: "team",
    eyebrow: "STEP 2 · NURSING TEAM",
    title: "Add every nurse to the roster",
    body: "The highlighted Add nurse button opens the roster form. Add the complete team before importing requests.",
    action:
      "Select Add nurse, enter the employee’s name, ID, and employment date, then save.",
    points: [
      "HANDLED creates the next Employee ID automatically.",
      "All nurses are treated equally during schedule generation.",
      "Removing a nurse also removes that nurse’s requests and assignments.",
    ],
    targets: ['[data-tutorial="add-nurse"]'],
    targetLabel: "Add nurse button",
  },
  {
    view: "preferences",
    eyebrow: "STEP 3 · COLLECT REQUESTS",
    title: "Bring in the nurses’ requests",
    body: "The highlighted controls download the structured 14-day template and import responses collected through Excel or Google Forms.",
    action:
      "Download the Excel template, collect the responses, then select Import file.",
    points: [
      "The Employee ID must match the current roster.",
      "The staff form enforces the head nurse’s configured date limit.",
      "A blank date means no request; importing never generates the schedule.",
    ],
    targets: ['[data-tutorial="preferences-actions"]'],
    targetLabel: "Request import controls",
  },
  {
    view: "preferences",
    eyebrow: "STEP 4 · REVIEW RESPONSES",
    title: "Review staff requests",
    body: "Use the highlighted pencil to enter or correct one structured request for each of the 14 dates.",
    action:
      "Select the pencil, then choose 6, 2, N, REST, Birthday Leave, Personal Leave, Training, or No request for each date.",
    points: [
      "Ordinary requests guide HANDLED but are not guaranteed.",
      "Shift and REST entries guide HANDLED; leave and Training are protected.",
      "When requests compete, HANDLED first helps nurses with fewer fulfilled requests, then considers prior denials, and rotates exact ties each period.",
      "The head nurse may enter additional dates without a limit.",
    ],
    targets: [
      '[data-tutorial="preference-edit"]',
      '[data-tutorial="preferences-actions"]',
    ],
    targetLabel: "Edit request button",
  },
  {
    view: "rules",
    eyebrow: "STEP 5 · ENFORCED RULES",
    title: "Understand the scheduling rules",
    body: "The rules page explains the fixed shift codes, daily balance, REST limits, recovery rules, and individual fairness checks HANDLED enforces.",
    action:
      "Review the highlighted rule section before generating the first schedule for a new roster.",
    points: [
      "6 is 6 AM–2 PM, 2 is 2 PM–10 PM, and N is 10 PM–6 AM.",
      "Each nurse receives two REST days in each seven-day half.",
      "Daily shift totals stay equal when possible and never differ by more than one.",
    ],
    targets: ['[data-tutorial="edit-rules"]'],
    targetLabel: "Enforced rules list",
  },
  {
    view: "schedule",
    eyebrow: "STEP 6 · GENERATE",
    title: "Create the first draft",
    body: "HANDLED uses the roster and any recorded requests to build a complete, reviewable 14-day draft.",
    action:
      "Select Generate draft after the roster is ready. Requests are optional, so blank dates do not block generation.",
    points: [
      "HANDLED plots leave first, Training second, then REST and working shifts.",
      "HANDLED balances 6, 2, N, REST, recovery time, and each nurse’s shift mix.",
      "Anything HANDLED cannot satisfy is listed for head-nurse review.",
    ],
    targets: [
      '[data-tutorial="generate-draft"]',
      '[data-tutorial="schedule-empty"]',
    ],
    targetLabel: "Generate draft button",
  },
  {
    view: "schedule",
    eyebrow: "STEP 7 · RULE FLAGS",
    title: "Review anything that needs attention",
    body: "The attention panel explains any daily imbalance, REST shortage, recovery conflict, request conflict, or unfair shift mix.",
    action:
      "Select the highlighted issue or schedule cell, make the necessary change, and confirm that the rule flag disappears.",
    points: [
      "Red flags block publication; yellow flags require review.",
      "Every flag names the affected date or nurse and explains why.",
      "Regenerate at any time to restore an automatically balanced draft.",
    ],
    targets: [
      '[data-tutorial="coverage-decision"]',
      '[data-tutorial="schedule-empty"]',
    ],
    targetLabel: "First scheduling-rule check",
  },
  {
    view: "schedule",
    eyebrow: "STEP 8 · MANUAL EDITS",
    title: "Edit any nurse’s assignment",
    body: "Every nurse-and-date cell in the schedule can be changed after generation.",
    action:
      "Select the highlighted schedule cell and choose 6 Morning, 2 Afternoon, N Night, REST, Birthday Leave, Personal Leave, or Training.",
    points: [
      "Any manual change returns a published period to Draft.",
      "Conflicts with protected leave or Training are shown before saving.",
      "Daily totals and rule flags update immediately.",
    ],
    targets: [
      '[data-tutorial="assignment-cell"]',
      '[data-tutorial="schedule-empty"]',
    ],
    targetLabel: "Editable schedule cell",
  },
  {
    view: "schedule",
    eyebrow: "STEP 9 · UNDERSTAFFING AND OVERTIME",
    title: "Cover an understaffed shift safely",
    body: "When a shift cannot be filled, HANDLED can pair adjacent duties into two 12-hour shifts. For example, a missing 2 Afternoon shift becomes 6:00 AM–6:00 PM and 6:00 PM–6:00 AM coverage.",
    action:
      "Select Assign forced overtime in the highlighted coverage decision. Review the named employees and the updated staffing total.",
    points: [
      "Each extension is four hours, so an employee works no more than 12 continuous hours.",
      "Each selected employee receives four overtime hours. Priority goes to employees with fewer past overtime hours, then the newest hire.",
      "If no safe pair exists, the shift stays visibly understaffed for head-nurse action.",
    ],
    targets: [
      '[data-tutorial="coverage-decision"]',
      '[data-tutorial="schedule-empty"]',
    ],
    targetLabel: "Understaffing coverage decision",
  },
  {
    view: "schedule",
    eyebrow: "STEP 10 · FINALIZE",
    title: "Review, publish, and export",
    body: "The highlighted actions show draft status, Excel export, generation, and publishing. Publication is available only when no blocking rule remains.",
    action:
      "Resolve blocking rule flags, review warnings, publish the schedule, then select Export Excel.",
    points: [
      "The workbook includes 14 dates and daily 6, 2, N, and REST totals.",
      "Any later edit changes the two-week schedule back to Draft.",
      "The color-coded export is formatted for review and printing.",
    ],
    targets: [
      '[data-tutorial="schedule-actions"]',
      '[data-tutorial="schedule-empty"]',
    ],
    targetLabel: "Schedule action controls",
  },
  {
    view: "reports",
    eyebrow: "STEP 11 · REPORTS",
    title: "Review monthly or yearly results",
    body: "Reports combine generated two-week periods into monthly or yearly coverage, hours, request matches, shift mix, and workload summaries.",
    action:
      "Use the highlighted Month and Year controls to change the reporting period.",
    points: [
      "Only generated periods are included.",
      "Ungenerated periods are not counted as zero coverage.",
      "Use workload totals to spot imbalance across nurses.",
    ],
    targets: [
      '[data-tutorial="report-period"]',
      '[data-tutorial="reports-content"]',
    ],
    targetLabel: "Report period controls",
  },
];

function TutorialPromptDialog({
  onClose,
  onStart,
}: {
  onClose: () => void;
  onStart: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    startButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable.at(-1)?.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === focusable.at(-1)
      ) {
        event.preventDefault();
        focusable[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className="info-dialog tutorial-prompt t-modal is-open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-prompt-title"
      >
        <header>
          <span className="dialog-icon">
            <HelpCircle size={19} />
          </span>
          <div>
            <span>GUIDED HELP</span>
            <h2 id="tutorial-prompt-title">Start tutorial mode?</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close tutorial prompt"
          >
            <X size={19} />
          </button>
        </header>
        <p>
          Take a guided tour of the complete HANDLED workflow. Each step highlights
          the exact control being explained, while the rest of the screen is
          dimmed. The tutorial will not edit or save staffing data.
        </p>
        <div className="tutorial-preview">
          <Sparkles size={18} />
          <span>
            <strong>11 focused steps · about 3 minutes</strong>Two-week period,
            roster setup, requests, enforced rules, generation, rule flags,
            schedule editing, forced overtime, publishing, export, and reports.
          </span>
        </div>
        <footer>
          <button className="secondary-button" type="button" onClick={onClose}>
            Not now
          </button>
          <button
            ref={startButton}
            className="primary-button"
            type="button"
            onClick={onStart}
          >
            Start tutorial <ChevronRight size={16} />
          </button>
        </footer>
      </section>
    </div>
  );
}

function TutorialTour({
  step,
  onStep,
  onExit,
  onFinish,
}: {
  step: number;
  onStep: (step: number) => void;
  onExit: () => void;
  onFinish: () => void;
}) {
  const current = tutorialSteps[step];
  const dialog = useRef<HTMLElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const [targetRect, setTargetRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [placement, setPlacement] = useState("card-bottom card-right");
  useEffect(() => {
    nextButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
      if (event.key !== "Tab") return;
      const focusable = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable.at(-1)?.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === focusable.at(-1)
      ) {
        event.preventDefault();
        focusable[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, onExit]);
  useEffect(() => {
    const target = current.targets
      .map((selector) => document.querySelector<HTMLElement>(selector))
      .find((element): element is HTMLElement => Boolean(element));
    if (!target) {
      setTargetRect(null);
      return;
    }
    const mobile = window.innerWidth <= 650;
    target.scrollIntoView({
      behavior: "auto",
      block: mobile ? "start" : "center",
      inline: "center",
    });
    if (mobile) window.scrollBy({ top: -88, behavior: "auto" });
    let frame = 0;
    let timer = 0;
    const measure = () => {
      const bounds = target.getBoundingClientRect();
      const padding = window.innerWidth <= 650 ? 6 : 10;
      const left = Math.max(8, bounds.left - padding);
      const top = Math.max(8, bounds.top - padding);
      const right = Math.min(window.innerWidth - 8, bounds.right + padding);
      const bottom = Math.min(window.innerHeight - 8, bounds.bottom + padding);
      setTargetRect(
        right > left && bottom > top
          ? { top, left, width: right - left, height: bottom - top }
          : null,
      );
      setPlacement(
        mobile
          ? "card-bottom card-right"
          : `${bounds.top + bounds.height / 2 > window.innerHeight / 2 ? "card-top" : "card-bottom"} ${bounds.left + bounds.width / 2 > window.innerWidth / 2 ? "card-left" : "card-right"}`,
      );
    };
    frame = window.requestAnimationFrame(measure);
    timer = window.setTimeout(measure, 80);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [current.targets, step]);
  const spotlightStyle = targetRect
    ? ({
        top: targetRect.top,
        left: targetRect.left,
        width: targetRect.width,
        height: targetRect.height,
      } satisfies CSSProperties)
    : undefined;
  return (
    <div
      className={`tutorial-layer ${placement} ${targetRect ? "" : "no-target"}`}
    >
      {targetRect ? (
        <div
          className="tutorial-spotlight"
          style={spotlightStyle}
          aria-hidden="true"
        />
      ) : null}
      <aside
        ref={dialog}
        className="tutorial-card t-panel-slide"
        data-open="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-step-title"
      >
        <header>
          <div>
            <span>TUTORIAL MODE</span>
            <strong>
              Step {step + 1} of {tutorialSteps.length}
            </strong>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onExit}
            aria-label="Exit tutorial"
          >
            <X size={18} />
          </button>
        </header>
        <div
          className="tutorial-progress"
          style={{
            gridTemplateColumns: `repeat(${tutorialSteps.length}, 1fr)`,
          }}
          aria-hidden="true"
        >
          {tutorialSteps.map((_, index) => (
            <i className={index <= step ? "complete" : ""} key={index} />
          ))}
        </div>
        <section aria-live="polite">
          <span>{current.eyebrow}</span>
          <h2 id="tutorial-step-title">{current.title}</h2>
          <p>{current.body}</p>
          <div className="tutorial-action">
            <strong>WHAT TO DO</strong>
            <span>{current.action}</span>
          </div>
          <ul>
            {current.points.map((point) => (
              <li key={point}>
                <Check size={14} />
                {point}
              </li>
            ))}
          </ul>
          <div className="tutorial-viewing">
            <Eye size={15} />
            <span>
              Highlighted: <strong>{current.targetLabel}</strong> in{" "}
              {viewMeta[current.view].title}
            </span>
          </div>
        </section>
        <footer>
          <button
            className="secondary-button"
            type="button"
            onClick={() => onStep(step - 1)}
            disabled={step === 0}
          >
            <ChevronLeft size={16} />
            Back
          </button>
          {step === tutorialSteps.length - 1 ? (
            <button
              ref={nextButton}
              className="primary-button"
              type="button"
              onClick={onFinish}
            >
              <CheckCircle2 size={16} />
              Finish tutorial
            </button>
          ) : (
            <button
              ref={nextButton}
              className="primary-button"
              type="button"
              onClick={() => onStep(step + 1)}
            >
              Next <ChevronRight size={16} />
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}

function PrivacyDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="info-dialog privacy-dialog t-modal is-open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-dialog-title"
      >
        <header>
          <span className="dialog-icon">
            <ShieldCheck size={19} />
          </span>
          <div>
            <span>DATA HANDLING</span>
            <h2 id="privacy-dialog-title">Privacy and security summary</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close privacy summary"
          >
            <X size={19} />
          </button>
        </header>
        <dl>
          <div>
            <dt>Stored data</dt>
            <dd>
              Employee IDs, names, hire and last-working dates, two-week
              requests and summaries, assignments, forced-overtime coverage,
              coverage rules, and non-identifying audit metadata.
            </dd>
          </div>
          <div>
            <dt>Purpose</dt>
            <dd>
              Preparing and reviewing ER nursing schedules for the authenticated
              workspace.
            </dd>
          </div>
          <div>
            <dt>Processors</dt>
            <dd>
              Vercel hosts the application and Neon hosts the private Postgres
              database. Vercel Web Analytics records aggregated, cookie-free
              page-view information such as route, referrer, approximate region,
              browser, and device type. HANDLED does not send Employee IDs,
              nurse names, request text, or schedule contents as analytics events.
            </dd>
          </div>
          <div>
            <dt>Security</dt>
            <dd>
              TLS, server-only database credentials, salted password hashes,
              strict HTTP-only sessions, input validation, and account-scoped
              API access.
            </dd>
          </div>
          <div>
            <dt>Deletion</dt>
            <dd>
              The head nurse can remove individual nurses or permanently delete
              the complete workspace under Coverage rules.
            </dd>
          </div>
        </dl>
        <p className="privacy-blocker">
          <strong>Before real hospital use:</strong> the deploying hospital must
          provide its legal operator identity, privacy contact or DPO, retention
          period, lawful-basis notice, access-review process, and
          incident-response procedure. Never enter patient data.
        </p>
        <footer>
          <button className="primary-button" type="button" onClick={onClose}>
            Close summary
          </button>
        </footer>
      </section>
    </div>
  );
}

type PublicRequestDay = { key: string; label: string; active?: boolean };

function StaffRequestPage({ token }: { token: string }) {
  const [days, setDays] = useState<PublicRequestDay[]>([]);
  const [maxRequests, setMaxRequests] = useState(5);
  const [nurseId, setNurseId] = useState("");
  const [surname, setSurname] = useState("");
  const [nurse, setNurse] = useState<{ id: string; name: string } | null>(null);
  const [nurseToken, setNurseToken] = useState("");
  const [draft, setDraft] = useState<Record<string, DutyCode>>({});
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const selectedCount = Object.keys(draft).length;

  useEffect(() => {
    let active = true;
    fetch(`/api/public-request?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Request form unavailable.");
        return result;
      })
      .then((result) => {
        if (!active) return;
        setDays(result.days ?? []);
        setMaxRequests(result.maxRequests ?? 5);
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Request form unavailable.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function verifyIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/public-request?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "verify", nurseId, surname }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Identity could not be verified.");
      setNurse(result.nurse);
      setNurseToken(result.nurseToken);
      setDays(result.days ?? days);
      setMaxRequests(result.maxRequests ?? maxRequests);
      setDraft(result.requests ?? {});
      setComment(result.comment ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Identity could not be verified.");
    } finally {
      setSubmitting(false);
    }
  }

  function changeRequest(dayKey: string, value: string) {
    setDraft((current) => {
      const next = { ...current };
      if (!value) delete next[dayKey];
      else next[dayKey] = value as DutyCode;
      return next;
    });
  }

  async function submitRequests(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedCount > maxRequests) return;
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/public-request?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "submit",
            nurseToken,
            requests: draft,
            comment: comment.trim(),
          }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Requests could not be saved.");
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Requests could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="staff-request-page">
      <header className="staff-request-brand">
        <span className="login-mark">H</span>
        <span>
          <strong>HANDLED</strong>
          <small>Your ED Schedule, Automatically.</small>
        </span>
      </header>
      <section className="staff-request-card">
        {loading ? (
          <div className="staff-request-state">
            <span className="loading-spinner" />
            <h1>Opening the request form</h1>
            <p>HANDLED is checking this two-week request link.</p>
          </div>
        ) : error && !days.length ? (
          <div className="staff-request-state error">
            <AlertTriangle size={30} />
            <h1>This request form is unavailable</h1>
            <p>{error}</p>
            <a className="secondary-button" href="/">Return to HANDLED sign in</a>
          </div>
        ) : complete ? (
          <div className="staff-request-state success">
            <CheckCircle2 size={34} />
            <span>REQUEST RECEIVED</span>
            <h1>Thank you, {nurse?.name}</h1>
            <p>
              Your {selectedCount} date request{selectedCount === 1 ? "" : "s"}{" "}
              {selectedCount === 1 ? "was" : "were"} sent to the head nurse. You
              may reopen this link to replace your response while the form remains open.
            </p>
            <a className="primary-button" href="/">Finish</a>
          </div>
        ) : !nurse ? (
          <>
            <div className="staff-request-heading">
              <span>PRIVATE TWO-WEEK REQUEST FORM</span>
              <h1>Verify your staff record</h1>
              <p>
                Enter your assigned Employee ID and surname. The form does not show
                the nursing-team roster.
              </p>
            </div>
            <form className="staff-identity-form" onSubmit={verifyIdentity}>
              <label>
                <span>Employee ID</span>
                <input
                  value={nurseId}
                  onChange={(event) => setNurseId(event.target.value.toUpperCase())}
                  placeholder="123456"
                  autoComplete="off"
                  required
                />
              </label>
              <label>
                <span>Surname</span>
                <input
                  value={surname}
                  onChange={(event) => setSurname(event.target.value)}
                  autoComplete="family-name"
                  required
                />
              </label>
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <button className="primary-button" type="submit" disabled={submitting}>
                <UserRoundCheck size={16} />
                {submitting ? "Checking…" : "Continue"}
              </button>
            </form>
            <p className="staff-request-privacy">
              Use this form only for your own schedule requests. Do not enter
              patient information or medical details. Your response is visible
              to the head nurse. <button type="button" onClick={() => setPrivacyOpen(true)}>Privacy &amp; security</button>
            </p>
          </>
        ) : (
          <>
            <div className="staff-request-heading">
              <span>TWO-WEEK SCHEDULE REQUEST</span>
              <h1>Hello, {nurse.name}</h1>
              <p>
                Select up to {maxRequests} dates. These are requests for head-nurse review and are not guaranteed assignments.
              </p>
            </div>
            <div className="staff-request-count" aria-live="polite">
              <span><strong>{selectedCount}</strong> of {maxRequests} selected</span>
              <i><span style={{ width: `${Math.min(100, (selectedCount / maxRequests) * 100)}%` }} /></i>
            </div>
            <form onSubmit={submitRequests}>
              <div className="staff-request-grid">
                {days.map((day) => {
                  const selected = draft[day.key];
                  const limitReached = selectedCount >= maxRequests && !selected;
                  return (
                    <label key={day.key}>
                      <span><strong>{day.label}</strong><small>{day.active === false ? "Outside employment dates" : selected ? dutyLabels[selected] : "No request"}</small></span>
                      <select
                        value={selected ?? ""}
                        onChange={(event) => changeRequest(day.key, event.target.value)}
                        aria-label={`Request for ${day.label}`}
                        disabled={day.active === false}
                      >
                        <option value="">No request</option>
                        <option value="morning" disabled={limitReached}>6 Morning</option>
                        <option value="afternoon" disabled={limitReached}>2 Afternoon</option>
                        <option value="night" disabled={limitReached}>N Night</option>
                        <option value="rest" disabled={limitReached}>REST</option>
                        <option value="birthday_leave" disabled={limitReached}>Birthday Leave</option>
                        <option value="personal_leave" disabled={limitReached}>Personal Leave</option>
                      </select>
                    </label>
                  );
                })}
              </div>
              <label className="staff-request-comment">
                <span>Why are you requesting this schedule? <small>Optional</small></span>
                <textarea
                  value={comment}
                  maxLength={500}
                  rows={4}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Give the head nurse a short summary of your scheduling reason."
                />
                <small>{comment.length}/500 · Do not include patient names, diagnoses, or medical details.</small>
              </label>
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <footer className="staff-request-actions">
                <button className="secondary-button" type="button" onClick={() => { setNurse(null); setNurseToken(""); setError(""); }}>
                  Not {nurse.name}
                </button>
                <button className="primary-button" type="submit" disabled={submitting || selectedCount > maxRequests}>
                  <Send size={16} />
                  {submitting ? "Submitting…" : "Submit requests"}
                </button>
              </footer>
            </form>
          </>
        )}
      </section>
      {privacyOpen ? <PrivacyDialog onClose={() => setPrivacyOpen(false)} /> : null}
    </main>
  );
}

function LoginScreen({
  onSignedIn,
}: {
  onSignedIn: (user: SessionUser) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (
        import.meta.env.DEV &&
        username.toLowerCase() === "demo" &&
        password === "DEMO"
      ) {
        onSignedIn({
          username: "demo",
          name: "Maria Teresa",
          role: "Demo Head Nurse",
          isDemo: true,
          seeded: true,
        });
        return;
      }
      const response = await fetch("/api/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.user)
        throw new Error(result.error || "Sign-in is unavailable. Try again.");
      onSignedIn(result.user);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Sign-in is unavailable. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function useDemo() {
    setUsername("demo");
    setPassword("DEMO");
    setError("");
  }

  return (
    <main className="login-page">
      <section className="login-brand" aria-label="HANDLED introduction">
        <div className="login-brand-top">
          <span className="login-mark">H</span>
          <span>
            <strong>HANDLED</strong>
            <small>Hospital Automated Nurse Duty Lineup &amp; Equitable Distribution</small>
          </span>
        </div>
        <div className="login-brand-copy">
          <span>ER WORKFORCE PLANNING</span>
          <h1>
            Every shift covered.
            <br />
            Every decision yours.
          </h1>
          <p>
            Build a fair two-week emergency nursing schedule from structured
            requests while keeping the final schedule under the head nurse’s control.
          </p>
        </div>
        <div className="login-safety">
          <ShieldCheck size={19} />
          <span>
            <strong>Private scheduling workspace</strong>
            <small>
              Use staff scheduling information only. Do not enter patient
              records or clinical details.
            </small>
          </span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <div className="login-mobile-brand">
                <span className="login-mark">H</span>
            <span>
              <strong>HANDLED</strong>
              <small>Emergency-nurse scheduling</small>
            </span>
          </div>
          <span className="login-eyebrow">AUTHORIZED ACCESS</span>
          <h2>Welcome back</h2>
          <p className="login-intro">
            Sign in to prepare and review the emergency nursing schedule.
          </p>
          <form onSubmit={handleSubmit}>
            <label>
              <span>Username</span>
              <input
                name="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                required
                disabled={submitting}
              />
            </label>
            <label>
              <span>Password</span>
              <span className="password-field">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={submitting}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>
            {error ? (
              <p className="login-error" role="alert">
                <AlertTriangle size={15} />
                {error}
              </p>
            ) : null}
            <button
              className="login-submit"
              type="submit"
              disabled={submitting}
            >
              <LogIn size={17} />
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <div className="demo-access">
            <div>
              <span>TRY THE INTERACTIVE DEMO</span>
              <strong>
                Username: demo <i /> Password: DEMO
              </strong>
            </div>
            <button type="button" onClick={useDemo}>
              Fill demo account
            </button>
          </div>
          <p className="login-cookie-note">
            HANDLED uses one necessary secure session cookie after sign-in. No
            analytics or advertising cookies.{" "}
            <button type="button" onClick={() => setPrivacyOpen(true)}>
              Privacy &amp; security
            </button>
          </p>
        </div>
      </section>
      {privacyOpen ? (
        <PrivacyDialog onClose={() => setPrivacyOpen(false)} />
      ) : null}
    </main>
  );
}

function SchedulingApp({
  user,
  onLogout,
}: {
  user: SessionUser;
  onLogout: () => Promise<void>;
}) {
  const startsSeeded = user.isDemo || user.seeded;
  const [view, setView] = useState<AppView>("schedule");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [nurseList, setNurseList] = useState<Nurse[]>(() =>
    startsSeeded ? demoNurses : [],
  );
  const [preferences, setPreferences] = useState<PreferenceMap>(() =>
    startsSeeded ? initialPreferences : {},
  );
  const [requests, setRequests] = useState<ScheduleRequestMap>(() =>
    startsSeeded ? initialRequests : {},
  );
  const [requestPortal, setRequestPortal] = useState<RequestPortal | undefined>();
  const [requestLink, setRequestLink] = useState<string | null>(null);
  const [requestSubmissions, setRequestSubmissions] = useState<Record<string, string>>(
    startsSeeded ? initialRequestSubmissions : {},
  );
  const [requestComments, setRequestComments] = useState<Record<string, string>>(
    startsSeeded ? initialRequestComments : {},
  );
  const [portalBusy, setPortalBusy] = useState(false);
  const [workRequests, setWorkRequests] = useState<WorkRequestMap>(() =>
    startsSeeded ? initialWorkRequests : {},
  );
  const [settings, setSettings] = useState<CoverageSettings>(
    defaultCoverageSettings,
  );
  const [dailyCoverage, setDailyCoverage] = useState<DailyCoverage>(() =>
    createDailyCoverage(),
  );
  const [overtimeCoverage, setOvertimeCoverage] = useState<OvertimeCoverage[]>([]);
  const [assignments, setAssignments] = useState<AssignmentMap>(() =>
    startsSeeded ? buildTwoWeekDraft(initialRequests, demoNurses).assignments : {},
  );
  const [scheduleIssues, setScheduleIssues] = useState<ScheduleIssue[]>(() =>
    startsSeeded ? buildTwoWeekDraft(initialRequests, demoNurses).issues : [],
  );
  const [weeks, setWeeks] = useState<Record<string, WeekRecord>>(() =>
    startsSeeded
      ? {
          "0": {
            preferences: initialPreferences,
            requests: initialRequests,
            workRequests: initialWorkRequests,
            assignments: buildTwoWeekDraft(initialRequests, demoNurses)
              .assignments,
            issues: buildTwoWeekDraft(initialRequests, demoNurses).issues,
            published: false,
            incidents: [],
            requestSubmissions: initialRequestSubmissions,
            requestComments: initialRequestComments,
            dailyCoverage: createDailyCoverage(),
            overtimeCoverage: [],
          },
        }
      : ({} as Record<string, WeekRecord>),
  );
  const [weekOffset, setWeekOffset] = useState(0);
  const [editingAssignment, setEditingAssignment] = useState<{
    nurseId: string;
    dayKey: string;
  } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [nurseDialog, setNurseDialog] = useState<Nurse | "new" | null>(null);
  const [preferenceNurse, setPreferenceNurse] = useState<Nurse | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [infoKind, setInfoKind] = useState<
    "help" | "notifications" | "review" | null
  >(null);
  const [tutorialPromptOpen, setTutorialPromptOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [published, setPublished] = useState(false);
  const [incidents, setIncidents] = useState<ScheduleIncident[]>([]);
  const [workspaceReady, setWorkspaceReady] = useState(user.isDemo);
  const [saveState, setSaveState] = useState<
    "loading" | "saving" | "saved" | "error"
  >(user.isDemo ? "saved" : "loading");
  const [saveError, setSaveError] = useState("");
  const [workspaceList, setWorkspaceList] = useState<WorkspaceSummary[]>(() =>
    user.isDemo
      ? [
          {
            id: "demo",
            name: "HANDLED Demo Hospital",
            staffType: "nurses",
            memberCount: demoNurses.length,
          },
        ]
      : [],
  );
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    user.isDemo ? "demo" : null,
  );
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const suppressNextSave = useRef(false);
  const weekDays = useMemo(() => datesForPeriod(weekOffset), [weekOffset]);
  const fairnessHistory = useMemo(
    () =>
      buildRequestFairnessHistory(
        Object.entries(weeks)
          .filter(([offset]) => Number(offset) < weekOffset)
          .sort(([first], [second]) => Number(first) - Number(second))
          .map(([, record]) => ({
            requests: record.requests,
            assignments: record.assignments,
          })),
      ),
    [weekOffset, weeks],
  );
  const requirementMap = useMemo(
    () => requirementMapFromDailyCoverage(dailyCoverage),
    [dailyCoverage],
  );
  const historicalOvertimeHours = useMemo(
    () =>
      overtimeHistoryHours(
        Object.entries(weeks)
          .filter(([offset]) => Number(offset) < weekOffset)
          .map(([, record]) => ({
            overtimeCoverage: record.overtimeCoverage,
          })),
      ),
    [weekOffset, weeks],
  );
  const chargeRequirementMap = useMemo(() => chargeRequirements(), []);
  const completeShifts = completedCoverageCount(
    assignments,
    requirementMap,
    chargeRequirementMap,
    nurseList,
    overtimeCoverage,
  );
  const totalShifts = Object.keys(requirementMap).length;
  const hasGeneratedSchedule = Object.keys(assignments).length > 0;
  const blockingScheduleIssues = scheduleIssues.filter(
    (issue) => issue.severity === "error",
  ).length;
  const activeShifts = officialShifts;
  const matchedPreferenceCount = nurseList.filter(
    (nurse) => requestSubmissions[nurse.id],
  ).length;
  const reportWeeks = {
    ...weeks,
    [String(weekOffset)]: {
      preferences,
      requests,
      workRequests,
      assignments,
      published,
      incidents,
      issues: scheduleIssues,
      requestPortal,
      requestSubmissions,
      requestComments,
      dailyCoverage,
      overtimeCoverage,
    },
  };
  const activeStaffType =
    workspaceList.find((workspace) => workspace.id === activeWorkspaceId)
      ?.staffType ?? "nurses";
  const staffLabel = activeStaffType === "orderlies" ? "Orderlies" : "Nurses";
  const staffSingular = activeStaffType === "orderlies" ? "orderly" : "nurse";
  const selectedViewMeta =
    view === "schedule"
      ? {
          ...viewMeta.schedule,
          eyebrow: `${staffLabel.toUpperCase()} / PERIOD ${weekOffset + 1}`,
        }
      : view === "preferences"
        ? {
            ...viewMeta.preferences,
            eyebrow: `${staffLabel.toUpperCase()} REQUESTS / PERIOD ${weekOffset + 1}`,
            title: `${staffSingular[0].toUpperCase()}${staffSingular.slice(1)} requests`,
          }
        : view === "team"
          ? { ...viewMeta.team, title: `${staffSingular[0].toUpperCase()}${staffSingular.slice(1)} team` }
          : viewMeta[view];
  const activeWorkspace =
    workspaceList.find((workspace) => workspace.id === activeWorkspaceId) ??
    (!user.isDemo
      ? {
          id: "primary",
          name: user.seeded ? "HANDLED Test Workspace" : "Salazar ER Workspace",
          staffType: "nurses" as const,
          memberCount: nurseList.length,
        }
      : workspaceList[0]);
  const editingNurse = editingAssignment
    ? nurseList.find((nurse) => nurse.id === editingAssignment.nurseId)
    : undefined;
  const editingDay = editingAssignment
    ? weekDays.find((day) => day.key === editingAssignment.dayKey)
    : undefined;
  const editingShifts =
    editingNurse && editingDay
      ? assignedShiftsOnDay(
          assignments,
          editingNurse.id,
          editingDay.key,
          settings.shiftDefinitions,
        )
      : [];
  const editingDuty =
    editingNurse && editingDay
      ? assignedDutyOnDay(assignments, editingNurse.id, editingDay.key)
      : null;

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function hydrateWorkspace(
    workspace: PersistedWorkspace | null,
    staffType: WorkspaceStaffType = "nurses",
  ) {
    if (!workspace) {
      setNurseList([]);
      setSettings(emptyWorkspace(staffType).settings);
      setWeeks({});
      setWeekOffset(0);
      setRequests({});
      setPreferences({});
      setWorkRequests({});
      setAssignments({});
      setScheduleIssues([]);
      setPublished(false);
      setIncidents([]);
      setRequestPortal(undefined);
      setRequestSubmissions({});
      setRequestComments({});
      setDailyCoverage(createDailyCoverage());
      setOvertimeCoverage([]);
      return;
    }
    const selectedWeek = workspace.weeks?.[
      String(workspace.weekOffset)
    ] ?? {
      preferences: {},
      assignments: {},
      published: false,
      incidents: [],
    };
    const loadedRequests = selectedWeek.requests ?? {};
    const normalizedSettings = normalizeCoverageSettings(workspace.settings);
    setNurseList(workspace.nurses ?? []);
    setSettings(normalizedSettings);
    setWeeks(workspace.weeks ?? {});
    setWeekOffset(workspace.weekOffset ?? 0);
    setRequests(loadedRequests);
    setPreferences(
      Object.keys(loadedRequests).length
        ? legacyPreferencesFromRequests(loadedRequests, workspace.nurses ?? [])
        : selectedWeek.preferences ?? {},
    );
    setWorkRequests(selectedWeek.workRequests ?? {});
    setAssignments(selectedWeek.assignments ?? {});
    setScheduleIssues(
      selectedWeek.issues ??
        validateTwoWeekSchedule(
          selectedWeek.assignments ?? {},
          loadedRequests,
          workspace.nurses ?? [],
          normalizedSettings.twoWeekRules,
          datesForPeriod(workspace.weekOffset ?? 0),
          selectedWeek.overtimeCoverage ?? [],
        ),
    );
    setPublished(Boolean(selectedWeek.published));
    setIncidents(selectedWeek.incidents ?? []);
    setRequestPortal(selectedWeek.requestPortal);
    setRequestSubmissions(selectedWeek.requestSubmissions ?? {});
    setRequestComments(selectedWeek.requestComments ?? {});
    setDailyCoverage(selectedWeek.dailyCoverage ?? createDailyCoverage());
    setOvertimeCoverage(selectedWeek.overtimeCoverage ?? []);
  }

  function currentWorkspaceData(): PersistedWorkspace {
    return {
      nurses: nurseList,
      settings,
      weeks: {
        ...weeks,
        [String(weekOffset)]: {
          preferences,
          requests,
          workRequests,
          assignments,
          published,
          incidents,
          issues: scheduleIssues,
          requestPortal,
          requestSubmissions,
          requestComments,
          dailyCoverage,
          overtimeCoverage,
        },
      },
      weekOffset,
    };
  }

  async function persistCurrentWorkspace() {
    if (user.isDemo || !activeWorkspaceId) return;
    const response = await fetch("/api/workspace", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        workspace: currentWorkspaceData(),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(result.error || "The current workspace could not be saved.");
  }

  function applyWorkspaceResult(
    result: {
      workspace: PersistedWorkspace | null;
      workspaces: WorkspaceSummary[];
      activeWorkspaceId: string;
    },
    message: string,
  ) {
    const selectedType =
      result.workspaces.find(
        (workspace) => workspace.id === result.activeWorkspaceId,
      )?.staffType ?? "nurses";
    suppressNextSave.current = true;
    setWorkspaceList(result.workspaces);
    setActiveWorkspaceId(result.activeWorkspaceId);
    hydrateWorkspace(result.workspace, selectedType);
    setRequestLink(null);
    setWorkspaceManagerOpen(false);
    setSidebarOpen(false);
    setView("schedule");
    setSaveError("");
    setSaveState("saved");
    setNotice(message);
  }

  useEffect(() => {
    if (user.isDemo) return;
    let active = true;
    fetch("/api/workspace", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(result.error || "Workspace could not be loaded.");
        return result as {
          workspace: PersistedWorkspace | null;
          workspaces?: WorkspaceSummary[];
          activeWorkspaceId?: string | null;
        };
      })
      .then((result) => {
        if (!active) return;
        const directories = result.workspaces ?? [];
        const selectedId = result.activeWorkspaceId ?? directories[0]?.id ?? null;
        const selectedType =
          directories.find((workspace) => workspace.id === selectedId)?.staffType ??
          "nurses";
        setWorkspaceList(directories);
        setActiveWorkspaceId(selectedId);
        hydrateWorkspace(result.workspace, selectedType);
        setSaveState("saved");
      })
      .catch((cause) => {
        if (active) {
          setSaveState("error");
          setNotice(
            cause instanceof Error
              ? cause.message
              : "Workspace could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setWorkspaceReady(true);
      });
    return () => {
      active = false;
    };
  }, [user.isDemo]);
  useEffect(() => {
    if (user.isDemo || !workspaceReady) return;
    if (suppressNextSave.current) {
      suppressNextSave.current = false;
      setSaveState("saved");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      const workspace: PersistedWorkspace = {
        nurses: nurseList,
        settings,
        weeks: {
          ...weeks,
          [String(weekOffset)]: {
            preferences,
            requests,
            workRequests,
            assignments,
            published,
            incidents,
            issues: scheduleIssues,
            requestPortal,
            requestSubmissions,
            requestComments,
            dailyCoverage,
            overtimeCoverage,
          },
        },
        weekOffset,
      };
      try {
        const response = await fetch("/api/workspace", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId: activeWorkspaceId ?? undefined,
            workspace,
          }),
          signal: controller.signal,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(result.error || "The workspace could not be saved.");
        if (Array.isArray(result.workspaces)) setWorkspaceList(result.workspaces);
        if (result.activeWorkspaceId)
          setActiveWorkspaceId(result.activeWorkspaceId);
        setSaveError("");
        setSaveState("saved");
      } catch (cause) {
        if (!controller.signal.aborted) {
          const message =
            cause instanceof Error
              ? cause.message
              : "The workspace could not be saved.";
          setSaveError(message);
          setNotice(message);
          setSaveState("error");
        }
      }
    }, 900);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    assignments,
    activeWorkspaceId,
    incidents,
    nurseList,
    preferences,
    requestPortal,
    requestSubmissions,
    requestComments,
    dailyCoverage,
    overtimeCoverage,
    requests,
    workRequests,
    scheduleIssues,
    published,
    settings,
    user.isDemo,
    weekOffset,
    weeks,
    workspaceReady,
  ]);
  useEffect(() => {
    if (view !== "preferences" || user.isDemo || !workspaceReady) return;
    let active = true;
    const workspaceQuery = activeWorkspaceId
      ? `&workspace=${encodeURIComponent(activeWorkspaceId)}`
      : "";
    fetch(`/api/request-link?week=${weekOffset}${workspaceQuery}`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Responses could not be refreshed.");
        return result;
      })
      .then((result) => {
        if (!active) return;
        setRequestPortal(result.portal ?? undefined);
        setRequestLink(result.url ?? null);
        setRequestSubmissions(result.submissions ?? {});
        setRequestComments(result.comments ?? {});
        if (result.requests) {
          setRequests(result.requests);
          setPreferences(legacyPreferencesFromRequests(result.requests, nurseList));
          if (hasGeneratedSchedule)
            setScheduleIssues(validateTwoWeekSchedule(assignments, result.requests, nurseList, settings.twoWeekRules, weekDays, overtimeCoverage));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [view, weekOffset, user.isDemo, workspaceReady, activeWorkspaceId]);
  function navigate(next: AppView) {
    setView(next);
    setSidebarOpen(false);
  }
  function startTutorial() {
    setTutorialPromptOpen(false);
    setTutorialStep(0);
    setView(tutorialSteps[0].view);
    setSidebarOpen(false);
    window.scrollTo({ top: 0 });
  }
  function moveTutorial(nextStep: number) {
    if (nextStep < 0 || nextStep >= tutorialSteps.length) return;
    setTutorialStep(nextStep);
    setView(tutorialSteps[nextStep].view);
    setSidebarOpen(false);
    window.scrollTo({ top: 0 });
  }
  function finishTutorial() {
    setTutorialStep(null);
    setNotice("Tutorial complete. You can reopen it anytime from Help.");
  }
  async function updateRequestPortal(
    action: "create" | "update" | "revoke",
    maxRequests: number,
  ) {
    if (user.isDemo) {
      setNotice("Sign in to a private workspace to create a live staff link.");
      return;
    }
    setPortalBusy(true);
    try {
      const response = await fetch("/api/request-link", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          weekOffset,
          maxRequests,
          workspaceId: activeWorkspaceId,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Request link could not be updated.");
      setRequestPortal(result.portal ?? undefined);
      setRequestLink(result.url ?? null);
      setRequestSubmissions(result.submissions ?? {});
      setRequestComments(result.comments ?? {});
      if (result.requests) {
        setRequests(result.requests);
        setPreferences(legacyPreferencesFromRequests(result.requests, nurseList));
      }
      setNotice(
        action === "revoke"
          ? "The staff request form is now closed."
          : action === "create"
            ? "Staff request link created. Copy it and send it to the nursing team."
            : `Staff may now request up to ${maxRequests} dates.`,
      );
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Request link could not be updated.");
    } finally {
      setPortalBusy(false);
    }
  }
  async function refreshRequestResponses() {
    if (user.isDemo) return;
    setPortalBusy(true);
    try {
      const workspaceQuery = activeWorkspaceId
        ? `&workspace=${encodeURIComponent(activeWorkspaceId)}`
        : "";
      const response = await fetch(
        `/api/request-link?week=${weekOffset}${workspaceQuery}`,
        {
        credentials: "same-origin",
        cache: "no-store",
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Responses could not be refreshed.");
      setRequestPortal(result.portal ?? undefined);
      setRequestLink(result.url ?? null);
      setRequestSubmissions(result.submissions ?? {});
      setRequestComments(result.comments ?? {});
      setRequests(result.requests ?? {});
      setPreferences(legacyPreferencesFromRequests(result.requests ?? {}, nurseList));
      if (hasGeneratedSchedule)
        setScheduleIssues(validateTwoWeekSchedule(assignments, result.requests ?? {}, nurseList, settings.twoWeekRules, weekDays, overtimeCoverage));
      setNotice("Staff response statuses are up to date.");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Responses could not be refreshed.");
    } finally {
      setPortalBusy(false);
    }
  }
  async function copyRequestLink() {
    if (!requestLink) return;
    try {
      await navigator.clipboard.writeText(requestLink);
      setNotice("Staff request link copied.");
    } catch {
      setNotice("Copy was blocked. Select the link field and copy it manually.");
    }
  }
  function generateDraft() {
    if (!nurseList.length) {
      navigate("team");
      setNotice("Add at least one nurse before generating a schedule.");
      return;
    }
    const result = buildTwoWeekDraft(
      requests,
      nurseList,
      fairnessHistory,
      weekOffset,
      settings.twoWeekRules,
    );
    setAssignments(result.assignments);
    setOvertimeCoverage([]);
    setScheduleIssues(result.issues);
    setIncidents([]);
    setPublished(false);
    const blocking = result.issues.filter((issue) => issue.severity === "error");
    setNotice(
      blocking.length
        ? `Two-week draft generated with ${blocking.length} rule${blocking.length === 1 ? "" : "s"} needing review.`
        : "Two-week draft generated. Staffing, REST days, and recovery rules are balanced.",
    );
  }
  function assignForcedOvertime(dayKey: string, shiftCode: ShiftCode) {
    const key = dutyKey(dayKey, shiftCode);
    const alreadyCovered =
      (assignments[key]?.length ?? 0) +
      overtimePositionsCovered(overtimeCoverage, dayKey, shiftCode);
    const missing = Math.max(0, (requirementMap[key] ?? 0) - alreadyCovered);
    if (!missing) {
      setNotice("This shift already meets its daily staffing minimum.");
      return;
    }
    const recommended = recommendForcedOvertime(
      assignments,
      nurseList,
      dayKey,
      shiftCode,
      missing,
      overtimeCoverage,
      historicalOvertimeHours,
      settings.shiftDefinitions,
    );
    if (!recommended.length) {
      setNotice(
        "No safe 12-hour overtime pair is available. The shift remains marked understaffed.",
      );
      return;
    }
    setOvertimeCoverage((current) => {
      const next = [...current, ...recommended];
      setScheduleIssues(
        validateTwoWeekSchedule(
          assignments,
          requests,
          nurseList,
          settings.twoWeekRules,
          weekDays,
          next,
        ),
      );
      return next;
    });
    setPublished(false);
    const nurseNames = recommended
      .flatMap((entry) => entry.nurseIds)
      .map((id) => nurseList.find((nurse) => nurse.id === id)?.name ?? id);
    setNotice(
      `${recommended.length} understaffed position${recommended.length === 1 ? "" : "s"} covered by paired 12-hour duties. ${nurseNames.join(", ")} each receive four overtime hours.`,
    );
  }
  function saveAssignment(
    nurse: Nurse,
    day: ScheduleDay,
    duty: DutyCode,
  ) {
    const remainingOvertime = overtimeCoverage.filter(
      (entry) => entry.dayKey !== day.key,
    );
    setOvertimeCoverage(remainingOvertime);
    setAssignments((current) => {
      const next = replaceNurseDuty(current, nurse.id, day.key, duty);
      setScheduleIssues(validateTwoWeekSchedule(next, requests, nurseList, settings.twoWeekRules, weekDays, remainingOvertime));
      return next;
    });
    setIncidents((current) =>
      current.filter(
        (incident) =>
          !(incident.nurseId === nurse.id && incident.dayKey === day.key),
      ),
    );
    setEditingAssignment(null);
    setPublished(false);
    setNotice(`${nurse.name} assigned ${dutyLabels[duty]} on ${day.label}.`);
  }
  function importPreferences(next: ScheduleRequestMap) {
    setRequests(next);
    setPreferences(legacyPreferencesFromRequests(next, nurseList));
    setAssignments({});
    setScheduleIssues([]);
    setIncidents([]);
    setPublished(false);
    setImportOpen(false);
    setNotice(
      `${nurseList.length} nurse responses imported and matched. Generate the schedule when you are ready.`,
    );
  }
  function saveNursePreferences(next: ScheduleRequestMap, comment: string) {
    if (!preferenceNurse) return;
    const prefix = `${preferenceNurse.id}-`;
    const merged = {
      ...Object.fromEntries(
        Object.entries(requests).filter(([key]) => !key.startsWith(prefix)),
      ),
      ...next,
    };
    setRequests(merged);
    setRequestComments((current) => {
      const updated = { ...current };
      if (comment) updated[preferenceNurse.id] = comment;
      else delete updated[preferenceNurse.id];
      return updated;
    });
    setPreferences(legacyPreferencesFromRequests(merged, nurseList));
    if (hasGeneratedSchedule)
      setScheduleIssues(
        validateTwoWeekSchedule(assignments, merged, nurseList, settings.twoWeekRules, weekDays, overtimeCoverage),
      );
    setPreferenceNurse(null);
    setPublished(false);
    setNotice(
      `${preferenceNurse.name}’s requests were saved for this two-week period.${hasGeneratedSchedule ? " Regenerate the draft to apply them." : ""}`,
    );
  }
  async function downloadTemplate() {
    setNotice("Preparing the formatted Excel template…");
    try {
      await downloadPreferenceWorkbook(
        nurseList,
        weekDays,
        requests,
        `HANDLED-preferences-${weekDays[0].date.replace(" ", "-")}.xlsx`,
      );
      setNotice("Formatted Excel template downloaded.");
    } catch {
      setNotice("The Excel template could not be created. Please try again.");
    }
  }
  async function exportSchedule() {
    setNotice("Preparing the formatted Excel schedule…");
    try {
      await downloadScheduleWorkbook(
        nurseList,
        weekDays,
        activeShifts,
        assignments,
        weekRangeLabel(weekDays),
        published,
        `HANDLED-schedule-${weekDays[0].date.replace(" ", "-")}.xlsx`,
        overtimeCoverage,
      );
      setNotice("Formatted Excel schedule downloaded.");
    } catch {
      setNotice("The Excel schedule could not be created. Please try again.");
    }
  }
  function changeWeek(delta: number) {
    const nextOffset = weekOffset + delta;
    const currentRecord = {
      preferences,
      requests,
      workRequests,
      assignments,
      published,
      incidents,
      issues: scheduleIssues,
      requestPortal,
      requestSubmissions,
      requestComments,
      dailyCoverage,
      overtimeCoverage,
    };
    const nextWeeks = { ...weeks, [String(weekOffset)]: currentRecord };
    const target = nextWeeks[String(nextOffset)] ?? {
      preferences: {},
      requests: {},
      workRequests: {},
      assignments: {},
      published: false,
      incidents: [],
      issues: [],
      requestSubmissions: {},
      requestComments: {},
      dailyCoverage: createDailyCoverage(),
      overtimeCoverage: [],
    };
    setWeeks(nextWeeks);
    setWeekOffset(nextOffset);
    setRequests(target.requests ?? {});
    setPreferences(
      target.requests && Object.keys(target.requests).length
        ? legacyPreferencesFromRequests(target.requests, nurseList)
        : target.preferences,
    );
    setWorkRequests(target.workRequests ?? {});
    setAssignments(target.assignments);
    setPublished(target.published);
    setIncidents(target.incidents ?? []);
    setScheduleIssues(target.issues ?? []);
    setRequestPortal(target.requestPortal);
    setRequestSubmissions(target.requestSubmissions ?? {});
    setRequestComments(target.requestComments ?? {});
    setDailyCoverage(target.dailyCoverage ?? createDailyCoverage());
    setOvertimeCoverage(target.overtimeCoverage ?? []);
    setRequestLink(null);
    setNotice(
      delta > 0
        ? "Moved to the next two-week planning period."
        : "Moved to the previous two-week planning period.",
    );
  }
  function reusePreviousPreferences() {
    const previous = weeks[String(weekOffset - 1)]?.requests ?? {};
    const copied = copyRequestsForRoster(previous, nurseList);
    if (!Object.keys(copied).length) {
      setNotice(
        "No requests are available from the previous two-week period.",
      );
      return;
    }
    setRequests(copied);
    setRequestSubmissions({});
    setRequestComments({});
    setPreferences(legacyPreferencesFromRequests(copied, nurseList));
    setAssignments({});
    setScheduleIssues([]);
    setIncidents([]);
    setOvertimeCoverage([]);
    setPublished(false);
    setNotice(
      "Previous period’s requests copied. Generate a new draft when you are ready.",
    );
  }
  function saveNurse(next: Nurse) {
    const current = nurseDialog === "new" ? null : nurseDialog;
    setNurseList((list) =>
      current
        ? list.map((nurse) => (nurse.id === current.id ? next : nurse))
        : [...list, next],
    );
    if (current && current.id !== next.id) {
      setRequests((values) =>
        Object.fromEntries(
          Object.entries(values).map(([key, value]) => [
            key.startsWith(`${current.id}-`)
              ? `${next.id}-${key.slice(current.id.length + 1)}`
              : key,
            value,
          ]),
        ),
      );
      setPreferences((values) =>
        Object.fromEntries(
          Object.entries(values).map(([key, value]) => [
            key.startsWith(`${current.id}-`)
              ? `${next.id}-${key.slice(current.id.length + 1)}`
              : key,
            value,
          ]),
        ),
      );
      setAssignments((values) =>
        Object.fromEntries(
          Object.entries(values).map(([key, ids]) => [
            key,
            ids.map((id) => (id === current.id ? next.id : id)),
          ]),
        ),
      );
      setRequestSubmissions((values) =>
        Object.fromEntries(
          Object.entries(values).map(([id, value]) => [
            id === current.id ? next.id : id,
            value,
          ]),
        ),
      );
      setRequestComments((values) =>
        Object.fromEntries(
          Object.entries(values).map(([id, value]) => [
            id === current.id ? next.id : id,
            value,
          ]),
        ),
      );
      setOvertimeCoverage((values) =>
        values.map((entry) => ({
          ...entry,
          nurseIds: entry.nurseIds.map((id) =>
            id === current.id ? next.id : id,
          ) as [string, string],
        })),
      );
      setWeeks((records) =>
        Object.fromEntries(
          Object.entries(records).map(([period, record]) => [
            period,
            {
              ...record,
              requests: Object.fromEntries(
                Object.entries(record.requests ?? {}).map(([key, value]) => [
                  key.startsWith(`${current.id}-`)
                    ? `${next.id}-${key.slice(current.id.length + 1)}`
                    : key,
                  value,
                ]),
              ),
              preferences: Object.fromEntries(
                Object.entries(record.preferences ?? {}).map(([key, value]) => [
                  key.startsWith(`${current.id}-`)
                    ? `${next.id}-${key.slice(current.id.length + 1)}`
                    : key,
                  value,
                ]),
              ),
              assignments: Object.fromEntries(
                Object.entries(record.assignments ?? {}).map(([key, ids]) => [
                  key,
                  ids.map((id) => (id === current.id ? next.id : id)),
                ]),
              ),
              requestSubmissions: Object.fromEntries(
                Object.entries(record.requestSubmissions ?? {}).map(([id, value]) => [
                  id === current.id ? next.id : id,
                  value,
                ]),
              ),
              requestComments: Object.fromEntries(
                Object.entries(record.requestComments ?? {}).map(([id, value]) => [
                  id === current.id ? next.id : id,
                  value,
                ]),
              ),
              overtimeCoverage: (record.overtimeCoverage ?? []).map((entry) => ({
                ...entry,
                nurseIds: entry.nurseIds.map((id) =>
                  id === current.id ? next.id : id,
                ) as [string, string],
              })),
            },
          ]),
        ),
      );
    }
    const employmentDatesChanged = Boolean(
      current &&
        (current.dateHired !== next.dateHired ||
          current.employmentEndDate !== next.employmentEndDate),
    );
    if (employmentDatesChanged) {
      setAssignments({});
      setOvertimeCoverage([]);
    }
    setNurseDialog(null);
    setScheduleIssues([]);
    setPublished(false);
    setNotice(
      current
        ? `${next.name} was updated.${employmentDatesChanged ? " Regenerate the schedule to apply the employment dates." : ""}`
        : `${next.name} was added to the team.`,
    );
  }
  function deleteNurse(nurse: Nurse) {
    if (
      !window.confirm(
        `Remove ${nurse.name} from the nursing team? Their current assignments will also be removed.`,
      )
    )
      return;
    setNurseList((list) => list.filter((item) => item.id !== nurse.id));
    setPreferences((values) =>
      Object.fromEntries(
        Object.entries(values).filter(
          ([key]) => !key.startsWith(`${nurse.id}-`),
        ),
      ),
    );
    setRequests((values) =>
      Object.fromEntries(
        Object.entries(values).filter(
          ([key]) => !key.startsWith(`${nurse.id}-`),
        ),
      ),
    );
    setWorkRequests((values) =>
      Object.fromEntries(
        Object.entries(values).filter(([id]) => id !== nurse.id),
      ),
    );
    setAssignments((values) =>
      Object.fromEntries(
        Object.entries(values).map(([key, ids]) => [
          key,
          ids.filter((id) => id !== nurse.id),
        ]),
      ),
    );
    setIncidents((values) =>
      values.filter(
        (incident) =>
          incident.nurseId !== nurse.id &&
          incident.replacementNurseId !== nurse.id,
      ),
    );
    setRequestSubmissions((values) =>
      Object.fromEntries(
        Object.entries(values).filter(([nurseId]) => nurseId !== nurse.id),
      ),
    );
    setRequestComments((values) =>
      Object.fromEntries(
        Object.entries(values).filter(([nurseId]) => nurseId !== nurse.id),
      ),
    );
    setOvertimeCoverage((values) =>
      values.filter((entry) => !entry.nurseIds.includes(nurse.id)),
    );
    setScheduleIssues([]);
    setPublished(false);
    setNotice(`${nurse.name} was removed from the roster.`);
  }
  function saveRules(next: CoverageSettings, nextDailyCoverage: DailyCoverage) {
    const hasGeneratedSchedule = Object.keys(assignments).length > 0;
    setSettings(next);
    setDailyCoverage(nextDailyCoverage);
    setOvertimeCoverage([]);
    setRulesOpen(false);
    if (hasGeneratedSchedule) {
      const result = buildTwoWeekDraft(
        requests,
        nurseList,
        fairnessHistory,
        weekOffset,
        next.twoWeekRules,
      );
      setAssignments(result.assignments);
      setScheduleIssues(result.issues);
    }
    setIncidents([]);
    setPublished(false);
    setNotice(
      hasGeneratedSchedule
        ? "Coverage rules saved and the existing draft was regenerated."
        : "Coverage rules saved. Generate a draft when you are ready.",
    );
  }
  async function runWorkspaceAction(
    body: Record<string, unknown>,
    message: string,
  ) {
    setWorkspaceBusy(true);
    try {
      await persistCurrentWorkspace();
      const response = await fetch("/api/workspace", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error || "The workspace action could not be completed.");
      applyWorkspaceResult(result, message);
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "The workspace action could not be completed.",
      );
    } finally {
      setWorkspaceBusy(false);
    }
  }
  async function selectWorkspace(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) {
      setWorkspaceManagerOpen(false);
      return;
    }
    const target = workspaceList.find((workspace) => workspace.id === workspaceId);
    await runWorkspaceAction(
      { action: "select", workspaceId },
      `${target?.name ?? "Workspace"} opened.`,
    );
  }
  async function createWorkspace(name: string, staffType: WorkspaceStaffType) {
    await runWorkspaceAction(
      {
        action: "create",
        name,
        staffType,
        workspace: emptyWorkspace(staffType),
      },
      `${name} created. Add the first ${staffType === "orderlies" ? "orderly" : "nurse"} when ready.`,
    );
  }
  async function renameWorkspace(workspaceId: string, name: string) {
    await runWorkspaceAction(
      { action: "rename", workspaceId, name },
      `Workspace renamed to ${name}.`,
    );
  }
  async function removeWorkspace(workspace: WorkspaceSummary) {
    if (
      !window.confirm(
        `Permanently delete ${workspace.name} and its roster, requests, schedules, and reports? This cannot be undone.`,
      )
    ) return;
    setWorkspaceBusy(true);
    try {
      if (workspace.id === activeWorkspaceId) await persistCurrentWorkspace();
      const response = await fetch(
        `/api/workspace?workspace=${encodeURIComponent(workspace.id)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error || "The workspace could not be deleted.");
      applyWorkspaceResult(result, `${workspace.name} was permanently deleted.`);
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "The workspace could not be deleted. No local data was cleared.",
      );
    } finally {
      setWorkspaceBusy(false);
    }
  }
  async function deleteWorkspace() {
    if (!activeWorkspace) return;
    await removeWorkspace(activeWorkspace);
  }

  return (
    <div className="app-shell">
      <button
        className="mobile-menu"
        type="button"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open navigation"
      >
        <Menu size={20} />
      </button>
      <aside
        className={`sidebar ${sidebarOpen ? "open" : ""}`}
        aria-label="Primary navigation"
      >
        <div className="brand-row">
          <button
            className="brand"
            type="button"
            onClick={() => navigate("schedule")}
          >
            <span className="brand-mark">A</span>
            <span>
              <strong>HANDLED</strong>
              <small>Hospital Automated Nurse Duty Lineup &amp; Equitable Distribution</small>
            </span>
          </button>
          <button
            className="sidebar-close"
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <button
          className="unit-switcher"
          type="button"
          onClick={() =>
            user.isDemo ? setPrivacyOpen(true) : setWorkspaceManagerOpen(true)
          }
          aria-label={user.isDemo ? "Open workspace privacy and security summary" : "Switch or manage workspaces"}
        >
          <span>{user.isDemo ? "AD" : activeStaffType === "orderlies" ? "OR" : "RN"}</span>
          <div>
            <strong>{activeWorkspace?.name ?? "HANDLED Workspace"}</strong>
            <small>
              {user.isDemo
                ? "Emergency department · Sample data"
                : `${staffLabel} · ${nurseList.length} team member${nurseList.length === 1 ? "" : "s"}`}
            </small>
          </div>
          {user.isDemo ? <Info size={16} /> : <Settings2 size={16} />}
        </button>
        <nav>
          <p>PLANNING</p>
          <button
            className={view === "schedule" ? "active" : ""}
            type="button"
            onClick={() => navigate("schedule")}
          >
            <CalendarDays size={18} />
            <span>Two-week schedule</span>
            <b>
              {completeShifts}/{totalShifts}
            </b>
          </button>
          <button
            className={view === "preferences" ? "active" : ""}
            type="button"
            onClick={() => navigate("preferences")}
          >
            <FileSpreadsheet size={18} />
            <span>Preferences</span>
            <i>{matchedPreferenceCount}</i>
          </button>
          <button
            className={view === "reports" ? "active" : ""}
            type="button"
            onClick={() => navigate("reports")}
          >
            <BarChart3 size={18} />
            <span>Reports</span>
          </button>
          <button
            className={view === "team" ? "active" : ""}
            type="button"
            onClick={() => navigate("team")}
          >
            <Users size={18} />
            <span>{staffLabel} team</span>
          </button>
          <p>CONFIGURATION</p>
          <button
            className={view === "rules" ? "active" : ""}
            type="button"
            onClick={() => navigate("rules")}
          >
            <SlidersHorizontal size={18} />
            <span>Coverage rules</span>
          </button>
        </nav>
        <div className="sidebar-insight">
          <span>
            <Sparkles size={15} />
            HANDLED CHECK
          </span>
          <strong>
            {!nurseList.length
              ? "Start with your team"
              : !hasGeneratedSchedule
                ? "Schedule not generated"
                : blockingScheduleIssues
                  ? `${blockingScheduleIssues} rule${blockingScheduleIssues === 1 ? "" : "s"} need review`
                : completeShifts === totalShifts
                  ? "Ready to publish"
                  : `${totalShifts - completeShifts} shifts need review`}
          </strong>
          <p>
            {!nurseList.length
              ? "Add nurses, then import their preferences."
              : !hasGeneratedSchedule
                ? "Record any nurse requests, then generate the two-week draft."
                : blockingScheduleIssues
                  ? "Resolve the flagged assignments before publishing."
                : completeShifts === totalShifts
                  ? "Every required position is covered."
                  : "Open the two-week schedule to complete review."}
          </p>
        </div>
        <div className="profile-row">
          <span>
            {user.name
              .split(" ")
              .map((part) => part[0])
              .slice(0, 2)
              .join("")}
          </span>
          <div>
            <strong>{user.name}</strong>
            <small>{user.role}</small>
          </div>
          <button
            type="button"
            onClick={() => void onLogout()}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      {sidebarOpen ? (
        <button
          className="sidebar-scrim"
          type="button"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close navigation overlay"
        />
      ) : null}
      <main className="main-content">
        <header className="topbar">
          <div>
            <span>{selectedViewMeta.eyebrow}</span>
            <h1>{selectedViewMeta.title}</h1>
          </div>
          <div className="topbar-actions">
            {!user.isDemo ? (
              <span className={`save-state ${saveState}`}>
                <i />
                {saveState === "loading"
                  ? "Loading"
                  : saveState === "saving"
                    ? "Saving"
                    : saveState === "error"
                      ? "Save failed"
                      : "Saved"}
              </span>
            ) : null}
            <button
              className="icon-button"
              type="button"
              aria-label="Help"
              onClick={() => setTutorialPromptOpen(true)}
            >
              <HelpCircle size={19} />
            </button>
            <button
              className="icon-button notification"
              type="button"
              aria-label="Notifications"
              onClick={() => setInfoKind("notifications")}
            >
              <Bell size={19} />
              <i />
            </button>
            {view === "preferences" || view === "reports" ? null : (
              <button
                className="primary-button"
                type="button"
                onClick={() =>
                  nurseList.length ? setImportOpen(true) : navigate("team")
                }
              >
                <Upload size={16} />
                <span>Import requests</span>
              </button>
            )}
          </div>
        </header>
        <div className="page-content">
          {!user.isDemo ? (
            <div
              className={`privacy-session-banner ${saveState === "error" ? "error" : ""}`}
            >
              {saveState === "error" ? (
                <AlertTriangle size={17} />
              ) : (
                <ShieldCheck size={17} />
              )}
              <p>
                <strong>
                  {saveState === "error"
                    ? "Changes could not be saved"
                    : "Private persistent workspace"}
                </strong>
                {saveState === "error"
                  ? `${saveError || "The workspace could not be saved."} Your latest changes remain open in this tab; retry before refreshing or signing out.`
                  : "HANDLED saves nurse staffing data to the protected account database. Do not enter patient names, diagnoses, or medical records."}
              </p>
            </div>
          ) : null}
          {!workspaceReady ? (
            <div className="view-empty">
              <span className="loading-spinner" />
              <strong>Loading your workspace</strong>
              <p>
                HANDLED is securely retrieving your team, rules, and two-week
                schedules.
              </p>
            </div>
          ) : view === "schedule" ? (
            <ScheduleView
              assignments={assignments}
              preferences={preferences}
              requests={requests}
              scheduleIssues={scheduleIssues}
              workRequests={workRequests}
              shiftDefinitions={settings.shiftDefinitions}
              overtimeCoverage={overtimeCoverage}
              nurseList={nurseList}
              staffType={activeStaffType}
              weekDays={weekDays}
              requirementMap={requirementMap}
              chargeRequirementMap={chargeRequirementMap}
              onGenerate={generateDraft}
              onResolve={assignForcedOvertime}
              onEditAssignment={(nurseId, dayKey) => {
                const nurse = nurseList.find((item) => item.id === nurseId);
                const day = weekDays.find((item) => item.key === dayKey);
                if (nurse && day && !nurseActiveOnDate(nurse, day.isoDate)) {
                  setNotice(
                    `${nurse.name} is outside their employment dates on ${day.date}. Update the employee record before assigning duty.`,
                  );
                  return;
                }
                setEditingAssignment({ nurseId, dayKey });
              }}
              onReviewDetails={() => setInfoKind("review")}
              onPublish={() => {
                setPublished(true);
                setNotice("Schedule published and queued for secure saving.");
              }}
              onExport={exportSchedule}
              onPreviousWeek={() => changeWeek(-1)}
              onNextWeek={() => changeWeek(1)}
              published={published}
            />
          ) : view === "preferences" ? (
            <RequestPreferencesView
              requests={requests}
              assignments={assignments}
              nurseList={nurseList}
              weekDays={weekDays}
              requestPortal={requestPortal}
              requestLink={requestLink}
              requestSubmissions={requestSubmissions}
              requestComments={requestComments}
              canManagePortal={!user.isDemo}
              portalBusy={portalBusy}
              canReusePrevious={
                Object.keys(weeks[String(weekOffset - 1)]?.requests ?? {})
                  .length > 0
              }
              onReusePrevious={reusePreviousPreferences}
              onImport={() => setImportOpen(true)}
              onDownload={() => void downloadTemplate()}
              onEdit={setPreferenceNurse}
              onUpdatePortal={(action, maxRequests) =>
                void updateRequestPortal(action, maxRequests)
              }
              onCopyLink={() => void copyRequestLink()}
              onRefreshResponses={() => void refreshRequestResponses()}
            />
          ) : view === "reports" ? (
            <ReportsView
              weeks={reportWeeks}
              weekOffset={weekOffset}
              requirementMap={requirementMap}
              nurseList={nurseList}
              shiftDefinitions={settings.shiftDefinitions}
            />
          ) : view === "team" ? (
            <TeamView
              nurseList={nurseList}
              staffType={activeStaffType}
              onAdd={() => setNurseDialog("new")}
              onEdit={setNurseDialog}
              onDelete={deleteNurse}
            />
          ) : (
            <TwoWeekRulesView
              settings={settings}
              dailyCoverage={dailyCoverage}
              weekDays={weekDays}
              onEdit={() => setRulesOpen(true)}
              canDelete={!user.isDemo && workspaceList.length > 1}
              onDeleteWorkspace={() => void deleteWorkspace()}
            />
          )}
        </div>
      </main>
      {importOpen ? (
        <ImportDialog
          nurseList={nurseList}
          weekDays={weekDays}
          onClose={() => setImportOpen(false)}
          onImport={importPreferences}
          onTemplate={() => void downloadTemplate()}
        />
      ) : null}
      {nurseDialog ? (
        <NurseDialog
          nurse={nurseDialog === "new" ? null : nurseDialog}
          staffType={activeStaffType}
          automaticId={nextNurseId(nurseList)}
          existingIds={nurseList.map((nurse) => nurse.id)}
          onClose={() => setNurseDialog(null)}
          onSave={saveNurse}
        />
      ) : null}
      {preferenceNurse ? (
        <RequestDialog
          nurse={preferenceNurse}
          requests={requests}
          assignments={assignments}
          nurseList={nurseList}
          weekDays={weekDays}
          requestComment={requestComments[preferenceNurse.id] ?? ""}
          onClose={() => setPreferenceNurse(null)}
          onSave={saveNursePreferences}
        />
      ) : null}
      {editingNurse && editingDay ? (
        <DutyAssignmentDialog
          nurse={editingNurse}
          day={editingDay}
          currentDuty={editingDuty}
          request={requests[requestKey(editingNurse.id, editingDay.key)]}
          onClose={() => setEditingAssignment(null)}
          onSave={(duty) =>
            saveAssignment(editingNurse, editingDay, duty)
          }
        />
      ) : null}
      {rulesOpen ? (
        <RulesDialog
          settings={settings}
          dailyCoverage={dailyCoverage}
          weekDays={weekDays}
          onClose={() => setRulesOpen(false)}
          onSave={saveRules}
        />
      ) : null}
      {infoKind ? (
        <InfoDialog kind={infoKind} onClose={() => setInfoKind(null)} />
      ) : null}
      {privacyOpen ? (
        <PrivacyDialog onClose={() => setPrivacyOpen(false)} />
      ) : null}
      {workspaceManagerOpen && !user.isDemo ? (
        <WorkspaceManagerDialog
          workspaces={workspaceList}
          activeWorkspaceId={activeWorkspaceId}
          busy={workspaceBusy}
          onClose={() => setWorkspaceManagerOpen(false)}
          onSelect={selectWorkspace}
          onCreate={createWorkspace}
          onRename={renameWorkspace}
          onDelete={removeWorkspace}
        />
      ) : null}
      {tutorialPromptOpen ? (
        <TutorialPromptDialog
          onClose={() => setTutorialPromptOpen(false)}
          onStart={startTutorial}
        />
      ) : null}
      {tutorialStep !== null ? (
        <TutorialTour
          step={tutorialStep}
          onStep={moveTutorial}
          onExit={() => setTutorialStep(null)}
          onFinish={finishTutorial}
        />
      ) : null}
      {notice ? (
        <div className="toast t-toast is-open" role="status">
          <CheckCircle2 size={17} />
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const requestToken = new URLSearchParams(window.location.search).get("request");

  useEffect(() => {
    let active = true;
    fetch("/api/session", { credentials: "same-origin" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (active && result?.user) setUser(result.user);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setCheckingSession(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function logout() {
    try {
      await fetch("/api/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      setUser(null);
    }
  }

  if (requestToken) return <StaffRequestPage token={requestToken} />;

  if (checkingSession)
    return (
      <main className="session-loading">
        <span className="login-mark">H</span>
        <p>Checking secure access…</p>
      </main>
    );
  if (!user) return <LoginScreen onSignedIn={setUser} />;
  return <SchedulingApp user={user} onLogout={logout} />;
}
