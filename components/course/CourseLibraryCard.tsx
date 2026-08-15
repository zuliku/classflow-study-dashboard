"use client";

import React from "react";
import { ChevronRight, FileUp, Loader2, Plus } from "lucide-react";
import { Course, Material } from "@/types";
import { NextCourseSession } from "@/lib/courses/nextSession";
import { CourseTaskRowView } from "@/lib/courseDetailView";
import { MaterialTypeIcon } from "@/components/ui/MaterialTypeIcon";
import { Popover, PopoverPanel } from "@/components/ui/Popover";
import { CourseCardOverflowPopover } from "@/components/course/CourseCardOverflowPopover";
import { cn } from "@/lib/utils";

/** Course Card 二级面板统一状态（同一时间最多一个；由 CoursesWorkspace 持有） */
export type CourseCardPopover =
  | { courseId: string; kind: "tasks" }
  | { courseId: string; kind: "materials" }
  | null;

const TASK_PREVIEW_LIMIT = 2;
const MATERIAL_PREVIEW_LIMIT = 2;
/** Task / Material preview 区域固定高度（2 × 28px），保证内部基线一致 */
const PREVIEW_AREA_HEIGHT = "h-14";

/**
 * Course Library Card（Task 5 follow-up）：
 * 明确分层 —— Course Header（Level 1）→ 下节课 context row → 任务 / 资料 Sections（Level 2，flex-1 均匀吸收
 * Desktop 剩余高度）→ 固定 Footer。Section preview 区域高度恒定，查看全部触发移入 Section Header，
 * 0/1/2/>2 条内容都不改变 Card 内部基线。
 */
