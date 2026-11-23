import { describe, expect, it } from "vitest";
import {
  cleanWorkspace,
  cleanWorkspaceCollection,
  mergeNewerPublicSubmissions,
  workspaceDirectory,
  workspaceEntry,
} from "../api/workspace.js";

const valid = {
  nurses: [
    {
      id: "n-201",
      name: "Test Nurse",
      role: "Staff nurse",
      targetShifts: 5,
    },
  ],
  settings: {
    erBeds: 15,
    morningCoverage: 7,
    afternoonCoverage: 6,
    nightCoverage: 5,
    chargeNursesPerShift: 1,
    coverageOverrides: [],
    maximumShifts: 5,
    requireChargeNurse: true,
    preventNightToMorning: true,
  },
  weeks: {
    0: {
      preferences: { "N-201-mon-morning": "preferred" },
      assignments: { "mon-morning": ["N-201", "UNKNOWN"] },
      published: false,
    },
  },
  weekOffset: 0,
};

describe("workspace validation", () => {
  it("migrates one legacy account workspace without mixing workspace data", () => {
    const migrated = cleanWorkspaceCollection(valid, { seeded: false }, "2026-09-26T00:00:00.000Z");
    const second = {
      id: "ws_1234567890abcdef",
      name: "ER Orderlies",
      staffType: "orderlies",
      createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z",
      data: { ...valid, nurses: [], weeks: {} },
    };
    const collection = cleanWorkspaceCollection({
      ...migrated,
      activeWorkspaceId: second.id,
      workspaces: [...migrated.workspaces, second],
    });

    expect(collection.workspaces).toHaveLength(2);
    expect(workspaceEntry(collection, "primary").data.nurses).toHaveLength(1);
    expect(workspaceEntry(collection, second.id).data.nurses).toHaveLength(0);
    expect(workspaceDirectory(collection)).toMatchObject([
      { id: "primary", staffType: "nurses", memberCount: 1 },
      { id: second.id, staffType: "orderlies", memberCount: 0 },
    ]);
  });

  it("normalizes nurse IDs and removes unknown assignment IDs", () => {
    const result = cleanWorkspace(valid);
    expect(result.nurses[0].id).toBe("N-201");
    expect(result.weeks["0"].assignments["mon-morning"]).toEqual(["N-201"]);
  });

  it("does not require or persist the retired qualification field", () => {
    const result = cleanWorkspace({
      ...valid,
      nurses: [{ ...valid.nurses[0], qualification: "Legacy value" }],
    });
    expect(result.nurses[0]).not.toHaveProperty("qualification");
  });

  it("rejects duplicate IDs and unsafe oversized values", () => {
    expect(() =>
      cleanWorkspace({ ...valid, nurses: [...valid.nurses, valid.nurses[0]] }),
    ).toThrow("Invalid nurse record");
    expect(() =>
      cleanWorkspace({
        ...valid,
        nurses: [{ ...valid.nurses[0], name: "x".repeat(121) }],
      }),
    ).toThrow("Invalid nurse record");
  });

  it("keeps supported non-working preferences and removes legacy incidents", () => {
    const workspace = cleanWorkspace({
      ...valid,
      weeks: {
        0: {
          preferences: { "N-201-mon-morning": "sick" },
          assignments: {},
          incidents: [
            {
              id: "incident-1",
              nurseId: "N-201",
              dayKey: "mon",
              shiftCode: "morning",
              status: "awol",
              createdAt: "2026-09-07T00:00:00.000Z",
            },
          ],
        },
      },
    });
    expect(workspace.weeks["0"].preferences["N-201-mon-morning"]).toBe("sick");
    expect(workspace.weeks["0"].incidents).toEqual([]);
  });

  it("allows the head nurse to set a lower staffing minimum", () => {
    const result = cleanWorkspace({
      ...valid,
      settings: { ...valid.settings, nightCoverage: 4 },
    });
    expect(result.settings.nightCoverage).toBe(4);
  });

  it("rejects assigning one nurse to two shifts on the same day", () => {
    const weeks = {
      0: {
        preferences: {},
        assignments: { "mon-morning": ["N-201"], "mon-night": ["N-201"] },
      },
    };
    expect(() => cleanWorkspace({ ...valid, weeks })).toThrow(
      "Double shift was not approved",
    );
  });

  it("does not accept nurse-requested overtime or double shifts", () => {
    const nurse = { ...valid.nurses[0], targetShifts: 1 };
    const weeks = {
      0: {
        preferences: {},
        workRequests: { "N-201": { overtime: true, doubleShift: true } },
        assignments: { "mon-morning": ["N-201"], "mon-afternoon": ["N-201"] },
      },
    };
    expect(() => cleanWorkspace({ ...valid, nurses: [nurse], weeks })).toThrow(
      "Double shift was not approved",
    );
  });

  it("rejects publishing when active shift times leave an ER coverage gap", () => {
    const shiftDefinitions = [
      {
        code: "morning",
        label: "Day",
        shortLabel: "D",
        start: "04:00",
        end: "10:00",
        enabled: true,
      },
      {
        code: "afternoon",
        label: "Afternoon",
        shortLabel: "PM",
        start: "10:00",
        end: "13:00",
        enabled: false,
      },
      {
        code: "night",
        label: "Night",
        shortLabel: "N",
        start: "13:00",
        end: "19:00",
        enabled: true,
      },
    ];
    const weeks = { 0: { preferences: {}, assignments: {}, published: true } };
    expect(() =>
      cleanWorkspace({
        ...valid,
        settings: { ...valid.settings, shiftDefinitions },
        weeks,
      }),
    ).toThrow("Cannot publish with a shift time gap");
  });

  it("stores request summaries and editable employment data", () => {
    const incident = {
      id: "incident-1",
      nurseId: "N-201",
      replacementNurseId: "N-201",
      dayKey: "mon",
      shiftCode: "morning",
      status: "awol",
      createdAt: "2026-09-07T00:00:00.000Z",
    };
    const weeks = {
      0: {
        preferences: {},
        assignments: { "mon-morning": ["N-201"] },
        incidents: [incident],
      },
    };
    const result = cleanWorkspace({
      ...valid,
      nurses: [
        {
          ...valid.nurses[0],
          firstName: "Test",
          surname: "Nurse",
          dateHired: "2026-01-02",
          employmentEndDate: "2026-09-12",
        },
      ],
      weeks: {
        0: {
          ...weeks[0],
          requestComments: { "N-201": "Family commitment on Saturday." },
        },
      },
    });
    expect(result.nurses[0]).toMatchObject({
      firstName: "Test",
      surname: "Nurse",
      dateHired: "2026-01-02",
      employmentEndDate: "2026-09-12",
    });
    expect(result.weeks["0"].requestComments["N-201"]).toBe(
      "Family commitment on Saturday.",
    );
  });

  it("keeps valid weekend and day-specific coverage exceptions", () => {
    const coverageOverrides = [
      {
        target: "weekend",
        morningCoverage: 8,
        afternoonCoverage: 7,
        nightCoverage: 5,
        chargeNurses: 2,
      },
      {
        target: "wed",
        morningCoverage: 9,
        afternoonCoverage: 7,
        nightCoverage: 6,
        chargeNurses: 1,
      },
    ];
    const result = cleanWorkspace({
      ...valid,
      settings: {
        ...valid.settings,
        chargeNursesPerShift: 2,
        coverageOverrides,
      },
    });
    expect(result.settings.chargeNursesPerShift).toBe(2);
    expect(result.settings.coverageOverrides).toEqual(coverageOverrides);
  });

  it("rejects duplicate exception targets and impossible charge-nurse counts", () => {
    const duplicate = {
      target: "weekend",
      morningCoverage: 8,
      afternoonCoverage: 7,
      nightCoverage: 5,
      chargeNurses: 1,
    };
    expect(() =>
      cleanWorkspace({
        ...valid,
        settings: {
          ...valid.settings,
          coverageOverrides: [duplicate, duplicate],
        },
      }),
    ).toThrow("Invalid coverage exception");
    expect(() =>
      cleanWorkspace({
        ...valid,
        settings: { ...valid.settings, chargeNursesPerShift: 6 },
      }),
    ).toThrow("Invalid coverage settings");
  });

  it("stores structured two-week requests and REST assignments", () => {
    const weeks = {
      0: {
        preferences: {},
        requests: {
          "N-201-d0": { choice: "morning", status: "requested" },
          "N-201-d1": { choice: "leave", status: "mandatory" },
        },
        assignments: {
          "d0-morning": ["N-201"],
          "d1-leave": ["N-201"],
          "d2-rest": ["N-201"],
        },
        published: false,
      },
    };
    const result = cleanWorkspace({ ...valid, weeks });
    expect(result.weeks["0"].requests["N-201-d1"]).toEqual({
      choice: "personal_leave",
      status: "mandatory",
    });
    expect(result.weeks["0"].assignments["d1-personal_leave"]).toEqual(["N-201"]);
    expect(result.weeks["0"].assignments["d2-rest"]).toEqual(["N-201"]);
  });

  it("does not retroactively reject an older published period under newer rules", () => {
    const historical = {
      requests: {},
      preferences: {},
      assignments: { "d0-morning": ["N-201"] },
      published: true,
    };
    expect(() =>
      cleanWorkspace({
        ...valid,
        weekOffset: 1,
        weeks: {
          0: historical,
          1: { requests: {}, preferences: {}, assignments: {}, published: false },
        },
      }),
    ).not.toThrow();
    expect(() =>
      cleanWorkspace({
        ...valid,
        weekOffset: 0,
        weeks: { 0: historical },
      }),
    ).toThrow("Published schedules must meet daily staffing minimums");
  });

  it("allows unlimited head-nurse requests but rejects two duties on one date", () => {
    const requests = Object.fromEntries(
      Array.from({ length: 6 }, (_, index) => [
        `N-201-d${index}`,
        { choice: "rest", status: "requested" },
      ]),
    );
    expect(
      Object.keys(
        cleanWorkspace({
          ...valid,
          weeks: { 0: { requests, assignments: {}, preferences: {} } },
        }).weeks["0"].requests,
      ),
    ).toHaveLength(6);
    expect(() =>
      cleanWorkspace({
        ...valid,
        weeks: {
          0: {
            requests: {},
            preferences: {},
            assignments: {
              "d0-morning": ["N-201"],
              "d0-rest": ["N-201"],
            },
          },
        },
      }),
    ).toThrow("Only one assignment");
  });

  it("migrates legacy approved requests into ordinary preferences", () => {
    const result = cleanWorkspace({
      ...valid,
      weeks: {
        0: {
          requests: {
            "N-201-d0": { choice: "night", status: "approved" },
          },
          assignments: {},
          preferences: {},
        },
      },
    });
    expect(result.weeks["0"].requests["N-201-d0"]).toEqual({
      choice: "night",
      status: "requested",
    });
  });

  it("sanitizes request portals and preserves newer public submissions", () => {
    const older = "2026-09-07T01:00:00.000Z";
    const newer = "2026-09-07T02:00:00.000Z";
    const portal = {
      enabled: true,
      version: "portal-version-123456",
      maxRequests: 8,
      createdAt: older,
      updatedAt: newer,
    };
    const existing = cleanWorkspace({
      ...valid,
      weeks: {
        0: {
          preferences: {},
          assignments: {},
          requests: {
            "N-201-d0": { choice: "night", status: "requested" },
          },
          requestPortal: portal,
          requestSubmissions: { "N-201": newer },
        },
      },
    });
    const incoming = cleanWorkspace({
      ...valid,
      weeks: {
        0: {
          preferences: {},
          assignments: {},
          requests: {
            "N-201-d0": { choice: "morning", status: "requested" },
          },
          requestSubmissions: { "N-201": older },
        },
      },
    });
    const merged = mergeNewerPublicSubmissions(incoming, existing);
    expect(merged.weeks["0"].requestPortal.maxRequests).toBe(8);
    expect(merged.weeks["0"].requests["N-201-d0"].choice).toBe("night");
    expect(merged.weeks["0"].requestSubmissions["N-201"]).toBe(newer);
  });

  it("rejects unsafe transitions when publishing a two-week schedule", () => {
    const assignments = {};
    for (let dayIndex = 0; dayIndex < 14; dayIndex += 1) {
      const duty =
        [3, 5, 9, 12].includes(dayIndex)
          ? "rest"
          : dayIndex === 1
            ? "night"
            : "morning";
      assignments[`d${dayIndex}-${duty}`] = ["N-201"];
    }
    expect(() =>
      cleanWorkspace({
        ...valid,
        weekOffset: 0,
        weeks: {
          0: {
            requests: {},
            preferences: {},
            assignments,
            dailyCoverage: Object.fromEntries(
              Array.from({ length: 14 }, (_, index) => [
                `d${index}`,
                { morning: 0, afternoon: 0, night: 0 },
              ]),
            ),
            published: true,
          },
        },
      }),
    ).toThrow("After N, the next duty must be N or REST");
  });

  it("forces recovery toggles on and protects Training and the two leave types", () => {
    const result = cleanWorkspace({
      ...valid,
      settings: {
        ...valid.settings,
        twoWeekRules: {
          ...valid.settings.twoWeekRules,
          preventNightToMorning: false,
          preventAfternoonRestMorning: false,
        },
      },
      weeks: {
        0: {
          requests: {
            "N-201-d0": { choice: "birthday_leave", status: "mandatory" },
            "N-201-d1": { choice: "personal_leave", status: "mandatory" },
            "N-201-d2": { choice: "training", status: "mandatory" },
          },
          assignments: {},
          preferences: {},
          published: false,
        },
      },
    });
    expect(result.settings.twoWeekRules).toMatchObject({
      preventNightToMorning: true,
      preventAfternoonRestMorning: true,
    });
    expect(result.weeks["0"].requests["N-201-d2"]).toEqual({
      choice: "training",
      status: "mandatory",
    });
  });
});
