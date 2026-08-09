"use client";

import React from "react";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";

const SUGGESTIONS: Record<string, { icon: string; label: string }[]> = {
  assignment: [
    { icon: "✂", label: "拆分这个任务" },
    { icon: "⏰", label: "调整截止时间" },
    { icon: "📋", label: "制定完成计划" },
    { icon: "📝", label: "总结任务要求" },
  ],
  course: [
    { icon: "📚", label: "总结这门课程" },
    { icon: "🗓", label: "安排复习计划" },
    { icon: "🎯", label: "分析最近任务" },
    { icon: "📄", label: "根据课程资料学习" },
  ],
  "group-project": [
    { icon: "✂", label: "拆分项目任务" },
    { icon: "📈", label: "总结项目进度" },
    { icon: "⏰", label: "检查即将截止任务" },
    { icon: "👥", label: "重新规划任务分工" },
  ],
  week: [
    { icon: "🗓", label: "帮我调整本周课表" },
    { icon: "⚠", label: "检查时间冲突" },
    { icon: "⏳", label: "查看本周空闲时间" },
    { icon: "🔁", label: "把某门课调到其他时间" },
  ],
  generic: [
    { icon: "💡", label: "了解当前页面" },
    { icon: "🎯", label: "帮我规划下一步" },
  ],
};

/**
 * 上下文建议（Sidecar 专用）：按 entry type 返回本地确定性快捷 Prompt。
 * 只在 Sidecar 刚打开且没有针对该 Entry 的新 User Message 时显示。
 * 点击才发送，不调用模型生成。
 */
export function KiroContextSuggestions({ compact }: { compact?: boolean }) {
  const session = useKiroSession();
  const kind = session.suggestionsKind;
  if (!kind) return null;
  if (session.suggestionsGen <= session.lastUserTurnGen) return null;

  const items = SUGGESTIONS[kind] ?? [];
  return (
    <div data-testid="kiro-context-suggestions" className="shrink-0 px-1 pb-1.5">
      <div className="flex flex-wrap gap-1.5">
        {items.map((s) => (
          <button
            key={s.label}
            onClick={() => session.chat.send(s.label)}
            className={cnChip(compact)}
          >
            <span className="text-sandrift">{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function cnChip(compact?: boolean) {
  return `ux-press flex items-center gap-1.5 rounded-lg border border-line bg-[#F7F5F5] text-[11px] font-semibold text-satin-grey hover:text-charcoal hover:border-line-strong transition-colors ${
    compact ? "px-2 py-1" : "px-2.5 py-1.5"
  }`;
}
