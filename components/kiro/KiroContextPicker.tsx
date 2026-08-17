"use client";

import React, { useEffect, useRef } from "react";
import { BookOpen, ClipboardCheck, CalendarRange, Users2, FileText } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { KiroContextRef } from "@/lib/ai/context/types";
import { cn } from "@/lib/utils";
import { usePresence } from "@/lib/usePresence";

/**
 * Context Picker（@）：从当前 Store 实时读取真实实体（属于 UI，不构建 Prompt、不发送数据）。
 * 分类：课程 / 任务 / 时间范围 / 小组项目 / 课程资料。
 * Desktop：absolute 弹层；Mobile：底部 sheet。
 */
export function KiroContextPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (ref: KiroContextRef) => void;
}) {
  const courses = useAppStore((s) => s.courses);
  const assignments = useAppStore((s) => s.assignments);
  const groupProjects = useAppStore((s) => s.groupProjects);
  const contentDensity = useAppStore((s) => s.preferences.contentDensity);
  const compact = contentDensity === "compact";
  const mobilePanelRef = useRef<HTMLDivElement | null>(null);
  const desktopPanelRef = useRef<HTMLDivElement | null>(null);
  const { mounted, visible } = usePresence(open, 160);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 点击外部关闭（mobile / desktop 两套面板同时挂载，分别检查）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      const inside =
        (mobilePanelRef.current?.contains(t) ?? false) || (desktopPanelRef.current?.contains(t) ?? false);
      if (!inside) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onClose]);

  if (!mounted) return null;

  const rowCls = cn(
    "w-full flex items-center gap-2.5 px-3 rounded-lg text-left text-xs font-semibold text-charcoal hover:bg-alabaster transition-colors",
    compact ? "py-2" : "py-2.5"
  );
  const iconCls = "w-4 h-4 text-sandrift shrink-0";

  const groups: { title: string; items: KiroContextRef[] }[] = [
    {
      title: "课程",
      items: courses.slice(0, 8).map((c) => ({
        key: `manual-course-${c.id}`,
        kind: "course" as const,
        entityId: c.id,
        label: `${c.name}（${c.teacher}）`,
        source: "manual" as const,
      })),
    },
    {
      title: "任务",
      items: assignments.slice(0, 8).map((a) => {
        const course = courses.find((c) => c.id === a.courseId);
        return {
          key: `manual-assignment-${a.id}`,
          kind: "assignment" as const,
          entityId: a.id,
          label: `${a.title}${course ? ` · ${course.name}` : ""}`,
          source: "manual" as const,
        };
      }),
    },
    {
      title: "时间范围",
      items: [
        { key: "manual-week-current", kind: "week" as const, entityId: "current", label: "本周", source: "manual" as const },
        { key: "manual-week-next", kind: "week" as const, entityId: "next", label: "下周", source: "manual" as const },
      ],
    },
    {
      title: "小组项目",
      items: groupProjects.slice(0, 6).map((p) => {
        const course = courses.find((c) => c.id === p.courseId);
        return {
          key: `manual-project-${p.id}`,
          kind: "group-project" as const,
          entityId: p.id,
          label: `${p.title}${course ? ` · ${course.name}` : ""}`,
          source: "manual" as const,
        };
      }),
    },
    {
      title: "课程资料",
      items: courses
        .flatMap((c) =>
          c.materials.map((m) => ({
            key: `manual-material-${m.id}`,
            kind: "material" as const,
            entityId: m.id,
            label: `${m.title} · ${c.name}`,
            source: "manual" as const,
          }))
        )
        .slice(0, 8),
    },
  ].filter((g) => g.items.length > 0);

  const itemIcon = (kind: KiroContextRef["kind"]) =>
    kind === "course"
      ? BookOpen
      : kind === "assignment"
      ? ClipboardCheck
      : kind === "week"
      ? CalendarRange
      : kind === "group-project"
      ? Users2
      : kind === "material"
      ? FileText
      : kind === "artifact"
      ? FileText
      : FileText;

  const list = (
    <div className="space-y-2.5" role="menu" aria-label="选择上下文">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="px-3 pb-1 text-[10px] font-bold text-sandrift uppercase tracking-wider">{g.title}</p>
          <div className="space-y-0.5">
            {g.items.map((it) => {
              const Icon = itemIcon(it.kind);
              return (
                <button
                  key={it.key}
                  role="menuitem"
                  onClick={() => onPick(it)}
                  className={rowCls}
                >
                  <Icon className={iconCls} />
                  <span className="min-w-0 truncate">{it.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="px-3 text-[10px] text-sandrift">所选上下文会随消息发送，Kiro 将据此优先查询。</p>
    </div>
  );

  return (
    <>
      {/* Mobile：底部 sheet（<md） */}
      <div
        className={cn(
          "md:hidden fixed inset-0 z-40 bg-black/30 transition-opacity ease-[var(--ease-standard)]",
          visible
            ? "duration-[var(--motion-panel)] opacity-100"
            : "duration-[160ms] opacity-0 pointer-events-none"
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={mobilePanelRef}
        role="dialog"
        aria-label="选择上下文"
        data-state={open ? "open" : "closed"}
        aria-hidden={!open}
        className={cn(
          "md:hidden fixed inset-x-0 bottom-0 z-50 bg-surface border-t border-line rounded-t-2xl shadow-card p-4 pb-5 max-h-[70dvh] overflow-y-auto transition-[opacity,transform] ease-[var(--ease-standard)]",
          visible
            ? "duration-[var(--motion-panel)] translate-y-0 opacity-100"
            : "duration-[160ms] translate-y-2 opacity-0 pointer-events-none"
        )}
      >
        <div className="w-10 h-1 rounded-full bg-line-strong mx-auto mb-3" />
        {list}
      </div>

      {/* Desktop：absolute 弹层（<md 隐藏）；Motion V1：kiro structure/popover timing + 2–3px offset */}
      <div
        ref={desktopPanelRef}
        role="dialog"
        aria-label="选择上下文"
        data-state={open ? "open" : "closed"}
        aria-hidden={!open}
        className={cn(
          "hidden md:block absolute bottom-full left-0 mb-2 w-80 max-h-[min(420px,60dvh)] overflow-y-auto bg-surface border border-line-strong rounded-2xl shadow-card p-3 z-40 transition-[opacity,transform] ease-[var(--ease-standard)] origin-bottom-left",
          visible
            ? "duration-[var(--kiro-motion-popover-enter,var(--motion-panel))] translate-y-0 opacity-100 scale-100"
            : "duration-[var(--kiro-motion-popover-exit,160ms)] translate-y-1 opacity-0 pointer-events-none scale-[0.985]"
        )}
      >
        {list}
      </div>
    </>
  );
}

