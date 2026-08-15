import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "@/store/useAppStore";
import { flushLearningHistoryQueue } from "@/lib/history/recorder";
import { clearLearningHistoryStorage } from "@/lib/history/store";
import { collectLearningHistoryEvents, resolveLearningHistoryQuery } from "@/lib/history/query";
import { applyStudyPlan } from "@/lib/planning/applyStudyPlan";
import { buildLearningAnalyticsSnapshot } from "@/lib/analytics/learningAnalytics";
import { projectStudyPlans } from "@/lib/analytics/studyPlanProjection";

/** P0：StudyBlock Batch / Priority History 完整性（先 RED 后实现） */

async function historyEvents() {
  await flushLearningHistoryQueue();
  return collectLearningHistoryEvents(resolveLearningHistoryQuery({}));
}

function mkBlock(idSuffix: string, patch: Record<string, unknown> = {}) {
  return {
    title: `批量计划 ${idSuffix}`,
    date: "2026-08-15",
    startTime: "19:00",
    endTime: "20:00",
    assignmentId: "a1",
    courseId: "c1",
    ...patch,
  };
}

beforeEach(async () => {
  await clearLearningHistoryStorage();
  useAppStore.setState({
    semester: { id: "sem1", name: "测试学期", startDate: "2026-08-10", totalWeeks: 16 } as never,
    assignments: [
      {
        id: "a1", courseId: "c1", title: "任务A", description: "", priority: "medium",
        status: "todo", progress: 0, tags: [], estimatedMinutes: 120,
      } as never,
    ],
    studyBlocks: [],
  });
});

describe("addStudyBlocksBatch History", () => {
  it("1. batch create 2 → created ×2（RED：当前不记录）", async () => {
    const created = useAppStore.getState().addStudyBlocksBatch([
      mkBlock("A"),
      mkBlock("B", { startTime: "20:00", endTime: "21:00" }),
    ]);
    expect(created).toHaveLength(2);
    const events = await historyEvents();
    const createdEvents = events.filter((e) => e.type === "study_block.created");
    expect(createdEvents).toHaveLength(2);
  });

  it("2/3. source=kiro → event.source=kiro + data.originSource=kiro", async () => {
    useAppStore.getState().addStudyBlocksBatch([mkBlock("A", { source: "kiro" })], { source: "kiro" });
    const events = await historyEvents();
    const createdEvent = events.find((e) => e.type === "study_block.created")!;
    expect(createdEvent.source).toBe("kiro");
    expect((createdEvent.data as { originSource: string }).originSource).toBe("kiro");
  });

  it("4. 同一 batch：所有事件共享同一 occurredAt，sequence 保序", async () => {
    useAppStore.getState().addStudyBlocksBatch([mkBlock("A"), mkBlock("B")]);
    const events = await historyEvents();
    const createdEvents = events
      .filter((e) => e.type === "study_block.created")
      .sort((a, b) => a.sequence - b.sequence);
    expect(new Set(createdEvents.map((e) => e.occurredAt)).size).toBe(1);
    expect(createdEvents[0].sequence).toBeLessThan(createdEvents[1].sequence);
  });

  it("6. 单次 state mutation：blocks 一次性进入 store（原子）", () => {
    const created = useAppStore.getState().addStudyBlocksBatch([mkBlock("A"), mkBlock("B")]);
    expect(useAppStore.getState().studyBlocks.length).toBe(2);
    expect(created.every((b) => !!b.id)).toBe(true);
  });
});

describe("deleteStudyBlocksBatch History", () => {
  it("4. batch delete 2 → deleted ×2（RED：当前不记录）", async () => {
    const created = useAppStore.getState().addStudyBlocksBatch([mkBlock("A"), mkBlock("B")]);
    const removed = useAppStore.getState().deleteStudyBlocksBatch(created.map((b) => b.id));
    expect(removed).toHaveLength(2);
    const events = await historyEvents();
    expect(events.filter((e) => e.type === "study_block.created")).toHaveLength(2);
    expect(events.filter((e) => e.type === "study_block.deleted")).toHaveLength(2);
    expect(useAppStore.getState().studyBlocks).toHaveLength(0);
  });

  it("5. delete 包含 missing id → 只对真实删除项产生事件", async () => {
    const created = useAppStore.getState().addStudyBlocksBatch([mkBlock("A")]);
    const removed = useAppStore.getState().deleteStudyBlocksBatch([
      created[0].id,
      "missing-block-id",
    ]);
    expect(removed).toHaveLength(1);
    const events = await historyEvents();
    expect(events.filter((e) => e.type === "study_block.deleted")).toHaveLength(1);
    const deleted = events.find((e) => e.type === "study_block.deleted")!;
    expect(deleted.entityId).toBe(created[0].id);
  });

  it("7. History append 失败不影响 state mutation（best-effort）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storeMod = await import("@/lib/history/store");
    vi.spyOn(storeMod, "appendLearningHistoryEvents").mockRejectedValue(new Error("idb boom"));
    try {
      const created = useAppStore.getState().addStudyBlocksBatch([mkBlock("A")]);
      expect(created).toHaveLength(1);
      expect(useAppStore.getState().studyBlocks).toHaveLength(1);
      // append 失败 → console.warn（dev），不抛给业务
      await historyEvents();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      warnSpy.mockRestore();
    }
  });
});

