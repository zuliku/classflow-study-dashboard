"use client";

import React from "react";
import { CalendarRange, ListChecks, BookOpen, Target } from "lucide-react";
import { KiroMark } from "@/components/kiro/KiroHeader";

/**
 * Kiro Empty State（Task 1）：
 * 模型尚未获得 ClassFlow Context，suggestion 使用通用学习辅助文案，
 * Task 2 接入 Context 后再恢复「查看最近 DDL / 分析本周负担」。
 */
export function KiroEmptyState({ onSuggestion }: { onSuggestion: (text: string) => void }) {
  const suggestions = [
    { icon: CalendarRange, label: "制定一个学习计划", desc: "帮我规划今天的学习" },
    { icon: ListChecks, label: "帮我拆解一个复杂任务", desc: "把大任务拆成可执行步骤" },
    { icon: BookOpen, label: "解释一个知识点", desc: "用通俗方式讲清楚概念" },
    { icon: Target, label: "规划今天的学习方法", desc: "给出一套高效的执行思路" },
  ];

  return (
    <div
      data-testid="kiro-empty"
      className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center text-center px-4 py-8"
    >
      <KiroMark size="lg" />
      <h2 className="text-lg font-bold text-charcoal mt-5">今天想先处理什么？</h2>
      <p className="text-xs text-sandrift mt-1.5 max-w-xs">告诉我你的问题，Kiro 会直接回答。</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-7 w-full max-w-md">
        {suggestions.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.label}
              onClick={() => onSuggestion(s.label)}
              className="ux-press flex items-start gap-2.5 p-3 bg-surface border border-line rounded-xl text-left hover:bg-alabaster hover:border-line-strong transition-colors duration-[var(--motion-fast)] group"
            >
              <Icon className="w-4 h-4 text-sandrift group-hover:text-charcoal shrink-0 mt-0.5" />
              <span className="min-w-0">
                <span className="block text-xs font-bold text-charcoal">{s.label}</span>
                <span className="block text-[10px] text-sandrift mt-0.5 leading-relaxed">{s.desc}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
