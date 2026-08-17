import { describe, it, expect } from "vitest";
import { FocusSession } from "@/types";
import { deriveAssignmentFocusView } from "@/lib/focus/assignmentFocusView";
import { formatFocusClock, formatFocusDurationMs } from "@/lib/focus/focusView";

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

describe("deriveAssignmentFocusView", () => {
  it("无任何会话 → active/relation 为 null，无统计", () => {
    const v = deriveAssignmentFocusView([], "a1");
    expect(v.active).toBeNull();
    expect(v.relation).toBeNull();
    expect(v.completedCount).toBe(0);
    expect(v.totalCompletedMs).toBe(0);
    expect(v.lastCompleted).toBeNull();
  });

  it("当前任务 running → relation=current，active 指向该会话", () => {
    const s = mk({ id: "f1", assignmentId: "a1", status: "running" });
    const v = deriveAssignmentFocusView([s], "a1");
    expect(v.active).toBe(s);
    expect(v.relation).toBe("current");
    expect(v.otherLabel).toBeNull();
  });

  it("当前任务 paused → relation=current（暂停也是 active）", () => {
    const s = mk({ id: "f1", assignmentId: "a1", status: "paused", activeStartedAt: undefined });
    const v = deriveAssignmentFocusView([s], "a1");
    expect(v.relation).toBe("current");
    expect(v.active).toBe(s);
  });

  it("其他任务 running → relation=other，otherLabel 用 assignmentTitleSnapshot", () => {
    const s = mk({
      id: "f2",
      assignmentId: "a2",
      status: "running",
      assignmentTitleSnapshot: "任务B",
      courseNameSnapshot: "课程X",
    });
    const v = deriveAssignmentFocusView([s], "a1");
    expect(v.relation).toBe("other");
    expect(v.otherLabel).toBe("任务B");
  });

  it("other 且无 assignmentTitleSnapshot → 退到 courseNameSnapshot", () => {
    const s = mk({ id: "f2", assignmentId: "a2", status: "running", courseNameSnapshot: "课程X" });
    const v = deriveAssignmentFocusView([s], "a1");
    expect(v.relation).toBe("other");
    expect(v.otherLabel).toBe("课程X");
  });

  it("other 且仅 course-only（无 assignmentId）→ 关系仍为 other", () => {
    const s = mk({ id: "f2", assignmentId: undefined, courseId: "c1", status: "running" });
    const v = deriveAssignmentFocusView([s], "a1");
    expect(v.relation).toBe("other");
    expect(v.otherLabel).toBeNull();
  });

  it("unbound（无关联）running → 关系为 other（不能算 current）", () => {
    const s = mk({ id: "f2", assignmentId: undefined, courseId: undefined, status: "running" });
    const v = deriveAssignmentFocusView([s], "a1");
    expect(v.relation).toBe("other");
  });

  it("仅当前任务已完成 → 统计真实 actualActiveMs（精确毫秒，不 round 分钟）", () => {
    const s1 = mk({
      id: "f1",
      assignmentId: "a1",
      status: "completed",
      endedAt: T0 + 100,
      actualActiveMs: 25 * 60_000 + 42_000,
    });
    const s2 = mk({
      id: "f2",
      assignmentId: "a1",
      status: "completed",
      endedAt: T0 + 200,
      actualActiveMs: 10 * 60_000,
    });
    const v = deriveAssignmentFocusView([s1, s2], "a1");
    expect(v.completedCount).toBe(2);
    expect(v.totalCompletedMs).toBe(35 * 60_000 + 42_000);
    expect(v.lastCompleted?.id).toBe("f2");
  });

  it("running / paused 不计入统计（不把 plannedMinutes 当已完成）", () => {
    const running = mk({ id: "f1", assignmentId: "a1", status: "running", plannedMinutes: 60 });
    const paused = mk({
      id: "f2",
      assignmentId: "a1",
      status: "paused",
      activeStartedAt: undefined,
      plannedMinutes: 45,
    });
    const v = deriveAssignmentFocusView([running, paused], "a1");
    expect(v.completedCount).toBe(0);
    expect(v.totalCompletedMs).toBe(0);
  });

  it("其他任务/课程/无归属的已完成不混入当前任务统计", () => {
    const mine = mk({
      id: "f1",
      assignmentId: "a1",
      status: "completed",
      endedAt: T0 + 100,
      actualActiveMs: 5 * 60_000,
    });
    const others = [
      mk({ id: "f2", assignmentId: "a2", status: "completed", endedAt: T0, actualActiveMs: 90 * 60_000 }),
      mk({
        id: "f3",
        assignmentId: undefined,
        courseId: "c1",
        status: "completed",
        endedAt: T0,
        actualActiveMs: 90 * 60_000,
      }),
      mk({
        id: "f4",
        assignmentId: undefined,
        courseId: undefined,
        status: "completed",
        endedAt: T0,
        actualActiveMs: 90 * 60_000,
      }),
    ];
    const v = deriveAssignmentFocusView([mine, ...others], "a1");
    expect(v.completedCount).toBe(1);
    expect(v.totalCompletedMs).toBe(5 * 60_000);
  });

  it("completed 但 actualActiveMs 缺失（异常数据）→ 不计入统计", () => {
    const s = mk({ id: "f1", assignmentId: "a1", status: "completed", endedAt: T0 + 100 });
    delete (s as { actualActiveMs?: number }).actualActiveMs;
    const v = deriveAssignmentFocusView([s], "a1");
    expect(v.completedCount).toBe(0);
    expect(v.totalCompletedMs).toBe(0);
  });

  it("current completed 会话不影响 active 关系（关系只看 running|paused）", () => {
    const done = mk({
      id: "f1",
      assignmentId: "a1",
      status: "completed",
      endedAt: T0 + 100,
      actualActiveMs: 3 * 60_000,
    });
    const v = deriveAssignmentFocusView([done], "a1");
    expect(v.relation).toBeNull();
    expect(v.active).toBeNull();
    expect(v.completedCount).toBe(1);
  });

  it("多会话时 active 取第一个 running|paused（Domain 唯一，取首个保守）", () => {
    const s1 = mk({
      id: "f1",
      assignmentId: "a2",
      status: "paused",
      activeStartedAt: undefined,
      assignmentTitleSnapshot: "任务B",
    });
    const s2 = mk({ id: "f2", assignmentId: "a2", status: "running" });
    const v = deriveAssignmentFocusView([s1, s2], "a1");
    expect(v.active?.id).toBe("f1");
    expect(v.relation).toBe("other");
  });

  it("快照/顺序变化不影响派生结果（deterministic）", () => {
    const s = mk({
      id: "f1",
      assignmentId: "a1",
      status: "completed",
      endedAt: T0 + 100,
      actualActiveMs: 7 * 60_000,
    });
    const a = deriveAssignmentFocusView([s], "a1");
    const b = deriveAssignmentFocusView([s], "a1");
    expect(a).toEqual(b);
  });
});

