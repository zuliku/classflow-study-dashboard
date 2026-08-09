"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { TimelineItem } from "@/lib/timeline/timelineTypes";
import { timeToDayRatio, intervalToDayGeometry } from "@/lib/timeline/timelineGeometry";
import { Priority } from "@/types";

const MAX_TRACKS = 2;
/** Interval 标题进入 block 的最小像素宽度（几何真实 + 标题可读分离） */
const INTERVAL_INLINE_MIN_PX = 56;

/** Deadline Point 优先级颜色（ClassFlow muted palette；禁止纯红/纯橙/neon） */
const PRIORITY_DOT: Record<Priority, string> = {
  urgent: "#9B5B57", // muted brick red
  high: "#A87952", // warm ochre
  medium: "#A48F82", // sandrift
  low: "#627566", // muted sage
};
const DEFAULT_DOT = "#A48F82";

const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "紧急",
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};

/** Deadline Point 布局：真实时间几何 + 最多 2 条微型 track（防完全重合），无常驻文字 */
function packDeadlinePoints(items: TimelineItem[]): { item: TimelineItem; ratio: number; track: number }[] {
  const sorted = [...items].sort((a, b) => (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99"));
  const tracks: (number | null)[] = [null, null];
  const out: { item: TimelineItem; ratio: number; track: number }[] = [];
  for (const item of sorted) {
    const ratio = timeToDayRatio(item.startTime);
    // 优先空闲 track；都占用时选间隔最大的（微错开）；同刻 ≥3 个重叠在 track 0
    let track = 0;
    let bestGap = -1;
    for (let t = 0; t < MAX_TRACKS; t++) {
      const existing = tracks[t];
      if (existing === null) {
        track = t;
        break;
      }
      const gap = Math.abs(existing - ratio);
      if (gap > bestGap && gap > 0.02) {
        bestGap = gap;
        track = t;
      }
    }
    tracks[track] = ratio;
    out.push({ item, ratio, track });
  }
  return out;
}

/**
 * Timeline Key Lane（Task：ClassFlow Timeline V1 polish）。
 * - Deadline：默认纯 Point（8px，优先级配色），真实 24h 几何；Hover/Focus 显示 Detail Tooltip（方向自适应）
 * - Interval：真实几何 bar + 浮动短标题
 * - All-day：独立顶部小层
 * - 底部 1px baseline（可感知时间轨）
 */
export function TimelineKeyLane({
  items,
  weekDates,
}: {
  items: TimelineItem[];
  weekDates: string[];
}) {
  const byDay = useMemo(() => {
    const map = new Map<string, TimelineItem[]>();
    for (const it of items) {
      const arr = map.get(it.date) ?? [];
      arr.push(it);
      map.set(it.date, arr);
    }
    return map;
  }, [items]);

  // ---- Week-level 纵向几何（全周统一，避免某天 All-day 造成 baseline 断层） ----
  const hasAnyAllDay = weekDates.some((date) => (byDay.get(date) ?? []).some((it) => it.temporalType === "all-day"));
  const laneHeightClass = hasAnyAllDay ? "h-[78px]" : "h-[64px]";
  const baselineTop = hasAnyAllDay ? 52 : 40;

  return (
    <div className="relative border-b border-line">
      {/* 连续时间 baseline：单条 1px 线从 gutter 结束处贯穿所有日期（全周统一 Y，无列拼接断点） */}
      <div
        aria-hidden="true"
        className="absolute left-[56px] right-0 h-px bg-line pointer-events-none z-0"
        style={{ top: baselineTop }}
      />
      <div
        className="grid relative"
        style={{ gridTemplateColumns: `56px repeat(${weekDates.length}, minmax(0, 1fr))` }}
      >
        {/* 左标签列：关键时间轴 Section Label（双行，与全周 baseline 垂直居中关联） */}
        <div className="relative self-stretch pr-1.5">
          <div
            className="absolute left-0 flex items-center gap-1"
            style={{ top: baselineTop, transform: "translateY(-50%)" }}
          >
            <span aria-hidden="true" className="w-[2px] h-6 rounded-full bg-sandrift/65 shrink-0" />
            <span className="leading-[1.15]">
              <span className="block text-[10px] font-bold text-charcoal">关键</span>
              <span className="block text-[10px] font-semibold text-sandrift">时间轴</span>
            </span>
          </div>
        </div>

        {weekDates.map((date, colIdx) => {
          const dayItems = byDay.get(date) ?? [];
          const allDays = dayItems.filter((it) => it.temporalType === "all-day");
          const timed = dayItems.filter((it) => it.temporalType !== "all-day");
          const intervals = timed.filter((it) => it.temporalType === "interval");
          const points = packDeadlinePoints(timed.filter((it) => it.temporalType === "deadline"));
          const pointTop = baselineTop - 6;

          return (
            <div
              key={date}
              data-testid="timeline-key-lane"
              className={cn(
                "relative border-r border-line-soft px-0.5",
                colIdx === weekDates.length - 1 && "border-r-0",
                laneHeightClass
              )}
            >
              {/* All-day 独立小层（有才显示；整周统一预留高度，不改变 baseline） */}
              {allDays.length > 0 && (
                <div className="absolute left-0.5 right-0.5 top-1 space-y-0.5">
                  {allDays.slice(0, 2).map((it) => (
                    <span
                      key={it.id}
                      title={`${it.title}（全天）`}
                      className="block truncate text-[10px] font-semibold text-satin-grey bg-alabaster/80 border border-line rounded px-1 py-px"
                    >
                      全天 · {it.title}
                    </span>
                  ))}
                  {allDays.length > 2 && (
                    <span className="block text-[9px] font-bold text-sandrift pl-1">+{allDays.length - 2}</span>
                  )}
                </div>
              )}

              {/* Deadline Points（纯 Point + Hover Detail） */}
              {points.map((p) => (
                <DeadlinePoint key={p.item.id} item={p.item} ratio={p.ratio} track={p.track} top={pointTop} />
              ))}

              {/* Interval：真实几何 bar + 浮动标题 */}
              {intervals.map((it) => (
                <IntervalBlock key={it.id} item={it} top={baselineTop - 7} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeadlinePoint({
  item,
  ratio,
  track,
  top,
}: {
  item: TimelineItem;
  ratio: number;
  track: number;
  top: number;
}) {
  const [hovered, setHovered] = useState(false);
  const color = item.priority ? PRIORITY_DOT[item.priority] : DEFAULT_DOT;
  const dotTop = top + track * 12;
  // Tooltip 方向：<0.65 向右，≥0.65 向左（防止 23:59 越界）
  const tooltipRight = ratio < 0.65;
  const weekDay = item.date ? new Date(`${item.date}T00:00:00`).getDay() : 0;
  const dayLabel = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][weekDay];
  const dateLabel = `${Number(item.date.slice(5, 7))}月${Number(item.date.slice(8, 10))}日`;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${item.title}，${dayLabel} ${item.startTime ?? ""} 截止${item.priority ? `，${PRIORITY_LABEL[item.priority]}` : ""}`}
      className="absolute z-10 outline-none"
      style={{ left: `${ratio * 100}%`, top: `${dotTop}px`, transform: "translateX(-50%)" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      {/* Hover 命中区（18px，视觉只显示 8px dot） */}
      <span className="block w-[18px] h-[18px] -m-[5px] flex items-center justify-center cursor-pointer">
        <span
          className={cn(
            "block w-2 h-2 rounded-full transition-transform duration-[var(--motion-fast)]",
            hovered && "scale-[1.15]"
          )}
          style={{ backgroundColor: color }}
        />
      </span>

      {/* Hover / Focus Detail Tooltip */}
      {hovered && (
        <div
          className={cn(
            "absolute top-full mt-1.5 w-max max-w-[220px] bg-surface border border-line-strong rounded-xl shadow-card px-2.5 py-2 space-y-0.5 z-30",
            tooltipRight ? "left-0" : "right-0"
          )}
        >
          <p className="text-[11px] font-bold text-charcoal leading-snug">{item.title}</p>
          <p className="text-[10px] font-semibold text-satin-grey">
            {dayLabel} · {item.startTime ?? ""} 截止
            {item.subtitle ? ` · ${item.subtitle}` : ""}
          </p>
          {item.priority && (
            <p className="text-[10px] font-semibold" style={{ color }}>
              {PRIORITY_LABEL[item.priority]}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function IntervalBlock({ item, top }: { item: TimelineItem; top: number }) {
  const { leftRatio, widthRatio } = intervalToDayGeometry(item.startTime, item.endTime);
  const exam = item.sourceType === "exam";
  // 估算真实几何像素宽（列宽 ~(container/7)，用于决定标题是否可进 block）
  const blockWidthPx = Math.max(widthRatio * 180, 12);
  const showInlineLabel = blockWidthPx > INTERVAL_INLINE_MIN_PX;
  const showFloatingLabel = !showInlineLabel;
  const weekDay = item.date ? new Date(`${item.date}T00:00:00`).getDay() : 0;
  const dayLabel = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][weekDay];

  return (
    <div
      aria-label={`${item.title}，${dayLabel} ${item.startTime ?? ""} 至 ${item.endTime ?? ""}`}
      title={`${item.title} · ${item.startTime ?? ""}–${item.endTime ?? ""}${item.subtitle ? ` · ${item.subtitle}` : ""}`}
      className="absolute z-10 pointer-events-auto"
      style={{ left: `${leftRatio * 100}%`, top: `${top}px`, width: `${Math.max(widthRatio * 100, 2.2)}%` }}
    >
      {/* Geometry Bar：严格按真实时间比例 */}
      <span
        className={cn(
          "block h-[7px] rounded-full",
          exam ? "bg-[#D9BBA0]" : "bg-line-strong/60"
        )}
      />
      {/* 标题：block 宽时进入 bar 内；窄时浮动在 bar 上方 */}
      {showInlineLabel && (
        <span className="absolute left-0 top-full mt-0.5 max-w-[100%] truncate text-[10px] font-semibold text-satin-grey leading-none">
          {item.title}
        </span>
      )}
      {showFloatingLabel && (
        <span className="absolute left-0 top-[-13px] max-w-[100%] whitespace-nowrap truncate text-[10px] font-semibold text-satin-grey leading-none">
          {item.title}
        </span>
      )}
    </div>
  );
}
