/**
 * Kiro Canonical Analytics Tool（Analytics V2 · Part 2，Browser async executor）。
 * get_learning_analytics：返回与「学习洞察」页面同源的确定性 Analytics Snapshot。
 * 绝不复制 Analytics 算法：直接调用 buildLearningAnalyticsSnapshot；
 * 绝不访问 IndexedDB 之外的原始事件；Server 只提供 schema/description。
 */

import { getLearningAnalyticsSchema } from "@/lib/ai/tools/read/schemas";
import { ReadToolResult } from "@/lib/ai/tools/read/executor";
import { buildLearningAnalyticsSnapshot } from "@/lib/analytics/learningAnalytics";
import { flushLearningHistoryQueue } from "@/lib/history/recorder";
import { useAppStore } from "@/store/useAppStore";

export type AnalyticsToolErrorCode = "INVALID_INPUT" | "READ_FAILED";

function fail(code: AnalyticsToolErrorCode, message: string): ReadToolResult<unknown> {
  return { ok: false, code, message };
}

/**
 * 执行 get_learning_analytics（Browser 侧）。
 * - 执行前 flush History queue：用户刚完成任务立即提问也能拿到最新事实；
 * - semester 来自调用时 useAppStore.getState().semester（模型不拥有学期定义权）；
 * - 输出 = Snapshot 的 model-friendly 视图（无 IndexedDB events / 无内部 projection 状态）。
 */
export async function executeGetLearningAnalytics(input: unknown): Promise<ReadToolResult<unknown>> {
  const parsed = getLearningAnalyticsSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(
      "INVALID_INPUT",
      first ? `${first.path.join(".") || "输入"}: ${first.message}` : "输入不合法。"
    );
  }
  const { preset } = parsed.data;
  try {
    await flushLearningHistoryQueue();
    const semester = useAppStore.getState().semester;
    const snapshot = await buildLearningAnalyticsSnapshot({
      preset,
      semester: { id: semester.id, name: semester.name, startDate: semester.startDate, totalWeeks: semester.totalWeeks },
    });
    return { ok: true, data: toModelFriendlyOutput(snapshot) };
  } catch (err) {
    return fail("READ_FAILED", "暂时无法读取学习洞察，请稍后重试。");
  }
}

/** 输出与 UI 同源：只做裁剪（去 isEmpty 等内部字段），不重算任何指标 */
function toModelFriendlyOutput(snapshot: Awaited<ReturnType<typeof buildLearningAnalyticsSnapshot>>) {
  return {
    period: {
      preset: snapshot.period.preset,
      current: { from: snapshot.period.current.from, to: snapshot.period.current.to },
      previous: snapshot.period.previous
        ? { from: snapshot.period.previous.from, to: snapshot.period.previous.to }
        : null,
    },
    coverage: {
      fullCoverage: snapshot.coverage.fullCoverage,
      comparisonAvailable: snapshot.coverage.comparisonAvailable,
      historyStartedAt: snapshot.coverage.historyStartedAt,
      planCoverageFull: snapshot.coverage.planCoverageFull,
      planCoverageStartedAt: snapshot.coverage.planCoverageStartedAt,
      assignmentReliability: snapshot.coverage.assignmentReliability,
      planReliability: snapshot.coverage.planReliability,
      focusReliability: snapshot.coverage.focusReliability,
      focusBackfilled: snapshot.coverage.focusBackfilled,
    },
    overview: snapshot.overview,
    trend: snapshot.trend,
    courseInvestment: snapshot.courseInvestment,
    focusRhythm: snapshot.focusRhythm,
    execution: snapshot.execution,
    signals: snapshot.signals,
  };
}