export function CourseLibraryCard({
  course,
  next,
  nextCellText,
  meta,
  overdueCount,
  taskRows,
  materials,
  newMaterialIds,
  uploading,
  activePopover,
  onTogglePopover,
  onClosePopover,
  onOpenCourse,
  onOpenAssignment,
  onUploadClick,
  onAddTask,
  onPreviewMaterial,
}: {
  course: Course;
  next: NextCourseSession | null;
  nextCellText: string;
  meta: string;
  overdueCount: number;
  /** 已按未完成优先排序的完整任务行（复用 sortCourseAssignments + buildCourseTaskRow） */
  taskRows: CourseTaskRowView[];
  materials: Material[];
  newMaterialIds: Set<string>;
  uploading: boolean;
  activePopover: CourseCardPopover;
  onTogglePopover: (kind: "tasks" | "materials") => void;
  onClosePopover: () => void;
  onOpenCourse: () => void;
  onOpenAssignment: (assignmentId: string) => void;
  onUploadClick: () => void;
  onAddTask: () => void;
  onPreviewMaterial: (material: Material) => void;
}) {
  const tasksPopoverOpen =
    activePopover?.courseId === course.id && activePopover.kind === "tasks";
  const materialsPopoverOpen =
    activePopover?.courseId === course.id && activePopover.kind === "materials";

  const previewTasks = taskRows.slice(0, TASK_PREVIEW_LIMIT);
  const taskOverflow = taskRows.length - TASK_PREVIEW_LIMIT;
  const previewMaterials = materials.slice(0, MATERIAL_PREVIEW_LIMIT);
  const materialOverflow = materials.length - MATERIAL_PREVIEW_LIMIT;

  const headerMeta = [course.code, meta].filter(Boolean).join(" · ");

  return (
    <article
      className={cn(
        "group flex flex-col bg-surface border border-line rounded-xl",
        "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
        "hover:bg-alabaster/30 hover:border-line-strong"
      )}
    >
      {/* Level 1 — Course Header（Parent Identity；14px name + secondary metadata + 常驻上传） */}
      <header className="shrink-0 bg-alabaster/30 rounded-t-xl px-4 pt-3.5 pb-3 border-b border-line-soft">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span
              aria-hidden="true"
              className="w-[7px] h-[7px] rounded-full shrink-0 mt-1"
              style={{ backgroundColor: course.borderHex }}
            />
            <div className="min-w-0">
              <button
                type="button"
                onClick={onOpenCourse}
                className="block max-w-full truncate text-[14px] font-bold text-charcoal text-left transition-colors hover:text-black"
                title="查看课程详情"
              >
                {course.name}
              </button>
              {headerMeta && (
                <p className="mt-0.5 truncate text-[11px] text-satin-grey">{headerMeta}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onUploadClick}
            disabled={uploading}
            className="ux-press shrink-0 flex items-center gap-1 h-8 px-2.5 rounded-lg border border-line bg-white text-[11px] font-bold text-satin-grey transition-colors hover:bg-alabaster hover:text-charcoal disabled:opacity-60"
          >
            {uploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                上传中…
              </>
            ) : (
              <>
                <FileUp className="w-3.5 h-3.5" />
                上传资料
              </>
            )}
          </button>
        </div>
      </header>

      {/* Context row — 下节课（低于 Section 权重，固定高度） */}
      <div className="shrink-0 h-8 px-4 flex items-center border-b border-line-soft">
        <p className="text-[11px] text-satin-grey truncate">
          <span className="mr-1.5 font-bold text-sandrift">下节课</span>
          {next ? (
            <span className="font-semibold text-charcoal">
              {["周一", "周二", "周三", "周四", "周五", "周六", "周日"][next.dayOfWeek - 1]}{" "}
              {next.startTime}–{next.endTime}
              {next.location || course.classroom ? ` · ${next.location || course.classroom}` : ""}
            </span>
          ) : (
            <span className="text-sandrift">{nextCellText}</span>
          )}
        </p>
      </div>

      {/* Level 2 — TASKS（flex-1 吸收 Desktop 剩余高度；preview 区域恒定 56px） */}
      <section className="flex-1 min-h-[88px] flex flex-col px-4 pt-2.5 pb-2 border-t border-line">
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h4 className="text-xs font-bold text-charcoal/85 shrink-0">
              任务 · {taskRows.length}
            </h4>
            {overdueCount > 0 && (
              <span className="text-[11px] font-semibold text-danger/90 shrink-0">
                {overdueCount} 项逾期
              </span>
            )}
          </div>
          {taskOverflow > 0 && (
            <Popover open={tasksPopoverOpen} onOpenChange={(open) => !open && onClosePopover()}>
              <button
                type="button"
                onClick={() => onTogglePopover("tasks")}
                aria-expanded={tasksPopoverOpen}
                aria-haspopup="dialog"
                className="shrink-0 text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal"
              >
                查看全部 +{taskOverflow}
              </button>
              <PopoverPanel
                placement="bottom-end"
                open={tasksPopoverOpen}
                className="w-[340px] max-w-[calc(100vw-32px)] max-h-[min(360px,55vh)] p-1"
              >
                <CourseCardOverflowPopover
                  course={course}
                  kind="tasks"
                  tasks={taskRows}
                  materials={materials}
                  onOpenAssignment={onOpenAssignment}
                  onPreviewMaterial={onPreviewMaterial}
                  onUploadClick={onUploadClick}
                  onAddTask={onAddTask}
                  uploading={uploading}
                />
              </PopoverPanel>
            </Popover>
          )}
        </div>

        {previewTasks.length === 0 ? (
          <p className={cn(PREVIEW_AREA_HEIGHT, "flex items-center text-[11px] text-sandrift")}>
            暂无未完成任务
          </p>
        ) : (
          <div className={cn(PREVIEW_AREA_HEIGHT, "flex flex-col justify-center")}>
            {previewTasks.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => onOpenAssignment(row.id)}
                className="group/task flex h-7 w-full items-center justify-between gap-2 text-left"
                title="打开任务详情"
              >
                <span className="min-w-0 truncate text-[11px] font-semibold text-charcoal group-hover/task:text-black">
                  {row.title}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[10px]",
                    row.overdue ? "font-bold text-danger/90" : "text-sandrift"
                  )}
                >
                  {row.deadlineLabel}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Level 2 — MATERIALS（与 Task 平行；查看全部触发在 Header 行） */}
      <section className="flex-1 min-h-[88px] flex flex-col px-4 pt-2.5 pb-2 border-t border-line">
        <div className="flex items-center justify-between gap-2 shrink-0">
          <h4 className="text-xs font-bold text-charcoal/85 shrink-0">
            资料 · {materials.length}
          </h4>
          {materialOverflow > 0 && (
            <Popover
              open={materialsPopoverOpen}
              onOpenChange={(open) => !open && onClosePopover()}
            >
              <button
                type="button"
                onClick={() => onTogglePopover("materials")}
                aria-expanded={materialsPopoverOpen}
                aria-haspopup="dialog"
                className="shrink-0 text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal"
              >
                查看全部 +{materialOverflow}
              </button>
              <PopoverPanel
                placement="top-end"
                open={materialsPopoverOpen}
                className="w-[340px] max-w-[calc(100vw-32px)] max-h-[min(360px,55vh)] p-1"
              >
                <CourseCardOverflowPopover
                  course={course}
                  kind="materials"
                  tasks={taskRows}
                  materials={materials}
                  onOpenAssignment={onOpenAssignment}
                  onPreviewMaterial={onPreviewMaterial}
                  onUploadClick={onUploadClick}
                  onAddTask={onAddTask}
                  uploading={uploading}
                />
              </PopoverPanel>
            </Popover>
          )}
        </div>

        {previewMaterials.length === 0 ? (
          <button
            type="button"
            onClick={onUploadClick}
            disabled={uploading}
            className={cn(
              PREVIEW_AREA_HEIGHT,
              "flex w-full items-center justify-between text-[11px] font-semibold text-sandrift transition-colors hover:text-charcoal disabled:opacity-60"
            )}
          >
            <span>暂无课程资料</span>
            <span className="flex items-center gap-1 font-bold">
              <FileUp className="w-3 h-3" />
              上传 →
            </span>
          </button>
        ) : (
          <div className={cn(PREVIEW_AREA_HEIGHT, "flex flex-col justify-center")}>
            {previewMaterials.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onPreviewMaterial(m)}
                className={cn(
                  "group/mat flex h-7 w-full items-center gap-2 text-left",
                  newMaterialIds.has(m.id) && "animate-enter"
                )}
                title="预览资料"
              >
                <MaterialTypeIcon type={m.type} />
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-charcoal group-hover/mat:text-black">
                  {m.title}
                </span>
                <ChevronRight className="w-3 h-3 text-sandrift shrink-0 opacity-0 transition-opacity group-hover/mat:opacity-100" />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* FOOTER — 固定尾部策略：mt-auto + border-t，无竞争 margin */}
      <footer className="mt-auto shrink-0 h-11 px-4 flex items-center justify-between border-t border-line">
        <button
          type="button"
          onClick={onAddTask}
          className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-semibold text-satin-grey transition-colors hover:bg-alabaster hover:text-charcoal"
        >
          <Plus className="w-3.5 h-3.5" />
          任务
        </button>
        <button
          type="button"
          onClick={onOpenCourse}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-sandrift transition-colors hover:bg-alabaster hover:text-charcoal"
        >
          课程详情
          <ChevronRight className="w-3 h-3" />
        </button>
      </footer>
    </article>
  );
}
