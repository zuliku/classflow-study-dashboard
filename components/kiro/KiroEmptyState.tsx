"use client";

import React from "react";
import { CalendarCheck, ListChecks, BookOpen, TrendingUp } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { KiroMark } from "@/components/kiro/KiroHeader";

/**
 * Kiro Empty State（Task 2）：恢复 ClassFlow Context 相关建议。
 * 有数据 / 无数据由本地确定性判断切换文案；点击 = 真实发送。
 */
export function KiroEmptyState({ onSuggestion, compact }: { onSuggestion: (text: string) => void; compact?: boolean }) {
  const courses = useAppStore((s) => s.courses);
  const assignments = useAppStore((s) => s.assignments);
  const schedules = useAppStore((s) => s.schedules);
  const hasData = courses.length > 0 || assignments.length > 0 || schedules.length > 0;

  const suggestions = hasData
    ? [
        { icon: CalendarCheck, label: "帮我规划今天", desc: "结合课表与 DDL 给出今日建议" },
        { icon: ListChecks, label: "查看最近 DDL", desc: "梳理未来几天的截止任务" },
        { icon: BookOpen, label: "看看我明天有什么课", desc: "基于当前周次查询课表" },
        { icon: TrendingUp, label: "分析本周学习负担", desc: "按课程与任务估算本周压力" },
      ]
    : [
        { icon: BookOpen, label: "了解 Kiro 能做什么", desc: "Kiro 会按需读取你的 ClassFlow 数据" },
        { icon: ListChecks, label: "制定一个学习计划", desc: "帮我把大目标拆成可执行步骤" },
        { icon: CalendarCheck, label: "解释一个知识点", desc: "用通俗方式讲清楚概念" },
      ];

  return (
    <div
      data-testid="kiro-empty"
      className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center text-center px-4 py-8"
    >
      <KiroMark size={compact ? "md" : "lg"} />
      <h2 className={compact ? "text-base font-bold text-charcoal mt-4" : "text-lg font-bold text-charcoal mt-5"}>
        今天想先处理什么？
      </h2>
      {!compact && (
        <p className="text-xs text-sandrift mt-1.5 max-w-xs">
          Kiro 会按需读取完成当前问题所需的 ClassFlow 学习数据。
        </p>
      )}

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
