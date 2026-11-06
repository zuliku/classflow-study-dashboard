"use client";

import React, { useMemo } from "react";
import { CalendarDays, Clock, Flag, GraduationCap, Play } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/useAppStore";
import { resolveCourseOccurrencesForWeek } from "@/lib/scheduleOccurrences";
import { isActiveStudyBlock } from "@/lib/tasks/taskPlanning";
import { getTaskDeadlineInstant, isActiveTask, localDateKey } from "@/lib/tasks/taskLifecycle";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";
import { cn } from "@/lib/utils";

type TimelineType = "course" | "study" | "exam" | "activity" | "ddl";

interface TimelineItem {
  id: string;
  type: TimelineType;
  title: string;
  subtitle?: string;
  start: number;
  end: number;
  courseId?: string;
  assignmentId?: string;
  markId?: string;
  color?: string;
  textColor?: string;
}

interface AllDayItem {
  id: string;
  type: TimelineType;
  title: string;
  courseId?: string;
  assignmentId?: string;
  markId?: string;
}

const HOUR_HEIGHT = 44;

function toMinutes(value: string | undefined): number | null {
  return value ? timeToMinutes(value) : null;
}

function layoutItems(items: TimelineItem[]): Map<string, { lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const clusters: TimelineItem[][] = [];

  for (const item of sorted) {
    const cluster = clusters.find((group) => item.start < Math.max(...group.map((x) => x.end)));
    if (cluster) cluster.push(item);
    else clusters.push([item]);
  }

  const layout = new Map<string, { lane: number; lanes: number }>();
  for (const cluster of clusters) {
    const laneEnds: number[] = [];
    const assigned: { id: string; lane: number }[] = [];
    for (const item of cluster) {
      let lane = laneEnds.findIndex((end) => end <= item.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.end);
      } else {
        laneEnds[lane] = item.end;
      }
      assigned.push({ id: item.id, lane });
    }
    const lanes = Math.max(1, laneEnds.length);
    for (const item of assigned) layout.set(item.id, { lane: item.lane, lanes });
  }
  return layout;
}

/**
 * Today 的单日时间线：只读，编辑在时间表。
 * 课程 / 学习块 / 考试活动 / DDL 共用一条垂直时间轴；重叠并排，不隐藏。
 */
