"use client";

import React from "react";
import { TrendingUp, Target, CalendarCheck2, Clock } from "lucide-react";
import { LearningSignal, LearningSignalTone } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

const TONE_STYLE: Record<LearningSignalTone, { icon: typeof TrendingUp; cls: string }> = {
  positive: { icon: TrendingUp, cls: "text-success" },
  neutral: { icon: Target, cls: "text-sandrift" },
  attention: { icon: CalendarCheck2, cls: "text-warning" },
};

/** 学习信号卡（最多 3 条 primary signals；可解释事实，非评分） */
export function LearningSignalsCard({
  signals,
  onNavigate,
}: {
  signals: LearningSignal[];
  onNavigate?: (tab: "assignments" | "timetable" | "courses") => void;
}) {
  if (signals.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle">
        <h3 className="text-sm font-bold text-charcoal pb-2 border-b border-[#F0EBE1]">学习信号</h3>
        <div className="py-6 text-center">
          <Clock className="w-6 h-6 text-sandrift mx-auto mb-1.5" />
          <p className="text-[11px] text-sandrift">数据积累后会在这里展示可解释的学习信号</p>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle">
      <h3 className="text-sm font-bold text-charcoal pb-2 border-b border-[#F0EBE1]">学习信号</h3>
      <div className="divide-y divide-line-soft">
        {signals.map((signal) => {
          const Icon = TONE_STYLE[signal.tone].icon;
          return (
            <div key={signal.id} className="py-2.5 space-y-1">
              <p className="flex items-center gap-1.5 text-xs font-bold text-charcoal">
                <Icon className={cn("w-3.5 h-3.5 shrink-0", TONE_STYLE[signal.tone].cls)} />
                {signal.title}
              </p>
              <p className="text-[11px] text-satin-grey leading-relaxed">{signal.description}</p>
              {signal.action && onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate(signal.action!.targetTab)}
                  className="text-[10px] font-bold text-charcoal bg-white border border-line rounded-lg px-2 py-1 hover:border-line-strong transition-colors"
                >
                  {signal.action.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
