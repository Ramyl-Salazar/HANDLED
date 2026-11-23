import { describe, expect, it } from "vitest";
import { nurses, type ShiftCode } from "./schedule";
import {
  assignedDutyOnDay,
  buildRequestFairnessHistory,
  buildTwoWeekDraft,
  countRequestsForNurse,
  createSeedRequests,
  datesForPeriod,
  dutyKey,
  explainRequestOutcome,
  officialShifts,
  overtimeDutyWindow,
  recommendForcedOvertime,
  planningDays,
  requestKey,
  replaceNurseDuty,
  transitionAllowed,
  validateTwoWeekSchedule,
  type ScheduleRequestMap,
} from "./twoWeekSchedule";

describe("two-week ER roster", () => {
  it("starts Period 1 on Sunday, September 13 and advances in 14-day blocks", () => {
    const first = datesForPeriod(0);
    const second = datesForPeriod(1);

    expect(first[0]).toMatchObject({
      isoDate: "2026-09-13",
      label: "Sunday",
      weekend: true,
    });
    expect(first.at(-1)).toMatchObject({
      isoDate: "2026-09-26",
      label: "Saturday",
      weekend: true,
    });
    expect(second[0].isoDate).toBe("2026-09-27");
    expect(second.at(-1)?.isoDate).toBe("2026-10-10");
  });

  it("creates fourteen dated planning columns and at most five seed requests", () => {
    const requests = createSeedRequests(nurses);
    expect(planningDays).toHaveLength(14);
    nurses.forEach((nurse) =>
      expect(countRequestsForNurse(requests, nurse.id)).toBeLessThanOrEqual(5),
    );
  });

  it("gives every nurse two REST days per week and balances daily shifts", () => {
    const requests = createSeedRequests(nurses);
    const { assignments, issues } = buildTwoWeekDraft(requests, nurses);
    expect(
      issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => `${issue.title}: ${issue.detail}`),
    ).toEqual([]);
    expect(
      issues.filter((issue) => issue.id.startsWith("transition-")),
    ).toHaveLength(0);

    nurses.forEach((nurse) => {
      for (let week = 0; week < 2; week += 1) {
        const rests = planningDays
          .slice(week * 7, week * 7 + 7)
          .filter(
            (day) => assignedDutyOnDay(assignments, nurse.id, day.key) === "rest",
          );
        expect(rests).toHaveLength(2);
        const restIndices = rests.map((day) => Number(day.key.slice(1)));
        expect(Math.abs(restIndices[0] - restIndices[1])).toBeGreaterThan(1);
      }
    });

    planningDays.forEach((day) => {
      const counts = (["morning", "afternoon", "night"] as ShiftCode[]).map(
        (shift) => assignments[dutyKey(day.key, shift)]?.length ?? 0,
      );
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      expect(assignments[dutyKey(day.key, "rest")]?.length ?? 0).toBeLessThanOrEqual(7);
    });
  });

  it("keeps consecutive REST days only when both dates were requested", () => {
    const nurse = nurses[0];
    const requests: ScheduleRequestMap = {
      [requestKey(nurse.id, "d1")]: { choice: "rest", status: "requested" },
      [requestKey(nurse.id, "d2")]: { choice: "rest", status: "requested" },
    };
    const result = buildTwoWeekDraft(requests, [nurse]);

    expect(assignedDutyOnDay(result.assignments, nurse.id, "d1")).toBe("rest");
    expect(assignedDutyOnDay(result.assignments, nurse.id, "d2")).toBe("rest");
    expect(
      result.issues.some((issue) => issue.id.startsWith("consecutive-rest-")),
    ).toBe(false);
  });

  it("keeps most nurses on one consistent shift pattern when no requests conflict", () => {
    const { assignments, issues } = buildTwoWeekDraft({}, nurses);
    const consistentNurses = nurses.filter((nurse) => {
      const workingDuties = planningDays
        .map((day) => assignedDutyOnDay(assignments, nurse.id, day.key))
        .filter((duty): duty is ShiftCode =>
          ["morning", "afternoon", "night"].includes(duty ?? ""),
        );
      const changes = workingDuties.slice(1).filter(
        (duty, index) => duty !== workingDuties[index],
      ).length;
      return changes <= 1;
    });

    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(consistentNurses.length).toBeGreaterThanOrEqual(nurses.length - 1);
  });

  it("flags an unrequested consecutive REST pair with exact dates", () => {
    const nurse = nurses[0];
    let assignments = replaceNurseDuty({}, nurse.id, "d0", "rest");
    assignments = replaceNurseDuty(assignments, nurse.id, "d1", "rest");

    const issue = validateTwoWeekSchedule(assignments, {}, [nurse]).find(
      (item) => item.id.startsWith("consecutive-rest-"),
    );
    expect(issue?.detail).toContain("Sunday, Sep 13, 2026");
    expect(issue?.detail).toContain("Monday, Sep 14, 2026");
  });

  it("enforces mandatory leave without requiring request approval", () => {
    const requests: ScheduleRequestMap = {
      [requestKey(nurses[0].id, "d2")]: {
        choice: "personal_leave",
        status: "mandatory",
      },
    };
    const result = buildTwoWeekDraft(requests, nurses);
    expect(assignedDutyOnDay(result.assignments, nurses[0].id, "d2")).toBe(
      "personal_leave",
    );
  });

  it("allows head-nurse requests above five dates and flags balance errors", () => {
    const requests: ScheduleRequestMap = Object.fromEntries(
      planningDays.slice(0, 6).map((day) => [
        requestKey(nurses[0].id, day.key),
        { choice: "morning", status: "requested" },
      ]),
    );
    const assignments = {
      [dutyKey("d0", "morning")]: nurses.slice(0, 5).map((nurse) => nurse.id),
      [dutyKey("d0", "afternoon")]: [nurses[5].id],
      [dutyKey("d0", "night")]: [nurses[6].id],
    };
    const result = buildTwoWeekDraft(requests, nurses);
    expect(result.issues.some((issue) => issue.id.startsWith("request-limit"))).toBe(false);
    expect(
      validateTwoWeekSchedule(assignments, requests, nurses).some((issue) =>
        issue.id.startsWith("daily-balance"),
      ),
    ).toBe(true);
  });

  it("does not let a nurse's second request outrank another nurse's first request", () => {
    const requesters = nurses.slice(0, 8);
    const requests: ScheduleRequestMap = {
      [requestKey(requesters[0].id, "d5")]: {
        choice: "rest",
        status: "requested",
      },
      ...Object.fromEntries(
        requesters.map((nurse) => [
          requestKey(nurse.id, "d6"),
          { choice: "rest", status: "requested" as const },
        ]),
      ),
    };
    const result = buildTwoWeekDraft(requests, nurses);
    const saturdayRest = result.assignments[dutyKey("d6", "rest")] ?? [];

    expect(saturdayRest).toHaveLength(7);
    expect(saturdayRest).not.toContain(requesters[0].id);
    requesters.slice(1).forEach((nurse) =>
      expect(saturdayRest).toContain(nurse.id),
    );
  });

  it("compensates a nurse with prior denials when a REST date is contested", () => {
    const requesters = nurses.slice(0, 8);
    const requests: ScheduleRequestMap = Object.fromEntries(
      requesters.map((nurse) => [
        requestKey(nurse.id, "d6"),
        { choice: "rest", status: "requested" as const },
      ]),
    );
    const previouslyDenied = requesters.at(-1)!;
    const result = buildTwoWeekDraft(
      requests,
      nurses,
      {
        [previouslyDenied.id]: {
          granted: 0,
          denied: 2,
          grantedByChoice: {},
          deniedByChoice: { rest: 2 },
        },
      },
      0,
    );
    const saturdayRest = result.assignments[dutyKey("d6", "rest")] ?? [];
    const denied = requesters.filter((nurse) => !saturdayRest.includes(nurse.id));

    expect(saturdayRest).toHaveLength(7);
    expect(saturdayRest).toContain(previouslyDenied.id);
    expect(denied).toHaveLength(1);
    expect(
      explainRequestOutcome(
        result.assignments,
        requests,
        nurses,
        denied[0].id,
        "d6",
      ),
    ).toMatchObject({
      status: "unmet",
      label: "REST not granted",
    });
    expect(
      explainRequestOutcome(
        result.assignments,
        requests,
        nurses,
        denied[0].id,
        "d6",
      )?.reason,
    ).toContain("seven-nurse REST limit");
  });

  it("rotates exact ties between two-week periods", () => {
    const requesters = nurses.slice(0, 8);
    const requests: ScheduleRequestMap = Object.fromEntries(
      requesters.map((nurse) => [
        requestKey(nurse.id, "d6"),
        { choice: "rest", status: "requested" as const },
      ]),
    );
    const first = buildTwoWeekDraft(requests, nurses, {}, 0).assignments[
      dutyKey("d6", "rest")
    ];
    const second = buildTwoWeekDraft(requests, nurses, {}, 1).assignments[
      dutyKey("d6", "rest")
    ];
    const firstDenied = requesters.find((nurse) => !first.includes(nurse.id));
    const secondDenied = requesters.find((nurse) => !second.includes(nurse.id));

    expect(firstDenied?.id).not.toBe(secondDenied?.id);
  });

  it("derives granted and denied history from completed periods", () => {
    const requests: ScheduleRequestMap = {
      [requestKey(nurses[0].id, "d0")]: {
        choice: "morning",
        status: "requested",
      },
      [requestKey(nurses[0].id, "d1")]: {
        choice: "rest",
        status: "requested",
      },
      [requestKey(nurses[0].id, "d2")]: {
        choice: "personal_leave",
        status: "mandatory",
      },
    };
    const history = buildRequestFairnessHistory([
      {
        requests,
        assignments: {
          [dutyKey("d0", "morning")]: [nurses[0].id],
          [dutyKey("d1", "afternoon")]: [nurses[0].id],
          [dutyKey("d2", "personal_leave")]: [nurses[0].id],
        },
      },
    ]);

    expect(history[nurses[0].id]).toMatchObject({
      granted: 1,
      denied: 1,
      grantedByChoice: { morning: 1 },
      deniedByChoice: { rest: 1 },
    });
  });

  it("stops assigning an employee after their last working date", () => {
    const departing = {
      ...nurses[0],
      dateHired: "2025-01-01",
      employmentEndDate: "2026-09-12",
    };
    const roster = [departing, ...nurses.slice(1)];
    const result = buildTwoWeekDraft({}, roster, {}, 0);

    planningDays.slice(7).forEach((day) =>
      expect(assignedDutyOnDay(result.assignments, departing.id, day.key)).toBeNull(),
    );
    expect(
      result.issues.some((issue) => issue.title === "Assignment outside employment dates"),
    ).toBe(false);
  });

  it("always enforces the fixed 16-hour and post-REST recovery rules", () => {
    expect(transitionAllowed("morning", null, "afternoon")).toBe(true);
    expect(transitionAllowed("afternoon", null, "morning")).toBe(false);
    expect(transitionAllowed("night", null, "morning")).toBe(false);
    expect(transitionAllowed("night", null, "afternoon")).toBe(false);
    expect(transitionAllowed("night", null, "night")).toBe(true);
    expect(transitionAllowed("rest", "night", "morning")).toBe(false);
    expect(transitionAllowed("rest", "night", "afternoon")).toBe(true);
    expect(transitionAllowed("rest", "afternoon", "morning")).toBe(false);
    expect(transitionAllowed("training", "night", "morning")).toBe(true);
  });

  it("plots leave, then Training, and does not count Training as REST", () => {
    const requests: ScheduleRequestMap = {
      [requestKey(nurses[0].id, "d0")]: {
        choice: "birthday_leave",
        status: "mandatory",
      },
      [requestKey(nurses[0].id, "d2")]: {
        choice: "training",
        status: "mandatory",
      },
    };
    const result = buildTwoWeekDraft(requests, nurses);

    expect(assignedDutyOnDay(result.assignments, nurses[0].id, "d0")).toBe(
      "birthday_leave",
    );
    expect(assignedDutyOnDay(result.assignments, nurses[0].id, "d2")).toBe(
      "training",
    );
    expect(assignedDutyOnDay(result.assignments, nurses[0].id, "d1")).not.toBe(
      "night",
    );
    expect(
      planningDays
        .slice(0, 7)
        .filter(
          (day) =>
            assignedDutyOnDay(result.assignments, nurses[0].id, day.key) ===
            "rest",
        ),
    ).toHaveLength(2);
  });

  it("flags Training after N and includes the exact calendar date", () => {
    let assignments = replaceNurseDuty({}, nurses[0].id, "d0", "night");
    assignments = replaceNurseDuty(assignments, nurses[0].id, "d1", "training");
    const issues = validateTwoWeekSchedule(
      assignments,
      {},
      [nurses[0]],
      undefined,
      datesForPeriod(0),
    );
    const issue = issues.find((item) => item.id.startsWith("training-transition"));
    expect(issue?.detail).toContain("Monday, Sep 14, 2026");
  });

  it("assigns forced overtime by past overtime balance, then newest hire", () => {
    const roster = nurses.slice(0, 4).map((nurse, index) => ({
      ...nurse,
      dateHired: `202${index + 2}-01-01`,
    }));
    const assignments = {
      [dutyKey("d0", "night")]: [roster[0].id, roster[1].id],
      [dutyKey("d0", "afternoon")]: [roster[2].id, roster[3].id],
    };
    const overtime = recommendForcedOvertime(
      assignments,
      roster,
      "d0",
      "morning",
      1,
      [],
      { [roster[1].id]: 4 },
    );

    expect(overtime).toHaveLength(1);
    expect(overtime[0]).toMatchObject({
      shiftCode: "morning",
      hoursEach: 4,
      nurseIds: [roster[0].id, roster[3].id],
    });
  });

  it("turns adjacent duties into two 12-hour shifts when afternoon is uncovered", () => {
    const coverage = {
      id: "d0-afternoon-pair",
      dayKey: "d0",
      shiftCode: "afternoon" as ShiftCode,
      nurseIds: [nurses[0].id, nurses[1].id] as [string, string],
      hoursEach: 4 as const,
      createdAt: "2026-09-08T00:00:00.000Z",
    };

    expect(
      overtimeDutyWindow(coverage, nurses[0].id, officialShifts),
    ).toMatchObject({
      regularShift: "morning",
      coveredShift: "afternoon",
      start: "06:00",
      end: "18:00",
      totalHours: 12,
    });
    expect(
      overtimeDutyWindow(coverage, nurses[1].id, officialShifts),
    ).toMatchObject({
      regularShift: "night",
      coveredShift: "afternoon",
      start: "18:00",
      end: "06:00",
      totalHours: 12,
    });
  });
});
