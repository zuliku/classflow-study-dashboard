"use client";

import React, { useMemo, useState } from "react";
import { BookOpen, ClipboardCheck, CalendarRange, Users2, FileText, Search, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { KiroContextRef } from "@/lib/ai/context/types";
import { getKiroContextGroups } from "@/lib/ai/context/options";
import { cn } from "@/lib/utils";

/**
 * ClassFlow Context 列表（@ 与 Composer Add Menu 共用）：
 * 从 Store 实时读取真实实体（属于 UI，不构建 Prompt、不发送数据）。
 * 分组与上限由 lib/ai/context/options 唯一提供（@ mention 菜单同源）。
 * 分类：课程 / 任务 / 时间范围 / 小组项目 / 课程资料。
 * showSearch：Add Menu 内 Codex-style 小搜索（@ 菜单本身即 query 过滤，不需要）。
 */
export function KiroContextListView({
  onPick,
  compact,
  showSearch,
}: {
  onPick: (ref: KiroContextRef) => void;
  compact?: boolean;
  showSearch?: boolean;
}) {
  const courses = useAppStore((s) => s.courses);
  const assignments = useAppStore((s) => s.assignments);
  const groupProjects = useAppStore((s) => s.groupProjects);
  const [query, setQuery] = useState("");

  const rowCls = cn(
    "w-full flex items-center gap-2.5 px-3 rounded-lg text-left text-xs font-semibold text-charcoal hover:bg-alabaster transition-colors",
    compact ? "py-2" : "py-2.5"
  );
  const iconCls = "w-4 h-4 text-sandrift shrink-0";

  const q = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    const all = getKiroContextGroups(courses, assignments, groupProjects);
    if (!q) return all;
    return all
      .map((g) => ({ ...g, items: g.items.filter((it) => it.label.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [courses, assignments, groupProjects, q]);

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
      {showSearch && (
        <div className="px-1">
          <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line-soft bg-background focus-within:border-line-strong transition-colors">
            <Search className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索上下文..."
              aria-label="搜索上下文"
              className="flex-1 min-w-0 bg-transparent text-xs text-charcoal placeholder:text-sandrift/70 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="清空搜索"
                className="p-0.5 rounded text-sandrift hover:text-charcoal transition-colors shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}
      {visibleGroups.length === 0 && (
        <p className="px-3 py-2 text-xs text-sandrift">{q ? "无匹配结果" : "暂无可用上下文"}</p>
      )}
      {visibleGroups.map((g) => (
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
