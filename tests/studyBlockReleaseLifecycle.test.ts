import { describe, it, expect } from "vitest";
import {
  isStudyBlockPlanningActive,
  isStudyBlockReleased,
  isStudyBlockEnded,
  didAssignmentLosePlanningEligibility,
  releaseFutureStudyBlocksForAssignment,
  reconcileTerminalAssignmentStudyBlocks,
} from "@/lib/planning/studyBlockLifecycle";
import { findFreeTime } from "@/lib/planning/freeTime";
import { getScheduledMinutesBeforeDeadline } from "@/lib/planning/taskPlanningFacts";
import { analyzeStudyBlockPlacement } from "@/lib/timeline/studyBlockPlacement";
import { deriveUnscheduledAssignments } from "@/lib/timeline/deriveTimelineItems";
import { proposeStudyRebalance } from "@/lib/planning/studyRebalance";
import { Assignment, StudyBlock } from "@/types";

/**
 * Workflow UX V15 —— StudyBlock Release Lifecycle（pure layer）：
 * planningState undefined = active / "released" = 已释放；
 * end-exclusive 历史边界；immutable/idempotent；Free Time / Placement /
 * scheduledMinutes / Shelf / Rebalance 全部尊重 released。
 */

const NOW = new Date("2026-03-10T15:00:00").getTime();
const SEMESTER = { id: "s", name: "x", startDate: "2026-03-09", totalWeeks: 16 };

const mk = (over: Partial<StudyBlock> & { id: string }): StudyBlock =>
  ({
    title: `计划 ${over.id}`,
    date: "2026-03-10",
    startTime: "14:00",
    endTime: "15:00",
    ...over,
  }) as StudyBlock;

describe("lifecycle helpers", () => {
  it("undefined planningState → active；released → inactive", () => {
    expect(isStudyBlockPlanningActive(mk({ id: "b1" }))).toBe(true);
    expect(isStudyBlockPlanningActive(mk({ id: "b1", planningState: "released" }))).toBe(false);
    expect(isStudyBlockReleased(mk({ id: "b1", planningState: "released" }))).toBe(true);
  });

  it("end-exclusive 边界：end === now → historical；past → ended；future/current 未结束", () => {
    // 14:00–15:00，now=15:00 → 已结束
    expect(isStudyBlockEnded(mk({ id: "e1" }), NOW)).toBe(true);
    // past
    expect(isStudyBlockEnded(mk({ id: "e2", startTime: "09:00", endTime: "10:00" }), NOW)).toBe(true);
    // current unfinished（14:30–15:30）
    expect(isStudyBlockEnded(mk({ id: "e3", startTime: "14:30", endTime: "15:30" }), NOW)).toBe(false);
    // future
    expect(isStudyBlockEnded(mk({ id: "e4", startTime: "16:00", endTime: "17:00" }), NOW)).toBe(false);
  });

  it("didAssignmentLosePlanningEligibility：eligible→terminal 全矩阵", () => {
    expect(didAssignmentLosePlanningEligibility("todo", "submitted")).toBe(true);
    expect(didAssignmentLosePlanningEligibility("doing", "submitted")).toBe(true);
    expect(didAssignmentLosePlanningEligibility("todo", "completed")).toBe(true);
    expect(didAssignmentLosePlanningEligibility("doing", "completed")).toBe(true);
    // terminal → terminal 不重复
    expect(didAssignmentLosePlanningEligibility("submitted", "completed")).toBe(false);
    // terminal → active 不触发 release（也不恢复）
    expect(didAssignmentLosePlanningEligibility("completed", "todo")).toBe(false);
    expect(didAssignmentLosePlanningEligibility("submitted", "doing")).toBe(false);
    // active 内变化
    expect(didAssignmentLosePlanningEligibility("todo", "doing")).toBe(false);
  });
});

