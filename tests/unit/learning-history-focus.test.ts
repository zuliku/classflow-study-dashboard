import { describe, it, expect, beforeEach, vi } from "vitest";
import { FocusSession } from "@/types";
import {
  buildFocusCompletedEvent,
  buildFocusPausedEvent,
  buildFocusResumedEvent,
  buildFocusStartedEvent,
} from "@/lib/history/focusEvents";
import {
  buildFocusBackfillEvent,
  runFocusBackfill,
  isBackfillableFocusSession,
} from "@/lib/history/migration";
import { resolveLearningMutationContext, flushLearningHistoryQueue } from "@/lib/history/recorder";
import {
  clearLearningHistoryStorage,
  countLearningHistoryEvents,
  ensureLearningHistoryCoverage,
  getLearningHistoryCoverage,
} from "@/lib/history/store";
import { clearLearningHistoryForUser } from "@/lib/history/clear";

const SEMESTER = { id: "sem1", name: "测试学期", startDate: "2026-08-10", totalWeeks: 16 };
const ENV = { semester: SEMESTER };
const CTX = resolveLearningMutationContext({ source: "manual" });

function mkSession(patch: Partial<FocusSession>): FocusSession {
  return {
    id: "fs1",
    plannedMinutes: 25,
    startedAt: 1000,
    accumulatedActiveMs: 0,
    status: "running",
    source: "manual",
    createdAt: 1000,
    updatedAt: 1000,
    ...patch,
  } as FocusSession;
}

beforeEach(async () => {
  await clearLearningHistoryStorage();
});

describe("Focus History Events", () => {
  it("started：plannedMinutes + sessionSource", () => {
    const event = buildFocusStartedEvent({ session: mkSession({}), context: CTX, environment: ENV });
    expect(event.type).toBe("focus.started");
    expect((event as { data: { plannedMinutes: number; sessionSource: string } }).data).toMatchObject({
      plannedMinutes: 25,
      sessionSource: "manual",
    });
  });

  it("paused / resumed：accumulatedActiveMs 来自 session", () => {
    const paused = buildFocusPausedEvent({
      session: mkSession({ status: "paused", accumulatedActiveMs: 60000 }),
      context: CTX,
      environment: ENV,
    });
    expect((paused as { data: { accumulatedActiveMs: number } }).data.accumulatedActiveMs).toBe(60000);
    const resumed = buildFocusResumedEvent({
      session: mkSession({ status: "running", accumulatedActiveMs: 60000 }),
      context: CTX,
      environment: ENV,
    });
    expect((resumed as { data: { accumulatedActiveMs: number } }).data.accumulatedActiveMs).toBe(60000);
  });

  it("completed：actualActiveMs 直接来自最终 session（不另算）", () => {
    const event = buildFocusCompletedEvent({
      session: mkSession({
        status: "completed",
        endedAt: 2500000,
        actualActiveMs: 1500000,
        accumulatedActiveMs: 1500000,
        source: "manual",
      }),
      endReason: "timer",
      context: CTX,
      environment: ENV,
    });
    expect(event).not.toBeNull();
    const data = (event as { data: { actualActiveMs: number; endReason: string; endedAt: number; sessionSource: string } }).data;
    expect(data.actualActiveMs).toBe(1500000);
    expect(data.endedAt).toBe(2500000);
    expect(data.endReason).toBe("timer");
    expect(data.sessionSource).toBe("manual");
  });

  it("completed：缺 endedAt/actualActiveMs → null", () => {
    expect(
      buildFocusCompletedEvent({
        session: mkSession({ status: "completed" }),
        endReason: "manual",
        context: CTX,
        environment: ENV,
      })
    ).toBeNull();
  });
});

const KEY = "classflow-storage-v2";

function seedState(extra?: { focusSessions?: unknown[] }) {
  const state = {
    userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s", name: "测试学期", startDate: "2026-08-10", totalWeeks: 16 },
    courses: [],
    schedules: [],
    assignments: [],
    calendarMarks: [],
    groupProjects: [],
    studyBlocks: [],
    assignmentTimeSlice: "all",
    preferences: {
      showWeekends: true, ddlWarningDays: 3, defaultDDLTime: "23:59",
      enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "system",
      startupView: "overview", defaultTaskPriority: "medium", defaultTaskStatus: "todo",
      enableSingleKeyShortcuts: true, contentDensity: "comfortable",
      defaultTaskWorkspaceView: "focus", defaultDeadlineReminderMinutes: 1440,
    },
    reminders: [],
    focusSessions: extra?.focusSessions ?? [],
  };
  localStorage.setItem(KEY, JSON.stringify({ version: 6, state }));
}

async function freshStore() {
  vi.resetModules();
  const mod = await import("@/store/useAppStore");
  return mod.useAppStore;
}

