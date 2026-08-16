"use client";

import React from "react";
import { TrendingUp, Target, CalendarCheck2, Sparkles, ChevronRight } from "lucide-react";
import { LearningSignal, LearningSignalTone } from "@/lib/analytics/types";
import { useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { cn } from "@/lib/utils";

const TONE_STYLE: Record<LearningSignalTone, { icon: typeof TrendingUp; cls: string }> = {
  positive: { icon: TrendingUp, cls: "text-success" },
  neutral: { icon: Target, cls: "text-sandrift" },
  attention: { icon: CalendarCheck2, cls: "text-warning" },
};

/** Signal → Kiro intent（不带数字快照：Kiro 收到后会调用 get_learning_analytics 取最新事实） */
const SIGNAL_KIRO_PROMPTS: Record<string, string> = {
  deadline: "结合我当前的学习洞察，帮我分析最近的截止节奏，并看看未来任务是否需要提前安排。",
  "plan-actual": "结合我当前的学习洞察，帮我分析最近计划学习与实际专注的差异，并给出下阶段调整建议。",
  "course-concentration": "结合我的学习洞察，看看最近课程投入是否需要调整。",
  "focus-rhythm": "结合我的学习洞察，分析最近的专注时间分布，并给出安排建议。",
  "focus-up": "结合我的学习洞察，分析我最近专注投入变化的原因，并看看怎么保持。",
  "focus-down": "结合我的学习洞察，分析我最近专注投入下降的原因，并给出恢复投入的建议。",
};

/** 学习信号卡（最多 3 条 primary signals；可解释事实，非评分） */
export function LearningSignalsCard({
  signals,
  onNavigate,
}: {
  signals: LearningSignal[];
  onNavigate?: (tab: "assignments" | "timetable" | "courses") => void;
}) {
  const { handoffPrompt } = useKiroSessionActions();

  if (signals.length === 0) {
    // V3.1：紧凑 Level 3 contextual state（不制造高卡空洞）
    return (
      <div className="bg-alabaster/50 border border-line rounded-xl px-3.5 py-3 h-fit self-start" data-testid="learning-signals-card">
        <h3 className="text-[11px] font-bold text-charcoal">值得注意</h3>
        <p className="text-[10px] text-sandrift mt-0.5">目前没有明显需要调整的信号</p>
      </div>
    );
  }
  return (
    <div className="bg-surface border border-line rounded-2xl p-4 h-fit self-start" data-testid="learning-signals-card">
      <h3 className="text-sm font-bold text-charcoal">值得注意</h3>
      <div className="divide-y divide-line-soft pt-2">
        {signals.map((signal) => {
          const Icon = TONE_STYLE[signal.tone].icon;
          const kiroPrompt = SIGNAL_KIRO_PROMPTS[signal.id] ?? undefined;
          return (
            <div key={signal.id} className="py-2.5 space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-bold text-charcoal">
                <Icon className={cn("w-3.5 h-3.5 shrink-0", TONE_STYLE[signal.tone].cls)} />
                {signal.title}
              </p>
              <p className="text-[11px] text-satin-grey leading-relaxed">{signal.description}</p>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {signal.action && onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate(signal.action!.targetTab)}
                    className="inline-flex items-center gap-0.5 text-[11px] font-bold text-charcoal hover:text-black transition-colors"
                  >
                    {signal.action.label}
                    <ChevronRight className="w-3 h-3" />
                  </button>
                )}
                {kiroPrompt && (
                  <button
                    type="button"
                    onClick={() => handoffPrompt(kiroPrompt)}
                    className="inline-flex items-center gap-1 text-[10px] font-bold text-sandrift hover:text-charcoal transition-colors"
                  >
                    <Sparkles className="w-3 h-3" />
                    问 Kiro
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
