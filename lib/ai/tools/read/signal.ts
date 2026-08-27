/**
 * Kiro Learning Signal Drill-down（P3-轮3，Browser async executor）。
 * get_learning_signal：按 preset 构建 Analytics Snapshot，返回 signals 列表或单条信号的 evidence。
 */
import { getLearningSignalSchema } from "@/lib/ai/tools/read/schemas";
import { ReadToolResult } from "@/lib/ai/tools/read/executor";
import { buildLearningAnalyticsSnapshot } from "@/lib/analytics/learningAnalytics";
import { buildLearningSignals } from "@/lib/analytics/signals";
import { flushLearningHistoryQueue } from "@/lib/history/recorder";
import { useAppStore } from "@/store/useAppStore";

export type SignalToolErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "READ_FAILED";

function fail(code: SignalToolErrorCode, message: string): ReadToolResult<unknown> {
  return { ok: false, code, message };
}

export async function executeGetLearningSignal(input: unknown): Promise<ReadToolResult<unknown>> {
  const parsed = getLearningSignalSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail("INVALID_INPUT", first ? `${first.path.join(".") || "输入"}: ${first.message}` : "输入不合法。");
  }
  const { signalId, preset } = parsed.data;
  try {
    await flushLearningHistoryQueue();
    const semester = useAppStore.getState().semester;
    const snapshot = await buildLearningAnalyticsSnapshot({
      preset: preset ?? "week",
      semester: { id: semester.id, name: semester.name, startDate: semester.startDate, totalWeeks: semester.totalWeeks },
    });
    const signals = buildLearningSignals(snapshot, {
      previousFocusMinutes: null,
      plannedMinutes: (snapshot.overview as unknown as { plannedMinutes?: number }).plannedMinutes ?? 0,
    });

    if (signalId) {
      const hit = signals.find((s) => s.id === signalId);
      if (!hit) return fail("NOT_FOUND", `未找到信号 ${signalId}。可用：${signals.map((s) => s.id).join(", ") || "无"}`);
      // 根据 signalId 附加 evidence
      const evidence: Record<string, unknown> = {};
      if (hit.id === "focus-up" || hit.id === "focus-down") {
        evidence.currentFocusMinutes = snapshot.overview.actualFocusMinutes;
        evidence.previousFocusMinutes = snapshot.period.previous ? (snapshot.overview as unknown as Record<string, unknown>).previousFocusMinutes : null;
        evidence.comparisonAvailable = snapshot.coverage.comparisonAvailable;
      } else if (hit.id === "plan-actual") {
        evidence.actualToPlanRatio = snapshot.overview.actualToPlanRatio;
        evidence.plannedMinutes = snapshot.overview.plannedMinutes;
        evidence.actualFocusMinutes = snapshot.overview.actualFocusMinutes;
        evidence.planCoverageFull = snapshot.coverage.planCoverageFull;
      } else if (hit.id === "deadline") {
        evidence.onTimeEligible = snapshot.overview.onTimeEligible;
        evidence.onTimeCount = snapshot.overview.onTimeCount;
        evidence.onTimeRate = snapshot.overview.onTimeRate;
      } else if (hit.id === "course-concentration") {
        evidence.courseInvestment = snapshot.courseInvestment.slice(0, 3);
      } else if (hit.id === "focus-rhythm") {
        evidence.focusRhythm = snapshot.focusRhythm;
      }
      return { ok: true, data: { signal: hit, evidence, period: snapshot.period, coverage: { fullCoverage: snapshot.coverage.fullCoverage, planCoverageFull: snapshot.coverage.planCoverageFull } } };
    }

    return {
      ok: true,
      data: {
        preset: preset ?? "week",
        period: snapshot.period,
        coverage: { fullCoverage: snapshot.coverage.fullCoverage, comparisonAvailable: snapshot.coverage.comparisonAvailable },
        signals,
        totalSignals: signals.length,
      },
    };
  } catch (err) {
    return fail("READ_FAILED", "暂时无法读取学习信号，请稍后重试。");
  }
}
