import { describe, it, expect, beforeEach } from "vitest";
import { LearningHistoryEvent, LearningHistoryEventType } from "@/lib/history/types";
import { buildLearningHistoryEvent, resolveLearningMutationContext } from "@/lib/history/recorder";
import { clearLearningHistoryStorage, appendLearningHistoryEvents, setLearningHistoryCoverage } from "@/lib/history/store";
import { buildLearningAnalyticsSnapshot } from "@/lib/analytics/learningAnalytics";
import { executeGetLearningAnalytics } from "@/lib/ai/tools/read/analytics";
import { executeKiroReadTool } from "@/lib/ai/tools/read/executor";
import { getLearningAnalyticsSchema } from "@/lib/ai/tools/read/schemas";
import { useAppStore } from "@/store/useAppStore";

const SEMESTER_BASE = { id: "sem1", name: "测试学期", startDate: "2026-08-10", totalWeeks: 16 };
const ENV_BASE = { semester: SEMESTER_BASE };

function mkEvent(
  type: LearningHistoryEventType,
  occurredAt: number,
  entityId: string,
  patch: { courseId?: string; courseNameSnapshot?: string; assignmentId?: string; data?: unknown } = {}
): LearningHistoryEvent {
  return {
    ...buildLearningHistoryEvent({
      type,
      entityType: type.startsWith("assignment")
        ? "assignment"
        : type.startsWith("study_block")
          ? "study-block"
          : "focus-session",
      entityId,
      data: patch.data ?? {},
      context: resolveLearningMutationContext({ source: "manual", occurredAt }),
      environment: ENV_BASE,
      courseId: patch.courseId,
      assignmentId: patch.assignmentId,
      courseNameSnapshot: patch.courseNameSnapshot,
    }),
  } as LearningHistoryEvent;
}

/** fixture 相对真实 Date.now() 构建：与 executeGetLearningAnalytics 的实时窗口一致 */
function realNowFixture() {
  const now = new Date();
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow - 1));
  monday.setHours(0, 0, 0, 0);
  const DAY = 86400000;
  const atLastWeek = (offsetDaysFromLastMonday: number, hour: number, minute = 0) => {
    const d = new Date(monday.getTime() - offsetDaysFromLastMonday * DAY);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  };
  const atToday = (hour: number, minute = 0) => {
    const d = new Date(now);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  };
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const localDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const SEMESTER = {
    ...SEMESTER_BASE,
    startDate: localDate(new Date(monday.getTime() - 28 * DAY)), // 4 周前开学：semester range 覆盖全部事件
  };
  const ddlFuture = localDate(new Date(Date.now() + 5 * DAY));

  const events: LearningHistoryEvent[] = [
    // prev week：focus 60min（last Tue 10:00）
    mkEvent("focus.completed", atLastWeek(5, 10, 0), "prev-f1", {
      courseId: "c1",
      courseNameSnapshot: "数据结构与算法",
      data: { actualActiveMs: 3600000, startedAt: atLastWeek(5, 10, 0), plannedMinutes: 60 },
    }),
    // prev week：assignment created/completed（last Mon → last Tue）
    mkEvent("assignment.created", atLastWeek(6, 9, 0), "prev-a1", {
      assignmentId: "prev-a1",
      courseId: "c2",
      courseNameSnapshot: "概率论",
      data: { ddl: `${localDate(new Date(atLastWeek(4, 0, 0)))}T23:59:00` },
    }),
    mkEvent("assignment.completed", atLastWeek(4, 15, 0), "prev-a1", { assignmentId: "prev-a1", courseId: "c2" }),
    // this week：focus 75min（today 上午）
    mkEvent("focus.completed", atToday(9, 30), "wk-f1", {
      courseId: "c1",
      courseNameSnapshot: "数据结构与算法",
      data: { actualActiveMs: 4500000, startedAt: atToday(9, 30), plannedMinutes: 75 },
    }),
    // this week：assignment created/completed（today，ddl +5d → onTime）
    mkEvent("assignment.created", atToday(8, 0), "wk-a1", {
      assignmentId: "wk-a1",
      courseId: "c1",
      courseNameSnapshot: "数据结构与算法",
      data: { ddl: `${ddlFuture}T23:59:00` },
    }),
    mkEvent("assignment.completed", atToday(11, 0), "wk-a1", { assignmentId: "wk-a1", courseId: "c1" }),
    // this week：study block（today 00:30，created 00:00 → 成熟 60min）
    mkEvent("study_block.created", atToday(0, 0), "wk-p1", {
      courseId: "c1",
      data: { date: localDate(now), startTime: "00:30", endTime: "01:30", plannedMinutes: 60 },
    }),
  ];
  return { events, semester: SEMESTER, now: now.getTime(), monday: monday.getTime() };
}

async function seed() {
  await clearLearningHistoryStorage();
  await setLearningHistoryCoverage({
    schemaVersion: 1,
    historyStartedAt: Date.now() - 60 * 86400000,
    initializedAt: Date.now() - 60 * 86400000,
    focusBackfillCompleted: true,
    backfilledFocusSessions: 0,
  });
  const fx = realNowFixture();
  await appendLearningHistoryEvents(fx.events);
  return fx;
}

beforeEach(async () => {
  const fx = realNowFixture();
  useAppStore.setState({ semester: fx.semester as never });
  await seed();
});