describe("releaseFutureStudyBlocksForAssignment", () => {
  it("future / current unfinished → release；past 与其它任务与 standalone 不动；幂等且顺序无关", () => {
    const blocks = [
      mk({ id: "past", startTime: "09:00", endTime: "10:00", assignmentId: "a1" }),
      mk({ id: "current", startTime: "14:30", endTime: "15:30", assignmentId: "a1" }),
      mk({ id: "future", startTime: "16:00", endTime: "17:00", assignmentId: "a1" }),
      mk({ id: "other", startTime: "16:00", endTime: "17:00", assignmentId: "a2" }),
      mk({ id: "standalone" }),
      mk({ id: "already", startTime: "18:00", endTime: "19:00", assignmentId: "a1", planningState: "released" }),
    ];
    const r1 = releaseFutureStudyBlocksForAssignment({ studyBlocks: blocks, assignmentId: "a1", now: NOW });
    const ids = r1.releasedIds.sort();
    expect(ids).toEqual(["current", "future"]);
    expect(r1.studyBlocks.find((b) => b.id === "past")?.planningState).toBeUndefined();
    expect(r1.studyBlocks.find((b) => b.id === "other")?.planningState).toBeUndefined();
    expect(r1.studyBlocks.find((b) => b.id === "standalone")?.planningState).toBeUndefined();
    // immutable：原数组元素未变
    expect(blocks.find((b) => b.id === "future")?.planningState).toBeUndefined();
    // idempotent
    const r2 = releaseFutureStudyBlocksForAssignment({ studyBlocks: r1.studyBlocks, assignmentId: "a1", now: NOW });
    expect(r2.releasedIds).toEqual([]);
    // 输入顺序无关
    const r3 = releaseFutureStudyBlocksForAssignment({ studyBlocks: [...blocks].reverse(), assignmentId: "a1", now: NOW });
    expect([...r3.releasedIds].sort()).toEqual(ids);
  });
});

describe("reconcileTerminalAssignmentStudyBlocks（legacy hydrate）", () => {
  it("terminal parent + 未来 block + scheduled reminder → 幂等修复；past 保持；active parent 不触碰", () => {
    const assignments = [
      { id: "a-done", status: "completed" } as Assignment,
      { id: "a-active", status: "todo" } as Assignment,
    ];
    const studyBlocks = [
      mk({ id: "legacy-future", startTime: "16:00", endTime: "17:00", assignmentId: "a-done" }),
      mk({ id: "legacy-past", startTime: "09:00", endTime: "10:00", assignmentId: "a-done" }),
      mk({ id: "active-b", startTime: "16:00", endTime: "17:00", assignmentId: "a-active" }),
    ];
    const reminders = [
      { id: "r-sch", targetType: "studyBlock", targetId: "legacy-future", status: "scheduled" },
      { id: "r-fired", targetType: "studyBlock", targetId: "legacy-past", status: "fired" },
    ] as unknown as never[];
    const r = reconcileTerminalAssignmentStudyBlocks({
      assignments,
      studyBlocks,
      reminders: reminders as never[],
      now: NOW,
    });
    expect(r.studyBlocks.find((b) => b.id === "legacy-future")?.planningState).toBe("released");
    expect(r.studyBlocks.find((b) => b.id === "legacy-past")?.planningState).toBeUndefined();
    expect(r.studyBlocks.find((b) => b.id === "active-b")?.planningState).toBeUndefined();
    expect((r.reminders as unknown as { id: string }[]).some((x) => x.id === "r-sch")).toBe(false);
    expect((r.reminders as unknown as { id: string }[]).some((x) => x.id === "r-fired")).toBe(true);
    // 幂等
    const r2 = reconcileTerminalAssignmentStudyBlocks({
      assignments,
      studyBlocks: r.studyBlocks,
      reminders: r.reminders,
      now: NOW,
    });
    expect(r2.studyBlocks).toBe(r.studyBlocks);
    expect(r2.reminders).toBe(r.reminders);
  });

  it("非法/缺失 planningState 视为 active（不把任意值解释为 released）", () => {
    const assignments = [{ id: "a-todo", status: "todo" } as Assignment];
    const studyBlocks = [mk({ id: "weird", planningState: "whatever" as unknown as "released" })];
    const r = reconcileTerminalAssignmentStudyBlocks({ assignments, studyBlocks, reminders: [], now: NOW });
    expect(r.studyBlocks[0]).toBe(studyBlocks[0]); // untouched
  });
});

