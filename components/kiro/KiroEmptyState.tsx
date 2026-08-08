"use client";

import React from "react";
import {
  CalendarClock,
  ClipboardList,
  BarChart3,
  BookOpenCheck,
  FileUp,
  Compass,
  PlusCircle,
  Info,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { KiroMark } from "@/components/kiro/KiroHeader";

/**
 * Kiro Empty State：主要完成状态。
 * 有学习数据 / 无学习数据 由本地确定性判断（courses/assignments/schedules 是否为空）切换 suggestion copy，
 * 不调用 AI、不做动态分析。
 */
export function KiroEmptyState({
  onSuggestion,
}: {
  /** 点击 suggestion = 以该文案发送一条本地 preview message */
  onSuggestion: (text: string) => void;
}) {
  const courses = useAppStore((s) => s.courses);
  const assignments = useAppStore((s) => s.assignments);
  const schedules = useAppStore((s) => s.schedules);
  const hasData = courses.length > 0 || assignments.length > 0 || schedules.length > 0;

  const suggestions = hasData
    ? [
        { icon: CalendarClock, label: "安排今天的任务", desc: "根据当前 DDL 排出今天的优先级" },
        { icon: ClipboardList, label: "查看最近 DDL", desc: "梳理近 7 天即将到期的任务" },
        { icon: BarChart3, label: "分析本周学习负担", desc: "按课表与任务估算本周压力" },
        { icon: BookOpenCheck, label: "制定复习计划", desc: "围绕近期考试生成复习安排" },
      ]
    : [
        { icon: FileUp, label: "上传资料开始学习", desc: "从课程资料出发了解你的学习" },
        { icon: Compass, label: "帮我规划学习", desc: "建立学期目标与周计划" },
        { icon: PlusCircle, label: "添加学习任务", desc: "创建任务与截止时间" },
        { icon: Info, label: "了解 Kiro 能做什么", desc: "Kiro 会结合你的 ClassFlow 数据工作" },
      ];

  return (
    <div
      data-testid="kiro-empty"
      className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center text-center px-4 py-8"
    >
      <KiroMark size="lg" />
      <h2 className="text-lg font-bold text-charcoal mt-5">今天想先处理什么？</h2>
      <p className="text-xs text-sandrift mt-1.5 max-w-xs">
        {hasData ? "告诉我你的安排，Kiro 会结合课程、任务与课表来帮你。" : "Kiro 会从你的课程、任务与课表中了解你的学习。"}
      </p>

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