describe("updateAssignmentPriority History", () => {
  it("medium → high → priority_changed（before/after）；source=manual", async () => {
    useAppStore.getState().updateAssignmentPriority("a1", "high");
    const events = await historyEvents();
    const changed = events.find((e) => e.type === "assignment.priority_changed");
    expect(changed).toBeTruthy();
    expect(changed!.source).toBe("manual");
    expect(changed!.data).toMatchObject({ before: "medium", after: "high" });
  });

  it("high → high（no-op）→ 0 events", async () => {
    useAppStore.getState().updateAssignmentPriority("a1", "medium");
    const events = await historyEvents();
    expect(events).toHaveLength(0);
  });
});

describe("Kiro Apply / Undo History Integrity", () => {
  it("propose → Apply → created×2（source=kiro, originSource=kiro）；Undo → deleted×2（source=manual）；created+deleted 都保留", async () => {
    const dayStr = "2026-08-15";
    const result = applyStudyPlan(
      {
        blocks: [
          { assignmentId: "a1", title: "计划A", courseId: "c1", date: dayStr, startTime: "19:00", endTime: "20:00" },
          { assignmentId: "a1", title: "计划B", courseId: "c1", date: dayStr, startTime: "20:00", endTime: "21:00" },
        ],
      },
      useAppStore.getState()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const createdIds = result.created.map((b) => b.id);

    let events = await historyEvents();
    let createdEvents = events.filter((e) => e.type === "study_block.created");
    expect(createdEvents).toHaveLength(2);
    for (const e of createdEvents) {
      expect(e.source).toBe("kiro");
      expect((e.data as { originSource: string }).originSource).toBe("kiro");
    }
    expect(useAppStore.getState().studyBlocks).toHaveLength(2);

    // Undo：删除动作是用户主动操作 → source=manual
    const removed = useAppStore.getState().deleteStudyBlocksBatch(createdIds, { source: "manual" });
    expect(removed).toHaveLength(2);
    expect(useAppStore.getState().studyBlocks).toHaveLength(0);

    events = await historyEvents();
    const deletedEvents = events.filter((e) => e.type === "study_block.deleted");
    expect(deletedEvents).toHaveLength(2);
    for (const e of deletedEvents) {
      expect(e.source).toBe("manual");
    }
    // append-only：created 事件仍保留
    expect(events.filter((e) => e.type === "study_block.created")).toHaveLength(2);
  });

  it("Analytics：Kiro Applied 计划在 scheduledStart 之后成熟 → plannedMinutes 计入（修复前会漏）", async () => {
    // coverage 起点设在过去（本周 range 全量覆盖）
    const storeMod = await import("@/lib/history/store");
    await storeMod.clearLearningHistoryStorage();
    const past = Date.now() - 60 * 86400000;
    await storeMod.setLearningHistoryCoverage({
      schemaVersion: 1,
      historyStartedAt: past,
      initializedAt: past,
      focusBackfillCompleted: true,
      backfilledFocusSessions: 0,
      studyBlockBatchIntegrityStartedAt: past,
    });

    // t0：Kiro Apply 明天 19:00–20:00 计划
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const dayStr = `${tomorrow.getFullYear()}-${pad2(tomorrow.getMonth() + 1)}-${pad2(tomorrow.getDate())}`;
    const result = applyStudyPlan(
      {
        blocks: [
          { assignmentId: "a1", title: "计划A", courseId: "c1", date: dayStr, startTime: "19:00", endTime: "20:00" },
        ],
      },
      useAppStore.getState()
    );
    expect(result.ok).toBe(true);
    await historyEvents();

    // Analytics now > scheduledStart（明天 20:00 之后）
    const snapshot = await buildLearningAnalyticsSnapshot({
      preset: "week",
      semester: useAppStore.getState().semester,
      now: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 21, 0, 0).getTime(),
    });
    // 修复前：batch 无 History → plannedMinutes 漏掉；修复后计入 60min
    expect(snapshot.overview.plannedMinutes).toBeGreaterThanOrEqual(60);
    expect(snapshot.coverage.planCoverageFull).toBe(true);
  });

  it("Analytics：plan coverage 不完整（batch marker 晚于 range 起点）→ actualToPlanRatio=null + 计划序列不完整", async () => {
    const storeMod = await import("@/lib/history/store");
    await storeMod.clearLearningHistoryStorage();
    // batch integrity marker 在 range 起点之后（模拟老用户：batch 历史缺失）
    const now = Date.now();
    await storeMod.setLearningHistoryCoverage({
      schemaVersion: 1,
      historyStartedAt: now - 60 * 86400000,
      initializedAt: now - 60 * 86400000,
      focusBackfillCompleted: true,
      backfilledFocusSessions: 0,
      studyBlockBatchIntegrityStartedAt: now - 2 * 86400000, // 2 天前才开始完整 batch 记录
    });
    // 本周 range 起点 = 本周一（早于 marker）→ planCoverageFull=false
    useAppStore.getState().addStudyBlocksBatch([mkBlock("A", { date: "2026-08-15", source: "kiro" })], { source: "kiro" });
    await historyEvents();

    const snapshot = await buildLearningAnalyticsSnapshot({
      preset: "week",
      semester: useAppStore.getState().semester,
    });
    expect(snapshot.coverage.planCoverageFull).toBe(false);
    expect(snapshot.overview.actualToPlanRatio).toBeNull();
    // plan-actual signal 不产生（planCoverageFull=false）
    expect(snapshot.signals.some((s) => s.id === "plan-actual")).toBe(false);
  });
});