describe("formatFocusDurationMs（V1.1 口径：正数至少 1 分钟，与 Activity 一致）", () => {
  it("0 / 负值 / NaN / Infinity → null", () => {
    expect(formatFocusDurationMs(0)).toBeNull();
    expect(formatFocusDurationMs(-1)).toBeNull();
    expect(formatFocusDurationMs(Number.NaN)).toBeNull();
    expect(formatFocusDurationMs(Number.POSITIVE_INFINITY)).toBeNull();
  });
  it("正数但不足 1 分钟 → 1 分钟（禁止 0 分钟）", () => {
    expect(formatFocusDurationMs(1)).toBe("1 分钟");
    expect(formatFocusDurationMs(20_000)).toBe("1 分钟");
    expect(formatFocusDurationMs(29_000)).toBe("1 分钟");
    expect(formatFocusDurationMs(31_000)).toBe("1 分钟");
    expect(formatFocusDurationMs(89_000)).toBe("1 分钟");
  });
  it("91s → 2 分钟（round）", () => {
    expect(formatFocusDurationMs(91_000)).toBe("2 分钟");
  });
  it("整小时 → N 小时", () => {
    expect(formatFocusDurationMs(60 * 60_000)).toBe("1 小时");
    expect(formatFocusDurationMs(120 * 60_000)).toBe("2 小时");
  });
  it("跨小时 → N 小时 M 分", () => {
    expect(formatFocusDurationMs(90 * 60_000)).toBe("1 小时 30 分");
    expect(formatFocusDurationMs(85 * 60_000 + 30_000)).toBe("1 小时 26 分");
  });
  it("与 Activity 旧口径一致：1/60/90 分钟输出不变", () => {
    expect(formatFocusDurationMs(60_000)).toBe("1 分钟");
    expect(formatFocusDurationMs(25 * 60_000)).toBe("25 分钟");
  });
});

describe("formatFocusClock", () => {
  it("<1h → mm:ss", () => {
    expect(formatFocusClock(0)).toBe("00:00");
    expect(formatFocusClock(24 * 60_000 + 36_000 + 123)).toBe("24:36");
  });
  it("≥1h → h:mm:ss", () => {
    expect(formatFocusClock(3600_000 + 5 * 60_000 + 9_000)).toBe("1:05:09");
  });
  it("负值 clamp 到 00:00", () => {
    expect(formatFocusClock(-500)).toBe("00:00");
  });
});
