import { describe, it, expect, beforeEach } from "vitest";
import { LearningHistoryEvent } from "@/lib/history/types";
import { buildLearningHistoryEvent, resolveLearningMutationContext } from "@/lib/history/recorder";
import {
  clearLearningHistoryStorage,
  appendLearningHistoryEvents,
  setLearningHistoryCoverage,
} from "@/lib/history/store";
import { buildLearningAnalyticsSnapshot } from "@/lib/analytics/learningAnalytics";

const SEMESTER = { id: "sem1", name: "测试学期", startDate: "2026-08-03", totalWeeks: 16 };
const ENV = { semester: SEMESTER };

// 固定时间：2026-08-23 周日 20:00 本地（week current = 08-17 周一 00:00）
const NOW = new Date(2026, 7, 23, 20, 0, 0).getTime();
const WEEK_FROM = new Date(2026, 7, 17, 0, 0, 0).getTime();
const PREV_WEEK_FROM = new Date(2026, 7, 10, 0, 0, 0).getTime();

function mkEvent(patch: {
  type: LearningHistoryEvent["type"];
  occurredAt: number;
  entityId: string;
  courseId?: string;
  assignmentId?: string;
  courseNameSnapshot?: string;
  data?: unknown;
}): LearningHistoryEvent {
  const entityType = patch.type.startsWith("assignment")
    ? "assignment"
    : patch.type.startsWith("study_block")
      ? "study-block"
      : "focus-session";
  return {
    ...buildLearningHistoryEvent({
      type: patch.type,
      entityType,
      entityId: patch.entityId,
      data: patch.data ?? {},
      context: resolveLearningMutationContext({ source: "manual", occurredAt: patch.occurredAt }),
      environment: ENV,
      courseId: patch.courseId,
      assignmentId: patch.assignmentId,
      courseNameSnapshot: patch.courseNameSnapshot,
    }),
  } as LearningHistoryEvent;
}

const DAY = 86400000;

// spec fixture：2 课程 / 4 任务（1 reopened / 1 late）/ 7 计划 / 6 focus
function buildFixture() {
  const at = (d: number, h: number, m = 0) => new Date(2026, 7, d, h, m, 0, 0).getTime();
  const events: LearningHistoryEvent[] = [
    // ---- assignments ----
    mkEvent({ type: "assignment.created", occurredAt: at(10, 9), entityId: "a1", assignmentId: "a1", courseId: "c1", courseNameSnapshot: "数据结构与算法", data: { ddl: "2026-08-20" } }),
    mkEvent({ type: "assignment.completed", occurredAt: at(18, 10), entityId: "a1", assignmentId: "a1", courseId: "c1", data: {} }),
    mkEvent({ type: "assignment.created", occurredAt: at(17, 8), entityId: "a2", assignmentId: "a2", courseId: "c2", courseNameSnapshot: "概率论", data: { ddl: null } }),
    mkEvent({ type: "assignment.completed", occurredAt: at(19, 15), entityId: "a2", assignmentId: "a2", courseId: "c2", data: {} }),
    mkEvent({ type: "assignment.created", occurredAt: at(15, 9), entityId: "a3", assignmentId: "a3", courseId: "c1", data: { ddl: "2026-08-17" } }),
    mkEvent({ type: "assignment.completed", occurredAt: at(18, 9), entityId: "a3", assignmentId: "a3", courseId: "c1", data: {} }),
    mkEvent({ type: "assignment.created", occurredAt: at(16, 9), entityId: "a4", assignmentId: "a4", courseId: "c2", data: { ddl: "2026-08-22" } }),
    mkEvent({ type: "assignment.completed", occurredAt: at(20, 11), entityId: "a4", assignmentId: "a4", courseId: "c2", data: {} }),
    mkEvent({ type: "assignment.reopened", occurredAt: at(21, 10), entityId: "a4", assignmentId: "a4", courseId: "c2", data: {} }),
    // ---- study blocks (7) ----
    mkEvent({ type: "study_block.created", occurredAt: at(15, 10), entityId: "p1", courseId: "c1", data: { date: "2026-08-17", startTime: "10:00", endTime: "11:30", plannedMinutes: 90 } }),
    mkEvent({ type: "study_block.created", occurredAt: at(16, 10), entityId: "p2", courseId: "c1", data: { date: "2026-08-18", startTime: "14:00", endTime: "15:00", plannedMinutes: 60 } }),
    mkEvent({ type: "study_block.created", occurredAt: at(17, 12), entityId: "p3", courseId: "c2", data: { date: "2026-08-17", startTime: "09:00", endTime: "10:00", plannedMinutes: 60 } }),
    mkEvent({ type: "study_block.created", occurredAt: at(14, 10), entityId: "p4", courseId: "c2", data: { date: "2026-08-19", startTime: "09:00", endTime: "10:00", plannedMinutes: 60 } }),
    mkEvent({ type: "study_block.updated", occurredAt: at(18, 20), entityId: "p4", courseId: "c2", data: { date: "2026-08-19", startTime: "10:00", endTime: "11:00", plannedMinutesAfter: 60 } }),
    mkEvent({ type: "study_block.created", occurredAt: at(15, 10), entityId: "p5", courseId: "c1", data: { date: "2026-08-20", startTime: "20:00", endTime: "21:00", plannedMinutes: 60 } }),
    mkEvent({ type: "study_block.deleted", occurredAt: at(20, 19), entityId: "p5" }),
    mkEvent({ type: "study_block.created", occurredAt: at(13, 10), entityId: "p6", courseId: "c1", data: { date: "2026-08-21", startTime: "08:00", endTime: "08:30", plannedMinutes: 30 } }),
    mkEvent({ type: "study_block.created", occurredAt: at(18, 10), entityId: "p7", courseId: "c2", data: { date: "2026-08-22", startTime: "15:00", endTime: "15:45", plannedMinutes: 45 } }),
    // ---- focus (6) ----
    mkEvent({ type: "focus.completed", occurredAt: at(17, 9, 30), entityId: "f1", courseId: "c1", courseNameSnapshot: "数据结构与算法", data: { actualActiveMs: 45 * 60000, startedAt: at(17, 9, 30), plannedMinutes: 45 } }),
    mkEvent({ type: "focus.completed", occurredAt: at(17, 15, 0), entityId: "f2", courseId: "c1", data: { actualActiveMs: 60 * 60000, startedAt: at(17, 15, 0), plannedMinutes: 60 } }),
    mkEvent({ type: "focus.completed", occurredAt: at(18, 9, 30), entityId: "f3", courseId: "c2", courseNameSnapshot: "概率论", data: { actualActiveMs: 30 * 60000, startedAt: at(18, 9, 30), plannedMinutes: 30 } }),
    mkEvent({ type: "focus.completed", occurredAt: at(18, 19, 0), entityId: "f4", courseId: "c1", data: { actualActiveMs: 90 * 60000, startedAt: at(18, 19, 0), plannedMinutes: 90 } }),
    mkEvent({ type: "focus.completed", occurredAt: at(19, 10, 0), entityId: "f5", courseId: "c2", data: { actualActiveMs: 45 * 60000, startedAt: at(19, 10, 0), plannedMinutes: 45 } }),
    mkEvent({ type: "focus.completed", occurredAt: at(21, 20, 0), entityId: "f6", courseId: "c2", data: { actualActiveMs: 30 * 60000, startedAt: at(21, 20, 0), plannedMinutes: 30 } }),
  ];
  return events;
}

