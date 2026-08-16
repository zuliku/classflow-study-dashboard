"use client";

import React from "react";
import { ChevronRight, FileUp, Loader2, Plus } from "lucide-react";
import { Course, Material } from "@/types";
import { NextCourseSession } from "@/lib/courses/nextSession";
import { CourseTaskRowView } from "@/lib/courseDetailView";
import { CourseLibraryTaskView } from "@/lib/courses/courseLibraryView";
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
/** preview row 高度（局部 line-height stability；不用于撑高整个 Card） */
const PREVIEW_ROW_HEIGHT = "h-7";
/** Desktop preview 区域稳定 slot（2 × h-7；仅 xl，mobile/tablet content-fit） */
const PREVIEW_SLOT_XL = "xl:min-h-14";

const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/**
 * Course Library Card（V5 — Compact Resource Dashboard）：
 * - Course Identity：bgHex header tint + borderHex accent rail（无 tiny dot）
 * - 扫读路径：Identity → Next Session → Task Attention → Materials
 * - 待处理 N（todo/doing only；逾期同源）；课程资料 N 视觉低于待处理
 * - Desktop：h-full + 稳定 preview slots（xl:min-h-14）→ 同一 Grid row 等高
 * - 无 Footer；Add Task 在 Task Section；Upload 为 compact ghost action
 */