export function TodayTimeline({ now }: { now: Date }) {
  const {
    courses,
    schedules,
    scheduleOccurrenceOverrides,
    semester,
    currentSemesterWeek,
    studyBlocks,
    calendarMarks,
    assignments,
    setSelectedCourseId,
    setSelectedAssignmentId,
    setSelectedCalendarMarkId,
    setActiveTab,
  } = useAppStore(
    useShallow((s) => ({
      courses: s.courses,
      schedules: s.schedules,
      scheduleOccurrenceOverrides: s.scheduleOccurrenceOverrides,
      semester: s.semester,
      currentSemesterWeek: s.currentSemesterWeek,
      studyBlocks: s.studyBlocks,
      calendarMarks: s.calendarMarks,
      assignments: s.assignments,
      setSelectedCourseId: s.setSelectedCourseId,
      setSelectedAssignmentId: s.setSelectedAssignmentId,
      setSelectedCalendarMarkId: s.setSelectedCalendarMarkId,
      setActiveTab: s.setActiveTab,
    }))
  );

  const today = localDateKey(now);
  const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
  const courseById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);

  const occurrences = useMemo(
    () =>
      resolveCourseOccurrencesForWeek({
        schedules,
        overrides: scheduleOccurrenceOverrides,
        week: currentSemesterWeek,
        totalWeeks: semester.totalWeeks,
      }).filter((occurrence) => occurrence.dayOfWeek === dayOfWeek),
    [schedules, scheduleOccurrenceOverrides, currentSemesterWeek, semester.totalWeeks, dayOfWeek]
  );

  const timed: TimelineItem[] = [];
  const allDay: AllDayItem[] = [];

  for (const occurrence of occurrences) {
    const start = toMinutes(occurrence.startTime);
    const end = toMinutes(occurrence.endTime);
    if (start === null || end === null || end <= start) continue;
    const course = courseById.get(occurrence.courseId);
    timed.push({
      id: `course-${occurrence.id}`,
      type: "course",
      title: course?.name ?? "课程",
      subtitle: occurrence.location,
      start,
      end,
      courseId: occurrence.courseId,
      color: course?.bgHex,
      textColor: course?.textHex,
    });
  }

  for (const block of studyBlocks) {
    if (!isActiveStudyBlock(block) || block.date !== today) continue;
    const start = toMinutes(block.startTime);
    const end = toMinutes(block.endTime);
    if (start === null || end === null || end <= start) continue;
    timed.push({
      id: `block-${block.id}`,
      type: "study",
      title: block.title,
      subtitle: "学习块",
      start,
      end,
      assignmentId: block.assignmentId,
      courseId: block.courseId,
    });
  }

  for (const mark of calendarMarks) {
    if (mark.date !== today) continue;
    if (mark.type !== "exam" && mark.type !== "activity") continue;
    const start = toMinutes(mark.startTime);
    const end = toMinutes(mark.endTime);
    if (start === null || end === null || end <= start) {
      allDay.push({
        id: `mark-${mark.id}`,
        type: mark.type,
        title: mark.title,
        markId: mark.id,
      });
      continue;
    }
    timed.push({
      id: `mark-${mark.id}`,
      type: mark.type,
      title: mark.title,
      subtitle: mark.type === "exam" ? "考试" : "活动",
      start,
      end,
      markId: mark.id,
    });
  }

  for (const assignment of assignments) {
    if (!isActiveTask(assignment)) continue;
    const deadline = getTaskDeadlineInstant(assignment);
    if (!deadline || localDateKey(deadline) !== today) continue;
    const minutes = deadline.getHours() * 60 + deadline.getMinutes();
    timed.push({
      id: `ddl-${assignment.id}`,
      type: "ddl",
      title: assignment.title,
      subtitle: "截止",
      start: minutes,
      end: minutes + 15,
      assignmentId: assignment.id,
    });
  }

  const layout = useMemo(() => layoutItems(timed), [timed]);

  if (timed.length === 0 && allDay.length === 0) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-5" aria-labelledby="today-timeline-title">
        <TimelineHeader onEditPlan={() => setActiveTab("timetable")} />
        <div className="mt-4 flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-soft py-8 text-center">
          <CalendarDays className="h-5 w-5 text-sandrift" />
          <p className="text-[13px] font-semibold text-charcoal">今天没有安排</p>
          <p className="text-[11px] text-satin-grey">在时间表里安排学习时间，或快速添加一件事。</p>
        </div>
      </section>
    );
  }

  const earliest = Math.min(8 * 60, ...timed.map((item) => item.start));
  const latest = Math.max(21 * 60, ...timed.map((item) => item.end));
  const windowStart = Math.max(6 * 60, Math.floor(earliest / 60) * 60);
  const windowEnd = Math.min(24 * 60, Math.ceil(latest / 60) * 60);
  const totalHeight = ((windowEnd - windowStart) / 60) * HOUR_HEIGHT;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const showNow = nowMinutes >= windowStart && nowMinutes <= windowEnd;
  const hours = Array.from(
    { length: Math.floor((windowEnd - windowStart) / 60) + 1 },
    (_, index) => windowStart / 60 + index
  );

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 md:p-5" aria-labelledby="today-timeline-title">
      <TimelineHeader onEditPlan={() => setActiveTab("timetable")} />

      {allDay.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {allDay.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.markId) setSelectedCalendarMarkId(item.markId);
                else if (item.assignmentId) setSelectedAssignmentId(item.assignmentId);
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold",
                item.type === "exam"
                  ? "border-warning-border bg-warning-bg text-warning"
                  : "border-success-border bg-success-bg text-success"
              )}
            >
              {item.type === "exam" ? <GraduationCap className="h-3 w-3" /> : <CalendarDays className="h-3 w-3" />}
              {item.title}
            </button>
          ))}
        </div>
      )}

      <div className="relative mt-3 overflow-hidden rounded-xl border border-line-soft bg-[#FBF9F6]">
        <div className="relative" style={{ height: totalHeight }}>
          {hours.map((hour) => {
            const top = ((hour * 60 - windowStart) / 60) * HOUR_HEIGHT;
            return (
              <div key={hour} className="absolute inset-x-0" style={{ top }}>
                <div className="flex items-start">
                  <span className="w-11 shrink-0 -translate-y-1/2 pr-1 text-right text-[10px] tabular-nums text-sandrift">
                    {String(hour).padStart(2, "0")}:00
                  </span>
                  <span className="mt-0 h-px flex-1 bg-line-soft" />
                </div>
              </div>
            );
          })}

          <div className="absolute inset-y-0 left-11 right-0">
            {timed.map((item) => {
              const position = layout.get(item.id) ?? { lane: 0, lanes: 1 };
              const top = ((item.start - windowStart) / 60) * HOUR_HEIGHT;
              const height = Math.max(18, ((item.end - item.start) / 60) * HOUR_HEIGHT - 2);
              const width = 100 / position.lanes;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid="today-timeline-item"
                  aria-label={`${item.title}，${String(Math.floor(item.start / 60)).padStart(2, "0")}:${String(
                    item.start % 60
                  ).padStart(2, "0")} 到 ${String(Math.floor(item.end / 60)).padStart(2, "0")}:${String(
                    item.end % 60
                  ).padStart(2, "0")}`}
                  onClick={() => {
                    if (item.type === "course" && item.courseId) setSelectedCourseId(item.courseId);
                    else if (item.type === "study" && item.assignmentId)
                      setSelectedAssignmentId(item.assignmentId);
                    else if (item.type === "ddl" && item.assignmentId)
                      setSelectedAssignmentId(item.assignmentId);
                    else if (item.markId) setSelectedCalendarMarkId(item.markId);
                  }}
                  className={cn(
                    "absolute overflow-hidden rounded-lg border px-1.5 py-1 text-left transition-[filter,box-shadow] duration-[var(--motion-fast)] hover:brightness-[0.98] focus-visible:outline-2 focus-visible:outline-charcoal/30",
                    item.type === "course" && "border-line shadow-subtle",
                    item.type === "study" && "border-dashed border-line-strong bg-pastel-mint/35",
                    item.type === "exam" && "border-warning-border bg-warning-bg",
                    item.type === "activity" && "border-success-border bg-success-bg",
                    item.type === "ddl" && "border-danger-border bg-danger-bg text-danger"
                  )}
                  style={{
                    top,
                    height,
                    left: `${position.lane * width}%`,
                    width: `calc(${width}% - 4px)`,
                    ...(item.color ? { backgroundColor: item.color, color: item.textColor } : {}),
                  }}
                >
                  <span className="flex min-w-0 items-center gap-1">
                    {item.type === "ddl" && <Flag className="h-3 w-3 shrink-0" />}
                    <span className="truncate text-[10px] font-bold leading-tight">{item.title}</span>
                  </span>
                  {height >= 34 && (
                    <span className="mt-0.5 flex items-center gap-1 truncate text-[9px] opacity-75">
                      <Clock className="h-2.5 w-2.5 shrink-0" />
                      {String(Math.floor(item.start / 60)).padStart(2, "0")}:
                      {String(item.start % 60).padStart(2, "0")}
                      {item.subtitle ? ` · ${item.subtitle}` : ""}
                    </span>
                  )}
                </button>
              );
            })}

            {showNow && (
              <div
                className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                style={{ top: ((nowMinutes - windowStart) / 60) * HOUR_HEIGHT }}
              >
                <span className="rounded-full bg-danger px-1.5 py-0.5 text-[9px] font-bold text-white">
                  现在
                </span>
                <span className="h-px flex-1 bg-danger/70" />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function TimelineHeader({ onEditPlan }: { onEditPlan: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 id="today-timeline-title" className="text-[13px] font-semibold text-charcoal">
          今天的时间
        </h2>
        <p className="mt-0.5 text-[10px] text-sandrift">课程、学习块、考试与截止共用一条时间线</p>
      </div>
      <button
        type="button"
        onClick={onEditPlan}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-satin-grey transition-colors hover:bg-alabaster hover:text-charcoal"
      >
        <Play className="h-3 w-3" />
        在时间表编辑
      </button>
    </div>
  );
}
