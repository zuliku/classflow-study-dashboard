"use client";

import React from "react";
import { CalendarDays, Flag, GraduationCap } from "lucide-react";
import type { PlanDay, PlanSelection } from "@/lib/plan/planTypes";
import { cn } from "@/lib/utils";

export function PlanAgenda({
  days,
  selectionKey,
  onSelect,
}: {
  days: PlanDay[];
  selectionKey: string | null;
  onSelect: (selection: PlanSelection) => void;
}) {
  const visibleDays = days.filter((day) => day.items.length + day.allDay.length > 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-4" data-testid="plan-agenda">
      {visibleDays.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-16 text-center">
          <CalendarDays className="h-5 w-5 text-sandrift" />
          <p className="text-sm font-semibold text-charcoal">本周没有安排</p>
          <p className="text-xs text-satin-grey">从待安排里拖入任务，或添加学习块。</p>
        </div>
      ) : (
        <div className="divide-y divide-line-soft">
          {visibleDays.map((day) => (
            <section key={day.date} aria-label={day.date}>
              <div
                className={cn(
                  "sticky top-0 z-10 flex items-center gap-2 border-b border-line-soft bg-surface px-4 py-2",
                  day.isToday && "bg-pastel-mint/40"
                )}
              >
                <span className="text-[11px] font-bold text-charcoal">
                  周{"一二三四五六日"[day.dayOfWeek - 1]}
                </span>
                <span className="text-[11px] tabular-nums text-sandrift">
                  {day.dateObj.getMonth() + 1}月{day.dateObj.getDate()}日
                </span>
                {day.isToday && (
                  <span className="rounded-full bg-charcoal px-1.5 py-px text-[9px] font-bold text-white">
                    今天
                  </span>
                )}
                <span className="ml-auto text-[10px] text-sandrift">
                  {day.items.length + day.allDay.length} 项
                </span>
              </div>

              {day.allDay.map((item) => {
                const selection = agendaSelection(item.kind, item);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selection && onSelect(selection)}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-alabaster/50"
                  >
                    <span className="w-12 shrink-0 text-[10px] text-sandrift">全天</span>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] font-semibold text-charcoal">
                      {item.kind === "exam" ? (
                        <GraduationCap className="h-3 w-3 shrink-0 text-warning" />
                      ) : (
                        <Flag className="h-3 w-3 shrink-0 text-danger" />
                      )}
                      <span className="truncate">{item.title}</span>
                    </span>
                  </button>
                );
              })}

              {day.items
                .slice()
                .sort((a, b) => a.start - b.start)
                .map((item) => {
                  const selection = agendaSelection(item.kind, {
                    assignmentId: item.assignmentId,
                    markId: item.markId,
                    blockId: item.blockId,
                    courseId: item.courseId,
                    date: item.date,
                    start: item.start,
                    end: item.end,
                    location: item.location,
                  });
                  const selected = selectionKey === keyFor(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selection && onSelect(selection)}
                      className={cn(
                        "flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-alabaster/50",
                        selected && "bg-pastel-mint/45"
                      )}
                    >
                      <span className="w-12 shrink-0 text-[10px] tabular-nums text-sandrift">
                        {formatTime(item.start)}
                      </span>
                      <span
                        className="h-7 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: item.color ?? kindColor(item.kind) }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold text-charcoal">
                          {item.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-sandrift">
                          {formatTime(item.start)}–{formatTime(item.end)}
                          {item.subtitle ? ` · ${item.subtitle}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function agendaSelection(
  kind: string,
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
      startTime: formatTime(data.start ?? 0),
      endTime: formatTime(data.end ?? 0),
      location: data.location,
    };
  }
  if (kind === "ddl" && data.assignmentId) {
    return { kind: "assignment", assignmentId: data.assignmentId };
  }
  if (data.markId) return { kind: "mark", markId: data.markId };
  if (data.assignmentId) return { kind: "assignment", assignmentId: data.assignmentId };
  return null;
}

function keyFor(item: {
  kind: string;
  blockId?: string;
  markId?: string;
  courseId?: string;
  assignmentId?: string;
  date: string;
  start: number;
}): string {
  if (item.blockId) return `block-${item.blockId}`;
  if (item.markId) return `mark-${item.markId}`;
  if (item.kind === "course" && item.courseId) {
    return `course-${item.courseId}-${item.date}-${item.start}`;
  }
  if (item.assignmentId) return `assignment-${item.assignmentId}`;
  return `${item.kind}-${item.date}-${item.start}`;
}

function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(
    2,
    "0"
  )}`;
}

function kindColor(kind: string): string {
  switch (kind) {
    case "study":
      return "#B9D8C5";
    case "exam":
      return "#D9B98F";
    case "activity":
      return "#BCD7C5";
    case "ddl":
      return "#C97C72";
    default:
      return "#D8D2C8";
  }
}
