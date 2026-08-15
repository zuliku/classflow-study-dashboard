"use client";

import React, { useRef, useState } from "react";
import { FileUp, Plus } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { Button } from "@/components/ui/Button";
import {
  CourseLibraryCard,
  CourseCardPopover,
} from "@/components/course/CourseLibraryCard";
import { uploadCourseMaterials } from "@/lib/materialUpload";
import { previewMaterial, openAssignmentEditor } from "@/lib/uiEvents";
import { deriveNextCourseSession } from "@/lib/courses/nextSession";
import { getSemesterWeek } from "@/lib/semester";
import { parseLocalDDL } from "@/lib/ddl";
import { useEnterOnAdd } from "@/lib/useEnterOnAdd";
import {
  sortCourseAssignments,
  buildCourseTaskRow,
} from "@/lib/courseDetailView";

/** 课程教师/教室：存在才显示，空字段不产生孤立 separator */
function courseMetaText(course: { teacher: string; classroom: string }): string {
  return [course.teacher, course.classroom].filter(Boolean).join(" · ");
}

/**
 * Course Library Workspace（Task 4 V4）：
 * - store orchestration / direct upload / activePopover 统一状态留在这里；
 * - 单 Card 呈现交给 CourseLibraryCard；tasks/materials 溢出面板交给 CourseCardOverflowPopover
 * - 上传只有一套 pipeline（uploadCourseMaterials），Header 与 Popover 共用同一 handler
 * - Task 排序/状态/截止展示复用 lib/courseDetailView（不建第三套语义）
 */
export function CoursesWorkspace() {
  const {
    courses,
    schedules,
    assignments,
    semester,
    setSelectedCourseId,
    setSelectedAssignmentId,
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

  // ---- 统一二级面板状态：同一时间最多一个 Course Card Popover ----
  const [activePopover, setActivePopover] = useState<CourseCardPopover>(null);
  const closePopover = () => setActivePopover(null);
  const togglePopover = (courseId: string, kind: "tasks" | "materials") =>
    setActivePopover((cur) =>
      cur?.courseId === courseId && cur.kind === kind ? null : { courseId, kind }
    );

  // ---- Workspace 直接上传（真实逻辑复用 uploadCourseMaterials，不复制 Blob 逻辑）----
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTargetCourseId, setUploadTargetCourseId] = useState<string | null>(null);
  const [uploadingCourseId, setUploadingCourseId] = useState<string | null>(null);

  const handleUploadClick = (courseId: string) => {
    setActivePopover(null);
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

  // 任务行派生：复用 courseDetailView 排序（未完成优先）与状态/截止展示
  const now = new Date();
  const taskRowsByCourse = new Map<string, ReturnType<typeof buildCourseTaskRow>[]>();
  for (const course of courses) {
    const courseAssignments = assignments.filter((a) => a.courseId === course.id);
    taskRowsByCourse.set(
      course.id,
      sortCourseAssignments(courseAssignments).map((a) => buildCourseTaskRow(a, now))
    );
  }
  const overdueCountByCourse = new Map<string, number>();
  for (const course of courses) {
    overdueCountByCourse.set(
      course.id,
      assignments.filter((a) => {
        if (a.courseId !== course.id || a.status === "completed") return false;
        const ddl = parseLocalDDL(a.ddl);
        return ddl ? ddl.getTime() < now.getTime() : false;
      }).length
    );
  }

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
                  ? ""
                  : "本周无后续课程";

              return (
                <CourseLibraryCard
                  key={course.id}
                  course={course}
                  next={next}
                  nextCellText={nextCellText}
                  meta={courseMetaText(course)}
                  overdueCount={overdueCountByCourse.get(course.id) ?? 0}
                  taskRows={taskRowsByCourse.get(course.id) ?? []}
                  materials={course.materials}
                  newMaterialIds={newMaterialIds}
                  uploading={uploadingCourseId === course.id}
                  activePopover={activePopover}
                  onTogglePopover={(kind) => togglePopover(course.id, kind)}
                  onClosePopover={closePopover}
                  onOpenCourse={() => {
                    closePopover();
                    setSelectedCourseId(course.id);
                  }}
                  onOpenAssignment={(assignmentId) => {
                    closePopover();
                    setSelectedAssignmentId(assignmentId);
                  }}
                  onUploadClick={() => handleUploadClick(course.id)}
                  onAddTask={() => {
                    closePopover();
                    openAssignmentEditor({ courseId: course.id });
                  }}
                  onPreviewMaterial={previewMaterial}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Shared hidden file input（Workspace 直接上传，Header 与 Popover 共用） */}
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
