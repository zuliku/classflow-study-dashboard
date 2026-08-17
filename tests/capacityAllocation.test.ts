import { describe, it, expect } from "vitest";
import { allocateStudyCapacity } from "@/lib/planning/capacityAllocation";
import { FreeTimeSlot } from "@/lib/planning/freeTime";
import { Assignment, StudyBlock } from "@/types";

const NOW = new Date(2026, 7, 10, 9, 0, 0);
const iso = (d: Date, h = 23, m = 59) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
const date = (offset: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function mk(id: string, patch: Partial<Assignment> = {}): Assignment {
  return {
    id, courseId: "c1", title: id, description: "", priority: "medium",
    status: "todo", progress: 0, tags: [],
    ...patch,
  } as Assignment;
}

function slot(offset: number, start: string, end: string): FreeTimeSlot {
  const s = Number(start.split(":")[0]) * 60 + Number(start.split(":")[1]);
  const e = Number(end.split(":")[0]) * 60 + Number(end.split(":")[1]);
  return { date: date(offset), startTime: start, endTime: end, minutes: e - s };
}

const noBlocks: StudyBlock[] = [];

describe("Capacity Allocation（共享容量）", () => {
  it("Red：共享池 180min，A=120 + B=120（同 DDL）→ shortfall=60，B 不能完整覆盖", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 120 });
    const b = mk("b1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 120 });
    const r = allocateStudyCapacity({
      assignments: [a, b],
      studyBlocks: noBlocks,
      freeSlots: [slot(1, "18:00", "21:00")], // 180
      fromDate: date(0),
      toDate: date(1),
      now: NOW,
    });
    expect(r.totalRemainingRequiredMinutes).toBe(240);
    expect(r.totalAllocatedMinutes).toBe(180);
    expect(r.totalShortfallMinutes).toBe(60);
    // 两个任务不能同时被认为容量可覆盖
    expect(r.tasks.filter((t) => t.completeCoverage).length).toBe(1);
    // stable order：a1 完整，b1 只有 60
    const ta = r.tasks.find((t) => t.assignmentId === "a1")!;
    const tb = r.tasks.find((t) => t.assignmentId === "b1")!;
    expect(ta.allocatedMinutes).toBe(120);
    expect(ta.shortfallMinutes).toBe(0);
    expect(ta.completeCoverage).toBe(true);
    expect(tb.allocatedMinutes).toBe(60);
    expect(tb.shortfallMinutes).toBe(60);
    expect(tb.completeCoverage).toBe(false);
  });

  it("staggered deadline：A 周二前只有 180（Mon60+Tue120），B 可用周五容量", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 2 * 86400000)), estimatedMinutes: 240 }); // 周二
    const b = mk("b1", { ddl: iso(new Date(NOW.getTime() + 5 * 86400000)), estimatedMinutes: 120 }); // 周五
    const r = allocateStudyCapacity({
      assignments: [a, b],
      studyBlocks: noBlocks,
      freeSlots: [slot(1, "18:00", "19:00"), slot(2, "18:00", "20:00"), slot(5, "18:00", "23:00")], // 60+120+300
      fromDate: date(0),
      toDate: date(5),
      now: NOW,
    });
    const ta = r.tasks.find((t) => t.assignmentId === "a1")!;
    expect(ta.allocatedMinutes).toBe(180);
    expect(ta.shortfallMinutes).toBe(60);
    const tb = r.tasks.find((t) => t.assignmentId === "b1")!;
    expect(tb.allocatedMinutes).toBe(120);
    expect(tb.completeCoverage).toBe(true);
  });

  it("existing plan：estimate 180 已有 60 → remaining=120；不重复要求 180", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000)), estimatedMinutes: 180 });
    const blocks: StudyBlock[] = [
      { id: "b1", title: "b1", date: date(1), startTime: "19:00", endTime: "20:00", assignmentId: "a1", courseId: "c1", source: "manual" },
    ];
    const r = allocateStudyCapacity({
      assignments: [a],
      studyBlocks: blocks,
      freeSlots: [slot(2, "19:00", "21:00")], // 120
      fromDate: date(0),
      toDate: date(3),
      now: NOW,
    });
    const t = r.tasks[0];
    expect(t.alreadyScheduledMinutes).toBe(60);
    expect(t.remainingRequiredMinutes).toBe(120);
    expect(t.allocatedMinutes).toBe(120);
    expect(t.completeCoverage).toBe(true);
  });

  it("missing estimate：不消费 capacity；有估时任务完整拿到 120", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)) }); // 无估时
    const b = mk("b1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 120 });
    const r = allocateStudyCapacity({
      assignments: [a, b],
      studyBlocks: noBlocks,
      freeSlots: [slot(1, "19:00", "21:00")], // 120
      fromDate: date(0),
      toDate: date(1),
      now: NOW,
    });
    const ta = r.tasks.find((t) => t.assignmentId === "a1")!;
    expect(ta.classification).toBe("missing_estimate");
    expect(ta.allocatedMinutes).toBe(0);
    const tb = r.tasks.find((t) => t.assignmentId === "b1")!;
    expect(tb.allocatedMinutes).toBe(120);
    expect(tb.completeCoverage).toBe(true);
    // 池子没被 A 消耗：unused = 0（B 拿满 120/120）
    expect(r.unusedFreeMinutes).toBe(0);
  });

  it("no deadline：不参与 shared allocation，不消耗容量", () => {
    const a = mk("a1", { estimatedMinutes: 300 }); // 无 DDL
    const b = mk("b1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 60 });
    const r = allocateStudyCapacity({
      assignments: [a, b],
      studyBlocks: noBlocks,
      freeSlots: [slot(1, "19:00", "20:00")], // 60
      fromDate: date(0),
      toDate: date(1),
      now: NOW,
    });
    const ta = r.tasks.find((t) => t.assignmentId === "a1")!;
    expect(ta.classification).toBe("no_deadline");
    expect(ta.allocatedMinutes).toBe(0);
    const tb = r.tasks.find((t) => t.assignmentId === "b1")!;
    expect(tb.allocatedMinutes).toBe(60);
    expect(tb.completeCoverage).toBe(true);
  });

  it("overdue：不进入未来 allocation", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() - 1 * 86400000)), estimatedMinutes: 60 });
    const b = mk("b1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 60 });
    const r = allocateStudyCapacity({
      assignments: [a, b],
      studyBlocks: noBlocks,
      freeSlots: [slot(1, "19:00", "20:00")], // 60
      fromDate: date(0),
      toDate: date(1),
      now: NOW,
    });
    const ta = r.tasks.find((t) => t.assignmentId === "a1")!;
    expect(ta.classification).toBe("overdue");
    expect(ta.allocatedMinutes).toBe(0);
    const tb = r.tasks.find((t) => t.assignmentId === "b1")!;
    expect(tb.allocatedMinutes).toBe(60);
    expect(tb.completeCoverage).toBe(true);
  });

  it("deadline constraint：Deadline 后的 slot 不可用", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000), 12, 0), estimatedMinutes: 120 });
    const r = allocateStudyCapacity({
      assignments: [a],
      studyBlocks: noBlocks,
      freeSlots: [slot(1, "18:00", "21:00")], // 明天 18:00 之后（DDL 明天 12:00）
      fromDate: date(0),
      toDate: date(1),
      now: NOW,
    });
    const t = r.tasks[0];
    expect(t.allocatedMinutes).toBe(0);
    expect(t.shortfallMinutes).toBe(120);
    // 池子原样保留
    expect(r.freeMinutesInWindow).toBe(180);
    expect(r.unusedFreeMinutes).toBe(180);
  });

  it("priority tie + stable id tie-break：同 Deadline 同 Priority → id localeCompare 稳定", () => {
    const mk2 = (id: string) => mk(id, { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 60, priority: "medium" });
    const tasks = [mk2("z-task"), mk2("a-task"), mk2("m-task")];
    const r = allocateStudyCapacity({
      assignments: tasks, // 故意乱序输入
      studyBlocks: noBlocks,
      freeSlots: [slot(1, "19:00", "20:30")], // 90
      fromDate: date(0),
      toDate: date(1),
      now: NOW,
    });
    // 只有 90min，3 个任务各需 60：按 id 排序 a-task 完整 60，m-task 30/shortfall 30，z-task 0/shortfall 60
    const order = r.tasks.map((t) => t.assignmentId);
    expect(order).toEqual(["a-task", "m-task", "z-task"]);
    expect(r.tasks[0].allocatedMinutes).toBe(60);
    expect(r.tasks[0].completeCoverage).toBe(true);
    expect(r.tasks[1].allocatedMinutes).toBe(30);
    expect(r.tasks[1].shortfallMinutes).toBe(30);
    expect(r.tasks[1].completeCoverage).toBe(false);
    expect(r.tasks[2].allocatedMinutes).toBe(0);
    expect(r.tasks[2].shortfallMinutes).toBe(60);
  });

  it("deadline 早于 priority：urgent 任务不能跨更早 deadline 抢容量", () => {
    // a2 urgent 但 deadline 晚；a1 medium 但 deadline 早
    const a1 = mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 60, priority: "medium" });
    const a2 = mk("a2", { ddl: iso(new Date(NOW.getTime() + 2 * 86400000)), estimatedMinutes: 120, priority: "urgent" });
    const r = allocateStudyCapacity({
      assignments: [a2, a1], // 乱序输入
      studyBlocks: noBlocks,
      freeSlots: [slot(1, "19:00", "20:00")], // 60（只有 deadline 更早的 a1 可用）
      fromDate: date(0),
      toDate: date(2),
      now: NOW,
    });
    const ta1 = r.tasks.find((t) => t.assignmentId === "a1")!;
    expect(ta1.allocatedMinutes).toBe(60);
    expect(ta1.completeCoverage).toBe(true);
    const ta2 = r.tasks.find((t) => t.assignmentId === "a2")!;
    expect(ta2.allocatedMinutes).toBe(0);
  });

  it("projected blocks：30–90min 块，仅供 forecast", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 180 });
    const r = allocateStudyCapacity({
      assignments: [a],
      studyBlocks: noBlocks,
      freeSlots: [slot(1, "18:00", "21:00")], // 180
      fromDate: date(0),
      toDate: date(1),
      now: NOW,
    });
    const t = r.tasks[0];
    expect(t.projectedBlocks.length).toBe(2); // 90 + 90
    for (const b of t.projectedBlocks) {
      expect(b.minutes).toBeGreaterThanOrEqual(30);
      expect(b.minutes).toBeLessThanOrEqual(90);
    }
    expect(t.allocatedMinutes).toBe(180);
  });
});
