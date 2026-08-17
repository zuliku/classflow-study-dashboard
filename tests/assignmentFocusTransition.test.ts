import { describe, it, expect } from "vitest";
import { FocusSession } from "@/types";
import {
  ObservedAssignmentFocus,
  reconcileObservedAssignmentFocus,
} from "@/lib/focus/assignmentFocusTransition";

const T0 = 1_000_000;

function mk(patch: Partial<FocusSession>): FocusSession {
  return {
    id: "f1",
    plannedMinutes: 30,
    startedAt: T0,
    accumulatedActiveMs: 0,
    status: "running",
    source: "manual",
    createdAt: T0,
    updatedAt: T0,
    ...patch,
  };
}

const runningA = () => mk({ id: "fA", assignmentId: "a1", status: "running" });
const pausedA = () => mk({ id: "fA", assignmentId: "a1", status: "paused", activeStartedAt: undefined });
const completedA = () =>
  mk({ id: "fA", assignmentId: "a1", status: "completed", endedAt: T0 + 100, actualActiveMs: 60_000 });
const runningB = () => mk({ id: "fB", assignmentId: "a2", status: "running" });
const courseOnly = () => mk({ id: "fC", assignmentId: undefined, courseId: "c1", status: "running" });
const unbound = () => mk({ id: "fU", assignmentId: undefined, courseId: undefined, status: "running" });

