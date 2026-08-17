import { describe, it, expect, beforeEach } from "vitest";
import {
  appendLearningHistoryEvent,
  appendLearningHistoryEvents,
  clearLearningHistoryStorage,
  countLearningHistoryEvents,
  ensureLearningHistoryCoverage,
  getLearningHistoryCoverage,
  getLearningHistoryEvent,
  setLearningHistoryCoverage,
} from "@/lib/history/store";
import { LearningHistoryEvent, LEARNING_HISTORY_SCHEMA_VERSION } from "@/lib/history/types";

/** 最小事件构造（仅测试 store 层 append/get/count/clear） */
function mkEvent(patch: Partial<LearningHistoryEvent> = {}): LearningHistoryEvent {
  return {
    id: patch.id ?? "e1",
    schemaVersion: 1,
    type: "assignment.created",
    occurredAt: patch.occurredAt ?? 1000,
    localDate: "2026-08-15",
    timezoneOffsetMinutes: 480,
    source: "manual",
    entityType: "assignment",
    entityId: "a1",
    semesterId: "sem1",
    semesterNameSnapshot: "测试学期",
    semesterWeek: 1,
    sequence: 1,
    data: { status: "todo", priority: "medium", ddl: null, estimatedMinutes: null },
    ...patch,
  } as LearningHistoryEvent;
}

beforeEach(async () => {
  await clearLearningHistoryStorage();
});

describe("Learning History Store", () => {
  it("append + get：按 id 读取", async () => {
    await appendLearningHistoryEvent(mkEvent({ id: "e1" }));
    const got = await getLearningHistoryEvent("e1");
    expect(got).not.toBeNull();
    expect(got!.id).toBe("e1");
    expect(got!.source).toBe("manual");
  });

  it("batch append + count", async () => {
    await appendLearningHistoryEvents([
      mkEvent({ id: "e1" }),
      mkEvent({ id: "e2" }),
      mkEvent({ id: "e3" }),
    ]);
    expect(await countLearningHistoryEvents()).toBe(3);
  });

  it("get 不存在 → null", async () => {
    expect(await getLearningHistoryEvent("missing")).toBeNull();
  });

  it("clear：清空 events 与 meta", async () => {
    await appendLearningHistoryEvent(mkEvent({ id: "e1" }));
    await setLearningHistoryCoverage({
      schemaVersion: 1,
      historyStartedAt: 1,
      initializedAt: 1,
      focusBackfillCompleted: false,
      backfilledFocusSessions: 0,
    });
    await clearLearningHistoryStorage();
    expect(await countLearningHistoryEvents()).toBe(0);
    expect(await getLearningHistoryCoverage()).toBeNull();
  });

  it("coverage：ensure 幂等，set/get 保留", async () => {
    const first = await ensureLearningHistoryCoverage();
    expect(first.schemaVersion).toBe(LEARNING_HISTORY_SCHEMA_VERSION);
    expect(first.historyStartedAt).toBeGreaterThan(0);
    const second = await ensureLearningHistoryCoverage();
    expect(second.historyStartedAt).toBe(first.historyStartedAt);
  });

  it("append 事件可经 occurredAt index 读取（基本内部 query）", async () => {
    await appendLearningHistoryEvent(mkEvent({ id: "e1", occurredAt: 5000 }));
    const db = await import("@/lib/history/store").then((m) => m.openLearningHistoryDB());
    const events: unknown[] = await new Promise((resolve, reject) => {
      const tx = db.transaction("events", "readonly");
      const req = tx.objectStore("events").index("occurredAt").getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(req.error);
    });
    expect(events).toHaveLength(1);
    expect((events[0] as { id: string }).id).toBe("e1");
  });
});