export function CourseLibraryCard({
  course,
  next,
  nextCellText,
  meta,
  taskRows,
  taskView,
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
  /** code · teacher · classroom（空字段不产生孤立 separator） */
  meta: string;
  /** 全部任务行（Popover 完整列表；含 submitted/completed） */
  taskRows: CourseTaskRowView[];
  /** 由 lib/courses/courseLibraryView 派生（attention + overdue + total 同源） */
  taskView: CourseLibraryTaskView;
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

  const { attentionRows, attentionCount, overdueCount, totalCount } = taskView;
  const previewTasks = attentionRows.slice(0, TASK_PREVIEW_LIMIT);
  const previewMaterials = materials.slice(0, MATERIAL_PREVIEW_LIMIT);

  const headerMeta = [course.code, meta].filter(Boolean).join(" · ");
  // V5.1：入口可见性 = 完整列表中存在未出现在首屏 preview 的任务
  // （不能按 totalCount > 2 判断——1 todo + 1 submitted 时 submitted 会无法访问）
  const hiddenTaskCount = totalCount - previewTasks.length;
  const showAllTasks = hiddenTaskCount > 0;
  const showAllMaterials = materials.length > MATERIAL_PREVIEW_LIMIT;

  return (
    <article
      data-testid={`course-library-card-${course.id}`}
      className={cn(
        "flex h-full flex-col bg-surface border border-line rounded-xl",
        "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
        "hover:border-line-strong"
      )}
    >
      {/* Course Identity Header：bgHex tint + borderHex accent rail（身份集中在 Header） */}
      <header
        className="shrink-0 rounded-t-xl border-b border-line-soft px-4 pt-3 pb-3"
        style={{ backgroundColor: course.bgHex }}
      >
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-1 h-8 w-[3.5px] shrink-0 rounded-full"
            style={{ backgroundColor: course.borderHex }}
          />
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={onOpenCourse}
              title={course.name}
              className="block max-w-full truncate text-[15px] font-bold leading-snug text-charcoal text-left transition-colors hover:text-black"
            >
              {course.name}
            </button>
            {headerMeta && (
              <p className="mt-0.5 truncate text-[11px] text-satin-grey">{headerMeta}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onUploadClick}
            disabled={uploading}
            aria-label={`上传《${course.name}》的课程资料`}
            className="ux-press shrink-0 flex items-center gap-1 h-7 px-2 rounded-lg text-[11px] font-bold text-satin-grey transition-colors hover:bg-black/5 hover:text-charcoal disabled:opacity-60"
          >
            {uploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                上传中…
              </>
            ) : (
              <>
                <FileUp className="w-3.5 h-3.5" />
                上传
              </>
            )}
          </button>
        </div>
      </header>

      {/* Next Session Context：紧凑信息行（有/无下一节高度一致；null → 只显示 muted 文案） */}
      <div className="shrink-0 min-h-9 px-4 py-2 flex items-center">
        {next ? (
          <p className="text-[11px] text-satin-grey truncate">
            <span className="mr-1.5 font-bold text-sandrift">下节课</span>
            <span className="font-semibold text-charcoal">
              {WEEKDAY_LABELS[next.dayOfWeek - 1]} {next.startTime}–{next.endTime}
              {next.location || course.classroom ? ` · ${next.location || course.classroom}` : ""}
            </span>
          </p>
        ) : (
          <p className="text-[11px] text-sandrift truncate">{nextCellText}</p>
        )}
      </div>

      {/* TASKS — Attention（待处理；todo/doing；逾期同源；首屏注意力） */}
      <section className="flex flex-col px-4 pt-1.5 pb-2">
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h4 className="shrink-0 text-xs font-bold text-charcoal">待处理 {attentionCount}</h4>
            {overdueCount > 0 && (
              <span className="text-[11px] font-semibold text-danger/90 shrink-0">
                {overdueCount} 项逾期
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onAddTask}
              aria-label={`为《${course.name}》添加任务`}
              className="flex items-center gap-0.5 text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal"
            >
              <Plus className="w-3 h-3" />
              添加
            </button>
            {showAllTasks && (
              <Popover open={tasksPopoverOpen} onOpenChange={(open) => !open && onClosePopover()}>
                <button
                  type="button"
                  onClick={() => onTogglePopover("tasks")}
                  aria-expanded={tasksPopoverOpen}
                  aria-haspopup="dialog"
                  className="flex items-center gap-0.5 text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal"
                >
                  全部 {totalCount} 项
                  <ChevronRight className="w-3 h-3" />
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
        </div>

        <div className={cn("flex flex-col pt-1", PREVIEW_SLOT_XL)}>
          {previewTasks.length === 0 ? (
            <p className={cn(PREVIEW_ROW_HEIGHT, "flex items-center text-[11px] text-sandrift")}>
              暂无待处理任务
            </p>
          ) : (
            previewTasks.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => onOpenAssignment(row.id)}
                className={cn(
                  "group/task flex w-full items-center justify-between gap-2 text-left",
                  PREVIEW_ROW_HEIGHT
                )}
                title="打开任务详情"
              >
                <span className="min-w-0 truncate text-[11px] font-semibold text-charcoal group-hover/task:text-black">
                  {row.title}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[10px]",
                    row.overdue ? "font-bold text-danger/90" : row.hasDdl ? "text-sandrift" : "text-satin-grey/80"
                  )}
                >
                  {row.deadlineLabel}
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      {/* MATERIALS — Resource（视觉低于 Tasks；仅一条 very subtle divider） */}
      <section className="flex flex-col px-4 pt-2 pb-3 border-t border-line-soft">
        <div className="flex items-center justify-between gap-2 shrink-0">
          <h4 className="shrink-0 text-xs font-bold text-charcoal/85">课程资料 {materials.length}</h4>
          {showAllMaterials && (
            <Popover
              open={materialsPopoverOpen}
              onOpenChange={(open) => !open && onClosePopover()}
            >
              <button
                type="button"
                onClick={() => onTogglePopover("materials")}
                aria-expanded={materialsPopoverOpen}
                aria-haspopup="dialog"
                className="flex items-center gap-0.5 text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal"
              >
                全部 {materials.length} 项
                <ChevronRight className="w-3 h-3" />
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

        <div className={cn("flex flex-col pt-1", PREVIEW_SLOT_XL)}>
          {previewMaterials.length === 0 ? (
            <p className={cn(PREVIEW_ROW_HEIGHT, "flex items-center text-[11px] text-sandrift")}>
              暂无课程资料
            </p>
          ) : (
            previewMaterials.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onPreviewMaterial(m)}
                className={cn(
                  "group/mat flex w-full items-center gap-2 text-left",
                  PREVIEW_ROW_HEIGHT,
                  newMaterialIds.has(m.id) && "animate-enter"
                )}
                title="预览资料"
              >
                <MaterialTypeIcon type={m.type} />
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-charcoal/90 group-hover/mat:text-charcoal">
                  {m.title}
                </span>
                <ChevronRight className="w-3 h-3 text-sandrift shrink-0 opacity-0 transition-opacity group-hover/mat:opacity-100" />
              </button>
            ))
          )}
        </div>
      </section>
    </article>
  );
}
