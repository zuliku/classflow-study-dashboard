"use client";

import React from "react";
import { FileUp, Loader2 } from "lucide-react";
import { Course, Material } from "@/types";
import { MaterialTypeIcon } from "@/components/ui/MaterialTypeIcon";
import { buildCourseTaskRow, CourseTaskRowView } from "@/lib/courseDetailView";

/**
 * Course Card 二级富内容 Popover 内容（Task 4）：
 * - tasks：该课程全部任务（未完成优先排序由调用方保证），每行 title + status + deadline；
 *   点击 → Assignment Floating Detail；顶部「+ 新建任务」
 * - materials：全部资料，点击 → previewMaterial；顶部「上传资料」（复用 Workspace 同一 upload handler）
 * 纯 overview/navigation surface：不提供 status/priority/delete 等编辑操作。
 * 面板本体由调用方以 PopoverPanel 承载（无 role="menu"，非 command menu）。
 */
export function CourseCardOverflowPopover({
  course,
  kind,
  tasks,
  materials,
  onOpenAssignment,
  onPreviewMaterial,
  onUploadClick,
  onAddTask,
  uploading,
}: {
  course: Course;
  kind: "tasks" | "materials";
  /** 已按未完成优先排序的 Assignments（复用 sortCourseAssignments） */
  tasks: CourseTaskRowView[];
  materials: Material[];
  onOpenAssignment: (assignmentId: string) => void;
  onPreviewMaterial: (material: Material) => void;
  onUploadClick: () => void;
  onAddTask: () => void;
  uploading: boolean;
}) {
  if (kind === "tasks") {
    return (
      <div className="p-2">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <p className="min-w-0 truncate text-xs font-bold text-charcoal">
            {course.name} · 任务 {tasks.length}
          </p>
          <button
            type="button"
            onClick={onAddTask}
            className="shrink-0 text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal"
          >
            + 新建任务
          </button>
        </div>
        <div className="divide-y divide-line-soft">
          {tasks.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onOpenAssignment(row.id)}
              className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left rounded-lg transition-colors hover:bg-alabaster/60"
            >
              <span className="min-w-0 truncate text-xs font-semibold text-charcoal">
                {row.title}
              </span>
              <span className="shrink-0 text-[10px] text-sandrift">
                {row.statusLabel} · {row.deadlineLabel}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-2">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <p className="min-w-0 truncate text-xs font-bold text-charcoal">
          {course.name} · 资料 {materials.length}
        </p>
        <button
          type="button"
          onClick={onUploadClick}
          disabled={uploading}
          className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal disabled:opacity-60"
        >
          {uploading ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              上传中…
            </>
          ) : (
            <>
              <FileUp className="w-3 h-3" />
              上传资料
            </>
          )}
        </button>
      </div>
      <div className="divide-y divide-line-soft">
        {materials.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onPreviewMaterial(m)}
            className="flex w-full items-center gap-2 px-2 py-2 text-left rounded-lg transition-colors hover:bg-alabaster/60"
          >
            <MaterialTypeIcon type={m.type} />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-charcoal">
              {m.title}
            </span>
            <span className="shrink-0 text-[10px] text-sandrift">
              {m.size ? `${m.size} · ` : ""}
              {m.uploadDate}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