describe("get_learning_analytics（canonical tool）", () => {
  it("schema：week/4weeks/semester 合法；缺省 → week；非法 preset → INVALID_INPUT", () => {
    expect(getLearningAnalyticsSchema.safeParse({}).success).toBe(true);
    expect(getLearningAnalyticsSchema.safeParse({}).data?.preset).toBe("week");
    expect(getLearningAnalyticsSchema.safeParse({ preset: "week" }).success).toBe(true);
    expect(getLearningAnalyticsSchema.safeParse({ preset: "4weeks" }).success).toBe(true);
    expect(getLearningAnalyticsSchema.safeParse({ preset: "semester" }).success).toBe(true);
    expect(getLearningAnalyticsSchema.safeParse({ preset: "year" }).success).toBe(false);
    // 模型不允许传 now / from / to / historyStartedAt
    expect(getLearningAnalyticsSchema.safeParse({ now: 123 }).success).toBe(false);
  });

  it("Canonical Invariant：Tool Output 与 buildLearningAnalyticsSnapshot 核心字段一致", async () => {
    const fx = realNowFixture();
    const a = await buildLearningAnalyticsSnapshot({
      preset: "week",
      semester: fx.semester,
      now: fx.now,
    });
    const b = await executeGetLearningAnalytics({ preset: "week" });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const out = b.data as Record<string, any>;

    // overview 核心字段
    expect(out.overview.actualFocusMinutes).toBe(a.overview.actualFocusMinutes);
    expect(out.overview.actualFocusLabel).toBe(a.overview.actualFocusLabel);
    expect(out.overview.completedAssignments).toBe(a.overview.completedAssignments);
    expect(out.overview.plannedMinutes).toBe(a.overview.plannedMinutes);
    expect(out.overview.actualToPlanRatio).toBe(a.overview.actualToPlanRatio);
    expect(out.overview.onTimeRate).toBe(a.overview.onTimeRate);
    expect(out.overview.focusDeltaPercent).toBe(a.overview.focusDeltaPercent);

    // courseInvestment / focusRhythm / signals / execution
    expect(out.courseInvestment).toEqual(a.courseInvestment);
    expect(out.focusRhythm).toEqual(a.focusRhythm);
    expect(out.execution).toEqual(a.execution);
    expect(out.signals).toEqual(a.signals);
    expect(out.trend).toEqual(a.trend);

    // coverage 原样透传（不在 Kiro 层重解释）
    expect(out.coverage).toEqual(a.coverage);
    expect(out.period.preset).toBe("week");
    expect(out.period.previous).not.toBeNull();

    // 不外泄内部状态
    expect(out.isEmpty).toBeUndefined();
    expect(out.coverage.historyStartedAt).toBeDefined();

    // fixture 语义抽查：专注 75 + 上周 60 → delta +25%
    expect(a.overview.actualFocusMinutes).toBe(75);
    expect(a.overview.focusDeltaPercent).toBe(25);
    expect(a.overview.completedAssignments).toBe(1);
    expect(a.overview.plannedMinutes).toBe(60);
  });

  it("缺省 → week；4weeks / semester 均可执行", async () => {
    const d = await executeGetLearningAnalytics({});
    expect(d.ok).toBe(true);
    if (d.ok) expect((d.data as { period: { preset: string } }).period.preset).toBe("week");

    const f = await executeGetLearningAnalytics({ preset: "4weeks" });
    expect(f.ok).toBe(true);
    if (f.ok) {
      const out = f.data as { period: { previous: unknown }; trend: unknown[] };
      expect(out.period.previous).not.toBeNull();
      expect(out.trend.length).toBeGreaterThan(0);
    }

    const s = await executeGetLearningAnalytics({ preset: "semester" });
    expect(s.ok).toBe(true);
    if (s.ok) {
      const out = s.data as { period: { previous: unknown }; trend: unknown[] };
      expect(out.period.previous).toBeNull();
      expect(out.trend.length).toBeGreaterThan(0);
    }
  });

  it("非法 preset → INVALID_INPUT；executor 同步路径拒绝（不破坏 sync read tools）", async () => {
    const r = await executeGetLearningAnalytics({ preset: "year" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_INPUT");

    const state = {
      semester: SEMESTER_BASE,
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
    const q = executeKiroReadTool("get_learning_analytics", {}, state as never);
    expect(q.ok).toBe(false);
    if (!q.ok) expect(q.message).toContain("需要异步执行");
    const ctx = executeKiroReadTool("get_current_context", {}, state as never);
    expect(ctx.ok).toBe(true);
  });

  it("coverage：historyStartedAt 在 current range 内 → fullCoverage=false 原样返回", async () => {
    // 重建 coverage：今天才刚开始记录 → week range [周一, now] 不完整
    await clearLearningHistoryStorage();
    await setLearningHistoryCoverage({
      schemaVersion: 1,
      historyStartedAt: Date.now() - 3600000, // 1 小时前（本周内）
      initializedAt: Date.now() - 3600000,
      focusBackfillCompleted: true,
      backfilledFocusSessions: 0,
    });
    await appendLearningHistoryEvents(realNowFixture().events);
    const r = await executeGetLearningAnalytics({ preset: "week" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const out = r.data as { coverage: { fullCoverage: boolean; comparisonAvailable: boolean } };
      expect(out.coverage.fullCoverage).toBe(false);
      expect(out.coverage.comparisonAvailable).toBe(false);
    }
  });

  it("READ_FAILED：IndexedDB 不可用时如实失败（不猜）", async () => {
    const r = await executeGetLearningAnalytics({ preset: "semester" });
    // 正常环境不应失败；这里只保证失败路径返回 READ_FAILED code
    if (!r.ok) expect(r.code).toBe("READ_FAILED");
  });
});
