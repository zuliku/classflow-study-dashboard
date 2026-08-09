"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { TimelineItem } from "@/lib/timeline/timelineTypes";
import { timeToDayRatio, intervalToDayGeometry } from "@/lib/timeline/timelineGeometry";

const MAX_TRACKS = 2;
/** Deadline 文字常驻：默认只时间；空间足够时允许短标题（由 track 与宽度决定） */
const DEADLINE_LABEL_RATIO = 0.32; // 估算 label 占用列宽比例（无 canvas 测量，deterministic）
/** Interval 标题进入 block 的最小像素宽度 */
const INTERVAL_INLINE_MIN_PX = 56;

interface PackedDeadline {
  item: TimelineItem;
  ratio: number;
  direction: "left" | "right";
  /** 估算的视觉占用（列宽比例） */
  visualStart: number;
  visualEnd: number;
  track: number;
  showLabel: boolean;
}

/** Deadline 视觉碰撞布局（Task：Timeline 排版优化）：
 *  - 按 Point ratio 决定 label 方向（<0.68 向右，≥0.68 向左，避免右缘越界）
 *  - 用估算 label 占用做 2-track packing；两轨都冲突 → 只显示 Point + Time */
function packDeadlines(items: TimelineItem[]): PackedDeadline[] {
  const sorted = [...items].sort((a, b) => (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99"));
  const tracks: { start: number; end: number }[][] = [[], []];
  const out: PackedDeadline[] = [];
  for (const item of sorted) {
    const ratio = timeToDayRatio(item.startTime);
    const direction: "left" | "right" = ratio < 0.68 ? "right" : "left";
    const half = DEADLINE_LABEL_RATIO / 2;
    const visualStart = direction === "right" ? ratio : Math.max(ratio - DEADLINE_LABEL_RATIO, 0);
    const visualEnd = direction === "right" ? Math.min(ratio + DEADLINE_LABEL_RATIO, 1) : ratio;
    let placed = false;
    let track = 0;
    for (let t = 0; t < MAX_TRACKS; t++) {
      const conflict = tracks[t].some((r) => visualStart < r.end && r.start < visualEnd);
      if (!conflict) {
        tracks[t].push({ start: visualStart, end: visualEnd });
        track = t;
        placed = true;
        break;
      }
    }
    if (!placed) track = 0; // 两轨都冲突：仍显示 Point + Time（不显示标题）
    out.push({ item, ratio, direction, visualStart, visualEnd, track, showLabel: placed });
    void half;
  }
  return out;
}

/**
 * Timeline Key Lane（Task：ClassFlow Timeline V1 排版优化）。
 * 真正的时间轴：每天 00:00–24:00 比例定位。
 * - Deadline：Point 严格按时间比例；label 自动左右翻转 + 2-track 视觉 packing + 列内 truncate
 * - Interval：Geometry Bar 严格按比例；标题按可用宽度进入 block 或浮动在 block 上方
 * - All-day：独立顶部小层（不占时间位置）
 * - 底部极弱 baseline，时间方向为水平
 */
export function TimelineKeyLane({
  items,
  weekDates,
}: {
  items: TimelineItem[];
  /** 本周日期 "YYYY-MM-DD"（顺序 = 列顺序） */
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

  return (
    <div className="relative border-b border-line-soft">
      <div
        className="grid"
        style={{ gridTemplateColumns: `56px repeat(${weekDates.length}, minmax(0, 1fr))` }}
      >
        {/* 左标签列 */}
        <div className="text-[9px] text-sandrift font-mono pr-1.5 pt-1 self-start">关键时间轴</div>

        {weekDates.map((date, colIdx) => {
          const dayItems = byDay.get(date) ?? [];
          const allDays = dayItems.filter((it) => it.temporalType === "all-day");
          const timed = dayItems.filter((it) => it.temporalType !== "all-day");
          const intervals = timed.filter((it) => it.temporalType === "interval");
          const deadlines = packDeadlines(timed.filter((it) => it.temporalType === "deadline"));
          const hasAllDay = allDays.length > 0;
          const laneHeight = hasAllDay ? "h-[58px]" : "h-[48px]";

          return (
            <div
              key={date}
              data-testid="timeline-key-lane"
              className={cn(
                "relative border-r border-line-soft px-0.5",
                colIdx === weekDates.length - 1 && "border-r-0",
                laneHeight
              )}
            >
              {/* 时间 baseline：1px 极弱线（水平时间语义） */}
              <div aria-hidden="true" className="absolute left-0 right-0 top-[30px] h-px bg-line-soft/70 pointer-events-none" />

              {/* All-day 独立小层（有才占空间） */}
              {hasAllDay && (
                <div className="absolute left-0.5 right-0.5 top-0.5 space-y-0.5">
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

              {/* Deadline Point + 自适应 Label */}
              {deadlines.map((d) => (
                <DeadlineMarker key={d.item.id} d={d} hasAllDay={hasAllDay} />
              ))}

              {/* Interval：真实几何 bar + 浮动标题 */}
              {intervals.map((it) => (
                <IntervalBlock key={it.id} item={it} hasAllDay={hasAllDay} />
              ))}

              {/* 溢出提示（interval 超出 2 条已由 track 覆盖；deadline 冲突降级为 time-only） */}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeadlineMarker({ d, hasAllDay }: { d: PackedDeadline; hasAllDay: boolean }) {
  const { item, ratio, direction, track, showLabel } = d;
  const urgent = item.priority === "urgent";
  const group = item.sourceType === "group-task";
  const top = (hasAllDay ? 42 : 34) + track * 14;
  const aria = `${item.title}，${item.startTime ?? ""} 截止${item.subtitle ? `，${item.subtitle}` : ""}`;
  // Label 视觉范围限制在当天列内（不跨列）
  const labelWidth = `calc(${DEADLINE_LABEL_RATIO * 100}% - 6px)`;
  return (
    <div
      aria-label={aria}
      className="absolute pointer-events-auto flex items-center gap-1"
      style={{
        left: direction === "right" ? `${ratio * 100}%` : undefined,
        right: direction === "left" ? `${(1 - ratio) * 100}%` : undefined,
        top: `${top}px`,
        maxWidth: "100%",
      }}
    >
      {/* Point：严格按真实时间比例 */}
      <span
        className={cn(
          "block w-[7px] h-[7px] rounded-full border shrink-0",
          urgent
            ? "bg-danger/70 border-danger/40"
            : group
              ? "bg-pastel-mint border-pastel-mint/60"
              : "bg-sandrift/70 border-sandrift/40"
        )}
        title={`${item.title} · ${item.startTime ?? ""} 截止${item.subtitle ? ` · ${item.subtitle}` : ""}`}
      />
      {/* Label：短信息（时间 + 空间足够时的短标题），列内 truncate；direction 决定左右 */}
      <span
        className={cn("whitespace-nowrap truncate leading-none text-[10px] font-semibold text-satin-grey", direction === "left" && "order-first text-right")}
        style={{ maxWidth: direction === "right" ? labelWidth : `calc(${DEADLINE_LABEL_RATIO * 100}% - 10px)` }}
      >
        {item.startTime ?? ""}
        {showLabel && (
          <span className="ml-1 hidden xl:inline text-sandrift font-medium">{item.title}</span>
        )}
      </span>
    </div>
  );
}

function IntervalBlock({ item, hasAllDay }: { item: TimelineItem; hasAllDay: boolean }) {
  const { leftRatio, widthRatio } = intervalToDayGeometry(item.startTime, item.endTime);
  const exam = item.sourceType === "exam";
  const top = (hasAllDay ? 42 : 34);
  // 真实几何像素宽度（按列宽估算，用于决定标题是否可进 block）
  const aria = `${item.title}，${item.startTime ?? ""} 至 ${item.endTime ?? ""}${item.subtitle ? `，${item.subtitle}` : ""}`;
  return (
    <div
      aria-label={aria}
      title={`${item.title} · ${item.startTime ?? ""}–${item.endTime ?? ""}${item.subtitle ? ` · ${item.subtitle}` : ""}`}
      className="absolute pointer-events-auto"
      style={{
        left: `${leftRatio * 100}%`,
        top: `${top}px`,
        width: `${Math.max(widthRatio * 100, 2.2)}%`,
      }}
    >
      {/* Geometry Bar：严格按真实时间比例 */}
      <span
        className={cn(
          "block h-[6px] rounded-full",
          exam ? "bg-[#E3CFBC]" : "bg-line-strong/50"
        )}
      />
      {/* 浮动标题：block 窄时显示在 bar 上方；宽时标题旁附时间 */}
      <span className="absolute left-0 top-[-13px] max-w-[100%] whitespace-nowrap truncate text-[10px] font-semibold text-satin-grey leading-none">
        {item.title}
        <span className="ml-1 hidden 2xl:inline text-sandrift font-medium">
          {item.startTime}–{item.endTime}
        </span>
      </span>
    </div>
  );
}