describe("Free Time / Placement / scheduledMinutes 尊重 released", () => {
  it("P0：released 10:00–11:00 重新成为可用容量；active/standalone 仍 busy", () => {
    const slots = findFreeTime({
      start: new Date("2026-03-10T08:00:00"),
      now: new Date("2026-03-10T08:00:00"),
      end: new Date("2026-03-10T21:00:00"),
      semester: SEMESTER,
      currentSemesterWeek: 1,
      schedules: [],
      calendarMarks: [],
      studyBlocks: [
        mk({ id: "rel", startTime: "10:00", endTime: "11:00", planningState: "released" }),
        mk({ id: "act", startTime: "13:00", endTime: "14:00" }),
      ],
    });
    const day = slots.filter((s) => s.date === "2026-03-10");
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    // released 时段重新可用：存在 slot 覆盖 10:00–11:00
    const covers10 = day.some((s) => toMin(s.startTime) <= 600 && toMin(s.endTime) >= 660);
    expect(covers10).toBe(true);
    // active block 仍 busy：没有任何 slot 完整覆盖 13:00–14:00
    const covers13 = day.some((s) => toMin(s.startTime) <= 780 && toMin(s.endTime) >= 840);
    expect(covers13).toBe(false);
  });

  it("Placement：released 同时间不构成 hard conflict；active 仍 hard", () => {
    const state = {
      schedules: [],
      courses: [],
      currentSemesterWeek: 1,
      studyBlocks: [
        mk({ id: "rel-a", startTime: "14:00", endTime: "15:00", planningState: "released" }),
      ],
    };
    const okPlacement = analyzeStudyBlockPlacement({ date: "2026-03-10", startTime: "14:30", endTime: "15:30" }, state as never);
    expect(okPlacement.hardConflict).toBeNull();

    const conflictState = {
      ...state,
      studyBlocks: [mk({ id: "act-a", startTime: "14:00", endTime: "15:00" })],
    };
    const conflict = analyzeStudyBlockPlacement({ date: "2026-03-10", startTime: "14:30", endTime: "15:30" }, conflictState as never);
    expect(conflict.hardConflict?.title).toBe("计划 act-a");
  });

  it("getScheduledMinutesBeforeDeadline 不计 released", () => {
    const a = { id: "a-x", ddl: "2026-03-12T23:59:00" } as Assignment;
    const mins = getScheduledMinutesBeforeDeadline(a, [
      mk({ id: "act", startTime: "10:00", endTime: "11:00", assignmentId: "a-x" }),
      mk({ id: "rel", startTime: "12:00", endTime: "13:00", assignmentId: "a-x", planningState: "released" }),
    ]);
    expect(mins).toBe(60);
  });
});

describe("Unscheduled Shelf：released 不算已安排", () => {
  it("只有 released block 的 todo 任务重新出现在 Shelf；active block 继续隐藏；completed 恒不出现", () => {
    const out = deriveUnscheduledAssignments({
      assignments: [
        { id: "a-rel-only", courseId: "c", title: "仅释放", description: "", ddl: "", priority: "medium", status: "todo", progress: 0, tags: [] },
        { id: "a-active", courseId: "c", title: "有活跃计划", description: "", ddl: "", priority: "medium", status: "todo", progress: 0, tags: [] },
        { id: "a-terminal", courseId: "c", title: "已结束", description: "", ddl: "", priority: "medium", status: "completed", progress: 100, tags: [] },
      ],
      studyBlocks: [
        mk({ id: "b-rel", assignmentId: "a-rel-only", planningState: "released" }),
        mk({ id: "b-act", assignmentId: "a-active" }),
        mk({ id: "b-term", assignmentId: "a-terminal" }),
      ],
    });
    expect(out.map((a) => a.id)).toEqual(["a-rel-only"]);
  });
});

describe("Rebalance：released 不参与 candidate / FreeTime", () => {
  it("released kiro block 不是 move candidate；不占 shortfall busy", () => {
    const proposal = proposeStudyRebalance({
      assignments: [{ id: "a-k", courseId: "", title: "Kiro 任务", status: "todo", progress: 0, estimatedMinutes: 60, tags: [], description: "" } as Assignment],
      studyBlocks: [
        mk({ id: "rel-k", source: "kiro", startTime: "16:00", endTime: "17:00", assignmentId: "a-k", planningState: "released" }),
      ],
      schedules: [],
      calendarMarks: [],
      semester: SEMESTER,
      currentSemesterWeek: 1,
      now: new Date("2026-03-10T10:00:00"),
      horizonDays: 3,
    });
    expect(proposal.moves).toHaveLength(0);
    void proposal;
  });
});
