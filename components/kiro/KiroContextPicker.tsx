"use client";

import React, { useEffect, useRef } from "react";
import { BookOpen, ClipboardCheck, CalendarRange, Users2, FileText } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { KiroContextChip } from "@/components/kiro/KiroContextBar";
import { cn } from "@/lib/utils";

/**
 * Context Picker（@）：从当前 Store 读取真实实体名称用于展示（属于 UI，不构建 Prompt、不发送数据）。
 * 分类预留：课程 / 任务 / 时间范围 / 小组项目 / 课程资料。
 * Desktop：absolute 弹层；Mobile：底部 sheet（适合移动端触控）。
 */
export function KiroContextPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (chip: KiroContextChip) => void;
}) {
  const courses = useAppStore((s) => s.courses);
  const assignments = useAppStore((s) => s.assignments);
  const groupProjects = useAppStore((s) => s.groupProjects);
  const contentDensity = useAppStore((s) => s.preferences.contentDensity);
  const compact = contentDensity === "compact";
  const mobilePanelRef = useRef<HTMLDivElement | null>(null);
  const desktopPanelRef = useRef<HTMLDivElement | null>(null);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 点击外部关闭（mobile / desktop 两套面板同时挂载，分别检查）
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      const inside =
        (mobilePanelRef.current?.contains(t) ?? false) || (desktopPanelRef.current?.contains(t) ?? false);
      if (!inside) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  const rowCls = cn(
    "w-full flex items-center gap-2.5 px-3 rounded-lg text-left text-xs font-semibold text-charcoal hover:bg-alabaster transition-colors",
    compact ? "py-2" : "py-2.5"
  );
  const iconCls = "w-4 h-4 text-sandrift shrink-0";

  const groups: {
    title: string;
    items: { id: string; label: string; kind: KiroContextChip["kind"]; sub?: string }[];
  }[] = [
    {
      title: "课程",
      items: courses.slice(0, 8).map((c) => ({ id: `course-${c.id}`, kind: "course" as const, label: c.name, sub: c.code })),
    },
    {
      title: "任务",
      items: assignments.slice(0, 8).map((a) => ({ id: `assignment-${a.id}`, kind: "assignment" as const, label: a.title })),
    },
    {
      title: "课表 / 时间范围",
      items: [
        { id: "range-week", kind: "range" as const, label: "本周" },
        { id: "range-month", kind: "range" as const, label: "本月" },
        { id: "range-semester", kind: "range" as const, label: "本学期" },
      ],
    },
    {
      title: "小组项目",
      items: groupProjects.slice(0, 6).map((p) => ({ id: `project-${p.id}`, kind: "project" as const, label: p.title })),
    },
    {
      title: "课程资料",
      items: courses
        .flatMap((c) => c.materials.map((m) => ({ id: `material-${m.id}`, kind: "material" as const, label: m.title, sub: c.name })))
        .slice(0, 8),
    },
  ].filter((g) => g.items.length > 0);

  const list = (
    <div className="space-y-2.5" role="menu" aria-label="选择上下文">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="px-3 pb-1 text-[10px] font-bold text-sandrift uppercase tracking-wider">{g.title}</p>
          <div className="space-y-0.5">
            {g.items.map((it) => {
              const Icon =
                it.kind === "course"
                  ? BookOpen
                  : it.kind === "assignment"
                  ? ClipboardCheck
                  : it.kind === "range"
                  ? CalendarRange
                  : it.kind === "project"
                  ? Users2
                  : FileText;
              return (
                <button
                  key={it.id}
                  role="menuitem"
                  onClick={() => onPick({ id: it.id, kind: it.kind, label: it.label, removable: true })}
                  className={rowCls}
                >
                  <Icon className={iconCls} />
                  <span className="min-w-0">
                    <span className="block truncate">{it.label}</span>
                    {it.sub && <span className="block text-[10px] text-sandrift truncate">{it.sub}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="px-3 text-[10px] text-sandrift">仅用于界面预览，不会发送或修改任何数据。</p>
    </div>
  );

  return (
    <>
      {/* Mobile：底部 sheet（<md） */}
      <div className="md:hidden fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        ref={mobilePanelRef}
        role="dialog"
        aria-label="选择上下文"
        className="md:hidden fixed inset-x-0 bottom-0 z-50 bg-surface border-t border-line rounded-t-2xl shadow-card p-4 pb-5 max-h-[70dvh] overflow-y-auto ux-inline"
      >
        <div className="w-10 h-1 rounded-full bg-line-strong mx-auto mb-3" />
        {list}
      </div>

      {/* Desktop：absolute 弹层（<md 隐藏） */}
      <div
        ref={desktopPanelRef}
        role="dialog"
        aria-label="选择上下文"
        className="hidden md:block absolute bottom-full left-0 mb-2 w-80 max-h-[min(420px,60dvh)] overflow-y-auto bg-surface border border-line-strong rounded-2xl shadow-card p-3 z-40 ux-inline"
      >
        {list}
      </div>
    </>
  );
}
