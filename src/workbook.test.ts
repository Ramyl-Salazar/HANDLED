import { describe, expect, it } from "vitest";
import { Workbook } from "exceljs";
import { nurses } from "./schedule";
import {
  buildTwoWeekDraft,
  createSeedRequests,
  datesForPeriod,
  officialShifts,
  dutyKey,
} from "./twoWeekSchedule";
import {
  buildPreferenceWorkbookBuffer,
  buildScheduleWorkbookBuffer,
} from "./workbook";

describe("Excel two-week request workbook", () => {
  it("creates one validated request column per date", async () => {
    const days = datesForPeriod(0);
    const buffer = await buildPreferenceWorkbookBuffer(
      nurses,
      days,
      createSeedRequests(nurses),
    );
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Requests")!;
    expect(sheet.getCell("A1").value).toContain("TWO-WEEK");
    expect(sheet.getCell("A4").value).toBe("Employee ID");
    expect(sheet.getCell("C4").value).toContain("Sep 13");
    expect(sheet.getCell("P4").value).toContain("Sep 26");
    expect(sheet.getCell("C5").dataValidation).toMatchObject({
      type: "list",
      allowBlank: true,
    });
    expect(sheet.getCell("C5").dataValidation.formulae?.[0]).toContain(
      "6 Morning",
    );
    expect(sheet.views[0]).toMatchObject({ state: "frozen", xSplit: 2, ySplit: 4 });
  });
});

describe("Excel two-week schedule workbook", () => {
  it("exports codes and the daily 6/2/N/REST summary", async () => {
    const days = datesForPeriod(0);
    const assignments = buildTwoWeekDraft(createSeedRequests(nurses), nurses).assignments;
    const buffer = await buildScheduleWorkbookBuffer(
      nurses,
      days,
      officialShifts,
      assignments,
      "Sep 13–Sep 26, 2026",
      false,
    );
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Two-week Schedule")!;
    expect(sheet.getCell("A1").value).toContain("TWO-WEEK ER NURSE SCHEDULE");
    expect(sheet.getCell("A4").value).toBe("Employee ID");
    expect(sheet.getCell("C4").value).toContain("Sun");
    const summaryStart = 5 + nurses.length;
    expect(sheet.getCell(summaryStart, 2).value).toBe("6");
    expect(sheet.getCell(summaryStart + 1, 2).value).toBe("2");
    expect(sheet.getCell(summaryStart + 2, 2).value).toBe("N");
    expect(sheet.getCell(summaryStart + 3, 2).value).toBe("REST");
    expect(sheet.getCell(summaryStart, 3).value).toBe(
      assignments[dutyKey("d0", "morning")]?.length ?? 0,
    );
    expect(sheet.views[0]).toMatchObject({ state: "frozen", xSplit: 2, ySplit: 4 });
    expect(sheet.pageSetup.orientation).toBe("landscape");
  });

  it("exports paired 12-hour duty windows and overtime hours", async () => {
    const days = datesForPeriod(0);
    const roster = nurses.slice(0, 2);
    const assignments = {
      [dutyKey("d0", "morning")]: [roster[0].id],
      [dutyKey("d0", "night")]: [roster[1].id],
    };
    const overtimeCoverage = [
      {
        id: "d0-afternoon-pair",
        dayKey: "d0",
        shiftCode: "afternoon" as const,
        nurseIds: [roster[0].id, roster[1].id] as [string, string],
        hoursEach: 4 as const,
        createdAt: "2026-09-08T00:00:00.000Z",
      },
    ];
    const buffer = await buildScheduleWorkbookBuffer(
      roster,
      days,
      officialShifts,
      assignments,
      "Sep 13–Sep 26, 2026",
      false,
      overtimeCoverage,
    );
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Two-week Schedule")!;

    expect(sheet.getCell("C5").value).toBe("6 06:00–18:00 (+4h OT)");
    expect(sheet.getCell("C6").value).toBe("N 18:00–06:00 (+4h OT)");
    expect(sheet.getCell("Q5").value).toBe(12);
    expect(sheet.getCell("Q6").value).toBe(12);
  });
});
