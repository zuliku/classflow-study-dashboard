"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { TimelineItem } from "@/lib/timeline/timelineTypes";
import { timeToDayRatio, intervalToDayGeometry } from "@/lib/timeline/timelineGeometry";
import { Priority } from "@/types";
import { FloatingTimelineDetail } from "@/components/timeline/FloatingTimelineDetail";
import { useAppStore } from "@/store/useAppStore";
import { cardKeyHandler } from "@/lib/utils";

/** P3 fix 4：独立 DDL CalendarMark 的默认提醒恢复入口（仅真正独立 mark；linked mark 不出现第二套控制） */
function CalendarMarkAutoReminderControl({ calendarMarkId }: { calendarMarkId?: string }) {
  const calendarMarks = useAppStore((s) => s.calendarMarks);
  const assignments = useAppStore((s) => s.assignments);
  const enableAutomaticReminderForTarget = useAppStore((s) => s.enableAutomaticReminderForTarget);
  if (!calendarMarkId) return null;
  const mark = calendarMarks.find((m) => m.id === calendarMarkId);
  if (!mark || mark.type !== "ddl") return null;
  // 独立判定与 Domain 一致：sourceId 精确 relation 匹配任一 assignment → linked（排除）
  if (mark.sourceId && assignments.some((a) => a.id === mark.sourceId)) return null;
  if (mark.autoReminderDisabled !== true) return null;
  return (
    <div className="flex items-center justify-between gap-2 pt-0.5">
      <span className="text-[10px] text-sandrift">默认提醒：已关闭</span>
      <button
        type="button"
        onClick={() => enableAutomaticReminderForTarget("calendarMark", mark.id)}
        aria-label="重新开启默认提醒"
        className="text-[10px] font-bold text-charcoal bg-white border border-line rounded-lg px-2 py-0.5 hover:border-line-strong transition-colors"
      >
        重新开启
      </button>
    </div>
  );
}

const MAX_TRACKS = 2;
/** Short Interval 视觉最小宽度（px；真实时间长度不变，Semantic Geometry 与 Visual Affordance 分离） */
const MIN_INTERVAL_VISUAL_PX = 16;

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
 * Timeline Key Lane。
 * - Deadline：纯 Point（真实 24h 几何）+ Floating Detail（Portal，collision 定位）
 * - Interval：真实几何 bar；过短时用 16px capsule（以真实 midpoint 为中心 + 列内 clamp）
 * - All-day：独立顶部小层
 */
