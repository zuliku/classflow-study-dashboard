"use client";

import React, { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, GripVertical, CalendarPlus } from "lucide-react";
import { Assignment } from "@/types";
import { usePresence } from "@/lib/usePresence";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * 待安排（Task：ClassFlow Timeline V1 polish）：
 * 独立 Secondary Panel，位于主时间表之后（页面滚动可见），默认单行横向滚动；点击展开才多行。
 * IM5B：directManipulationEnabled 时整个任务 chip 可拖（pointerdown 交给 TimelineWorkspace owner），
 * Grip 仅视觉 affordance；「安排」按钮保持精确安排（ArrangeSheet）且 pointer 隔离。
 */
export function TimelineUnscheduledShelf({
  assignments,
  onArrange,
  directManipulationEnabled = false,
  draggingAssignmentId = null,
  onAssignmentPointerDown,
}: {
  assignments: Assignment[];
  onArrange: (a: Assignment) => void;
  directManipulationEnabled?: boolean;
  draggingAssignmentId?: string | null;
  onAssignmentPointerDown?: (event: React.PointerEvent, assignment: Assignment) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // 面板级 presence：最后一个待安排被安排后淡出再卸载（panel 档退出），不整块硬消失
  const { mounted, visible } = usePresence(assignments.length > 0, MOTION_EXIT_MS.panel);
  // 展开/收起高度 FLIP：单行横向 ↔ 多行换行的高度差无法用 CSS 过渡（auto 不可插值，
  // 此前 transition-[height] + key 重挂载双双失效）；改用实测高度 WAAPI 补间，
  // reduced-motion 下直接落位
  const listRef = useRef<HTMLDivElement | null>(null);
  const fromHeightRef = useRef(0);
  const reducedMotion = useEffectiveReducedMotion();
  const toggleExpanded = () => {
    const el = listRef.current;
    if (el) fromHeightRef.current = el.offsetHeight;
    setExpanded((v) => !v);
  };
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || reducedMotion) return;
    const from = fromHeightRef.current;
    fromHeightRef.current = 0;
    const to = el.offsetHeight;
    if (!from || Math.abs(to - from) < 2) return;
    // 与 --motion-base（180ms）/ --ease-standard 同源（WAAPI 不解析 var()，此处抄值并注明）
    const anim = el.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: 180,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
    return () => anim.cancel();
  }, [expanded, reducedMotion]);
  if (!mounted) return null;

  const ddlText = (a: Assignment): string => {
    if (!a.ddl) return "无截止日期";
    const date = a.ddl.slice(0, 10);
    const time = a.ddl.slice(11, 16);
    const label = `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
    return time ? `${label} ${time}` : label;
  };

  return (
    <div
      data-testid="timeline-unscheduled"
      className={cn(
        "bg-surface border border-line rounded-2xl shadow-subtle p-3 shrink-0",
        "transition-[opacity,transform] duration-[var(--motion-base)] ease-[var(--ease-standard)]",
        visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-1 pointer-events-none !duration-[var(--motion-exit-panel)] !ease-[var(--ease-exit)]"
      )}
    >
      {/* Panel Header：计数 + 展开/收起 */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-satin-grey">
          待安排 {assignments.length}
        </span>
        <button
          onClick={toggleExpanded}
          aria-expanded={expanded}
          className="flex items-center gap-0.5 text-[11px] font-semibold text-sandrift hover:text-charcoal transition-colors"
        >
          {expanded ? "收起" : "展开"}
          <ChevronDown
            className={cn(
              "w-3 h-3 transition-transform duration-[var(--motion-fast)]",
              expanded && "rotate-180"
            )}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* 默认单行横向滚动；展开后允许换行（高度差由 WAAPI FLIP 补间，下方内容平滑让位；
          此前 key 切换重挂载 + transition-[height] 对 auto 无效，整排硬跳） */}
      <div
        ref={listRef}
        className={cn(
          "flex gap-1.5 min-h-7",
          expanded ? "flex-wrap" : "flex-nowrap items-center overflow-x-auto kiro-attachment-tray"
        )}
      >
        {assignments.map((a) => {
          const isDragging = draggingAssignmentId === a.id;
          return (
            <span
              key={a.id}
              data-testid="timeline-unscheduled-item"
              onPointerDown={
                directManipulationEnabled && onAssignmentPointerDown
                  ? (e) => onAssignmentPointerDown(e, a)
                  : undefined
              }
              title={directManipulationEnabled ? "拖到时间表快速安排 1 小时" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 pl-1.5 pr-1 h-7 rounded-lg bg-surface border border-line text-[11px] font-semibold text-charcoal max-w-[240px] shrink-0",
                directManipulationEnabled && !isDragging && "cursor-grab select-none",
                // Motion M5 Grab 态：与 StudyBlock source 统一语言（~40%，只降视觉权重，无 scale）
                isDragging && "opacity-40 cursor-grabbing"
              )}
            >
              {directManipulationEnabled && (
                <GripVertical className="w-3 h-3 text-sandrift shrink-0" aria-hidden="true" />
              )}
              <span title={a.title} className="truncate min-w-0">{a.title}</span>
              <span className="text-[10px] text-sandrift font-medium shrink-0">{ddlText(a)}</span>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onArrange(a);
                }}
                aria-label={`安排 ${a.title}`}
                title="精准设置时间"
                className="flex items-center gap-0.5 p-1 rounded text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors shrink-0"
              >
                <CalendarPlus className="w-3 h-3" />
                <span className="text-[10px] font-bold">安排</span>
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
