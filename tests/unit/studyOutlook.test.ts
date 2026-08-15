import { describe, it, expect } from "vitest";
import { buildStudyOutlook } from "@/lib/outlook/studyOutlook";
import { StudyOutlookBuildInput } from "@/lib/outlook/types";
import { EstimateCalibration } from "@/lib/analytics/estimateCalibration";
import { findFreeTime } from "@/lib/planning/freeTime";
import { Assignment, CalendarMark, CourseSchedule, Semester, StudyBlock } from "@/types";

// fixture 相对真实 now（findFreeTime 内部用真实时钟；与 taskHealth.test 同策略）
const NOW = new Date();
const iso = (d: Date, h = 23, m = 59) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
const date = (offset: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const SEMESTER: Semester = { id: "s", name: "S", startDate: date(-30), totalWeeks: 16 };

function mk(id: string, patch: Partial<Assignment>): Assignment {
  return {
    id, courseId: "c1", title: `任务${id}`, description: "", priority: "medium",
    status: "todo", progress: 0, tags: [],
    ...patch,
  } as Assignment;
}

function block(id: string, assignmentId: string, offset: number, start: string, end: string): StudyBlock {
  return { id, title: id, date: date(offset), startTime: start, endTime: end, assignmentId, courseId: "c1", source: "manual" };
}

const EMPTY_CAL: EstimateCalibration = {
  status: "insufficient-data",
  sampleCount: 0,
  excludedOutliers: 0,
  medianRatio: null,
  interpretation: null,
  byCourse: [],
  samples: [],
};

function baseInput(patch: Partial<StudyOutlookBuildInput> = {}): StudyOutlookBuildInput {
  return {
    assignments: [],
    studyBlocks: [],
    schedules: [] as CourseSchedule[],
    calendarMarks: [] as CalendarMark[],
    courses: [{ id: "c1", name: "数据结构", code: "C1", credit: 3, teacher: "T", classroom: "R", description: "", bgHex: "#fff", borderHex: "#ddd", materials: [] }] as any[],
    semester: SEMESTER,
    currentSemesterWeek: 1,
    horizonDays: 7,
    now: NOW,
    calibration: EMPTY_CAL,
    ...patch,
  };
}

describe("Study Outlook", () => {
  it("DDL 在 horizon 内 → 进入主列表；无 DDL 单独计数；completed 排除", () => {
    const input = baseInput({
      assignments: [
        mk("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000)), estimatedMinutes: 60 }),
        mk("a2", {}), // 无 DDL
        mk("a3", { ddl: iso(new Date(NOW.getTime() + 20 * 86400000)), estimatedMinutes: 60 }), // horizon 外
        mk("a4", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000)), status: "completed" }),
      ],
    });
    const out = buildStudyOutlook(input);
    expect(out.summary.counts.totalDue).toBe(1);
    expect(out.summary.counts.noDeadline).toBe(1);
    expect(out.tasks.map((t) => t.assignmentId)).toEqual(["a1"]);
  });

  it("overdue 任务进入列表且 health=overdue；排序在最前", () => {
    const input = baseInput({
      assignments: [
        mk("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000)), estimatedMinutes: 60 }),
        mk("a2", { ddl: iso(new Date(NOW.getTime() - 1 * 86400000)), estimatedMinutes: 60 }),
      ],
    });
    const out = buildStudyOutlook(input);
    expect(out.tasks[0].assignmentId).toBe("a2");
    expect(out.tasks[0].health).toBe("overdue");
    expect(out.summary.counts.overdue).toBe(1);
  });

  it("missing estimate → health=unknown + reason missing_estimate + unscheduledMinutes=null", () => {
    const input = baseInput({
      assignments: [mk("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000)) })],
    });
    const out = buildStudyOutlook(input);
    const t = out.tasks[0];
    expect(t.health).toBe("unknown");
    expect(t.reasons).toContain("missing_estimate");
    expect(t.unscheduledMinutes).toBeNull();
    expect(out.summary.counts.missingEstimate).toBe(1);
  });

  it("已排满 → safe；部分已排 → attention；一个没排且可用时间足 → unscheduled", () => {
    const input = baseInput({
      assignments: [
        mk("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000)), estimatedMinutes: 60 }),
        mk("a2", { ddl: iso(new Date(NOW.getTime() + 4 * 86400000)), estimatedMinutes: 120 }),
        mk("a3", { ddl: iso(new Date(NOW.getTime() + 5 * 86400000)), estimatedMinutes: 60 }),
      ],
      studyBlocks: [
        block("b1", "a1", 1, "19:00", "20:00"), // a1 排满 60
        block("b2", "a2", 1, "20:00", "20:30"), // a2 只排 30/120
      ],
    });
    const out = buildStudyOutlook(input);
    expect(out.tasks.find((t) => t.assignmentId === "a1")?.health).toBe("safe");
    expect(out.tasks.find((t) => t.assignmentId === "a2")?.health).toBe("attention");
    expect(out.tasks.find((t) => t.assignmentId === "a2")?.unscheduledMinutes).toBe(90);
    expect(out.tasks.find((t) => t.assignmentId === "a3")?.health).toBe("unscheduled");
  });

  it("availableMinutes 来自 Free Time Engine（课程冲突被扣除）", () => {
    // 下个周一有课 08:00-12:00 → 该日 free time 只有 12:00 之后
    const daysUntilMonday = (8 - NOW.getDay()) % 7;
    const mondayOffset = daysUntilMonday === 0 ? 7 : daysUntilMonday;
    const schedules: CourseSchedule[] = [
      { id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "12:00", location: "", weeks: "1-16周" },
    ];
    const input = baseInput({
      assignments: [mk("a1", { ddl: iso(new Date(NOW.getTime() + mondayOffset * 86400000)), estimatedMinutes: 240 })],
      schedules,
    });
    const out = buildStudyOutlook(input);
    const t = out.tasks[0];
    // 有至少一段可用时间（周一 12:00–21:00 及更晚日期）
    expect(t.availableMinutesBeforeDeadline).toBeGreaterThan(0);
    // 验证 Monday 的全部可用时间都落在课程外：直接验证 free slots 不含 08:00-12:00
    const mondayDate = date(mondayOffset);
    const slots = findFreeTime({ start: NOW, end: new Date(NOW.getTime() + (mondayOffset + 1) * 86400000), semester: SEMESTER, currentSemesterWeek: 1, schedules, calendarMarks: [], studyBlocks: [] });
    const mondaySlots = slots.filter((s) => s.date === mondayDate);
    expect(mondaySlots.length).toBeGreaterThan(0);
    for (const s of mondaySlots) {
      expect(s.startTime >= "12:00").toBe(true);
    }
  });

  it("at-risk：可用时间不足 → health=at-risk", () => {
    const input = baseInput({
      assignments: [
        mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000), 12, 0), estimatedMinutes: 480 }), // 明天中午，缺口巨大
      ],
    });
    const out = buildStudyOutlook(input);
    expect(out.tasks[0].health).toBe("at-risk");
    expect(out.summary.counts.atRisk).toBe(1);
  });

  it("bottleneck days：due>=2 或 planned>=240", () => {
    const input = baseInput({
      assignments: [
        mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 60 }),
        mk("a2", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 60 }),
        mk("a3", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000)), estimatedMinutes: 60 }),
      ],
      studyBlocks: [
        block("b1", "a1", 2, "08:00", "12:00"), // 240min
      ],
    });
    const out = buildStudyOutlook(input);
    const days = out.bottleneckDays.map((d) => d.date);
    expect(days).toContain(date(1)); // due>=2
    expect(days).toContain(date(2)); // planned>=240
    expect(out.bottleneckDays.find((d) => d.date === date(1))?.dueTaskCount).toBe(2);
  });

  it("排序：overdue → at-risk → attention → unscheduled → unknown → safe；最多 8 条", () => {
    const many: Assignment[] = [];
    for (let i = 0; i < 12; i++) {
      many.push(mk(`a${i}`, { ddl: iso(new Date(NOW.getTime() + (i + 1) * 86400000)), estimatedMinutes: 60, status: i === 0 ? "doing" : "todo" }));
    }
    const input = baseInput({ assignments: many });
    const out = buildStudyOutlook(input);
    expect(out.tasks.length).toBeLessThanOrEqual(8);
    const rank: Record<string, number> = { overdue: 0, "at-risk": 1, attention: 2, unscheduled: 3, unknown: 4, safe: 5 };
    const healths = out.tasks.map((t) => rank[t.health]);
    for (let i = 1; i < healths.length; i++) {
      expect(healths[i]).toBeGreaterThanOrEqual(healths[i - 1]);
    }
  });

  it("calibration ready 且任务有估时 → 附加 course/global 只读参考；health 判定不受其影响", () => {
    const cal: EstimateCalibration = {
      status: "ready",
      sampleCount: 6,
      excludedOutliers: 0,
      medianRatio: 1.3,
      interpretation: "tracked-above-estimate",
      byCourse: [{ courseId: "c1", courseName: "数据结构", sampleCount: 4, medianRatio: 1.4, status: "ready" }],
      samples: [],
    };
    const input = baseInput({
      assignments: [
        mk("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000)), estimatedMinutes: 60 }),
        mk("a2", { ddl: iso(new Date(NOW.getTime() + 4 * 86400000)) }), // 无估时 → 无 calibration ref
      ],
      calibration: cal,
    });
    const out = buildStudyOutlook(input);
    const t1 = out.tasks.find((t) => t.assignmentId === "a1")!;
    expect(t1.estimateCalibration).toEqual({ source: "course", medianRatio: 1.4, sampleCount: 4 });
    // health 仍按原始 estimate 判定（a1 无 block → unscheduled，不是 safe/at-risk）
    expect(t1.health).toBe("unscheduled");
    const t2 = out.tasks.find((t) => t.assignmentId === "a2")!;
    expect(t2.estimateCalibration).toBeUndefined();
  });

  it("Portfolio shortfall：A=120 B=120 共享 180min → 一个任务 capacityComplete=false；raw free != shared allocated", () => {
    // 用 calendarMarks 限制未来容量：今天 all-day exam（0 free）+ 明天 exam 08:00-18:00（只剩 180min）
    const calendarMarks: CalendarMark[] = [
      { id: "cm0", date: date(0), type: "exam", title: "全天考试", startTime: "00:00", endTime: "23:59" },
      { id: "cm1", date: date(1), type: "exam", title: "考试", startTime: "08:00", endTime: "18:00" },
    ];
    const input = baseInput({
      assignments: [
        mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 120 }),
        mk("a2", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 120 }),
      ],
      calendarMarks,
    });
    const out = buildStudyOutlook(input);

    // 共享容量：240 需求 vs 180 可分配
    expect(out.summary.workload.remainingKnownMinutes).toBe(240);
    expect(out.summary.workload.allocatableMinutes).toBe(180);
    expect(out.summary.workload.shortfallMinutes).toBe(60);
    // 至少一个任务 capacityComplete=false
    expect(out.tasks.filter((t) => t.capacityComplete === false).length).toBe(1);
    expect(out.tasks.filter((t) => t.capacityComplete === true).length).toBe(1);
    // raw free（无竞争）与 shared allocated 不同：raw 对每个任务都是 180
    for (const t of out.tasks) {
      expect(t.availableMinutesBeforeDeadline).toBe(180);
      expect(t.capacityAllocatedMinutes).not.toBe(t.availableMinutesBeforeDeadline);
    }
    // firstCapacityShortfall 存在且 affected 只含 capacityComplete=false 的任务
    expect(out.firstCapacityShortfall).not.toBeNull();
    expect(out.firstCapacityShortfall!.shortfallMinutes).toBe(60);
    const affected = out.firstCapacityShortfall!.affectedAssignmentIds;
    expect(affected.length).toBe(1);
    // capacityForecast：一个 checkpoint（同 DDL），cumulative shortfall = 60
    expect(out.capacityForecast.length).toBe(1);
    expect(out.capacityForecast[0].cumulativeShortfallMinutes).toBe(60);
    expect(out.capacityForecast[0].dueAssignmentIds.length).toBe(2);
  });

  it("capacityForecast：按 Deadline 升序 checkpoint；早截止任务不把晚截止容量算进累计", () => {
    const calendarMarks: CalendarMark[] = [
      { id: "cm0", date: date(0), type: "exam", title: "全天考试", startTime: "00:00", endTime: "23:59" },
      { id: "cm1", date: date(1), type: "exam", title: "考试", startTime: "08:00", endTime: "18:00" },
    ];
    const input = baseInput({
      assignments: [
        mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 240 }), // 明天，缺口大
        mk("a2", { ddl: iso(new Date(NOW.getTime() + 5 * 86400000)), estimatedMinutes: 60 }), // 周五
      ],
      calendarMarks,
    });
    const out = buildStudyOutlook(input);
    expect(out.capacityForecast.length).toBe(2);
    expect(out.capacityForecast[0].deadline.slice(0, 10)).toBe(date(1));
    expect(out.capacityForecast[0].cumulativeRequiredMinutes).toBe(240);
    // a1 明天 deadline 前只有 180min 可用 → 累计缺口 60
    expect(out.capacityForecast[0].cumulativeShortfallMinutes).toBe(60);
    expect(out.firstCapacityShortfall?.deadline.slice(0, 10)).toBe(date(1));
    expect(out.firstCapacityShortfall?.affectedAssignmentIds).toEqual(["a1"]);
  });

  it("scheduled_after_deadline：Deadline 后 StudyBlock 不计 coverage，但保留 reason 提示", () => {
    const input = baseInput({
      assignments: [mk("a1", { ddl: iso(new Date(NOW.getTime() + 2 * 86400000)), estimatedMinutes: 120 })],
      studyBlocks: [block("b1", "a1", 3, "19:00", "20:00")], // Deadline 之后
    });
    const out = buildStudyOutlook(input);
    const t = out.tasks[0];
    expect(t.scheduledMinutesBeforeDeadline).toBe(0);
    expect(t.unscheduledMinutes).toBe(120);
    expect(t.reasons).toContain("scheduled_after_deadline");
  });
});
