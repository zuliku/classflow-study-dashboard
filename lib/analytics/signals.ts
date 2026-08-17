/**
 * Learning Signals（Analytics V2）：
 * deterministic、可解释事实；不调用 AI；最多 3 条 primary signals。
 * 禁止把投入称为效率；禁止综合学习分数。
 */

import { LearningAnalyticsSnapshot, LearningSignal } from "@/lib/analytics/types";

export interface SignalContext {
  previousFocusMinutes: number | null;
  plannedMinutes: number;
}

export function buildLearningSignals(
  snapshot: LearningAnalyticsSnapshot,
  context: SignalContext
): LearningSignal[] {
  const { overview, coverage, focusRhythm, courseInvestment } = snapshot;
  const signals: LearningSignal[] = [];
  const { previousFocusMinutes, plannedMinutes } = context;

  // 1. 明显的 period change（专注趋势）
  if (coverage.comparisonAvailable && previousFocusMinutes !== null) {
    const current = overview.actualFocusMinutes;
    if (current >= 60 && previousFocusMinutes >= 60 && current !== previousFocusMinutes) {
      const delta = Math.round(((current - previousFocusMinutes) / previousFocusMinutes) * 100);
      if (delta > 0) {
        signals.push({
          id: "focus-up",
          tone: "positive",
          title: "专注投入增加",
          description: `本周期较上一周期 +${delta}%`,
        });
      } else if (delta < 0) {
        signals.push({
          id: "focus-down",
          tone: "attention",
          title: "专注投入减少",
          description: `本周期较上一周期 ${delta}%`,
        });
      }
    }
  }

  // 2. 计划 / 实际（计划序列不完整时不得输出 ratio 信号）
  if (snapshot.coverage.planCoverageFull && plannedMinutes >= 120 && overview.actualToPlanRatio !== null) {
    signals.push({
      id: "plan-actual",
      tone: overview.actualToPlanRatio >= 100 ? "positive" : "neutral",
      title: "计划与实际",
      description: `实际专注约为计划时长的 ${overview.actualToPlanRatio}%`,
    });
  }

  // 3. Deadline
  if (overview.onTimeEligible >= 3) {
    const rate = overview.onTimeRate ?? 0;
    signals.push({
      id: "deadline",
      tone: rate >= 70 ? "positive" : "attention",
      title: "截止节奏",
      description: `${overview.onTimeEligible} 个可判断任务中，${overview.onTimeCount} 个按时完成`,
      action:
        rate < 70
          ? {
              label: "查看任务",
              targetTab: "assignments" as const,
            }
          : undefined,
    });
  }

  // 4. Course concentration
  if (snapshot.overview.actualFocusMinutes >= 120 && courseInvestment.length > 0) {
    const top = courseInvestment[0];
    if (top.share >= 0.45) {
      signals.push({
        id: "course-concentration",
        tone: "neutral",
        title: "投入集中",
        description: `本周期 ${Math.round(top.share * 100)}% 的专注时间投入在《${top.courseName}》`,
      });
    }
  }

  // 5. Focus rhythm（样本阈值：5 sessions + 120 min）
  if (focusRhythm.dominantTimeOfDay !== null) {
    signals.push({
      id: "focus-rhythm",
      tone: "neutral",
      title: "专注时段",
      description: `你的专注主要集中在${focusRhythm.dominantTimeOfDay}`,
    });
  }

  // 最多 3 条 primary signals（按优先级顺序保留）
  return signals.slice(0, 3);
}
