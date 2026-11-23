import { describe, expect, it } from "vitest";

import {
  buildDraft,
  completedShiftCount,
  copyPreferencesForRoster,
  coverageGaps,
  createSeedPreferences,
  days,
  getCandidates,
  nextNurseId,
  nurses,
  preferenceKey,
  replaceNurseAssignment,
  shiftKey,
  shifts,
} from "./schedule";

describe("HANDLED weekly schedule generation", () => {
  it("creates the next nurse ID automatically", () => {
    expect(nextNurseId([])).toBe("N-101");
    expect(nextNurseId(nurses)).toBe("N-116");
    expect(nextNurseId([...nurses, { ...nurses[0], id: "N-120" }])).toBe(
      "N-121",
    );
  });

  it("copies only the previous preferences that match the current roster", () => {
    const source = createSeedPreferences();
    const currentRoster = nurses.slice(0, 2);
    const copied = copyPreferencesForRoster(source, currentRoster);
    expect(Object.keys(copied)).toHaveLength(2 * 7 * 3);
    expect(
      copied[preferenceKey(currentRoster[0].id, "mon", "morning")],
    ).toBeTruthy();
    expect(
      Object.keys(copied).some((key) => key.startsWith(`${nurses[2].id}-`)),
    ).toBe(false);
  });

  it("fills preferred coverage and leaves the ambiguous Wednesday night slot for the head nurse", () => {
    const preferences = createSeedPreferences();
    const assignments = buildDraft(preferences);
    expect(assignments[shiftKey("wed", "night")]).toHaveLength(3);
    expect(completedShiftCount(assignments)).toBe(20);
  });

  it("does not assign a nurse to two shifts on the same day", () => {
    const assignments = buildDraft(createSeedPreferences());
    days.forEach((day) => {
      const assignedThatDay = Object.entries(assignments)
        .filter(([key]) => key.startsWith(`${day.key}-`))
        .flatMap(([, nurseIds]) => nurseIds);
      expect(new Set(assignedThatDay).size).toBe(assignedThatDay.length);
    });
  });

  it("fills more than one required charge-nurse position when qualified nurses prefer the shift", () => {
    const nurseList = [nurses[0], nurses[3], nurses[1]];
    const preferences = Object.fromEntries(
      nurseList.map((nurse) => [
        preferenceKey(nurse.id, "mon", "morning"),
        "preferred",
      ]),
    ) as ReturnType<typeof createSeedPreferences>;
    const assignments = buildDraft(
      preferences,
      nurseList,
      { [shiftKey("mon", "morning")]: 3 },
      undefined,
      { [shiftKey("mon", "morning")]: 2 },
    );
    const assignedNurses = assignments[shiftKey("mon", "morning")].map((id) =>
      nurseList.find((nurse) => nurse.id === id)!,
    );
    expect(
      assignedNurses.filter((nurse) => nurse.role === "Charge nurse"),
    ).toHaveLength(2);
  });

  it("offers only unassigned, eligible nurses for an incomplete shift", () => {
    const preferences = createSeedPreferences();
    const assignments = buildDraft(preferences);
    const candidates = getCandidates(assignments, preferences, "wed", "night");
    const alreadyAssigned = new Set(
      Object.entries(assignments)
        .filter(([key]) => key.startsWith("wed-"))
        .flatMap(([, ids]) => ids),
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(
      candidates.every((candidate) => !alreadyAssigned.has(candidate.nurse.id)),
    ).toBe(true);
    expect(
      candidates.every((candidate) =>
        nurses.some((nurse) => nurse.id === candidate.nurse.id),
      ),
    ).toBe(true);
  });

  it("excludes nurses marked on leave, sick, absent, or unavailable from replacement candidates", () => {
    const preferences = createSeedPreferences();
    const unavailableNurses = nurses.slice(0, 4);
    const statuses = ["leave", "sick", "absent", "unavailable"] as const;
    unavailableNurses.forEach((nurse, index) => {
      preferences[preferenceKey(nurse.id, "wed", "night")] = statuses[index];
    });
    const candidates = getCandidates({}, preferences, "wed", "night");
    expect(
      candidates.every(
        (candidate) =>
          !unavailableNurses.some((nurse) => nurse.id === candidate.nurse.id),
      ),
    ).toBe(true);
  });

  it("moves a nurse to another shift without creating a same-day double assignment", () => {
    const assignments = buildDraft(createSeedPreferences());
    const originalMorning = [
      ...(assignments[shiftKey("mon", "morning")] ?? []),
    ];
    const updated = replaceNurseAssignment(
      assignments,
      "N-101",
      "mon",
      "night",
    );

    expect(updated[shiftKey("mon", "morning")]).not.toContain("N-101");
    expect(updated[shiftKey("mon", "afternoon")]).not.toContain("N-101");
    expect(updated[shiftKey("mon", "night")]).toContain("N-101");
    expect(assignments[shiftKey("mon", "morning")]).toEqual(originalMorning);
  });

  it("marks a nurse off by removing every assignment for that day", () => {
    const assignments = buildDraft(createSeedPreferences());
    const updated = replaceNurseAssignment(assignments, "N-101", "mon", null);

    expect(
      shiftsForDay(updated, "mon").every(
        (nurseIds) => !nurseIds.includes("N-101"),
      ),
    ).toBe(true);
  });

  it("detects exact uncovered time when custom day and night shifts leave gaps", () => {
    const configured = shifts.map((shift) =>
      shift.code === "morning"
        ? { ...shift, label: "Day", start: "04:00", end: "10:00" }
        : shift.code === "afternoon"
          ? { ...shift, enabled: false }
          : { ...shift, start: "13:00", end: "19:00" },
    );
    expect(coverageGaps(configured).map((gap) => gap.label)).toEqual([
      "12:00 AM–4:00 AM",
      "10:00 AM–1:00 PM",
      "7:00 PM–12:00 AM",
    ]);
  });

  it("offers a consecutive second shift only when the nurse opted into double shifts", () => {
    const nurse = nurses[0];
    const assignments = { [shiftKey("mon", "morning")]: [nurse.id] };
    const preferences = {
      [preferenceKey(nurse.id, "mon", "afternoon")]: "preferred",
    } as ReturnType<typeof createSeedPreferences>;
    expect(
      getCandidates(assignments, preferences, "mon", "afternoon", [nurse]),
    ).toHaveLength(0);
    expect(
      getCandidates(
        assignments,
        preferences,
        "mon",
        "afternoon",
        [nurse],
        {
          maximumShifts: 7,
          requireChargeNurse: true,
          preventNightToMorning: true,
        },
        { [nurse.id]: { overtime: false, doubleShift: true } },
      ),
    ).toHaveLength(1);
  });
});

function shiftsForDay(assignments: Record<string, string[]>, dayKey: string) {
  return Object.entries(assignments)
    .filter(([key]) => key.startsWith(`${dayKey}-`))
    .map(([, nurseIds]) => nurseIds);
}
