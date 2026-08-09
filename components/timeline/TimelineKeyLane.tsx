"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { TimelineItem, TimelineTemporalType } from "@/lib/timeline/timelineTypes";
import { timeToDayRatio, intervalToDayGeometry } from "@/lib/timeline/timelineGeometry";

const MAX_TRACKS = 2;

/** 当天事件的 lane packing：最多 2 条 track（重叠才换行），第 3 个及之后计入 +N */
function packDayItems(items: TimelineItem[]): { tracks: TimelineItem[][]; overflow: number } {
  const sorted = [...items].sort((a, b) => (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99"));
  const tracks: TimelineItem[][] = [[], []];
  const overlap = (a: TimelineItem, b: TimelineItem) => {
    if (a.temporalType !== "interval" || b.temporalType !== "interval") return false;
    return (a.startTime ?? "") < (b.endTime ?? "") && (b.startTime ?? "") < (a.endTime ?? "");
  };
  let overflow = 0;
  for (const item of sorted) {
    let placed = false;
    for (let t = 0; t < MAX_TRACKS; t++) {
      if (!tracks[t].some((x) => overlap(x, item))) {
        tracks[t].push(item);
        placed = true;
        break;
      }
    }
    if (!placed) overflow++;
  }
  return { tracks, overflow };
}

/**
 * Timeline Key Lane（Task：ClassFlow Timeline V1）。
 * 真正的时间轴：每天 00:00–24:00 比例定位。
 * - Deadline → point marker（x = 当天时间比例）
 * - Interval（考试/活动）→ mini block（left/width = 时间比例）
 * - All-day（只有日期）→ 固定左上角小标签（不伪造时间）
 * 最多 2 条 track；更多显示 +N。
 */
export function TimelineKeyLane({
  items,
  weekDates,
  showDayLabels = true,
  nowLine,
}: {
  items: TimelineItem[];
  /** 本周日期 "YYYY-MM-DD"（顺序 = 列顺序；7 天） */
  weekDates: string[];
  showDayLabels?: boolean;
  /** 当前周的真实时间线（今天列显示极细线；非当前周不传） */
  nowLine?: { date: string; ratio: number } | null;
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
        style={{ gridTemplateColumns: `minmax(0, 1fr) repeat(${weekDates.length}, minmax(0, 1fr))` }}
      >
        {/* 左标签列 */}
        <div className="text-[9px] text-sandrift font-mono pr-1.5 py-0.5 self-start">关键时间轴</div>

        {weekDates.map((date, colIdx) => {
          const dayItems = byDay.get(date) ?? [];
          const { tracks, overflow } = packDayItems(dayItems);
          return (
            <div
              key={date}
              data-testid="timeline-key-lane"
              className={cn(
                "relative h-[40px] min-h-[40px] border-r border-line-soft px-0.5",
                colIdx === weekDates.length - 1 && "border-r-0"
              )}
            >
              {/* all-day：固定左上角（不占时间位置） */}
              {dayItems
                .filter((it) => it.temporalType === "all-day")
                .map((it) => (
                  <span
                    key={it.id}
                    title={`${it.title}（全天）`}
                    className="absolute left-0.5 top-0.5 max-w-[calc(100%-4px)] truncate text-[9px] font-semibold text-satin-grey bg-alabaster/70 border border-line rounded px-1 py-px"
                  >
                    全天 · {it.title}
                  </span>
                ))}

              {/* 时间比例定位：deadline point / interval block */}
              {tracks.map((track, t) =>
                track
                  .filter((it) => it.temporalType !== "all-day")
                  .map((it) =>
                    it.temporalType === "interval" ? (
                      <IntervalBlock key={it.id} item={it} track={t} />
                    ) : (
                      <DeadlineMarker key={it.id} item={it} track={t} />
                    )
                  )
              )}

              {/* 溢出提示 */}
              {overflow > 0 && (
                <span className="absolute right-1 bottom-0.5 text-[9px] font-bold text-sandrift">
                  +{overflow}
                </span>
              )}

              {/* 当前时间线：极细低饱和线（真实当前周 + 今天） */}
              {nowLine && nowLine.date === date && (
                <div
                  aria-hidden="true"
                  className="absolute left-0 right-0 h-px bg-sandrift/50 pointer-events-none z-10"
                  style={{ top: `${Math.min(nowLine.ratio * 100, 99)}%` }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeadlineMarker({ item, track }: { item: TimelineItem; track: number }) {
  const left = timeToDayRatio(item.startTime) * 100;
  const urgent = item.priority === "urgent";
  const group = item.sourceType === "group-task";
  return (
    <div
      title={`${item.title}${item.startTime ? ` · ${item.startTime} 截止` : "截止"}${item.subtitle ? ` · ${item.subtitle}` : ""}`}
      className="absolute -translate-x-1/2 pointer-events-auto group"
      style={{ left: `${left}%`, top: `${track * 15 + 6}px` }}
    >
      {/* Point */}
      <span
        className={cn(
          "block w-[7px] h-[7px] rounded-full border",
          urgent
            ? "bg-danger/70 border-danger/40"
            : group
              ? "bg-pastel-mint border-pastel-mint/60"
              : "bg-sandrift/70 border-sandrift/40"
        )}
      />
      {/* 短 label：时间 + 截断标题（hover 完整信息在 title） */}
      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 whitespace-nowrap text-[9px] font-semibold text-satin-grey leading-none">
        {item.startTime ?? ""}
        <span className="ml-1 hidden xl:inline truncate max-w-[90px] text-sandrift font-medium">{item.title}</span>
      </span>
    </div>
  );
}

function IntervalBlock({ item, track }: { item: TimelineItem; track: number }) {
  const { leftRatio, widthRatio } = intervalToDayGeometry(item.startTime, item.endTime);
  const exam = item.sourceType === "exam";
  return (
    <div
      title={`${item.title} · ${item.startTime ?? ""}–${item.endTime ?? ""}${item.subtitle ? ` · ${item.subtitle}` : ""}`}
      className={cn(
        "absolute h-[16px] rounded-md border flex items-center px-1 overflow-hidden",
        exam ? "bg-[#F4E9DF] border-[#E3CFBC]" : "bg-alabaster border-line"
      )}
      style={{
        left: `${leftRatio * 100}%`,
        width: `${Math.max(widthRatio * 100, 2.2)}%`,
        top: `${track * 15 + 5}px`,
      }}
    >
      <span className="truncate text-[9px] font-semibold text-satin-grey leading-none">
        {item.title}
      </span>
    </div>
  );
}
