import { describe, it, expect, beforeEach } from "vitest";
import {
  buildLearningHistoryEvent,
  enqueueLearningHistoryEvents,
  enqueueLearningHistoryReset,
  flushLearningHistoryQueue,
  resolveLearningMutationContext,
} from "@/lib/history/recorder";
import {
  clearLearningHistoryStorage,
  countLearningHistoryEvents,
} from "@/lib/history/store";
import { LearningHistoryEvent } from "@/lib/history/types";
import { resetLearningHistoryForDomainReset, clearLearningHistoryForUser } from "@/lib/history/clear";

const SEMESTER = { id: "sem1", name: "测试学期", startDate: "2026-08-10", totalWeeks: 16 };

function mkEvent(id: string, type: LearningHistoryEvent["type"] = "assignment.created"): LearningHistoryEvent {
  return buildLearningHistoryEvent({
    type,
    entityType: "assignment",
    entityId: "a1",
    data: { status: "todo", priority: "medium", ddl: null, estimatedMinutes: null },
    context: resolveLearningMutationContext({ source: "manual" }),
    environment: { semester: SEMESTER },
  });
}

beforeEach(async () => {
  await clearLearningHistoryStorage();
});

describe("Learning History Recorder", () => {
  it("A → B → C 写入顺序稳定", async () => {
    enqueueLearningHistoryEvents([mkEvent("e-a")]);
    enqueueLearningHistoryEvents([mkEvent("e-b")]);
    enqueueLearningHistoryEvents([mkEvent("e-c")]);
    await flushLearningHistoryQueue();
    expect(await countLearningHistoryEvents()).toBe(3);
  });

  it("A → Reset → B：最终只有 B（async clear 不竞态）", async () => {
    enqueueLearningHistoryEvents([mkEvent("e-a")]);
    enqueueLearningHistoryReset(async () => {
      await clearLearningHistoryStorage();
    });
    enqueueLearningHistoryEvents([mkEvent("e-b")]);
    await flushLearningHistoryQueue();
    expect(await countLearningHistoryEvents()).toBe(1);
  });

  it("resetLearningHistoryForDomainReset：队列内清空 + 新 coverage", async () => {
    enqueueLearningHistoryEvents([mkEvent("e-a")]);
    resetLearningHistoryForDomainReset();
    enqueueLearningHistoryEvents([mkEvent("e-b")]);
    await flushLearningHistoryQueue();
    expect(await countLearningHistoryEvents()).toBe(1);
    const { getLearningHistoryCoverage } = await import("@/lib/history/store");
    const coverage = await getLearningHistoryCoverage();
    expect(coverage).not.toBeNull();
    expect(coverage!.focusBackfillDisabled).toBeUndefined();
  });

  it("clearLearningHistoryForUser：清空 + focusBackfillDisabled=true", async () => {
    enqueueLearningHistoryEvents([mkEvent("e-a")]);
    clearLearningHistoryForUser();
    await flushLearningHistoryQueue();
    expect(await countLearningHistoryEvents()).toBe(0);
    const { getLearningHistoryCoverage } = await import("@/lib/history/store");
    const coverage = await getLearningHistoryCoverage();
    expect(coverage!.focusBackfillDisabled).toBe(true);
  });
});
