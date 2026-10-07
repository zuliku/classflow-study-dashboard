import type { AnalyticsOverview, LearningSignal } from "@/lib/analytics/types";

export type AnalyticsVerdictTone = "good" | "warn" | "flat";

export interface AnalyticsVerdict {
  tone: AnalyticsVerdictTone;
  /** 一句话结论（Screen Time 式）：直接给判断，不复述数据 */
  headline: string;
  /** 依据（一句，引用已有口径数字） */
  detail: string;
  actionLabel: string;
  actionTab: "assignments" | "timetable" | "courses";
}

interface VerdictInput {
  signals: LearningSignal[];
  overview: Pick<AnalyticsOverview, "focusDeltaPercent" | "completedAssignments" | "onTimeRate">;
  comparisonAvailable: boolean;
}

const FALLBACK_ACTION = { actionLabel: "查看任务", actionTab: "assignments" } as const;

/**
 * 洞察结论（一句话）：把 signals 翻译成判断 + 下一步。
 * 优先级：attention（风险先行）> positive（保持）> neutral/无信号（平稳）。
 * 只消费已有口径（不发明数字）；文案新增，与 presentation.ts 现有文案无耦合。
 */
export function buildAnalyticsVerdict(input: VerdictInput): AnalyticsVerdict {
  const { signals, overview, comparisonAvailable } = input;
  const delta =
    comparisonAvailable && overview.focusDeltaPercent !== null
      ? `${overview.focusDeltaPercent >= 0 ? "↑" : "↓"} ${Math.abs(overview.focusDeltaPercent)}%`
      : null;

  const attention = signals.find((s) => s.tone === "attention");
  if (attention) {
    return {
      tone: "warn",
      headline: attention.title,
      detail: [attention.description, delta ? `专注${delta}` : null].filter(Boolean).join(" · "),
      actionLabel: attention.action?.label ?? "去排期",
      actionTab: attention.action?.targetTab ?? "assignments",
    };
  }

  const positive = signals.find((s) => s.tone === "positive");
  if (positive) {
    const done = overview.completedAssignments;
    return {
      tone: "good",
      headline: "本周节奏稳健",
      detail: [positive.description, delta ? `专注${delta}` : null, done > 0 ? `完成 ${done} 项` : null]
        .filter(Boolean)
        .join(" · "),
      actionLabel: positive.action?.label ?? FALLBACK_ACTION.actionLabel,
      actionTab: positive.action?.targetTab ?? FALLBACK_ACTION.actionTab,
    };
  }

  const first = signals[0];
  if (first) {
    return {
      tone: "flat",
      headline: "保持稳定",
      detail: [first.description, delta ? `专注${delta}` : null].filter(Boolean).join(" · "),
      actionLabel: first.action?.label ?? FALLBACK_ACTION.actionLabel,
      actionTab: first.action?.targetTab ?? FALLBACK_ACTION.actionTab,
    };
  }

  return {
    tone: "flat",
    headline: "数据积累中",
    detail: "完成任务或记录专注后，这里会给出本周结论",
    ...FALLBACK_ACTION,
  };
}
