"use client";

import React from "react";
import { BookOpen, ClipboardCheck, CalendarRange, Users2, FileText } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { KiroContextRef } from "@/lib/ai/context/types";
import { getKiroContextGroups } from "@/lib/ai/context/options";
import { cn } from "@/lib/utils";

/**
 * ClassFlow Context 列表（@ 与 Composer Add Menu 共用）：
 * 从 Store 实时读取真实实体（属于 UI，不构建 Prompt、不发送数据）。
 * 分组与上限由 lib/ai/context/options 唯一提供（@ mention 菜单同源）。
 * 分类：课程 / 任务 / 时间范围 / 小组项目 / 课程资料。
 */
export function KiroContextListView({
  onPick,
  compact,
}: {
  onPick: (ref: KiroContextRef) => void;
  compact?: boolean;
}) {
  const courses = useAppStore((s) => s.courses);
  const assignments = useAppStore((s) => s.assignments);
  const groupProjects = useAppStore((s) => s.groupProjects);

  const rowCls = cn(
    "w-full flex items-center gap-2.5 px-3 rounded-lg text-left text-xs font-semibold text-charcoal hover:bg-alabaster transition-colors",
    compact ? "py-2" : "py-2.5"
  );
  const iconCls = "w-4 h-4 text-sandrift shrink-0";

  const groups = getKiroContextGroups(courses, assignments, groupProjects);

  const itemIcon = (kind: KiroContextRef["kind"]) =>
    kind === "course"
      ? BookOpen
      : kind === "assignment"
        ? ClipboardCheck
        : kind === "week"
          ? CalendarRange
          : kind === "group-project"
            ? Users2
            : FileText;

  return (
    <div className="space-y-2.5" role="menu" aria-label="选择上下文">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="px-3 pb-1 text-[10px] font-bold text-sandrift uppercase tracking-wider">{g.title}</p>
          <div className="space-y-0.5">
            {g.items.map((it) => {
              const Icon = itemIcon(it.kind);
              return (
                <button key={it.key} type="button" role="menuitem" onClick={() => onPick(it)} className={rowCls}>
                  <Icon className={iconCls} />
                  <span className="min-w-0 truncate">{it.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
