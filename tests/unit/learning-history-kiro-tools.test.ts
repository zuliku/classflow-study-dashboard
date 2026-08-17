import { describe, it, expect, beforeEach } from "vitest";
import { LearningHistoryEvent, LearningHistoryEventType } from "@/lib/history/types";
import { buildLearningHistoryEvent, resolveLearningMutationContext } from "@/lib/history/recorder";
import { clearLearningHistoryStorage, appendLearningHistoryEvents, setLearningHistoryCoverage } from "@/lib/history/store";
import {
  executeQueryLearningHistory,
  executeSummarizeLearningHistory,
  parseLocalDay,
} from "@/lib/ai/tools/read/history";
import { executeKiroReadTool } from "@/lib/ai/tools/read/executor";
import { queryLearningHistorySchema, summarizeLearningHistorySchema } from "@/lib/ai/tools/read/schemas";

const SEMESTER = { id: "sem1", name: "测试学期", startDate: "2026-08-10", totalWeeks: 16 };
const ENV = { semester: SEMESTER };

function mkEvent(
  type: LearningHistoryEventType,
  occurredAt: number,
  patch: { courseId?: string; data?: unknown } = {}
): LearningHistoryEvent {
  return {
    ...buildLearningHistoryEvent({
      type,
      entityType: type.startsWith("assignment")
        ? "assignment"
        : type.startsWith("study_block")
          ? "study-block"
          : type.startsWith("focus")
            ? "focus-session"
            : type.startsWith("course")
              ? "course"
              : "schedule",
      entityId: `e-${type}-${occurredAt}`,
      data: patch.data ?? { status: "todo", priority: "medium", ddl: null, estimatedMinutes: null },
      context: resolveLearningMutationContext({ source: "manual", occurredAt }),
      environment: ENV,
      courseId: patch.courseId,
    }),
  } as LearningHistoryEvent;
}

beforeEach(async () => {
  await clearLearningHistoryStorage();
  await setLearningHistoryCoverage({
    schemaVersion: 1,
    historyStartedAt: Date.now() - 60 * 86400000, // 60 天前开始（默认 28/30 天范围在 coverage 内）
    initializedAt: Date.now() - 60 * 86400000,
    focusBackfillCompleted: true,
    backfilledFocusSessions: 0,
  });
});

function dayFromNow(offset: number): string {
  const d = new Date(Date.now() + offset * 86400000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

describe("parseLocalDay", () => {
  it("本地墙钟 00:00:00 / 23:59:59.999（非 UTC midnight）", () => {
    const start = parseLocalDay("2026-08-15", false)!;
    const end = parseLocalDay("2026-08-15", true)!;
    const d = new Date(start);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(end - start).toBe(86400000 - 1);
  });
});

describe("query_learning_history（schema + executor）", () => {
  it("schema 校验通过/拒绝", () => {
    expect(queryLearningHistorySchema.safeParse({ from: "2026-08-01", to: "2026-08-15", limit: 50 }).success).toBe(true);
    expect(queryLearningHistorySchema.safeParse({ from: "2026-8-1" }).success).toBe(false);
    expect(queryLearningHistorySchema.safeParse({ limit: 300 }).success).toBe(false);
    expect(queryLearningHistorySchema.safeParse({ source: "cloud" }).success).toBe(false);
  });

  it("默认过去 30 天；90 天 hard max → OUT_OF_RANGE；raw 结果 ≤200", async () => {
    const events = Array.from({ length: 250 }, (_, i) =>
      mkEvent("assignment.created", Date.now() - i * 1000)
    );
    await appendLearningHistoryEvents(events);
    const r = await executeQueryLearningHistory({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.data as { events: unknown[] }).events.length).toBeLessThanOrEqual(200);
    }
    const out = await executeQueryLearningHistory({ from: dayFromNow(-120), to: dayFromNow(-10) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("OUT_OF_RANGE");
  });

  it("filters：type/course/source 生效；输出 model-friendly（无 schemaVersion/internal id）", async () => {
    await appendLearningHistoryEvents([
      mkEvent("assignment.completed", Date.now() - 1000, { courseId: "c1" }),
      mkEvent("assignment.completed", Date.now() - 2000, { courseId: "c2" }),
      mkEvent("focus.completed", Date.now() - 3000),
    ]);
    const r = await executeQueryLearningHistory({ eventTypes: ["assignment.completed"], courseId: "c1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const items = (r.data as { events: Record<string, unknown>[] }).events;
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("assignment.completed");
      expect(items[0].schemaVersion).toBeUndefined();
      expect(items[0].timezoneOffsetMinutes).toBeUndefined();
      expect(items[0].id).toBeUndefined();
    }
  });

  it("server dispatcher：异步工具返回「需要异步执行」（不破坏同步 read tools）", () => {
    const state = {
      semester: SEMESTER,
      currentSemesterWeek: 1,
      activeTab: "overview",
      selectedCourseId: null,
      selectedAssignmentId: null,
      highlightedAssignmentId: null,
      userProfile: { name: "", college: "", grade: "", completedCredits: 0, totalCredits: 0 },
      courses: [],
      schedules: [],
      assignments: [],
      calendarMarks: [],
      groupProjects: [],
      studyBlocks: [],
      reminders: [],
      focusSessions: [],
    };
    const q = executeKiroReadTool("query_learning_history", {}, state as never);
    expect(q.ok).toBe(false);
    if (!q.ok) expect(q.message).toContain("需要异步执行");
    // 同步工具不受影响
    const ctx = executeKiroReadTool("get_current_context", {}, state as never);
    expect(ctx.ok).toBe(true);
  });
});

describe("summarize_learning_history（schema + executor）", () => {
  it("schema 校验", () => {
    expect(summarizeLearningHistorySchema.safeParse({ groupBy: "day" }).success).toBe(true);
    expect(summarizeLearningHistorySchema.safeParse({ groupBy: "month" }).success).toBe(false);
  });

  it("默认过去 28 天；366 天 hard max；返回确定性 summary + coverage", async () => {
    await appendLearningHistoryEvents([
      mkEvent("focus.completed", Date.now() - 1000, { data: { actualActiveMs: 1_500_000, plannedMinutes: 25 } }),
      mkEvent("assignment.completed", Date.now() - 2000, { courseId: "c1" }),
    ]);
    const r = await executeSummarizeLearningHistory({ groupBy: "none" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const data = r.data as { focus: { completedSessions: number; actualMinutes: number }; assignments: { completed: number }; coverage: { fullCoverage: boolean } };
      expect(data.focus).toEqual({ completedSessions: 1, actualMinutes: 25, plannedMinutes: 25 });
      expect(data.assignments.completed).toBe(1);
      expect(data.coverage.fullCoverage).toBe(true);
    }
    const out = await executeSummarizeLearningHistory({ from: dayFromNow(-400), to: dayFromNow(-30) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("OUT_OF_RANGE");
  });

  it("coverage：范围早于 historyStartedAt → fullCoverage=false", async () => {
    await appendLearningHistoryEvents([mkEvent("assignment.completed", Date.now() - 1000)]);
    // historyStartedAt = 60 天前；from 70 天前 < startedAt → false
    const early = await executeSummarizeLearningHistory({ from: dayFromNow(-70), to: dayFromNow(-61) });
    expect(early.ok).toBe(true);
    if (early.ok) {
      expect((early.data as { coverage: { fullCoverage: boolean } }).coverage.fullCoverage).toBe(false);
    }
  });
});
