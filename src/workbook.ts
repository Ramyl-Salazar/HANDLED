import {
  scheduledHours,
  type AssignmentMap,
  type Nurse,
  type ScheduleDay,
  type ShiftDefinition,
} from "./schedule";
import {
  assignedDutyOnDay,
  dutyKey,
  dutyLabels,
  dutyShortLabels,
  overtimeDutyWindow,
  overtimePositionsCovered,
  requestKey,
  type DutyCode,
  type OvertimeCoverage,
  type ScheduleRequestMap,
} from "./twoWeekSchedule";

const colors = {
  cobalt: "FF24489D",
  darkCobalt: "FF1F4295",
  paleBlue: "FFEAF0FF",
  red: "FFD72B37",
  ink: "FF162344",
  muted: "FF66728F",
  white: "FFFFFFFF",
  border: "FFD5DDEC",
  morning: "FFFFE58A",
  afternoon: "FF53CED2",
  night: "FF526FC2",
  rest: "FFE3E5EA",
  birthday_leave: "FFFFE7A8",
  personal_leave: "FFFFD8DC",
  training: "FFD8F0E5",
  leave: "FFFFD8DC",
} as const;

function saveBuffer(filename: string, buffer: ArrayBuffer) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function buildPreferenceWorkbookBuffer(
  nurseList: Nurse[],
  days: ScheduleDay[],
  requests: ScheduleRequestMap,
) {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  workbook.creator = "HANDLED — Hospital Automated Nurse Duty Lineup & Equitable Distribution";
  workbook.created = new Date();

  const instructions = workbook.addWorksheet("Instructions", {
    views: [{ showGridLines: false }],
  });
  instructions.columns = [{ width: 24 }, { width: 78 }];
  instructions.mergeCells("A1:B2");
  const instructionTitle = instructions.getCell("A1");
  instructionTitle.value = "HANDLED · TWO-WEEK NURSE REQUEST FORM";
  instructionTitle.font = {
    color: { argb: colors.white },
    bold: true,
    size: 18,
  };
  instructionTitle.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: colors.darkCobalt },
  };
  instructionTitle.alignment = {
    vertical: "middle",
    horizontal: "left",
    indent: 1,
  };
  const guidance = [
    ["Purpose", "Collect structured requests for one complete two-week schedule."],
    ["Request entry", "The head nurse may record any number of dates here. Staff submissions use the separate link limit configured in HANDLED."],
    ["Allowed choices", "6 Morning · 2 Afternoon · N Night · REST · Birthday Leave · Personal Leave · Training. Leave and Training are protected."],
    ["Empty cells", "Leave dates blank when the nurse has no special request. Availability entry is not required."],
    ["Privacy", "Staff scheduling information only. Never include patient or clinical information."],
    ["Import", "Keep Employee IDs and headings unchanged, save as .xlsx, then import in HANDLED → Preferences."],
  ];
  guidance.forEach(([label, detail], index) => {
    const row = instructions.getRow(index + 4);
    row.values = [label, detail];
    row.height = 34;
    row.getCell(1).font = { bold: true, color: { argb: colors.cobalt } };
    row.getCell(2).alignment = { vertical: "middle", wrapText: true };
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: "thin", color: { argb: colors.border } },
      };
    });
  });

  const sheet = workbook.addWorksheet("Requests", {
    views: [
      {
        state: "frozen",
        xSplit: 2,
        ySplit: 4,
        topLeftCell: "C5",
        showGridLines: false,
      },
    ],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  const totalColumns = 2 + days.length;
  sheet.mergeCells(1, 1, 2, totalColumns);
  const title = sheet.getCell(1, 1);
  title.value = "HANDLED · TWO-WEEK SHIFT / REST / LEAVE REQUESTS";
  title.font = { color: { argb: colors.white }, bold: true, size: 18 };
  title.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: colors.darkCobalt },
  };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sheet.mergeCells(3, 1, 3, totalColumns);
  sheet.getCell(3, 1).value =
    "Head-nurse entry has no date limit. Leave dates without a request blank.";
  sheet.getCell(3, 1).font = {
    color: { argb: colors.muted },
    italic: true,
    size: 10,
  };
  sheet.getCell(3, 1).alignment = {
    vertical: "middle",
    indent: 1,
  };
  sheet.getRow(1).height = 28;
  sheet.getRow(2).height = 22;
  sheet.getRow(3).height = 25;

  const header = sheet.getRow(4);
  header.values = [
    "Employee ID",
    "Nurse name",
    ...days.map((day) => `${day.shortLabel} ${day.date}`),
  ];
  header.height = 38;
  header.eachCell((cell, column) => {
    const weekend = column > 2 && Boolean(days[column - 3]?.weekend);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: weekend ? "FF3859AA" : colors.cobalt },
    };
    cell.font = { bold: true, color: { argb: colors.white }, size: 10 };
    cell.alignment = {
      vertical: "middle",
      horizontal: column <= 2 ? "left" : "center",
      wrapText: true,
    };
    cell.border = {
      right: { style: "thin", color: { argb: "FF8095C8" } },
      bottom: { style: "medium", color: { argb: colors.red } },
    };
  });

  nurseList.forEach((nurse, index) => {
    const row = sheet.getRow(index + 5);
    row.values = [
      nurse.id,
      nurse.name,
      ...days.map((day) => {
        const request = requests[requestKey(nurse.id, day.key)];
        return request ? dutyLabels[request.choice] : "";
      }),
    ];
    row.height = 27;
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: index % 2 ? "FFF7F9FD" : colors.white },
      };
      cell.font = {
        color: { argb: colors.ink },
        size: 10,
        bold: column === 1,
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: column <= 2 ? "left" : "center",
        wrapText: true,
      };
      cell.border = {
        bottom: { style: "thin", color: { argb: colors.border } },
        right: { style: "thin", color: { argb: colors.border } },
      };
      if (column > 2) {
        cell.dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: ['"6 Morning,2 Afternoon,N Night,REST,Birthday Leave,Personal Leave,Training"'],
          showErrorMessage: true,
          errorTitle: "Choose an HANDLED request",
          error:
            "Use 6 Morning, 2 Afternoon, N Night, REST, Birthday Leave, Personal Leave, Training, or leave the cell blank.",
        };
      }
    });
  });
  sheet.getColumn(1).width = 13;
  sheet.getColumn(2).width = 24;
  days.forEach((_, index) => (sheet.getColumn(index + 3).width = 15));
  sheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4 + nurseList.length, column: totalColumns },
  };
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(totalColumns).letter}${4 + nurseList.length}`;

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function downloadPreferenceWorkbook(
  nurseList: Nurse[],
  days: ScheduleDay[],
  requests: ScheduleRequestMap,
  filename: string,
) {
  saveBuffer(
    filename,
    await buildPreferenceWorkbookBuffer(nurseList, days, requests),
  );
}

export async function buildScheduleWorkbookBuffer(
  nurseList: Nurse[],
  days: ScheduleDay[],
  shifts: ShiftDefinition[],
  assignments: AssignmentMap,
  periodLabel: string,
  published: boolean,
  overtimeCoverage: OvertimeCoverage[] = [],
) {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  workbook.creator = "HANDLED — Hospital Automated Nurse Duty Lineup & Equitable Distribution";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Two-week Schedule", {
    views: [
      {
        state: "frozen",
        xSplit: 2,
        ySplit: 4,
        topLeftCell: "C5",
        showGridLines: false,
      },
    ],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      margins: {
        left: 0.2,
        right: 0.2,
        top: 0.4,
        bottom: 0.4,
        header: 0.15,
        footer: 0.15,
      },
    },
  });
  const totalColumns = 4 + days.length;
  sheet.mergeCells(1, 1, 2, totalColumns);
  const title = sheet.getCell(1, 1);
  title.value = "HANDLED · TWO-WEEK ER NURSE SCHEDULE";
  title.font = { color: { argb: colors.white }, bold: true, size: 18 };
  title.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: colors.darkCobalt },
  };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sheet.mergeCells(3, 1, 3, totalColumns);
  const subtitle = sheet.getCell(3, 1);
  subtitle.value = `${periodLabel} · ${published ? "PUBLISHED" : "DRAFT FOR HEAD-NURSE REVIEW"}`;
  subtitle.font = { color: { argb: colors.cobalt }, bold: true, size: 10 };
  subtitle.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: colors.paleBlue },
  };
  subtitle.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sheet.getRow(1).height = 28;
  sheet.getRow(2).height = 22;
  sheet.getRow(3).height = 25;

  const header = sheet.getRow(4);
  header.values = [
    "Employee ID",
    "Nurse name",
    ...days.map((day) => `${day.shortLabel}\n${day.date}`),
    "Hours",
    "REST",
  ];
  header.height = 38;
  header.eachCell((cell, column) => {
    const dayIndex = column - 3;
    const weekend =
      dayIndex >= 0 && dayIndex < days.length && days[dayIndex].weekend;
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: weekend ? "FF3859AA" : colors.cobalt },
    };
    cell.font = { bold: true, color: { argb: colors.white }, size: 10 };
    cell.alignment = {
      vertical: "middle",
      horizontal: column <= 2 ? "left" : "center",
      wrapText: true,
    };
    cell.border = {
      right: { style: "thin", color: { argb: "FF8095C8" } },
      bottom: { style: "medium", color: { argb: colors.red } },
    };
  });

  nurseList.forEach((nurse, index) => {
    const duties = days.map((day) =>
      assignedDutyOnDay(assignments, nurse.id, day.key),
    );
    const overtimeEntriesForDay = days.map((day) =>
      overtimeCoverage.find(
        (entry) => entry.dayKey === day.key && entry.nurseIds.includes(nurse.id),
      ),
    );
    const overtimeForDay = overtimeEntriesForDay.map(
      (entry) => entry?.hoursEach ?? 0,
    );
    const overtimeWindows = overtimeEntriesForDay.map((entry) =>
      entry ? overtimeDutyWindow(entry, nurse.id, shifts) : null,
    );
    const row = sheet.getRow(index + 5);
    row.values = [
      nurse.id,
      nurse.name,
      ...duties.map((duty, dayIndex) =>
        duty
          ? `${dutyShortLabels[duty]}${overtimeWindows[dayIndex] ? ` ${overtimeWindows[dayIndex]!.start}–${overtimeWindows[dayIndex]!.end} (+${overtimeForDay[dayIndex]}h OT)` : ""}`
          : "",
      ),
      scheduledHours(assignments, nurse.id, shifts) +
        overtimeForDay.reduce<number>((total, hours) => total + hours, 0),
      duties.filter((duty) => duty === "rest").length,
    ];
    row.height = 28;
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      const dayIndex = column - 3;
      const duty =
        dayIndex >= 0 && dayIndex < duties.length ? duties[dayIndex] : null;
      const background = duty
        ? colors[duty]
        : index % 2
          ? "FFF7F9FD"
          : colors.white;
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: background },
      };
      cell.font = {
        color: { argb: duty === "night" ? colors.white : colors.ink },
        bold: column === 1 || Boolean(duty),
        size: 10,
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: column <= 2 ? "left" : "center",
        wrapText: true,
      };
      cell.border = {
        bottom: { style: "thin", color: { argb: colors.border } },
        right: { style: "thin", color: { argb: colors.border } },
      };
    });
  });

  const summaryStart = 5 + nurseList.length;
  ([
    "morning",
    "afternoon",
    "night",
    "rest",
    "birthday_leave",
    "personal_leave",
    "training",
  ] as DutyCode[]).forEach(
    (duty, index) => {
      const row = sheet.getRow(summaryStart + index);
      row.values = [
        index === 0 ? "DAILY SUMMARY" : "",
        dutyShortLabels[duty],
        ...days.map(
          (day) =>
            (assignments[dutyKey(day.key, duty)]?.length ?? 0) +
            (["morning", "afternoon", "night"].includes(duty)
              ? overtimePositionsCovered(
                  overtimeCoverage,
                  day.key,
                  duty as ShiftDefinition["code"],
                )
              : 0),
        ),
        "",
        "",
      ];
      row.height = 22;
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: column === 1 ? colors.paleBlue : colors[duty],
          },
        };
        cell.font = {
          bold: true,
          color: {
            argb:
              duty === "night" && column > 1 ? colors.white : colors.ink,
          },
          size: 9,
        };
        cell.alignment = {
          vertical: "middle",
          horizontal: column <= 2 ? "left" : "center",
        };
        cell.border = {
          bottom: { style: "thin", color: { argb: colors.border } },
          right: { style: "thin", color: { argb: colors.border } },
        };
      });
    },
  );

  sheet.getColumn(1).width = 12;
  sheet.getColumn(2).width = 23;
  days.forEach((_, index) => (sheet.getColumn(index + 3).width = 10));
  sheet.getColumn(totalColumns - 1).width = 9;
  sheet.getColumn(totalColumns).width = 9;
  sheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4 + nurseList.length, column: totalColumns },
  };
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(totalColumns).letter}${summaryStart + 4}`;
  sheet.pageSetup.printTitlesRow = "1:4";
  sheet.headerFooter.oddFooter =
    "&LHANDLED · Emergency-nurse schedule&CPage &P of &N&RConfidential staff schedule";
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function downloadScheduleWorkbook(
  nurseList: Nurse[],
  days: ScheduleDay[],
  shifts: ShiftDefinition[],
  assignments: AssignmentMap,
  periodLabel: string,
  published: boolean,
  filename: string,
  overtimeCoverage: OvertimeCoverage[] = [],
) {
  saveBuffer(
    filename,
    await buildScheduleWorkbookBuffer(
      nurseList,
      days,
      shifts,
      assignments,
      periodLabel,
      published,
      overtimeCoverage,
    ),
  );
}

export async function rowsFromPreferenceWorkbook(
  file: File,
): Promise<string[][]> {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.getWorksheet("Requests") ?? workbook.worksheets[0];
  if (!sheet) throw new Error("The workbook does not contain a worksheet.");
  const headerRow = sheet.getRow(4);
  const headers = Array.from({ length: headerRow.cellCount }, (_, index) =>
    String(headerRow.getCell(index + 1).text ?? "").trim(),
  );
  if (!headers.some((value) => value.toLowerCase() === "employee id"))
    throw new Error(
      "The workbook needs the HANDLED Requests sheet and Employee ID header.",
    );
  const result = [headers];
  for (let rowNumber = 5; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const values = headers.map((_, index) =>
      String(sheet.getRow(rowNumber).getCell(index + 1).text ?? "").trim(),
    );
    if (values.some(Boolean)) result.push(values);
  }
  return result;
}