describe("Focus Store Integration（lifecycle 全链路）", () => {
  it("start → pause → resume → finish：started/paused/resumed/completed（manual）", async () => {
    seedState();
    const store = await freshStore();
    store.getState().startFocusSession({ plannedMinutes: 25, now: 1000 });
    store.getState().pauseFocusSession(2000000);
    store.getState().resumeFocusSession(3000000);
    store.getState().finishFocusSession(4000000);
    await (await import("@/lib/history/recorder")).flushLearningHistoryQueue();
    const db = await import("@/lib/history/store").then((m) => m.openLearningHistoryDB());
    const events = await new Promise<{ type: string; source: string }[]>((resolve, reject) => {
      const tx = db.transaction("events", "readonly");
      const req = tx.objectStore("events").index("occurredAt").getAll();
      req.onsuccess = () => resolve(req.result as { type: string; source: string }[]);
      req.onerror = () => reject(req.error);
    });
    expect(events.map((e) => e.type)).toEqual([
      "focus.started",
      "focus.paused",
      "focus.resumed",
      "focus.completed",
    ]);
    expect(events[3].source).toBe("manual");
  });

  it("completeFocusSession（timer）→ completed source=system", async () => {
    seedState();
    const store = await freshStore();
    const result = store.getState().startFocusSession({ plannedMinutes: 25, now: 1000 });
    if (!result.ok) throw new Error("start failed");
    store.getState().completeFocusSession(result.session.id, "timer", 2500000);
    await (await import("@/lib/history/recorder")).flushLearningHistoryQueue();
    const db = await import("@/lib/history/store").then((m) => m.openLearningHistoryDB());
    const events = await new Promise<{ type: string; source: string }[]>((resolve, reject) => {
      const tx = db.transaction("events", "readonly");
      const req = tx.objectStore("events").index("occurredAt").getAll();
      req.onsuccess = () => resolve(req.result as { type: string; source: string }[]);
      req.onerror = () => reject(req.error);
    });
    expect(events.map((e) => e.type)).toEqual(["focus.started", "focus.completed"]);
    expect(events[1].source).toBe("system");
  });

  it("recovered completion（completeFocusSession reason=recovered）→ source=system + endReason=recovered", async () => {
    seedState();
    const store = await freshStore();
    const result = store.getState().startFocusSession({ plannedMinutes: 25, now: 1000 });
    if (!result.ok) throw new Error("start failed");
    store.getState().completeFocusSession(result.session.id, "recovered", 2500000);
    await (await import("@/lib/history/recorder")).flushLearningHistoryQueue();
    const db = await import("@/lib/history/store").then((m) => m.openLearningHistoryDB());
    const events = await new Promise<{ type: string; source: string; data: { endReason: string } }[]>((resolve, reject) => {
      const tx = db.transaction("events", "readonly");
      const req = tx.objectStore("events").index("occurredAt").getAll();
      req.onsuccess = () => resolve(req.result as { type: string; source: string; data: { endReason: string } }[]);
      req.onerror = () => reject(req.error);
    });
    const completed = events.find((e) => e.type === "focus.completed")!;
    expect(completed.source).toBe("system");
    expect(completed.data.endReason).toBe("recovered");
  });
});

describe("Focus Backfill / Migration", () => {
  it("旧 2 completed + 1 running → 第一次回填 2；第二次仍然 2（幂等）", async () => {
    const completed1 = mkSession({
      id: "old-1",
      status: "completed",
      endedAt: 2000000,
      actualActiveMs: 1500000,
      accumulatedActiveMs: 1500000,
    });
    const completed2 = mkSession({
      id: "old-2",
      status: "completed",
      endedAt: 3000000,
      actualActiveMs: 2000000,
      accumulatedActiveMs: 2000000,
    });
    const running = mkSession({ id: "old-3", status: "running", activeStartedAt: 1000 });
    expect(isBackfillableFocusSession(completed1)).toBe(true);
    expect(isBackfillableFocusSession(running)).toBe(false);

    await ensureLearningHistoryCoverage();
    const first = await runFocusBackfill({ sessions: [completed1, completed2, running], semester: SEMESTER });
    expect(first!.backfilledFocusSessions).toBe(2);
    expect(await countLearningHistoryEvents()).toBe(2);

    const second = await runFocusBackfill({ sessions: [completed1, completed2, running], semester: SEMESTER });
    expect(second!.backfilledFocusSessions).toBe(2);
    expect(await countLearningHistoryEvents()).toBe(2);
  });

  it("backfill 事件 id 固定 + source=system + backfilled=true", async () => {
    await ensureLearningHistoryCoverage();
    const event = buildFocusBackfillEvent({
      session: mkSession({ id: "old-1", status: "completed", endedAt: 2000000, actualActiveMs: 1500000, accumulatedActiveMs: 1500000 }),
      semester: SEMESTER,
    });
    expect(event!.id).toBe("lh_backfill_focus_completed_old-1");
    expect(event!.source).toBe("system");
    expect((event as { data: { backfilled?: boolean; sessionSource: string } }).data).toMatchObject({
      backfilled: true,
      sessionSource: "manual",
    });
  });

  it("clearLearningHistoryForUser：backfill 后清空 → focusBackfillDisabled=true；再跑 backfill 仍 0", async () => {
    await ensureLearningHistoryCoverage();
    const completed = mkSession({ id: "old-1", status: "completed", endedAt: 2000000, actualActiveMs: 1500000, accumulatedActiveMs: 1500000 });
    await runFocusBackfill({ sessions: [completed], semester: SEMESTER });
    expect(await countLearningHistoryEvents()).toBe(1);
    clearLearningHistoryForUser();
    await (await import("@/lib/history/recorder")).flushLearningHistoryQueue();
    expect(await countLearningHistoryEvents()).toBe(0);
    const coverage = await getLearningHistoryCoverage();
    expect(coverage!.focusBackfillDisabled).toBe(true);
    await runFocusBackfill({ sessions: [completed], semester: SEMESTER });
    expect(await countLearningHistoryEvents()).toBe(0);
  });
});
