"use client";

import React, { useRef, useState } from "react";
import { ChevronRight, FileUp, Plus } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { Button } from "@/components/ui/Button";
import { MaterialTypeIcon } from "@/components/ui/MaterialTypeIcon";
import { uploadCourseMaterials } from "@/lib/materialUpload";
import { previewMaterial, openAssignmentEditor } from "@/lib/uiEvents";
import { deriveNextCourseSession } from "@/lib/courses/nextSession";
import { getSemesterWeek } from "@/lib/semester";
import { parseLocalDDL } from "@/lib/ddl";
import { useEnterOnAdd } from "@/lib/useEnterOnAdd";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 课程教师/教室：存在才显示，空字段不产生孤立 separator */
function courseMetaText(course: { teacher: string; classroom: string }): string {
  return [course.teacher, course.classroom].filter(Boolean).join(" · ");
}

/**
 * Course Library Workspace（Task 3B Phase A）：
 * 每门课程 = 一块「课程工作单元」Card：身份 / 元数据 / 本周下一节 / 任务状态 / 资料预览。
 * - 上传资料入口每张 Card 始终可见，直接复用 uploadCourseMaterials（IndexedDB + metadata + toast）
 * - material row 点击直接 previewMaterial，不强制先进详情
 * - 空资料课程显示「上传第一份资料」CTA
 * - 卡片本体是 article，可点击区域是明确按钮（避免 nested interactive）
 */
