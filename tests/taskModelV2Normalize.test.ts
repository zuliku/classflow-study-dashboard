// @vitest-environment jsdom
/**
 * Phase 0 P0-01：Task Model V2 additive 字段归一。
 * 只验证“读入/清洗/持久化兼容”，不改变任何生命周期行为。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  normalizeAssignment,
  normalizeTaskTerminalTransition,
  TASK_MODEL_VERSION,
} from "@/lib/tasks/taskSemantics";
import { normalizeReminder } from "@/lib/reminders/reminderDomain";
import { useAppStore } from "@/store/useAppStore";

const KEY = "classflow-storage-v2";

const BASE_ASSIGNMENT = {
  id: "a1",
  courseId: "c1",
  title: "计量作业",
  description: "",
  ddl: "2026-11-10T23:59:00",
  estimatedMinutes: 120,
  priority: "high" as const,
  status: "doing" as const,
  progress: 40,
  tags: ["计量"],
};

const VALID_TRANSITION = {
  id: "t1",
  at: "2026-11-06T10:00:00",
  fromStatus: "doing" as const,
  toStatus: "submitted" as const,
  activeStatusBeforeTerminal: "doing" as const,
  releasedStudyBlockIds: ["b1", "b1", "b2"],
  cancelledReminderIds: ["r1", "r1"],
  generatedRecurrenceId: "a2",
  batchId: "batch1",
  source: "ui" as const,
};

function seed(state: Record<string, unknown>) {
  localStorage.setItem(KEY, JSON.stringify({ state, version: 8 }));
}

async function rehydrate() {
  // @ts-expect-error — persist 存在于 store
  await (useAppStore.persist as unknown as { rehydrate: () => Promise<void> }).rehydrate();
}

beforeEach(() => {
  localStorage.clear();
});

describe("Task Model V2 normalize", () => {
  it("版本常量与 persist version 解耦", () => {
    expect(TASK_MODEL_VERSION).toBe(2);
  });

  it("合法新字段保留；lastTerminalTransition 的 ID 去重", () => {
    const a = normalizeAssignment({
      ...BASE_ASSIGNMENT,
      doDate: "2026-11-06",
      submissionRequired: true,
      submittedAt: "2026-11-06T10:00:00",
      completedAt: "2026-11-06T11:00:00",
      recurrenceSpawnedAt: "2026-11-06T10:00:00",
      lastTerminalTransition: VALID_TRANSITION,
    });

    expect(a.doDate).toBe("2026-11-06");
    expect(a.submissionRequired).toBe(true);
    expect(a.submittedAt).toBe("2026-11-06T10:00:00");
    expect(a.completedAt).toBe("2026-11-06T11:00:00");
    expect(a.recurrenceSpawnedAt).toBe("2026-11-06T10:00:00");
    expect(a.lastTerminalTransition?.id).toBe("t1");
    expect(a.lastTerminalTransition?.releasedStudyBlockIds).toEqual(["b1", "b2"]);
    expect(a.lastTerminalTransition?.cancelledReminderIds).toEqual(["r1"]);
    expect(a.lastTerminalTransition?.generatedRecurrenceId).toBe("a2");
  });

  it("旧数据没有新字段：保持 undefined，不改 status/progress", () => {
    const a = normalizeAssignment(BASE_ASSIGNMENT);
    expect(a.doDate).toBeUndefined();
    expect(a.submissionRequired).toBeUndefined();
    expect(a.submittedAt).toBeUndefined();
    expect(a.completedAt).toBeUndefined();
    expect(a.lastTerminalTransition).toBeUndefined();
    expect(a.recurrenceSpawnedAt).toBeUndefined();
    expect(a.status).toBe("doing");
    expect(a.progress).toBe(40);
  });

  it("非法日期/时间/布尔/来源 → 丢弃，不伪造", () => {
    const a = normalizeAssignment({
      ...BASE_ASSIGNMENT,
      doDate: "2026-02-30",
      submissionRequired: "yes",
      submittedAt: "2026-11-06",
      completedAt: "2026-11-06T25:00",
      recurrenceSpawnedAt: "not-a-date",
      lastTerminalTransition: { ...VALID_TRANSITION, source: "hacker" },
    });

    expect(a.doDate).toBeUndefined();
    expect(a.submissionRequired).toBeUndefined();
    expect(a.submittedAt).toBeUndefined();
    expect(a.completedAt).toBeUndefined();
    expect(a.recurrenceSpawnedAt).toBeUndefined();
    expect(a.lastTerminalTransition).toBeUndefined();
  });

  it("lastTerminalTransition 缺必需字段 → 整个账本丢弃", () => {
    expect(normalizeTaskTerminalTransition({ ...VALID_TRANSITION, id: "" })).toBeUndefined();
    expect(
      normalizeTaskTerminalTransition({ ...VALID_TRANSITION, activeStatusBeforeTerminal: "submitted" })
    ).toBeUndefined();
    expect(normalizeTaskTerminalTransition({ ...VALID_TRANSITION, at: "2026-11-06" })).toBeUndefined();
  });

  it("cancelled reminder 可归一；非法 status 仍拒绝；未知 reason 丢弃", () => {
    const base = {
      id: "r1",
      title: "提交提醒",
      targetType: "assignment" as const,
      targetId: "a1",
      timingMode: "absolute" as const,
      triggerAt: "2026-11-06T10:00:00",
      status: "cancelled" as const,
      source: "manual" as const,
      createdAt: "2026-11-01T10:00:00",
      updatedAt: "2026-11-06T10:00:00",
      cancelledAt: "2026-11-06T10:00:00",
      cancelledByTaskId: "a1",
      cancelledReason: "task-submitted" as const,
    };

    const r = normalizeReminder(base);
    expect(r?.status).toBe("cancelled");
    expect(r?.cancelledAt).toBe("2026-11-06T10:00:00");
    expect(r?.cancelledByTaskId).toBe("a1");
    expect(r?.cancelledReason).toBe("task-submitted");

    const unknownReason = normalizeReminder({ ...base, cancelledReason: "weird" });
    expect(unknownReason?.cancelledReason).toBeUndefined();

    expect(normalizeReminder({ ...base, status: "weird" })).toBeNull();
  });

  it("hydrate 保留 Assignment / StudyBlock / Reminder 的 V2 字段", async () => {
    seed({
      courses: [],
      schedules: [],
      calendarMarks: [],
      scheduleOccurrenceOverrides: [],
      assignments: [
        {
          ...BASE_ASSIGNMENT,
          doDate: "2026-11-06",
          submissionRequired: true,
          submittedAt: "2026-11-06T10:00:00",
          lastTerminalTransition: VALID_TRANSITION,
        },
      ],
      studyBlocks: [
        {
          id: "b-rel",
          title: "有效释放",
          date: "2026-11-07",
          startTime: "10:00",
          endTime: "11:00",
          planningState: "released",
          releasedAt: "2026-11-06T10:00:00",
          releasedBy: "task-submitted",
          releasedByTaskId: "a1",
        },
        {
          id: "b-legacy",
          title: "旧释放",
          date: "2026-11-07",
          startTime: "12:00",
          endTime: "13:00",
          planningState: "released",
        },
        {
          id: "b-active",
          title: "活跃计划",
          date: "2026-11-07",
          startTime: "14:00",
          endTime: "15:00",
          releasedBy: "task-submitted",
        },
      ],
      reminders: [
        {
          id: "r-cancelled",
          title: "提交提醒",
          targetType: "assignment",
          targetId: "a1",
          timingMode: "absolute",
          triggerAt: "2026-11-06T10:00:00",
          status: "cancelled",
          source: "manual",
          createdAt: "2026-11-01T10:00:00",
          updatedAt: "2026-11-06T10:00:00",
          cancelledAt: "2026-11-06T10:00:00",
          cancelledByTaskId: "a1",
          cancelledReason: "task-submitted",
        },
      ],
    });

    await rehydrate();
    const s = useAppStore.getState();

    expect(s.assignments[0].doDate).toBe("2026-11-06");
    expect(s.assignments[0].submissionRequired).toBe(true);
    expect(s.assignments[0].submittedAt).toBe("2026-11-06T10:00:00");
    expect(s.assignments[0].lastTerminalTransition?.id).toBe("t1");

    const rel = s.studyBlocks.find((b) => b.id === "b-rel");
    expect(rel?.releasedBy).toBe("task-submitted");
    expect(rel?.releasedByTaskId).toBe("a1");

    const legacy = s.studyBlocks.find((b) => b.id === "b-legacy");
    expect(legacy?.releasedBy).toBe("legacy");
    expect(legacy?.releasedAt).toBeUndefined();

    const active = s.studyBlocks.find((b) => b.id === "b-active");
    expect(active?.releasedBy).toBeUndefined();
    expect(active?.releasedAt).toBeUndefined();

    const cancelled = s.reminders.find((r) => r.id === "r-cancelled");
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.cancelledReason).toBe("task-submitted");
  });
});