async function seedFullCoverage() {
  await setLearningHistoryCoverage({
    schemaVersion: 1,
    historyStartedAt: new Date(2026, 7, 1).getTime(),
    initializedAt: new Date(2026, 7, 1).getTime(),
    focusBackfillCompleted: true,
    backfilledFocusSessions: 0,
  });
}

beforeEach(async () => {
  await clearLearningHistoryStorage();
  await seedFullCoverage();
});

describe("Learning Analytics Snapshot（本周）", () => {
  it("spec A–F fixture 精确断言", async () => {
    await appendLearningHistoryEvents(buildFixture());
    const snapshot = await buildLearningAnalyticsSnapshot({
      preset: "week",
      semester: { id: SEMESTER.id, name: SEMESTER.name, startDate: SEMESTER.startDate, totalWeeks: SEMESTER.totalWeeks },
      now: NOW,
    });

    expect(snapshot.period.current.from).toBe(WEEK_FROM);
    expect(snapshot.period.current.to).toBe(NOW);
    expect(snapshot.period.previous!.from).toBe(PREV_WEEK_FROM);

    // overview
    expect(snapshot.overview.actualFocusMinutes).toBe(300);
    expect(snapshot.overview.actualFocusLabel).toBe("5h");
    expect(snapshot.overview.focusDeltaPercent).toBeNull(); // previous 无数据
    expect(snapshot.overview.completedAssignments).toBe(4);
    expect(snapshot.overview.plannedMinutes).toBe(285);
    expect(snapshot.overview.plannedLabel).toBe("4h 45m");
    expect(snapshot.overview.actualToPlanRatio).toBe(105);
    expect(snapshot.overview.onTimeEligible).toBe(3); // a2 无 DDL 不计
    expect(snapshot.overview.onTimeCount).toBe(2); // a1, a4 onTime；a3 late
    expect(snapshot.overview.onTimeRate).toBe(67);

    // execution
    expect(snapshot.execution.uniqueCompletedAssignments).toBe(4);
    expect(snapshot.execution.reopenedAssignments).toBe(1);
    expect(snapshot.execution.onTime).toBe(2);
    expect(snapshot.execution.late).toBe(1);
    expect(snapshot.execution.activeDays).toBe(4);
    expect(snapshot.execution.avgFocusSessionMinutes).toBe(50);

    // course investment
    expect(snapshot.courseInvestment).toHaveLength(2);
    expect(snapshot.courseInvestment[0].courseName).toBe("数据结构与算法");
    expect(snapshot.courseInvestment[0].minutes).toBe(195);
    expect(snapshot.courseInvestment[0].share).toBeCloseTo(0.65);
    expect(snapshot.courseInvestment[1].courseName).toBe("概率论");
    expect(snapshot.courseInvestment[1].minutes).toBe(105);

    // rhythm
    expect(snapshot.focusRhythm.activeDays).toBe(4);
    expect(snapshot.focusRhythm.averageSessionMinutes).toBe(50);
    expect(snapshot.focusRhythm.longestSessionMinutes).toBe(90);
    expect(snapshot.focusRhythm.dominantTimeOfDay).toBe("上午");
    expect(snapshot.focusRhythm.byTimeOfDay.find((b) => b.bucket === "晚间")!.minutes).toBe(120);

    // trend（day grain；8 天连续 bucket）
    expect(snapshot.trend.map((p) => p.key)).toEqual([
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
    ]);
    const d17 = snapshot.trend.find((p) => p.key === "2026-08-17")!;
    expect(d17.focusMinutes).toBe(105);
    expect(d17.plannedMinutes).toBe(90);
    const d18 = snapshot.trend.find((p) => p.key === "2026-08-18")!;
    expect(d18.focusMinutes).toBe(120);
    expect(d18.completedAssignments).toBe(2); // a1 + a3
    const d20 = snapshot.trend.find((p) => p.key === "2026-08-20")!;
    expect(d20.focusMinutes).toBe(0);
    expect(d20.completedAssignments).toBe(1); // a4
    const d22 = snapshot.trend.find((p) => p.key === "2026-08-22")!;
    expect(d22.plannedMinutes).toBe(45);

    // coverage
    expect(snapshot.coverage.fullCoverage).toBe(true);
    expect(snapshot.coverage.comparisonAvailable).toBe(false); // previous 无事件

    // signals：无 period change（比较不可用）；max 3
    expect(snapshot.signals.map((s) => s.id)).toEqual(["plan-actual", "deadline", "course-concentration"]);
    const deadline = snapshot.signals.find((s) => s.id === "deadline")!;
    expect(deadline.tone).toBe("attention");
    expect(deadline.action?.targetTab).toBe("assignments");
    expect(snapshot.isEmpty).toBe(false);
  });

  it("previous 有数据时 comparisonAvailable=true 且 focusDelta 计算", async () => {
    const events = buildFixture();
    events.push(
      mkEvent({
        type: "focus.completed",
        occurredAt: new Date(2026, 7, 12, 10, 0).getTime(),
        entityId: "f_prev",
        courseId: "c1",
        data: { actualActiveMs: 120 * 60000, startedAt: new Date(2026, 7, 12, 10, 0).getTime(), plannedMinutes: 120 },
      })
    );
    await appendLearningHistoryEvents(events);
    const snapshot = await buildLearningAnalyticsSnapshot({
      preset: "week",
      semester: SEMESTER,
      now: NOW,
    });
    expect(snapshot.coverage.comparisonAvailable).toBe(true);
    expect(snapshot.overview.focusDeltaPercent).toBe(150); // (300-120)/120
    expect(snapshot.signals.some((s) => s.id === "focus-up")).toBe(true);
  });

  it("historyStartedAt 晚于本周 → fullCoverage=false 且 comparisonAvailable=false", async () => {
    await clearLearningHistoryStorage();
    await setLearningHistoryCoverage({
      schemaVersion: 1,
      historyStartedAt: new Date(2026, 7, 19, 0, 0).getTime(),
      initializedAt: new Date(2026, 7, 19, 0, 0).getTime(),
      focusBackfillCompleted: true,
      backfilledFocusSessions: 0,
    });
    await appendLearningHistoryEvents(buildFixture());
    const snapshot = await buildLearningAnalyticsSnapshot({
      preset: "week",
      semester: SEMESTER,
      now: NOW,
    });
    expect(snapshot.coverage.fullCoverage).toBe(false);
    expect(snapshot.coverage.comparisonAvailable).toBe(false);
  });

  it("4weeks range：trendGrain=week，趋势按周聚合", async () => {
    await appendLearningHistoryEvents(buildFixture());
    const snapshot = await buildLearningAnalyticsSnapshot({
      preset: "4weeks",
      semester: SEMESTER,
      now: NOW,
    });
    expect(snapshot.period.trendGrain).toBe("week");
    expect(snapshot.trend.length).toBeGreaterThan(0);
    expect(snapshot.trend.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.key))).toBe(true);
  });

  it("semester range：previous=null，comparisonAvailable=false", async () => {
    await appendLearningHistoryEvents(buildFixture());
    const snapshot = await buildLearningAnalyticsSnapshot({
      preset: "semester",
      semester: SEMESTER,
      now: NOW,
    });
    expect(snapshot.period.previous).toBeNull();
    expect(snapshot.coverage.comparisonAvailable).toBe(false);
  });

  it("空历史 → isEmpty=true", async () => {
    const snapshot = await buildLearningAnalyticsSnapshot({
      preset: "week",
      semester: SEMESTER,
      now: NOW,
    });
    expect(snapshot.isEmpty).toBe(true);
    expect(snapshot.overview.actualFocusMinutes).toBe(0);
    expect(snapshot.signals).toEqual([]);
  });
});