describe("reconcileObservedAssignmentFocus", () => {
  it("1. A current + A running → arm observed {a1, fA}", () => {
    const r = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: null,
      focusSessions: [runningA()],
    });
    expect(r.nextObserved).toEqual({ assignmentId: "a1", sessionId: "fA" });
    expect(r.completedSessionId).toBeNull();
  });

  it("2. A current + A 已完成（已 armed）→ completedSessionId = fA，disarm", () => {
    const r = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: { assignmentId: "a1", sessionId: "fA" },
      focusSessions: [completedA()],
    });
    expect(r.completedSessionId).toBe("fA");
    expect(r.nextObserved).toBeNull();
  });

  it("3. B current + A running → 不 arm（其他任务不观察）", () => {
    const r = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a2",
      observed: null,
      focusSessions: [runningA()],
    });
    expect(r.nextObserved).toBeNull();
    expect(r.completedSessionId).toBeNull();
  });

  it("4. B current + A completes（从未 armed）→ 无 follow-up", () => {
    const r = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a2",
      observed: null,
      focusSessions: [completedA()],
    });
    expect(r.completedSessionId).toBeNull();
    expect(r.nextObserved).toBeNull();
  });

  it("5. KILLER：A running → A→B → A completes → B 无 follow-up", () => {
    // A 上 armed
    const armed = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: null,
      focusSessions: [runningA()],
    }).nextObserved!;
    expect(armed).toEqual({ assignmentId: "a1", sessionId: "fA" });
    // A→B：disarm，不产生 follow-up
    const switched = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a2",
      observed: armed,
      focusSessions: [runningA()],
    });
    expect(switched.nextObserved).toBeNull();
    expect(switched.completedSessionId).toBeNull();
    // A completes：B 保持干净
    const afterComplete = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a2",
      observed: switched.nextObserved,
      focusSessions: [completedA()],
    });
    expect(afterComplete.completedSessionId).toBeNull();
    expect(afterComplete.nextObserved).toBeNull();
  });

  it("6. A running → A→B→A（仍 active）→ re-arm → A completes → follow-up A", () => {
    const armed = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: null,
      focusSessions: [runningA()],
    }).nextObserved!;
    const switched = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a2",
      observed: armed,
      focusSessions: [runningA()],
    });
    expect(switched.nextObserved).toBeNull();
    // B→A：重新 arm 同一 active session
    const rearmed = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: switched.nextObserved,
      focusSessions: [runningA()],
    });
    expect(rearmed.nextObserved).toEqual({ assignmentId: "a1", sessionId: "fA" });
    expect(rearmed.completedSessionId).toBeNull();
    // A completes → follow-up A
    const done = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: rearmed.nextObserved,
      focusSessions: [completedA()],
    });
    expect(done.completedSessionId).toBe("fA");
    expect(done.nextObserved).toBeNull();
  });

  it("7. close（currentId=null）→ disarm；之后 A completes → 无 follow-up；reopen 也干净", () => {
    const armed = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: null,
      focusSessions: [runningA()],
    }).nextObserved!;
    const closed = reconcileObservedAssignmentFocus({
      currentAssignmentId: null,
      observed: armed,
      focusSessions: [runningA()],
    });
    expect(closed.nextObserved).toBeNull();
    expect(closed.completedSessionId).toBeNull();
    // 关闭后 A completes
    const whileClosed = reconcileObservedAssignmentFocus({
      currentAssignmentId: null,
      observed: null,
      focusSessions: [completedA()],
    });
    expect(whileClosed.completedSessionId).toBeNull();
    // 重新打开 A：completed 非 active → 无观察、无 follow-up
    const reopened = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: null,
      focusSessions: [completedA()],
    });
    expect(reopened.completedSessionId).toBeNull();
    expect(reopened.nextObserved).toBeNull();
  });

  it("8. course-only focus completes while B open → 无 follow-up", () => {
    const r = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a2",
      observed: null,
      focusSessions: [
        mk({ id: "fC", assignmentId: undefined, courseId: "c1", status: "completed", endedAt: T0, actualActiveMs: 60_000 }),
      ],
    });
    expect(r.completedSessionId).toBeNull();
    expect(r.nextObserved).toBeNull();
    // 即使 course-only 一直 running（B 上从未 armed）→ 完成时也不产生
    const whileRunning = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a2",
      observed: null,
      focusSessions: [courseOnly()],
    });
    expect(whileRunning.nextObserved).toBeNull();
    const after = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a2",
      observed: whileRunning.nextObserved,
      focusSessions: [completedA()],
    });
    expect(after.completedSessionId).toBeNull();
  });

  it("9. unbound focus completes → 无 follow-up", () => {
    const r = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: null,
      focusSessions: [unbound()],
    });
    expect(r.nextObserved).toBeNull();
    const done = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: null,
      focusSessions: [
        mk({ id: "fU", assignmentId: undefined, courseId: undefined, status: "completed", endedAt: T0, actualActiveMs: 60_000 }),
      ],
    });
    expect(done.completedSessionId).toBeNull();
  });

  it("paused 也是 active：A paused → arm；pause→complete 结算", () => {
    const r = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: null,
      focusSessions: [pausedA()],
    });
    expect(r.nextObserved).toEqual({ assignmentId: "a1", sessionId: "fA" });
    const done = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: r.nextObserved,
      focusSessions: [completedA()],
    });
    expect(done.completedSessionId).toBe("fA");
  });

  it("manual finish 后 direct set + observer 幂等：已 disarm，不再重复 emit", () => {
    const r1 = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: { assignmentId: "a1", sessionId: "fA" },
      focusSessions: [completedA()],
    });
    expect(r1.completedSessionId).toBe("fA");
    // 后续 reconcile（同一 completed session，observed 已 null）→ 不再 emit
    const r2 = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: r1.nextObserved,
      focusSessions: [completedA()],
    });
    expect(r2.completedSessionId).toBeNull();
  });

  it("observed session 从快照消失（恢复/备份替换）→ disarm，不猜 follow-up", () => {
    const r = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: { assignmentId: "a1", sessionId: "fA" },
      focusSessions: [],
    });
    expect(r.nextObserved).toBeNull();
    expect(r.completedSessionId).toBeNull();
  });

  it("A current + B 的 active → 不 arm；B completes 无 follow-up；随后 A 自己 start → 正常 arm", () => {
    const r1 = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: null,
      focusSessions: [runningB()],
    });
    expect(r1.nextObserved).toBeNull();
    const r2 = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: null,
      focusSessions: [
        mk({ id: "fB", assignmentId: "a2", status: "completed", endedAt: T0, actualActiveMs: 60_000 }),
      ],
    });
    expect(r2.completedSessionId).toBeNull();
    const r3 = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: null,
      focusSessions: [runningA()],
    });
    expect(r3.nextObserved).toEqual({ assignmentId: "a1", sessionId: "fA" });
  });

  it("observed 保持同一 running session → 幂等不变化（不重复 arm）", () => {
    const armed = { assignmentId: "a1", sessionId: "fA" } satisfies ObservedAssignmentFocus;
    const r = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: armed,
      focusSessions: [runningA()],
    });
    expect(r.nextObserved).toBe(armed);
    expect(r.completedSessionId).toBeNull();
  });

  it("emitted 后同一实体无 active（completed 静止）→ 保持干净", () => {
    const r = reconcileObservedAssignmentFocus({
      currentAssignmentId: "a1",
      observed: null,
      focusSessions: [completedA()],
    });
    expect(r.completedSessionId).toBeNull();
    expect(r.nextObserved).toBeNull();
  });
});
