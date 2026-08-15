/**
 * Weekly Review（Analytics V2 · Part 2）：
 * 纯函数：只把 LearningAnalyticsSnapshot("week") 重新组织成「回顾」模型。
 * 禁止 import lib/history/* 或 lib/analytics/*Projection —— 绝不重新查询 / 重新计算底层指标。
 * 全部文案 deterministic；只报告事实，不评价（无"表现优秀/效率高/自律"）。
 */

import {
  CourseInvestment,
  FocusTimeOfDay,
  LearningAnalyticsSnapshot,
  LearningSignal,
} from "@/lib/analytics/types";
import { formatDurationLabel } from "@/lib/analytics/learningAnalytics";

export interface WeeklyReview {
  range: {
    from: number;
    to: number;
  };
  coverage: {
    fullCoverage: boolean;
    comparisonAvailable: boolean;
  };
  headline: {
    focusMinutes: number;
    focusLabel: string;
    completedAssignments: number;
    plannedMinutes: number;
    plannedLabel: string;
    actualToPlanRatio: number | null;
    onTimeRate: number | null;
    onTimeCount: number;
    onTimeEligible: number;
    activeDays: number;
  };
  change: {
    focusDeltaPercent: number | null;
    /** comparisonAvailable=false 时给出替代文案 */
    comparisonUnavailable: boolean;
  };
  investment: {
    topCourse: CourseInvestment | null;
  };
  rhythm: {
    activeDays: number;
    averageSessionMinutes: number | null;
    dominantTimeOfDay: FocusTimeOfDay | null;
  };
  highlights: LearningSignal[];
  attention: LearningSignal[];
}

/** 只读投影：所有字段必须来自 snapshot，禁止自行计算新指标 */
export function buildWeeklyReview(snapshot: LearningAnalyticsSnapshot): WeeklyReview {
  const { overview, coverage, courseInvestment, focusRhythm, signals } = snapshot;

  return {
    range: {
      from: snapshot.period.current.from,
      to: snapshot.period.current.to,
    },
    coverage: {
      fullCoverage: coverage.fullCoverage,
      comparisonAvailable: coverage.comparisonAvailable,
    },
    headline: {
      focusMinutes: overview.actualFocusMinutes,
      focusLabel: overview.actualFocusLabel,
      completedAssignments: overview.completedAssignments,
      plannedMinutes: overview.plannedMinutes,
      plannedLabel: overview.plannedLabel,
      actualToPlanRatio: overview.actualToPlanRatio,
      onTimeRate: overview.onTimeRate,
      onTimeCount: overview.onTimeCount,
      onTimeEligible: overview.onTimeEligible,
      activeDays: focusRhythm.activeDays,
    },
    change: {
      focusDeltaPercent: overview.focusDeltaPercent,
      comparisonUnavailable: !coverage.comparisonAvailable,
    },
    investment: {
      topCourse: courseInvestment.length > 0 ? courseInvestment[0] : null,
    },
    rhythm: {
      activeDays: focusRhythm.activeDays,
      averageSessionMinutes: focusRhythm.averageSessionMinutes,
      dominantTimeOfDay: focusRhythm.dominantTimeOfDay,
    },
    highlights: signals.filter((s) => s.tone === "positive" || s.tone === "neutral"),
    attention: signals.filter((s) => s.tone === "attention"),
  };
}

export interface WeeklyReviewCopy {
  headlineLines: string[];
  planActualLines: string[];
  investmentLines: string[];
  deadlineLines: string[];
  changeLines: string[];
  highlightLines: string[];
  attentionLines: string[];
}

/** 回顾文案（deterministic；不评价只报事实；空值给"暂无记录"而非 0 伪装） */
export function weeklyReviewCopy(review: WeeklyReview): WeeklyReviewCopy {
  const { headline, change, investment, rhythm, coverage, highlights, attention } = review;

  const headlineLines: string[] = [];
  if (headline.focusMinutes > 0) {
    headlineLines.push(`本周投入：${headline.focusLabel} 专注`);
  }
  if (headline.completedAssignments > 0) {
    headlineLines.push(`完成 ${headline.completedAssignments} 项任务`);
  }
  if (rhythm.activeDays > 0) {
    headlineLines.push(`${rhythm.activeDays} 天有专注记录`);
  }

  const planActualLines: string[] = [];
  if (headline.plannedMinutes > 0) {
    planActualLines.push(`计划 ${headline.plannedLabel}`);
    if (headline.actualToPlanRatio !== null) {
      planActualLines.push(`实际专注约为计划时长的 ${headline.actualToPlanRatio}%`);
    }
  } else if (headline.focusMinutes > 0) {
    planActualLines.push("本周暂无已到达开始时间的有效计划");
  }

  const investmentLines: string[] = [];
  if (investment.topCourse && investment.topCourse.minutes > 0) {
    investmentLines.push(
      `《${investment.topCourse.courseName}》${formatDurationLabel(investment.topCourse.minutes)} · 本周专注时间的 ${Math.round(
        investment.topCourse.share * 100
      )}%`
    );
  }

  const deadlineLines: string[] = [];
  if (headline.onTimeRate !== null && headline.completedAssignments > 0) {
    deadlineLines.push(`按时完成 ${headline.onTimeRate}%`);
  } else {
    deadlineLines.push("暂无可靠截止时间可判断");
  }

  const changeLines: string[] = [];
  if (coverage.comparisonAvailable && change.focusDeltaPercent !== null) {
    const pct = change.focusDeltaPercent;
    changeLines.push(`较上周同期 ${pct >= 0 ? "+" : ""}${pct}% 专注时间`);
  } else {
    changeLines.push("历史不足，暂无法与上周同期比较");
  }

  const highlightLines = highlights.map((s) => s.description);
  const attentionLines = attention.map((s) => s.description);

  return {
    headlineLines,
    planActualLines,
    investmentLines,
    deadlineLines,
    changeLines,
    highlightLines,
    attentionLines,
  };
}