export function CoursesWorkspace() {
  const {
    courses,
    schedules,
    assignments,
    semester,
    setSelectedCourseId,
    setAddCourseModalOpen,
    setImportScheduleModalOpen,
    addCourseMaterial,
  } = useAppStore();
  const pushToast = useToastStore((s) => s.pushToast);

  const totalCredits = courses.reduce((sum, c) => sum + c.credit, 0);
  const totalMaterials = courses.reduce((sum, c) => sum + c.materials.length, 0);

  // 「本周下一节」基于真实当前教学周（semester + 今天），不跟随 Timeline 浏览过的任意周
  const realSemesterWeek = getSemesterWeek(new Date(), semester);
  const inTeachingWeek = realSemesterWeek >= 1 && realSemesterWeek <= semester.totalWeeks;

  // ---- Workspace 直接上传（真实逻辑复用 uploadCourseMaterials，不复制 Blob 逻辑）----
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTargetCourseId, setUploadTargetCourseId] = useState<string | null>(null);
  const [uploadingCourseId, setUploadingCourseId] = useState<string | null>(null);

  const handleUploadClick = (courseId: string) => {
    setUploadTargetCourseId(courseId);
    fileInputRef.current?.click();
  };

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    const courseId = uploadTargetCourseId;
    if (!files || files.length === 0 || !courseId) return;
    setUploadingCourseId(courseId);
    try {
      const { succeeded, failed } = await uploadCourseMaterials({
        courseId,
        files: Array.from(files),
        addMaterial: addCourseMaterial,
      });
      if (succeeded.length > 0) {
        pushToast({
          message: succeeded.length === 1 ? "资料已上传" : `${succeeded.length} 份资料已上传`,
        });
      }
      for (const name of failed) {
        pushToast({ type: "error", message: `《${name}》保存失败，请重试` });
      }
    } finally {
      setUploadingCourseId(null);
      e.target.value = "";
    }
  };

  // 新增资料出场动画：跨课程统一追踪（useEnterOnAdd 不能放在 map 内）
  const allMaterialIds = courses.flatMap((c) => c.materials.map((m) => m.id));
  const newMaterialIds = useEnterOnAdd(allMaterialIds);

  const now = new Date();

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <WorkspaceHeader
        title="课程资料"
        context={`${courses.length} 门课程 · ${totalCredits} 学分 · ${totalMaterials} 份资料`}
        primaryAction={
          <Button variant="primary" size="sm" onClick={() => setAddCourseModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            <span>添加课程</span>
          </Button>
        }
        sticky
      />

      <div className="flex-1 min-h-0 overflow-y-auto p-4 pb-24 md:p-6 md:pb-6">
        {courses.length === 0 ? (
          <div className="bg-surface border border-line rounded-xl p-10 shadow-subtle flex flex-col items-center justify-center gap-2.5 text-center">
            <p className="text-xs font-bold text-charcoal">暂无课程</p>
            <p className="text-[11px] text-sandrift">添加第一门课程或导入课表，开始建立课程资料库</p>
            <div className="flex items-center gap-2 mt-1">
              <Button variant="primary" size="sm" onClick={() => setAddCourseModalOpen(true)}>
                <Plus className="w-3.5 h-3.5" />
                <span>添加课程</span>
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setImportScheduleModalOpen(true)}>
                <FileUp className="w-3.5 h-3.5" />
                <span>导入课表</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            {courses.map((course) => {
              const next = inTeachingWeek
                ? deriveNextCourseSession(course.id, schedules, realSemesterWeek, semester.totalWeeks)
                : null;
              const nextCellText = !inTeachingWeek
                ? "当前不在教学周"
                : next
                  ? null
                  : "本周无后续课程";

              const courseAssignments = assignments.filter((a) => a.courseId === course.id);
              const incompleteCount = courseAssignments.filter(
                (a) => a.status !== "completed"
              ).length;
              const overdueCount = courseAssignments.filter((a) => {
                if (a.status === "completed") return false;
                const ddl = parseLocalDDL(a.ddl);
                return ddl ? ddl.getTime() < now.getTime() : false;
              }).length;
              const nearestDdl = courseAssignments
                .filter((a) => {
                  if (a.status === "completed") return false;
                  const ddl = parseLocalDDL(a.ddl);
                  return ddl ? ddl.getTime() >= now.getTime() : false;
                })
                .sort((a, b) => (parseLocalDDL(a.ddl)?.getTime() ?? 0) - (parseLocalDDL(b.ddl)?.getTime() ?? 0))[0];
              const nearestDdlDate = nearestDdl ? parseLocalDDL(nearestDdl.ddl) : null;

              const materials = course.materials;
              const uploading = uploadingCourseId === course.id;
              const meta = courseMetaText(course);

              return (
                <article
                  key={course.id}
                  className={cn(
                    "group flex flex-col bg-surface border border-line rounded-xl",
                    "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
                    "hover:bg-alabaster/30 hover:border-line-strong"
                  )}
                >
                  {/* Header：身份 + 始终可见的上传资料入口 */}
                  <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        aria-hidden="true"
                        className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                        style={{ backgroundColor: course.borderHex }}
                      />
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => setSelectedCourseId(course.id)}
                          className="block max-w-full truncate text-[13px] font-bold text-charcoal text-left transition-colors hover:text-black"
                          title="查看课程详情"
                        >
                          {course.name}
                        </button>
                        {course.code && (
                          <p className="text-[11px] font-mono text-sandrift truncate">{course.code}</p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUploadClick(course.id);
                      }}
                      disabled={uploading}
                      className="ux-press shrink-0 flex items-center gap-1 h-8 px-2.5 rounded-lg border border-line bg-white text-[11px] font-bold text-satin-grey transition-colors hover:bg-alabaster hover:text-charcoal disabled:opacity-60"
                    >
                      {uploading ? (
                        <>
                          <Plus className="w-3.5 h-3.5 animate-spin" />
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

                  {/* Metadata：有值才显示 */}
                  {meta && (
                    <p className="px-4 text-[11px] text-satin-grey truncate">{meta}</p>
                  )}

                  {/* 本周下一节 */}
                  <div className="px-4 mt-3">
                    <p className="text-[10px] font-bold text-sandrift">本周下一节</p>
                    {next ? (
                      <p className="text-xs font-semibold text-charcoal mt-0.5">
                        {WEEKDAY_LABELS[next.dayOfWeek - 1]} {next.startTime}–{next.endTime}
                        {next.location || course.classroom
                          ? ` · ${next.location || course.classroom}`
                          : ""}
                      </p>
                    ) : (
                      <p className="text-[11px] text-sandrift mt-0.5">{nextCellText}</p>
                    )}
                  </div>

                  {/* 任务状态：真实 assignments 派生（不做健康分/AI 风险分） */}
                  <div className="px-4 mt-2 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px]">
                    <span className="font-semibold text-satin-grey">{incompleteCount} 个未完成任务</span>
                    {nearestDdlDate && (
                      <span className="text-sandrift">
                        最近 DDL · {nearestDdlDate.getMonth() + 1}月{nearestDdlDate.getDate()}日
                      </span>
                    )}
                    {overdueCount > 0 && (
                      <span className="font-bold text-danger/90">{overdueCount} 项逾期</span>
                    )}
                  </div>

                  {/* 资料状态：主卡展示（最多 2 条 preview + 其余计数） */}
                  <div className="px-4 mt-3.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold text-sandrift">
                        课程资料 {materials.length}
                      </p>
                      {materials.length > 2 && (
                        <button
                          type="button"
                          onClick={() => setSelectedCourseId(course.id)}
                          className="text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal"
                        >
                          查看全部 {materials.length} 份 →
                        </button>
                      )}
                    </div>

                    {materials.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => handleUploadClick(course.id)}
                        disabled={uploading}
                        className="flex w-full items-center justify-between px-2 py-2 mt-1 rounded-lg text-[11px] font-semibold text-sandrift transition-colors hover:bg-alabaster hover:text-charcoal disabled:opacity-60"
                      >
                        <span>暂无课程资料</span>
                        <span className="flex items-center gap-1 font-bold">
                          <FileUp className="w-3.5 h-3.5" />
                          上传第一份资料 →
                        </span>
                      </button>
                    ) : (
                      <div className="mt-1 divide-y divide-line-soft border-t border-line-soft">
                        {materials.slice(0, 2).map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => previewMaterial(m)}
                            className={cn(
                              "group/mat flex w-full items-center gap-2 py-2 text-left",
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
                  </div>

                  {/* Footer：低权重 +任务 与 查看详情 */}
                  <div className="mt-auto px-4 pt-2.5 pb-2.5 mt-3.5 border-t border-line-soft flex items-center justify-between">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openAssignmentEditor({ courseId: course.id });
                      }}
                      className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-semibold text-satin-grey transition-colors hover:bg-alabaster hover:text-charcoal"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      任务
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedCourseId(course.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-sandrift transition-colors hover:bg-alabaster hover:text-charcoal"
                    >
                      查看课程详情
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Shared hidden file input（Workspace 直接上传） */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp"
        onChange={handleFiles}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
}
