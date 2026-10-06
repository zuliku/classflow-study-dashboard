"use client";

import React, { useMemo, useState } from "react";
import { FileUp, Loader2, Search, X } from "lucide-react";
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
 * Codex-style 小搜索：任务/资料按标题过滤（演示数据单课可达数十项）。
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
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visibleTasks = useMemo(
    () => (!q ? tasks : tasks.filter((t) => t.title.toLowerCase().includes(q))),
    [tasks, q]
  );
  const visibleMaterials = useMemo(
    () => (!q ? materials : materials.filter((m) => m.title.toLowerCase().includes(q))),
    [materials, q]
  );
  const searchBox = (
    <div className="px-2 pb-1.5">
      <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line-soft bg-background focus-within:border-line-strong transition-colors">
        <Search className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={kind === "tasks" ? "搜索任务..." : "搜索资料..."}
          aria-label={kind === "tasks" ? "搜索任务" : "搜索资料"}
          className="flex-1 min-w-0 bg-transparent text-xs text-charcoal placeholder:text-sandrift/70 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="清空搜索"
            className="p-0.5 rounded text-sandrift hover:text-charcoal transition-colors shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
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
        {searchBox}
        <div className="max-h-[min(260px,40vh)] overflow-y-auto overflow-x-clip divide-y divide-line-soft">
          {visibleTasks.length === 0 && (
            <p className="px-2 py-3 text-xs text-sandrift">{q ? "无匹配任务" : "暂无任务"}</p>
          )}
          {visibleTasks.map((row) => (
            <button
              key={row.id}
              type="button"
              title={row.title}
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
        <p title={course.name} className="min-w-0 truncate text-xs font-bold text-charcoal">
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
      {searchBox}
      <div className="max-h-[min(260px,40vh)] overflow-y-auto overflow-x-clip divide-y divide-line-soft">
        {visibleMaterials.length === 0 && (
          <p className="px-2 py-3 text-xs text-sandrift">{q ? "无匹配资料" : "暂无资料"}</p>
        )}
        {visibleMaterials.map((m) => (
          <button
            key={m.id}
            type="button"
            title={m.title}
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
