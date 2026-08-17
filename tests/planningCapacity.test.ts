import { describe, it, expect } from "vitest";
import { buildPlanningCapacity, getAllocatableShortfall } from "@/lib/planning/planningCapacity";
import { Assignment, CalendarMark, CourseSchedule, Semester, StudyBlock } from "@/types";

const NOW = new Date(2026, 7, 10, 9, 0, 0); // 周一
const iso = (d: Date, h = 23, m = 59) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
const date = (offset: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const SEMESTER: Semester = { id: "s", name: "S", startDate: date(0), totalWeeks: 16 };

function mkA(id: string, patch: Partial<Assignment> = {}): Assignment {
  return {
    id, courseId: "c1", title: id, description: "", priority: "medium",
    status: "todo", progress: 0, tags: [],
    ...patch,
  } as Assignment;
}

function mkBlock(id: string, offset: number, start: string, end: string, patch: Partial<StudyBlock> = {}): StudyBlock {
  return {
    id, title: id, date: date(offset), startTime: start, endTime: end,
    assignmentId: "a1", courseId: "c1", source: "manual",
    ...patch,
  } as StudyBlock;
}

function base(patch: Partial<Parameters<typeof buildPlanningCapacity>[0]> = {}) {
  return {
    assignments: [] as Assignment[],
    studyBlocks: [] as StudyBlock[],
    schedules: [] as CourseSchedule[],
    calendarMarks: [] as CalendarMark[],
    semester: SEMESTER,
    currentSemesterWeek: 1,
    fromDate: date(0),
    toDate: date(1),
    now: NOW,
    ...patch,
  };
}

const mondayDow = 1;

describe("Planning Capacity（V1.2 两层容量）", () => {
  it("§41 sandwich course：08-10 free / 10-11 course / 11-12 free，need 240 → Preferred 180，Combined 240", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 240 });
    const schedules: CourseSchedule[] = [
      { id: "s1", courseId: "c2", dayOfWeek: mondayDow, startTime: "10:00", endTime: "11:00", location: "", weeks: "1-16周" },
    ];
    // 收窄到当天（now=00:00 不截断早间）+ 考试堵住 12:00-21:00 → preferred 只剩 08-10 + 11-12
    const midnight = new Date(2026, 7, 10, 0, 0, 0);
    const calendarMarks: CalendarMark[] = [
      { id: "cm1", date: date(0), type: "exam", title: "考试", startTime: "12:00", endTime: "21:00" },
    ];
    const r = buildPlanningCapacity(
      base({ assignments: [a], schedules, calendarMarks, fromDate: date(0), toDate: date(0), now: midnight })
    );
    expect(r.summary.preferredAllocatedMinutes).toBe(180); // 08-10 + 11-12
    expect(r.summary.preferredShortfallMinutes).toBe(60);
    expect(r.summary.courseFallbackUsed).toBe(true);
    expect(r.summary.combinedAllocatedMinutes).toBe(240);
    expect(r.summary.combinedShortfallMinutes).toBe(0);
    expect(r.combined.tasks[0].completeCoverage).toBe(true);
  });

  it("§42 adjacent course：08-09 free / 09-10 course / 10-11 free，need 150 → fallback 补 30+", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 150 });
    const schedules: CourseSchedule[] = [
      { id: "s1", courseId: "c2", dayOfWeek: mondayDow, startTime: "09:00", endTime: "10:00", location: "", weeks: "1-16周" },
    ];
    const midnight = new Date(2026, 7, 10, 0, 0, 0);
    const calendarMarks: CalendarMark[] = [
      { id: "cm1", date: date(0), type: "exam", title: "考试", startTime: "11:00", endTime: "21:00" },
    ];
    const r = buildPlanningCapacity(
      base({ assignments: [a], schedules, calendarMarks, fromDate: date(0), toDate: date(0), now: midnight })
    );
    expect(r.summary.preferredAllocatedMinutes).toBe(120); // 08-09 + 10-11
    expect(r.summary.combinedAllocatedMinutes).toBe(150);
    expect(r.summary.combinedShortfallMinutes).toBe(0);
  });

  it("§43 preferred sufficient：need 90、非课程 180 → courseFallbackUsed=false，blocks 不碰课程", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 90 });
    const schedules: CourseSchedule[] = [
      { id: "s1", courseId: "c2", dayOfWeek: mondayDow, startTime: "08:00", endTime: "12:00", location: "", weeks: "1-16周" },
    ];
    const r = buildPlanningCapacity(base({ assignments: [a], schedules }));
    expect(r.summary.courseFallbackUsed).toBe(false);
    expect(r.courseFallback).toBeNull();
    expect(r.combined.tasks[0].projectedBlocks.some((b) => b.date === date(0) && b.startTime >= "08:00" && b.endTime <= "12:00")).toBe(false);
  });

  it("§44 exam remains hard：fallback 不能进入考试时间", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 240 });
    const calendarMarks: CalendarMark[] = [
      { id: "cm1", date: date(0), type: "exam", title: "考试", startTime: "08:00", endTime: "12:00" },
    ];
    const r = buildPlanningCapacity(base({ assignments: [a], calendarMarks }));
    // 08-12 被考试占用；非课程 free = 12:00-21:00；fallback 也进不去考试时段
    expect(r.combined.tasks[0].projectedBlocks.some((b) => b.date === date(0) && b.startTime < "12:00" && b.endTime > "08:00")).toBe(false);
  });

  it("§44 studyblock remains hard：已有 StudyBlock 占用的时间 fallback 也不可用", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 240 });
    const blocks = [mkBlock("b1", 0, "13:00", "14:00", { assignmentId: "a1" })];
    const r = buildPlanningCapacity(base({ assignments: [a], studyBlocks: blocks }));
    expect(r.combined.tasks[0].projectedBlocks.some((b) => b.date === date(0) && b.startTime >= "13:00" && b.endTime <= "14:00")).toBe(false);
  });

  it("§45 same-day different DDL：A 10:00 / B 20:00 → 两者都 complete（不被全局 dayCap 截断）", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime()), 10, 0), estimatedMinutes: 60 }); // 今天 10:00
    const b = mkA("b1", { ddl: iso(new Date(NOW.getTime()), 20, 0), estimatedMinutes: 60 }); // 今天 20:00
    const r = buildPlanningCapacity(base({ assignments: [a, b] }));
    const ta = r.combined.tasks.find((t) => t.assignmentId === "a1")!;
    const tb = r.combined.tasks.find((t) => t.assignmentId === "b1")!;
    expect(ta.completeCoverage).toBe(true);
    expect(tb.completeCoverage).toBe(true);
    expect(tb.allocatedMinutes).toBe(60); // B 不被 A 的 10:00 全局 cap 饿死
  });

  it("§46 deadline-first：同日 A 10:00 / B 20:00，A 先拿 09-10（B 不能抢走 A 唯一窗口）", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime()), 10, 0), estimatedMinutes: 60 });
    const b = mkA("b1", { ddl: iso(new Date(NOW.getTime()), 20, 0), estimatedMinutes: 60 });
    const r = buildPlanningCapacity(base({ assignments: [a, b] }));
    const order = r.preferred.tasks.map((t) => t.assignmentId);
    expect(order.indexOf("a1")).toBeLessThan(order.indexOf("b1"));
    const aBlock = r.preferred.tasks.find((t) => t.assignmentId === "a1")!.projectedBlocks[0];
    expect(aBlock.startTime).toBe("09:00"); // A 拿到 09-10（唯一可用窗口）
    // B 之后仍拿到分配（使用 A 之后的时间，未被 dayCap 饿死）
    const bAlloc = r.preferred.tasks.find((t) => t.assignmentId === "b1")!;
    expect(bAlloc.allocatedMinutes).toBe(60);
  });

  it("§47 shared competition 保持：preferred 与 combined 内部都是单一共享池", () => {
    const a1 = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 120 });
    const a2 = mkA("a2", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 120 });
    const r = buildPlanningCapacity(base({ assignments: [a1, a2] }));
    // 明天全天空闲 → preferred 足够两人
    expect(r.summary.preferredAllocatedMinutes).toBe(240);
    expect(r.summary.courseFallbackUsed).toBe(false);
    expect(r.combined.tasks.filter((t) => t.completeCoverage).length).toBe(2);
  });

  it("missing estimate 不消耗容量；其 shortfall 不计入 allocatable（§6 helper）", () => {
    const a = mkA("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)) }); // 无估时
    const b = mkA("b1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 60 });
    const r = buildPlanningCapacity(base({ assignments: [a, b] }));
    // a1 的 shortfall（remaining=0）不应触发 fallback
    expect(r.summary.courseFallbackUsed).toBe(false);
    expect(getAllocatableShortfall(r.preferred)).toBe(0);
    expect(r.preferred.tasks.find((t) => t.assignmentId === "a1")!.classification).toBe("missing_estimate");
  });

  it("no_deadline：outlook 模式不参与；planner 模式（includeNoDeadline）参与", () => {
    const a = mkA("a1", { estimatedMinutes: 300 }); // 无 DDL
    const b = mkA("b1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 60 });
    const rOutlook = buildPlanningCapacity(base({ assignments: [a, b] }), { includeNoDeadline: false });
    expect(rOutlook.preferred.tasks.find((t) => t.assignmentId === "a1")!.allocatedMinutes).toBe(0);
    const rPlanner = buildPlanningCapacity(base({ assignments: [a, b] }), { includeNoDeadline: true });
    expect(rPlanner.preferred.tasks.find((t) => t.assignmentId === "a1")!.allocatedMinutes).toBeGreaterThan(0);
  });
});
