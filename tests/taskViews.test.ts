import { describe, it, expect } from "vitest";
import { Assignment, CalendarMark, CourseSchedule, Semester, StudyBlock } from "@/types";
import {
  deriveTaskWorkspace,
  buildTaskWorkspaceMeta,
  TASK_WORKSPACE_VIEWS,
  TaskWorkspaceView,
  TaskHealthPlanningInput,
} from "@/lib/tasks/taskViews";

// 2026-08-10 周一 12:00（与 fixture 无关，纯静态）
const NOW = new Date(2026, 7, 10, 12, 0, 0);
const iso = (d: Date, hour = 23, minute = 59) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
const date = (offset: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function mk(id: string, patch: Partial<Assignment>): Assignment {
  return {
    id,
    courseId: "c1",
    title: id,
    description: "",
    priority: "medium",
    status: "todo",
    progress: 0,
    tags: [],
    ...patch,
  };
}

function block(id: string, assignmentId: string, offset: number, start: string, end: string): StudyBlock {
  return { id, title: id, date: date(offset), startTime: start, endTime: end, assignmentId };
}

const TASKS: Assignment[] = [
  mk("overdue", { status: "doing", ddl: iso(new Date(2026, 7, 9)), priority: "urgent" }),
  mk("deadline-today", { ddl: iso(new Date(2026, 7, 10), 23, 59) }),
  mk("scheduled-today", { estimatedMinutes: 60 }),
  mk("doing", { status: "doing", ddl: iso(new Date(2026, 7, 20)) }),
  mk("urgent-soon", { priority: "urgent", ddl: iso(new Date(2026, 7, 12)) }),
  mk("upcoming-far", { ddl: iso(new Date(2026, 7, 30)) }),
  mk("no-ddl", {}),
  mk("archived-submitted", { status: "submitted", ddl: iso(new Date(2026, 7, 1)) }),
  mk("archived-completed", { status: "completed" }),
];

const BLOCKS: StudyBlock[] = [
  block("b1", "scheduled-today", 0, "19:00", "20:30"),
  block("b2", "scheduled-today", 1, "19:00", "20:00"),
  block("b3", "scheduled-today", 2, "09:00", "09:30"),
  block("b4", "no-ddl", 0, "12:00", "12:30"),
  block("b5", "doing", 1, "10:00", "10:00"), // 非法（0 分钟）忽略
];

describe("deriveTaskWorkspace", () => {
  it("focus 排序：overdue > 今天截止 > 今天安排 > doing > urgent 3 天内（无 DDL 但今天有安排也入选）", () => {
    const { items } = deriveTaskWorkspace(TASKS, BLOCKS, "focus", NOW);
    expect(items.map((i) => i.task.id)).toEqual([
      "overdue",
      "deadline-today",
      "scheduled-today",
      "no-ddl",
      "doing",
      "urgent-soon",
    ]);
  });

  it("today = 今天截止 或 今天有 StudyBlock（Do Date ≠ Due Date）", () => {
    const { items } = deriveTaskWorkspace(TASKS, BLOCKS, "today", NOW);
    const ids = items.map((i) => i.task.id).sort();
    expect(ids).toEqual(["deadline-today", "no-ddl", "scheduled-today"]);
  });

  it("upcoming 只含今天结束之后的 DDL，升序排列", () => {
    const { items } = deriveTaskWorkspace(TASKS, BLOCKS, "upcoming", NOW);
    expect(items.map((i) => i.task.id)).toEqual(["urgent-soon", "doing", "upcoming-far"]);
  });

  it("unscheduled = active 且无任何 StudyBlock（不要求无 DDL；逾期未安排也在列）", () => {
    const { items } = deriveTaskWorkspace(TASKS, BLOCKS, "unscheduled", NOW);
    const ids = items.map((i) => i.task.id).sort();
    expect(ids).toEqual(["deadline-today", "overdue", "upcoming-far", "urgent-soon"]);
  });

  it("all 包含无 DDL 任务，active 在前 archive 在后", () => {
    const { items } = deriveTaskWorkspace(TASKS, BLOCKS, "all", NOW);
    expect(items.map((i) => i.task.id)).toContain("no-ddl");
    const active = items.filter((i) => !["archived-submitted", "archived-completed"].includes(i.task.id));
    const archived = items.filter((i) => ["archived-submitted", "archived-completed"].includes(i.task.id));
    expect(active.length + archived.length).toBe(9);
    // archive 都排在 active 之后
    expect(items[items.length - 2].task.id).toBe("archived-submitted");
    expect(items[items.length - 1].task.id).toBe("archived-completed");
  });

  it("archive = submitted + completed", () => {
    const { items } = deriveTaskWorkspace(TASKS, BLOCKS, "archive", NOW);
    expect(items.map((i) => i.task.id).sort()).toEqual(["archived-completed", "archived-submitted"]);
  });

  it("counts 覆盖全部六个视图", () => {
    const { counts } = deriveTaskWorkspace(TASKS, BLOCKS, "focus", NOW);
    expect(Object.keys(counts).sort()).toEqual(TASK_WORKSPACE_VIEWS.map((v) => v.id).sort());
    expect(counts.archive).toBe(2);
    expect(counts.all).toBe(9);
    expect(counts.today).toBe(3);
  });
});

describe("buildTaskWorkspaceMeta", () => {
  it("scheduledMinutes 多 block 累计，非法 block 忽略", () => {
    const meta = buildTaskWorkspaceMeta(TASKS[3] /* doing */, BLOCKS, NOW);
    expect(meta.scheduledMinutes).toBe(0); // 非法 block 不计
    const meta2 = buildTaskWorkspaceMeta(TASKS[2] /* scheduled-today */, BLOCKS, NOW);
    expect(meta2.scheduledMinutes).toBe(90 + 60 + 30);
    expect(meta2.studyBlockCount).toBe(3);
    expect(meta2.scheduledToday).toBe(true);
  });

  it("overdue 仅对未完成任务为 true", () => {
    const overdue = buildTaskWorkspaceMeta(TASKS[0], BLOCKS, NOW);
    expect(overdue.overdue).toBe(true);
    const completed = buildTaskWorkspaceMeta(TASKS[8], BLOCKS, NOW);
    expect(completed.overdue).toBe(false);
  });

  it("deadlineToday / hasDeadline 正确", () => {
    const meta = buildTaskWorkspaceMeta(TASKS[1], BLOCKS, NOW);
    expect(meta.hasDeadline).toBe(true);
    expect(meta.deadlineToday).toBe(true);
    const noDdl = buildTaskWorkspaceMeta(TASKS[6], BLOCKS, NOW);
    expect(noDdl.hasDeadline).toBe(false);
    expect(noDdl.deadlineToday).toBe(false);
  });

  it("空数据不崩溃", () => {
    const { items, counts } = deriveTaskWorkspace([], [], "focus", NOW);
    expect(items).toEqual([]);
    expect(counts.all).toBe(0);
  });
});

describe("at-risk 视图（Deadline Health 驱动）", () => {
  const SEMESTER: Semester = { id: "s", name: "S", startDate: date(0), totalWeeks: 16 };
  // 每天 08:00-21:00 全占课程 → 截止前可用时间为 0
  const fullSchedules: CourseSchedule[] = [1, 2, 3, 4, 5, 6, 7].map((dow) => ({
    id: `s${dow}`,
    courseId: "c1",
    dayOfWeek: dow,
    startTime: "08:00",
    endTime: "21:00",
    location: "",
    weeks: "1-16周",
  }));
  const planning: TaskHealthPlanningInput = {
    schedules: fullSchedules,
    calendarMarks: [],
    semester: SEMESTER,
    currentSemesterWeek: 1,
  };

  it("planning 提供时包含 at-risk / overdue；无 planning 时为空", () => {
    const tasks = [
      mk("done", { ddl: iso(new Date(2026, 7, 12), 23, 59), estimatedMinutes: 60, status: "completed" }),
      mk("noddl", { estimatedMinutes: 60 }), // unknown（missing_deadline）
      mk("noestimate", { ddl: iso(new Date(2026, 7, 12), 23, 59) }), // unknown（missing_estimate）
      mk("atrisk", { ddl: iso(new Date(2026, 7, 12), 23, 59), estimatedMinutes: 120 }), // free=0 → at-risk
      mk("unsched-safe", { ddl: iso(new Date(2026, 7, 12), 23, 59), estimatedMinutes: 30 }), // free=0 < remaining 30 → 也 at-risk
    ];
    const withPlanning = deriveTaskWorkspace(tasks, [], "at-risk", NOW, planning);
    expect(withPlanning.items.map((i) => i.task.id).sort()).toEqual(["atrisk", "unsched-safe"]);
    expect(withPlanning.counts["at-risk"]).toBe(2);

    const withoutPlanning = deriveTaskWorkspace(tasks, [], "at-risk", NOW);
    expect(withoutPlanning.items).toEqual([]);
    expect(withoutPlanning.counts["at-risk"]).toBe(0);
  });

  it("overdue 排在 at-risk 之前；内部 DDL 早优先", () => {
    const tasks = [
      mk("later-first", { ddl: iso(new Date(2026, 7, 13), 23, 59), estimatedMinutes: 60 }),
      mk("overdue", { status: "doing", ddl: iso(new Date(2026, 7, 9), 23, 59), estimatedMinutes: 60 }),
      mk("earlier-first", { ddl: iso(new Date(2026, 7, 12), 23, 59), estimatedMinutes: 60 }),
    ];
    const { items } = deriveTaskWorkspace(tasks, [], "at-risk", NOW, planning);
    expect(items.map((i) => i.task.id)).toEqual(["overdue", "earlier-first", "later-first"]);
  });

  it("Part B：at-risk 并入 Focus（overdue → at-risk → 今天截止 → 今天安排 → doing → urgent 临近）", () => {
    const tasks = [
      mk("overdue-a", { status: "doing", ddl: iso(new Date(2026, 7, 9), 23, 59), estimatedMinutes: 60 }),
      mk("atrisk-a", { ddl: iso(new Date(2026, 7, 12), 23, 59), estimatedMinutes: 120 }),
      mk("atrisk-b", { ddl: iso(new Date(2026, 7, 13), 23, 59), estimatedMinutes: 120 }),
      mk("today-safe", { ddl: iso(new Date(2026, 7, 10), 23, 59), estimatedMinutes: 30 }),
      mk("doing-a", { status: "doing", ddl: iso(new Date(2026, 7, 20), 23, 59), estimatedMinutes: 30 }),
      mk("urgent-safe", { priority: "urgent", ddl: iso(new Date(2026, 7, 12), 23, 59), estimatedMinutes: 30 }),
      mk("far-safe", { ddl: iso(new Date(2026, 7, 30), 23, 59), estimatedMinutes: 30 }),
    ];
    const blocks: StudyBlock[] = [
      block("pb1", "today-safe", 0, "18:00", "18:30"),
      block("pb2", "doing-a", 5, "10:00", "10:30"),
      block("pb3", "urgent-safe", 1, "09:00", "09:30"),
      block("pb4", "far-safe", 8, "09:00", "09:30"),
    ];
    const { items, counts } = deriveTaskWorkspace(tasks, blocks, "focus", NOW, planning);
    expect(items.map((i) => i.task.id)).toEqual([
      "overdue-a",
      "atrisk-a",
      "atrisk-b",
      "today-safe",
      "doing-a",
      "urgent-safe",
    ]);
    // 安排充足（scheduled ≥ estimated）的远期任务不进入 Focus
    expect(items.map((i) => i.task.id)).not.toContain("far-safe");
    // at-risk Domain 仍可派生（overdue + 2 个 at-risk）
    expect(counts["at-risk"]).toBe(3);
  });

  it("Part B：无 planning 时 focus 不含 at-risk 层级（Health 不可判定）", () => {
    const tasks = [
      mk("overdue-a", { status: "doing", ddl: iso(new Date(2026, 7, 9), 23, 59), estimatedMinutes: 60 }),
      mk("atrisk-a", { status: "doing", ddl: iso(new Date(2026, 7, 12), 23, 59), estimatedMinutes: 120 }),
      mk("today-safe", { ddl: iso(new Date(2026, 7, 10), 23, 59), estimatedMinutes: 30 }),
    ];
    const { items } = deriveTaskWorkspace(tasks, [], "focus", NOW);
    // atrisk-a 无 health → 不因风险提前；按 逾期 → 今天截止 → doing 排序
    expect(items.map((i) => i.task.id)).toEqual(["overdue-a", "today-safe", "atrisk-a"]);
  });
});
