"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CalendarDays, Flag, GraduationCap } from "lucide-react";
import type { PlanCanvasItem, PlanDay, PlanSelection } from "@/lib/plan/planTypes";
import { layoutPlanItems } from "@/lib/plan/canvasLayout";
import { cn } from "@/lib/utils";

const HOUR_HEIGHT = 56;
const GRID_PAD_Y = 8;
const DEFAULT_START = 8 * 60;
const DEFAULT_END = 22 * 60;

export function PlanCanvas({
  days,
  now,
  selectionKey,
  onSelect,
  onDropTask,
  onMoveBlock,
  onDragActiveChange,
}: {
  days: PlanDay[];
  now: Date;
  selectionKey: string | null;
  onSelect: (selection: PlanSelection) => void;
  onDropTask: (date: string, minutes: number) => void;
  onMoveBlock: (blockId: string, date: string, minutes: number) => void;
  onDragActiveChange?: (active: boolean) => void;
}) {
  const [drop, setDrop] = useState<{ date: string; minutes: number } | null>(null);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);

  useEffect(() => {
    const clear = () => {
      setDrop(null);
      setDraggingBlockId(null);
    };
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, []);

  const { rangeStart, rangeEnd } = useMemo(() => {
    const starts = days.flatMap((day) => day.items.map((item) => item.start));
    const ends = days.flatMap((day) => day.items.map((item) => item.end));
    const earliest = Math.min(DEFAULT_START, ...starts);
    const latest = Math.max(DEFAULT_END, ...ends);
    return {
      rangeStart: Math.max(6 * 60, Math.floor(earliest / 60) * 60),
      rangeEnd: Math.min(24 * 60, Math.ceil(latest / 60) * 60),
    };
  }, [days]);

  const totalHeight = ((rangeEnd - rangeStart) / 60) * HOUR_HEIGHT;
  const hours = Array.from(
    { length: Math.floor((rangeEnd - rangeStart) / 60) + 1 },
    (_, index) => rangeStart / 60 + index
  );
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const showNow =
    nowMinutes >= rangeStart &&
    nowMinutes <= rangeEnd &&
    days.some((day) => day.isToday);
  const hasAllDay = days.some((day) => day.allDay.length > 0);

  const minuteFromPointer = (event: React.DragEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const relative = event.clientY - rect.top - GRID_PAD_Y;
    const raw = rangeStart + (relative / HOUR_HEIGHT) * 60;
    return Math.min(rangeEnd - 15, Math.max(rangeStart, Math.round(raw / 15) * 15));
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface" data-testid="plan-canvas">
      <div className="flex shrink-0 border-b border-line">
        <div className="w-14 shrink-0 border-r border-line-soft" aria-hidden="true" />
        <div className="grid min-w-0 flex-1 grid-cols-7">
          {days.map((day) => (
            <div
              key={day.date}
              className={cn(
                "min-w-0 border-r border-line-soft px-2 py-2 last:border-r-0",
                day.isToday && "bg-pastel-mint/35"
              )}
            >
              <div className="flex items-center justify-between gap-1 whitespace-nowrap">
                <span className={cn("text-[11px] font-bold", day.isToday ? "text-charcoal" : "text-satin-grey")}>
                  周{"一二三四五六日"[day.dayOfWeek - 1]}{" "}
                  <span className="text-[10px] font-normal tabular-nums text-sandrift">
                    {day.dateObj.getMonth() + 1}/{day.dateObj.getDate()}
                  </span>
                </span>
                <span className="text-[10px] tabular-nums text-sandrift">
                  {day.items.length + day.allDay.length} 项
                </span>
              </div>
              {day.isToday && (
                <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-charcoal">
                  <span className="h-1.5 w-1.5 rounded-full bg-charcoal" aria-hidden="true" />
                  今天
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {hasAllDay && (
        <div className="flex shrink-0 border-b border-line-soft bg-alabaster/20">
          <div className="flex w-14 shrink-0 items-start justify-end border-r border-line-soft px-1 py-1.5">
            <span className="text-[10px] text-sandrift">全天</span>
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-7">
            {days.map((day) => (
              <div key={day.date} className="min-w-0 border-r border-line-soft p-1 last:border-r-0">
                <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
                  {day.allDay.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        const selection = selectionFor(item.kind, {
                          assignmentId: item.assignmentId,
                          markId: item.markId,
                          courseId: item.courseId,
                          date: item.date,
                        });
                        if (selection) onSelect(selection);
                      }}
                      className={cn(
                        "inline-flex max-w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                        item.kind === "exam"
                          ? "border-warning-border bg-warning-bg text-warning"
                          : item.kind === "activity"
                            ? "border-success-border bg-success-bg text-success"
                            : "border-danger-border bg-danger-bg text-danger"
                      )}
                    >
                      {item.kind === "exam" ? (
                        <GraduationCap className="h-2.5 w-2.5 shrink-0" />
                      ) : item.kind === "ddl" ? (
                        <Flag className="h-2.5 w-2.5 shrink-0" />
                      ) : (
                        <CalendarDays className="h-2.5 w-2.5 shrink-0" />
                      )}
                      <span className="truncate">{item.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="plan-canvas-scroll">
        <div className="relative flex" style={{ height: totalHeight + GRID_PAD_Y * 2 }}>
          <div className="relative w-14 shrink-0 border-r border-line-soft">
            {hours.map((hour, index) => {
              const top = GRID_PAD_Y + ((hour * 60 - rangeStart) / 60) * HOUR_HEIGHT;
              const isFirst = index === 0;
              const isLast = index === hours.length - 1;
              return (
                <span
                  key={hour}
                  className={cn(
                    "absolute right-1 text-[10px] tabular-nums text-sandrift",
                    isFirst ? "" : isLast ? "-translate-y-full" : "-translate-y-1/2"
                  )}
                  style={{ top }}
                >
                  {String(hour).padStart(2, "0")}:00
                </span>
              );
            })}
          </div>

          <div className="relative grid min-w-0 flex-1 grid-cols-7">
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              {hours.map((hour) => (
                <span
                  key={hour}
                  className="absolute inset-x-0 h-px bg-line-soft"
                  style={{
                    top: GRID_PAD_Y + ((hour * 60 - rangeStart) / 60) * HOUR_HEIGHT,
                  }}
                />
              ))}
            </div>

            {days.map((day, dayIndex) => {
              const layout = layoutPlanItems(day.items);
              return (
                <div
                  key={day.date}
                  data-plan-day={day.date}
                  className={cn(
                    "relative min-w-0 border-r border-line-soft last:border-r-0",
                    dayIndex >= 5 && "bg-alabaster/25",
                    day.isToday && "bg-pastel-mint/20",
                    drop?.date === day.date && "bg-pastel-mint/40"
                  )}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect =
                      event.dataTransfer.effectAllowed === "move" ? "move" : "copy";
                    setDrop({ date: day.date, minutes: minuteFromPointer(event) });
                    onDragActiveChange?.(true);
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                    setDrop((current) => (current?.date === day.date ? null : current));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const minutes = minuteFromPointer(event);
                    const movedBlockId =
                      event.dataTransfer.getData("application/x-plan-block") || draggingBlockId;
                    setDrop(null);
                    onDragActiveChange?.(false);
                    if (movedBlockId) {
                      onMoveBlock(movedBlockId, day.date, minutes);
                      setDraggingBlockId(null);
                    } else {
                      onDropTask(day.date, minutes);
                    }
                  }}
                >
                  {drop?.date === day.date && (
                    <div
                      className="pointer-events-none absolute inset-x-1 z-20 rounded-lg border border-dashed border-charcoal/40 bg-pastel-mint/60 px-1.5 py-1 text-[10px] font-bold text-charcoal"
                      style={{
                        top: GRID_PAD_Y + ((drop.minutes - rangeStart) / 60) * HOUR_HEIGHT,
                        height: 56,
                      }}
                    >
                      {String(Math.floor(drop.minutes / 60)).padStart(2, "0")}:
                      {String(drop.minutes % 60).padStart(2, "0")}
                    </div>
                  )}

                  {day.isToday && showNow && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-30 flex items-center"
                      style={{
                        top: GRID_PAD_Y + ((nowMinutes - rangeStart) / 60) * HOUR_HEIGHT,
                      }}
                    >
                      <span className="rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">
                        现在
                      </span>
                      <span className="h-px flex-1 bg-danger/70" />
                    </div>
                  )}

                  {day.items.map((item) => {
                    const slot = layout.get(item.id) ?? { lane: 0, lanes: 1 };
                    const top = GRID_PAD_Y + ((item.start - rangeStart) / 60) * HOUR_HEIGHT;
                    const height = Math.max(
                      24,
                      ((item.end - item.start) / 60) * HOUR_HEIGHT - 2
                    );
                    const width = 100 / slot.lanes;
                    const selected = selectionKey === itemKey(item);
                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        data-testid="plan-canvas-item"
                        data-kind={item.kind}
                        aria-label={`${item.title}，${formatItemTime(item)}`}
                        draggable={item.kind === "study" && !!item.blockId}
                        onDragStart={(event) => {
                          if (item.kind !== "study" || !item.blockId) return;
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("application/x-plan-block", item.blockId);
                          setDraggingBlockId(item.blockId);
                        }}
                        onDragEnd={() => setDraggingBlockId(null)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          const selection = selectionFor(item.kind, {
                            assignmentId: item.assignmentId,
                            markId: item.markId,
                            blockId: item.blockId,
                            courseId: item.courseId,
                            date: item.date,
                            start: item.start,
                            end: item.end,
                            location: item.location,
                          });
                          if (selection) onSelect(selection);
                        }}
                        onClick={() => {
                          const selection = selectionFor(item.kind, {
                            assignmentId: item.assignmentId,
                            markId: item.markId,
                            blockId: item.blockId,
                            courseId: item.courseId,
                            date: item.date,
                            start: item.start,
                            end: item.end,
                            location: item.location,
                          });
                          if (selection) onSelect(selection);
                        }}
                        className={cn(
                          "absolute overflow-hidden rounded-lg border px-1.5 py-1 text-left transition-[filter,box-shadow] duration-[var(--motion-fast)] hover:brightness-[0.98] focus-visible:outline-2 focus-visible:outline-charcoal/30",
                          item.kind === "course" && "border-line shadow-subtle",
                          item.kind === "study" &&
                            "border-dashed border-line-strong bg-pastel-mint/45",
                          item.kind === "exam" && "border-warning-border bg-warning-bg",
                          item.kind === "activity" && "border-success-border bg-success-bg",
                          item.kind === "ddl" && "border-danger-border bg-danger-bg text-danger",
                          selected && "ring-2 ring-charcoal/35",
                          draggingBlockId === item.blockId && "opacity-40"
                        )}
                        style={{
                          top,
                          height,
                          left: `calc(${slot.lane * width}% + 3px)`,
                          width: `calc(${width}% - 6px)`,
                          ...(item.color ? { backgroundColor: item.color, color: item.textColor } : {}),
                        }}
                      >
                        <span className="flex min-w-0 items-center gap-1">
                          {item.kind === "ddl" && <Flag className="h-2.5 w-2.5 shrink-0" />}
                          {item.kind === "exam" && (
                            <GraduationCap className="h-2.5 w-2.5 shrink-0" />
                          )}
                          <span className="truncate text-[10px] font-bold leading-tight">
                            {item.title}
                          </span>
                        </span>
                        {height >= 36 && (
                          <span className="mt-0.5 block truncate text-[10px] opacity-75">
                            {formatItemTime(item)}
                            {item.subtitle ? ` · ${item.subtitle}` : ""}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

          </div>
        </div>
      </div>
    </section>
  );
}

function formatItemTime(item: PlanCanvasItem): string {
  return `${String(Math.floor(item.start / 60)).padStart(2, "0")}:${String(
    item.start % 60
  ).padStart(2, "0")}–${String(Math.floor(item.end / 60)).padStart(2, "0")}:${String(
    item.end % 60
  ).padStart(2, "0")}`;
}

function itemKey(item: PlanCanvasItem): string {
  if (item.blockId) return `block-${item.blockId}`;
  if (item.markId) return `mark-${item.markId}`;
  if (item.kind === "course" && item.courseId) {
    return `course-${item.courseId}-${item.date}-${item.start}`;
  }
  if (item.assignmentId) return `assignment-${item.assignmentId}`;
  return item.id;
}

function selectionFor(
  kind: PlanCanvasItem["kind"],
  data: {
    assignmentId?: string;
    markId?: string;
    blockId?: string;
    courseId?: string;
    date: string;
    start?: number;
    end?: number;
    location?: string;
  }
): PlanSelection | null {
  if (kind === "study" && data.blockId) return { kind: "block", blockId: data.blockId };
  if (kind === "course" && data.courseId) {
    return {
      kind: "course",
      courseId: data.courseId,
      date: data.date,
      startTime: minutesToTime(data.start ?? 0),
      endTime: minutesToTime(data.end ?? 0),
      location: data.location,
    };
  }
  if (kind === "ddl" && data.assignmentId) {
    return { kind: "assignment", assignmentId: data.assignmentId };
  }
  if ((kind === "exam" || kind === "activity" || kind === "ddl") && data.markId) {
    return { kind: "mark", markId: data.markId };
  }
  if (data.assignmentId) return { kind: "assignment", assignmentId: data.assignmentId };
  return null;
}

function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(
    2,
    "0"
  )}`;
}