export function TimelineKeyLane({
  items,
  weekDates,
  boundsRef,
}: {
  items: TimelineItem[];
  weekDates: string[];
  boundsRef?: React.RefObject<HTMLElement | null>;
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

  // 列宽测量（Semantic Geometry → px 视觉）：真实 widthRatio * colWidth
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [colWidth, setColWidth] = useState(180);
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => setColWidth(Math.max(el.clientWidth / weekDates.length, 40));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weekDates.length]);

  const hasAnyAllDay = weekDates.some((date) => (byDay.get(date) ?? []).some((it) => it.temporalType === "all-day"));
  const laneHeightClass = hasAnyAllDay ? "h-[78px]" : "h-[64px]";
  const baselineTop = hasAnyAllDay ? 52 : 40;

  return (
    <div className="relative border-b border-line">
      <div
        aria-hidden="true"
        className="absolute left-[56px] right-0 h-px bg-line pointer-events-none z-0"
        style={{ top: baselineTop }}
      />
      <div
        ref={gridRef}
        className="grid relative"
        style={{ gridTemplateColumns: `56px repeat(${weekDates.length}, minmax(0, 1fr))` }}
      >
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

              {points.map((p) => (
                <DeadlinePoint
                  key={p.item.id}
                  item={p.item}
                  ratio={p.ratio}
                  track={p.track}
                  top={pointTop}
                  boundsRef={boundsRef}
                />
              ))}

              {intervals.map((it) => (
                <IntervalBlock
                  key={it.id}
                  item={it}
                  top={baselineTop - 7}
                  colWidth={colWidth}
                  boundsRef={boundsRef}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Hover Bridge 通用逻辑：mouseleave 延迟 100ms 关闭；popover mouseenter 取消 */
function useHoverBridge(): {
  open: boolean;
  setOpen: (v: boolean) => void;
  anchorLeave: () => void;
  cancelClose: () => void;
} {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  const cancelClose = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const anchorLeave = () => {
    cancelClose();
    timerRef.current = window.setTimeout(() => setOpen(false), 100);
  };
  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    []
  );
  return { open, setOpen, anchorLeave, cancelClose };
}

function DeadlinePoint({
  item,
  ratio,
  track,
  top,
  boundsRef,
}: {
  item: TimelineItem;
  ratio: number;
  track: number;
  top: number;
  boundsRef?: React.RefObject<HTMLElement | null>;
}) {
  const { open, setOpen, anchorLeave, cancelClose } = useHoverBridge();
  const ref = useRef<HTMLDivElement | null>(null);
  const setSelectedAssignmentId = useAppStore((s) => s.setSelectedAssignmentId);
  const setSelectedCalendarMarkId = useAppStore((s) => s.setSelectedCalendarMarkId);
  const assignments = useAppStore((s) => s.assignments);
  const color = item.priority ? PRIORITY_DOT[item.priority] : DEFAULT_DOT;
  const dotTop = top + track * 12;
  const weekDay = item.date ? new Date(`${item.date}T00:00:00`).getDay() : 0;
  const dayLabel = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][weekDay];

  // Click → Full Detail：Assignment DDL / linked DDL → Assignment 详情；
  // 真正独立 ddl mark（sourceId 无对应 assignment）→ 轻量 DDL 详情。
  // （Hover preview 保留为 glance；不在这里做编辑。）
  // 打开 Full Detail 时立即关闭 hover preview（不等 mouseleave；keyboard 激活同样处理）。
  const handleOpenDetail = () => {
    setOpen(false);
    if (item.sourceType === "assignment") {
      const linked = assignments.some((a) => a.id === item.sourceId);
      if (linked) {
        setSelectedAssignmentId(item.sourceId);
        return;
      }
      if (item.calendarMarkId) setSelectedCalendarMarkId(item.calendarMarkId);
      return;
    }
    if (item.calendarMarkId) setSelectedCalendarMarkId(item.calendarMarkId);
  };

  return (
    <>
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label={`${item.title}，${dayLabel} ${item.startTime ?? ""} 截止${item.priority ? `，${PRIORITY_LABEL[item.priority]}` : ""}`}
        className="absolute z-10 cursor-pointer outline-none"
        style={{ left: `${ratio * 100}%`, top: `${dotTop}px`, transform: "translateX(-50%)" }}
        onClick={handleOpenDetail}
        onKeyDown={cardKeyHandler(handleOpenDetail)}
        onMouseEnter={() => {
          cancelClose();
          setOpen(true);
        }}
        onMouseLeave={anchorLeave}
        onFocus={() => {
          cancelClose();
          setOpen(true);
        }}
        onBlur={anchorLeave}
      >
        <span className="block w-[18px] h-[18px] -m-[5px] flex items-center justify-center">
          <span
            className={cn(
              "block w-2 h-2 rounded-full transition-[transform] duration-[var(--motion-snap)]",
              open && "scale-[1.15]",
              "active:scale-[.8]"
            )}
            style={{ backgroundColor: color }}
          />
        </span>
      </div>

      <FloatingTimelineDetail
        anchorRef={ref}
        boundsRef={boundsRef ?? ref}
        open={open}
        kind="interval"
        ariaLabel={item.title}
        onRequestClose={() => setOpen(false)}
        onMouseEnter={cancelClose}
        onMouseLeave={anchorLeave}
      >
        <div className="px-2.5 py-2 space-y-0.5">
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
          {/* P3 fix 4：独立 DDL CalendarMark 的默认提醒恢复入口（仅真正独立 mark；linked mark 无第二套控制） */}
          <CalendarMarkAutoReminderControl calendarMarkId={item.calendarMarkId} />
        </div>
      </FloatingTimelineDetail>
    </>
  );
}

function IntervalBlock({
  item,
  top,
  colWidth,
  boundsRef,
}: {
  item: TimelineItem;
  top: number;
  colWidth: number;
  boundsRef?: React.RefObject<HTMLElement | null>;
}) {
  const { leftRatio, widthRatio } = intervalToDayGeometry(item.startTime, item.endTime);
  const exam = item.sourceType === "exam";
  const { open, setOpen, anchorLeave, cancelClose } = useHoverBridge();
  const ref = useRef<HTMLDivElement | null>(null);
  const weekDay = item.date ? new Date(`${item.date}T00:00:00`).getDay() : 0;
  const dayLabel = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][weekDay];
  const dateLabel = `${Number(item.date.slice(5, 7))}月${Number(item.date.slice(8, 10))}日`;
  const typeLabel = exam ? "考试" : "活动";

  // Semantic Geometry（真实时间比例）
  const trueWidthPx = widthRatio * colWidth;
  const midRatio = leftRatio + widthRatio / 2;
  const visualWidthPx = Math.max(trueWidthPx, MIN_INTERVAL_VISUAL_PX);

  // Visual Affordance：短 capsule 以真实 midpoint 为中心，并 clamp 在列内（左右 2px）
  const centerPx = midRatio * colWidth;
  const leftPx =
    trueWidthPx >= MIN_INTERVAL_VISUAL_PX
      ? leftRatio * colWidth
      : Math.min(Math.max(centerPx - visualWidthPx / 2, 2), Math.max(colWidth - visualWidthPx - 2, 2));

  return (
    <>
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label={`${item.title}，${dayLabel} ${item.startTime ?? ""} 至 ${item.endTime ?? ""}`}
        className="absolute z-10 outline-none"
        style={{ left: `${leftPx}px`, top: `${top}px`, width: visualWidthPx }}
        onMouseEnter={() => {
          cancelClose();
          setOpen(true);
        }}
        onMouseLeave={anchorLeave}
        onFocus={() => {
          cancelClose();
          setOpen(true);
        }}
        onBlur={anchorLeave}
      >
        {/* Hover Hit Area：真实 bar（margin box 7px）+ 上下各 4px 命中扩展（不改变可见几何） */}
        <span className="block h-[15px] -my-[4px] flex items-center">
          <span
            className={cn(
              "block h-[7px] rounded-full transition-transform duration-[var(--motion-fast)]",
              open && "scale-y-[1.3]"
            )}
            style={{
              width: "100%",
              backgroundColor: exam ? "#D9BBA0" : "#C9C4BC",
            }}
          />
        </span>
      </div>

      <FloatingTimelineDetail
        anchorRef={ref}
        boundsRef={boundsRef ?? ref}
        open={open}
        kind="interval"
        ariaLabel={item.title}
        onRequestClose={() => setOpen(false)}
        onMouseEnter={cancelClose}
        onMouseLeave={anchorLeave}
      >
        <div className="px-2.5 py-2 space-y-0.5">
          <p className="text-[11px] font-bold text-charcoal leading-snug">{item.title}</p>
          <p className="text-[10px] font-semibold text-satin-grey">
            {dayLabel} · {dateLabel} · {item.startTime ?? "—"}–{item.endTime ?? "—"}
          </p>
          <p className="text-[10px] font-semibold text-[#A87952]">{typeLabel}</p>
          {item.subtitle && <p className="text-[10px] text-satin-grey">{item.subtitle}</p>}
        </div>
      </FloatingTimelineDetail>
    </>
  );
}