describe("Undo / Delete 与计划成熟语义（append-only projection）", () => {
  const ev = (type: string, entityId: string, occurredAt: number, data: Record<string, unknown>) => ({
    type,
    entityId,
    occurredAt,
    sequence: 1,
    data,
  });

  it("scheduledStart 前撤销：created + deleted → 不产生 matured plan（plannedMinutes += 0）", () => {
    const t0 = Date.now();
    const tomorrow = new Date(t0 + 86400000);
    const p = (n: number) => String(n).padStart(2, "0");
    const dayStr = `${tomorrow.getFullYear()}-${p(tomorrow.getMonth() + 1)}-${p(tomorrow.getDate())}`;
    const result = projectStudyPlans([
      ev("study_block.created", "sb1", t0, { date: dayStr, startTime: "19:00", endTime: "20:00", plannedMinutes: 60 }),
      ev("study_block.deleted", "sb1", t0 + 60000, {}), // 1 分钟后撤销（start 之前）
    ]);
    expect(result.maturedPlans).toHaveLength(0);
  });

  it("scheduledStart 后删除：历史仍保留该成熟计划事实（plannedMinutes 计入）", () => {
    const t0 = new Date(2026, 7, 10, 9, 0, 0).getTime();
    const start = new Date(2026, 7, 10, 19, 0, 0).getTime(); // 当天 19:00
    const result = projectStudyPlans([
      ev("study_block.created", "sb1", t0, { date: "2026-08-10", startTime: "19:00", endTime: "20:00", plannedMinutes: 60 }),
      ev("study_block.deleted", "sb1", start + 90 * 60000, {}), // 20:30 删除（start 之后）
    ]);
    expect(result.maturedPlans).toHaveLength(1);
    expect(result.maturedPlans[0].plannedMinutes).toBe(60);
  });
});

describe("Coverage Migration（studyBlockBatchIntegrityStartedAt）", () => {
  it("新安装：marker === historyStartedAt", async () => {
    const storeMod = await import("@/lib/history/store");
    await storeMod.clearLearningHistoryStorage();
    const coverage = await storeMod.ensureLearningHistoryCoverage();
    expect(coverage.studyBlockBatchIntegrityStartedAt).toBe(coverage.historyStartedAt);
  });

  it("老用户迁移：缺 marker → 补齐；第二次 ensure 值不变（幂等）", async () => {
    const storeMod = await import("@/lib/history/store");
    await storeMod.clearLearningHistoryStorage();
    const legacyStartedAt = Date.now() - 30 * 86400000;
    await storeMod.setLearningHistoryCoverage({
      schemaVersion: 1,
      historyStartedAt: legacyStartedAt,
      initializedAt: legacyStartedAt,
      focusBackfillCompleted: true,
      backfilledFocusSessions: 0,
    });
    const first = await storeMod.ensureLearningHistoryCoverage();
    expect(first.studyBlockBatchIntegrityStartedAt).toBeGreaterThan(legacyStartedAt);
    const marker = first.studyBlockBatchIntegrityStartedAt;
    await new Promise((r) => setTimeout(r, 5));
    const second = await storeMod.ensureLearningHistoryCoverage();
    expect(second.studyBlockBatchIntegrityStartedAt).toBe(marker);
  });

  it("reset / 手动 clear → 新 marker（= 当时的 now）", async () => {
    const storeMod = await import("@/lib/history/store");
    await storeMod.clearLearningHistoryStorage();
    const resetCov = await storeMod.resetLearningHistoryCoverage();
    expect(resetCov.studyBlockBatchIntegrityStartedAt).toBe(resetCov.historyStartedAt);
    await storeMod.clearLearningHistoryForUser();
    const afterClear = await storeMod.getLearningHistoryCoverage();
    expect(afterClear?.studyBlockBatchIntegrityStartedAt).toBe(afterClear?.historyStartedAt);
    expect(afterClear?.focusBackfillDisabled).toBe(true);
  });
});
