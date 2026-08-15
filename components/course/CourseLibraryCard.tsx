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

/**
 * Course Library Card V4（Task 4）：
 * 三层结构 —— COURSE IDENTITY（identity dot + header）→ 下节课 context strip → 任务/资料平行 sections → footer。
 * - 固定高度（xl 两列统一 312px）：Task/Material preview 数量固定，空态固定高度，保证 Card 内容天然可控
 * - 溢出 → 轻量二级 Popover（tasks bottom-end / materials top-end），不直接进详情
 * - 上传资料始终可见（header + materials popover 共用 Workspace 同一 upload handler）
 * - article 本体不是按钮；所有可交互点都是明确 button
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

  return (
    <article
      className={cn(
        "group relative flex flex-col bg-surface border border-line rounded-xl",
        "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
        "hover:bg-alabaster/30 hover:border-line-strong",
        "xl:h-[320px]"
      )}
    >
      {/* HEADER：课程身份（名称最高层级 + identity dot）+ 始终可见的上传资料 */}
      <header className="shrink-0 bg-alabaster/20 rounded-t-xl px-4 pt-3.5 pb-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span
              aria-hidden="true"
              className="w-[7px] h-[7px] rounded-full shrink-0"
              style={{ backgroundColor: course.borderHex }}
            />
            <div className="min-w-0">
              <button
                type="button"
                onClick={onOpenCourse}
                className="block max-w-full truncate text-[13px] font-bold text-charcoal text-left transition-colors hover:text-black"
                title="查看课程详情"
              >
                {course.name}
              </button>
              <div className="flex items-center gap-2 min-w-0">
                {course.code && (
                  <span className="text-[11px] font-mono text-sandrift truncate">{course.code}</span>
                )}
                {meta && <span className="text-[11px] text-satin-grey truncate">{meta}</span>}
              </div>
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

      {/* 下节课：context strip（低于 Task/Material section 视觉权重） */}
      <div className="shrink-0 px-4 pt-2.5">
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

      {/* TASKS：固定 preview section（最多 2 条）+ 溢出 Popover */}
      <section className="shrink-0 px-4 pt-2.5 mt-2 border-t border-line-soft">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-bold text-sandrift">任务 {taskRows.length}</h4>
          {overdueCount > 0 && (
            <span className="text-[11px] font-bold text-danger/90">{overdueCount} 项逾期</span>
          )}
        </div>

        {previewTasks.length === 0 ? (
          <p className="h-7 flex items-center text-[11px] text-sandrift">暂无未完成任务</p>
        ) : (
          <div>
            {previewTasks.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => onOpenAssignment(row.id)}
                className="group/task flex w-full items-center justify-between gap-2 py-1 text-left"
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
            {taskOverflow > 0 && (
              <Popover open={tasksPopoverOpen} onOpenChange={(open) => !open && onClosePopover()}>
                <button
                  type="button"
                  onClick={() => onTogglePopover("tasks")}
                  aria-expanded={tasksPopoverOpen}
                  aria-haspopup="dialog"
                  className="py-0.5 text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal"
                >
                  +{taskOverflow} 查看全部
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
        )}
      </section>

      {/* MATERIALS：与 Task 平行的固定 preview section */}
      <section className="shrink-0 px-4 pt-2.5 mt-2 border-t border-line-soft">
        <h4 className="text-[11px] font-bold text-sandrift">资料 {materials.length}</h4>

        {previewMaterials.length === 0 ? (
          <button
            type="button"
            onClick={onUploadClick}
            disabled={uploading}
            className="h-7 flex w-full items-center justify-between text-[11px] font-semibold text-sandrift transition-colors hover:text-charcoal disabled:opacity-60"
          >
            <span>暂无课程资料</span>
            <span className="flex items-center gap-1 font-bold">
              <FileUp className="w-3 h-3" />
              上传第一份资料 →
            </span>
          </button>
        ) : (
          <div>
            {previewMaterials.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onPreviewMaterial(m)}
                className={cn(
                  "group/mat flex w-full items-center gap-2 py-1 text-left",
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
                  className="py-0.5 text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal"
                >
                  +{materialOverflow} 查看全部
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
        )}
      </section>

      {/* FOOTER：低权重动作 */}
      <footer className="mt-auto shrink-0 flex items-center justify-between px-4 pt-2.5 pb-3 mt-2.5 border-t border-line-soft">
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
