"use client";

import React from "react";
import {
  Scissors,
  Clock,
  ClipboardList,
  FileText,
  BookOpen,
  CalendarRange,
  Target,
  TrendingUp,
  Users,
  TriangleAlert,
  Hourglass,
  RefreshCw,
  Lightbulb,
} from "lucide-react";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { cn } from "@/lib/utils";

const SUGGESTIONS: Record<string, { icon: React.ComponentType<{ className?: string }>; label: string }[]> = {
  assignment: [
    { icon: Scissors, label: "拆分这个任务" },
    { icon: Clock, label: "调整截止时间" },
    { icon: ClipboardList, label: "制定完成计划" },
    { icon: FileText, label: "总结任务要求" },
  ],
  course: [
    { icon: BookOpen, label: "总结这门课程" },
    { icon: CalendarRange, label: "安排复习计划" },
    { icon: Target, label: "分析最近任务" },
    { icon: FileText, label: "根据课程资料学习" },
  ],
  "group-project": [
    { icon: Scissors, label: "拆分项目任务" },
    { icon: TrendingUp, label: "总结项目进度" },
    { icon: Clock, label: "检查即将截止任务" },
    { icon: Users, label: "重新规划任务分工" },
  ],
  week: [
    { icon: CalendarRange, label: "帮我调整本周课表" },
    { icon: TriangleAlert, label: "检查时间冲突" },
    { icon: Hourglass, label: "查看本周空闲时间" },
    { icon: RefreshCw, label: "把某门课调到其他时间" },
  ],
  generic: [
    { icon: Lightbulb, label: "了解当前页面" },
    { icon: Target, label: "帮我规划下一步" },
  ],
};

/**
 * 上下文建议：按 entry type 返回本地确定性快捷 Prompt。
 * 无消息时渲染在 EmptyState 标题下方（EmptyState 的主操作区）；
 * 已有消息时可作为 Conversation 尾部的 follow-up 建议。
 * 点击才发送，不调用模型生成。
 * 有 Entry Context 时是唯一建议区（EmptyState 通用建议被隐藏，见 KiroChatSurface）。
 */
export function KiroContextSuggestions({ compact, inset }: { compact?: boolean; inset?: boolean }) {
  const session = useKiroSession();
  const kind = session.suggestionsKind;
  if (!kind) return null;
  if (session.suggestionsGen <= session.lastUserTurnGen) return null;

  const items = SUGGESTIONS[kind] ?? [];
  return (
    <div
      data-testid="kiro-context-suggestions"
      className={cn("shrink-0", inset ? (compact ? "px-3 pb-1.5" : "px-1 pb-1.5") : "pb-0")}
    >
      <div className={cn("flex flex-wrap gap-1.5", !inset && "justify-center")}>
        {items.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.label}
              onClick={() => session.chat.send(s.label)}
              className={cnChip(compact)}
            >
              <Icon className="w-4 h-4 text-sandrift" />
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function cnChip(compact?: boolean) {
  return `ux-press flex items-center gap-1.5 rounded-lg border border-line bg-[#F7F5F5] text-[11px] font-semibold text-satin-grey hover:text-charcoal hover:border-line-strong transition-colors ${
    compact ? "px-2 py-1" : "px-2.5 py-1.5"
  }`;
}
