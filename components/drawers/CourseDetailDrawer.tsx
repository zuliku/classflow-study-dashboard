"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  X,
  Plus,
  Trash2,
  FileUp,
  MoreHorizontal,
  PencilLine,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { Material, CourseSchedule, ScheduleConflict } from "@/types";
import { deleteFileBlob } from "@/lib/fileStorage";
import { uploadCourseMaterials } from "@/lib/materialUpload";
import { isValidTimeRange } from "@/lib/schedule";
import { findScheduleConflicts } from "@/lib/conflicts";
import { openAssignmentEditor, previewMaterial } from "@/lib/uiEvents";
import { formatCourseStats } from "@/lib/courseDetailView";

import { cn } from "@/lib/utils";
import { Drawer } from "@/components/ui/Drawer";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { DropdownMenuPanel, DropdownMenuItem, DropdownMenuDivider } from "@/components/ui/DropdownMenu";
import { useKiroHandoff } from "@/hooks/useKiroHandoff";
import { useEnterOnAdd } from "@/lib/useEnterOnAdd";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { CourseDetailOverview, CourseDraft } from "@/components/course/detail/CourseDetailOverview";
import { CourseScheduleSection, ScheduleForm } from "@/components/course/detail/CourseScheduleSection";
import { CourseTaskSection } from "@/components/course/detail/CourseTaskSection";
import { CourseMaterialSection } from "@/components/course/detail/CourseMaterialSection";

const OVERLAY_ID = "course-detail-drawer";
const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

/**
 * Course Detail V2 —— Productized Course Hub（orchestration）：
 * - edge Drawer（深度管理实体 ≠ Task floating detail）；加宽至 560/600px
 * - Header：Identity（code + name）+ [编辑] [···] [关闭]；删除进 More（confirm 语义不变）
 * - Overview（readonly ↔ inline edit）→ Primary Actions → Schedule → Tasks → Materials
 * - Schedule conflict / Material Blob / delete+undo 全部保留原 Domain 语义
 */
export function CourseDetailDrawer() {
  const {
    courses,
    schedules,
    assignments,
    selectedCourseId,
    setSelectedCourseId,
    setSelectedAssignmentId,
    updateCourse,
    deleteCourse,
    addScheduleSlot,
    updateSchedule,
    deleteSchedule,
    restoreSchedule,
    addCourseMaterial,
    deleteCourseMaterial,
    restoreCourseMaterial,
  } = useAppStore();
  const pushToast = useToastStore((s) => s.pushToast);
  const handoff = useKiroHandoff();
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const reducedMotion = useEffectiveReducedMotion();

  const [isEditing, setIsEditing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Add Schedule form 默认 CLOSED；Quick Action 通过 autoFocusKey 联动展开+聚焦
  const [addSlotOpen, setAddSlotOpen] = useState(false);
  const [addSlotAutoFocusKey, setAddSlotAutoFocusKey] = useState(0);

  const scheduleSectionRef = useRef<HTMLDivElement | null>(null);
  const materialInputRef = useRef<HTMLInputElement | null>(null);

  // Course Edit draft（Header [取消] [保存]；验证：name 非空 / credit 有限正数）
  const [draft, setDraft] = useState<CourseDraft>({
    name: "",
    teacher: "",
    classroom: "",
    credit: 3,
    description: "",
  });
  const [editError, setEditError] = useState<string | null>(null);

  const currentCourse = courses.find((c) => c.id === selectedCourseId);
  // 关闭（selected 清空）期间保留最后一次内容渲染，让 Drawer exit presence 生效
  const [staleCourse, setStaleCourse] = useState<(typeof courses)[number] | null>(null);
  useEffect(() => {
    if (currentCourse) setStaleCourse(currentCourse);
  }, [currentCourse?.id]);
  const course = currentCourse ?? staleCourse;

  // ---- Floating entity swap lifecycle（与 Assignment Floating Detail 同家族）----
  // closed→open：第一帧即当前实体；open A→open B：先 old fade-out（60ms）再替换；
  // close：保留 displayed 内容供 exit presence。reduced motion 即时切换。
  const currentId = currentCourse?.id ?? null;
  const [prevSelectedId, setPrevSelectedId] = useState(currentId);
  const [displayedId, setDisplayedId] = useState<string | null>(null);
  const [swapPhase, setSwapPhase] = useState<"in" | "out">("in");

  if (currentId !== prevSelectedId) {
    setPrevSelectedId(currentId);
    const wasOpen = prevSelectedId !== null;
    if (currentId === null) {
      // closing：不改变 displayed 内容
    } else if (!wasOpen) {
      setDisplayedId(currentId);
      setSwapPhase("in");
    } else if (displayedId !== currentId) {
      setSwapPhase("out");
    }
  }

  useEffect(() => {
    if (currentId === null || swapPhase !== "out") return;
    if (displayedId === currentId) {
      setSwapPhase("in");
      return;
    }
    if (reducedMotion) {
      setDisplayedId(currentId);
      setSwapPhase("in");
      return;
    }
    const t = window.setTimeout(() => {
      setDisplayedId(currentId);
      setSwapPhase("in");
    }, 60);
    return () => window.clearTimeout(t);
  }, [currentId, swapPhase, displayedId, reducedMotion]);

  // 实体切换/关闭：transient UI 一律复位（editing / more / addSlot / error）
  useEffect(() => {
    setIsEditing(false);
    setEditError(null);
    setMoreOpen(false);
    setAddSlotOpen(false);
    setAddSlotAutoFocusKey(0);
  }, [currentId]);

  const displayedCourse =
    courses.find((c) => c.id === displayedId) ?? currentCourse ?? staleCourse;

  const courseSchedules = schedules.filter((s) => s.courseId === displayedCourse?.id);
  const courseAssignments = assignments.filter((a) => a.courseId === displayedCourse?.id);
  const newScheduleIds = useEnterOnAdd(courseSchedules.map((s) => s.id), displayedCourse?.id);
  const newMaterialIds = useEnterOnAdd(
    displayedCourse?.materials.map((m) => m.id) ?? [],
    displayedCourse?.id
  );

  if (!course) return null;

  // ---- Course Edit ----
  const handleStartEdit = () => {
    setDraft({
      name: course.name,
      teacher: course.teacher,
      classroom: course.classroom,
      credit: course.credit,
      description: course.description,
    });
    setEditError(null);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditError(null);
  };

  const handleSaveCourse = () => {
    if (!draft.name.trim()) {
      setEditError("课程名称不能为空");
      return;
    }
    if (!Number.isFinite(draft.credit) || draft.credit <= 0) {
      setEditError("学分必须为大于 0 的数字");
      return;
    }
    updateCourse({
      ...course,
      name: draft.name.trim(),
      teacher: draft.teacher,
      classroom: draft.classroom,
      credit: draft.credit,
      description: draft.description,
    });
    setIsEditing(false);
    setEditError(null);
    pushToast({ message: "课程已更新" });
  };

  // 快捷操作：添加任务（自动预选当前课程）
  const handleQuickAddAssignment = () => {
    openAssignmentEditor({ courseId: course.id });
  };

  // 快捷操作：展开 Add Schedule form + 滚动 + focus（由 section 的 autoFocusKey 联动）
  const handleQuickAddSlot = () => {
    setAddSlotAutoFocusKey((k) => k + 1);
    scheduleSectionRef.current?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });
  };

  // 快捷操作：触发资料上传文件选择
  const handleQuickUploadMaterial = () => {
    materialInputRef.current?.click();
  };

  // Ask Kiro：固定课程 Entry Context → 关闭 Drawer → 打开 Sidecar
  const handleAskKiro = () => {
    setMoreOpen(false);
    handoff.openForCourse(course.id);
    setSelectedCourseId(null);
  };

  // 相关任务：Course 关闭 + Assignment Floating Detail（state 立即切换，presence 负责视觉）
  const handleOpenAssignment = (assignmentId: string) => {
    setSelectedCourseId(null);
    setSelectedAssignmentId(assignmentId);
  };

  const handleDeleteCourse = () => {
    setMoreOpen(false);
    confirmRequest({
      title: "删除课程？",
      description: `课程《${course.name}》的排课、相关任务和本地资料也会一并删除，此操作无法撤销。`,
      confirmLabel: "删除课程",
      danger: true,
      onConfirm: () => {
        deleteCourse(course.id);
        setSelectedCourseId(null);
        pushToast({ message: "课程已删除" });
      },
    });
  };

  // ---- Schedule 表单验证与冲突检测（新增/编辑共用，全站一致；Domain 不改） ----
  const validateSlot = (form: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    weeks: string;
  }): string | null => {
    if (!Number.isInteger(form.dayOfWeek) || form.dayOfWeek < 1 || form.dayOfWeek > 7) {
      return "星期必须为 1-7";
    }
    if (!isValidTimeRange(form.startTime, form.endTime)) {
      return "时间格式非法或结束时间需晚于开始时间";
    }
    if (!form.weeks.trim()) {
      return "周次不能为空";
    }
    return null;
  };

  const findCandidateConflicts = (
    candidate: CourseSchedule,
    excludeId?: string
  ): ScheduleConflict[] => {
    const others = schedules.filter((s) => s.id !== excludeId);
    return findScheduleConflicts([...others, candidate]).filter(
      (c) => c.scheduleA.id === candidate.id || c.scheduleB.id === candidate.id
    );
  };

  const formatConflictMessage = (conflicts: ScheduleConflict[], candidateId: string): string => {
    const c = conflicts[0];
    const other = c.scheduleA.id === candidateId ? c.scheduleB : c.scheduleA;
    const otherCourse = courses.find((x) => x.id === other.courseId);
    return `与《${otherCourse?.name || "未知课程"}》周${DAY_LABELS[other.dayOfWeek - 1]} ${other.startTime}–${other.endTime} 存在时间冲突`;
  };

  const slotConflictSuffix = (editing: boolean) =>
    editing ? "，已阻止保存。可取消编辑后调整时间或周次。" : "，已阻止添加。";

  /** 新增时段：返回错误文案（null = 成功） */
  const handleAddSlot = (form: ScheduleForm): string | null => {
    const error = validateSlot(form);
    if (error) return error;
    const candidate: CourseSchedule = {
      id: "__candidate__",
      courseId: course.id,
      dayOfWeek: form.dayOfWeek,
      startTime: form.startTime,
      endTime: form.endTime,
      location: form.location || course.classroom,
      weeks: form.weeks,
    };
    const conflicts = findCandidateConflicts(candidate);
    if (conflicts.length > 0) {
      return formatConflictMessage(conflicts, candidate.id) + slotConflictSuffix(false);
    }
    addScheduleSlot({
      courseId: course.id,
      dayOfWeek: form.dayOfWeek,
      startTime: form.startTime,
      endTime: form.endTime,
      location: form.location || course.classroom,
      weeks: form.weeks,
    });
    return null;
  };

  /** 编辑时段：返回错误文案（null = 成功） */
  const handleUpdateSlot = (id: string, form: ScheduleForm): string | null => {
    const sched = courseSchedules.find((s) => s.id === id);
    if (!sched) return null;
    const error = validateSlot(form);
    if (error) return error;
    const candidate: CourseSchedule = {
      ...sched,
      dayOfWeek: form.dayOfWeek,
      startTime: form.startTime,
      endTime: form.endTime,
      location: form.location.trim() || sched.location,
      weeks: form.weeks,
    };
    const conflicts = findCandidateConflicts(candidate, sched.id);
    if (conflicts.length > 0) {
      return formatConflictMessage(conflicts, candidate.id) + slotConflictSuffix(true);
    }
    updateSchedule(candidate);
    return null;
  };

  // 删除时段：立即删除 + Toast 撤销（保留原 Schedule ID）
  const handleDeleteSlot = (sched: CourseSchedule) => {
    const removed = deleteSchedule(sched.id);
    if (removed) {
      pushToast({
        message: "上课时段已删除",
        actionLabel: "撤销",
        onAction: () => restoreSchedule(removed),
      });
    }
  };

  // Real File Upload Handler: File → IndexedDB 保存 Blob → 生成 storageKey → Zustand 只存 metadata
  const handleRealFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      const { succeeded, failed } = await uploadCourseMaterials({
        courseId: course.id,
        files: Array.from(files),
        addMaterial: addCourseMaterial,
      });
      if (succeeded.length > 0) {
        pushToast({ message: succeeded.length === 1 ? "资料已上传" : `${succeeded.length} 份资料已上传` });
      }
      for (const name of failed) {
        pushToast({ type: "error", message: `《${name}》保存失败，请重试` });
      }
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  // 删除资料：先移除 metadata，Blob 在撤销窗口结束后再删
  const handleDeleteMaterial = (mat: Material) => {
    const removed = deleteCourseMaterial(course.id, mat.id);
    if (!removed) return;
    let undone = false;
    pushToast({
      type: "info",
      message: "资料已删除",
      actionLabel: "撤销",
      onAction: () => {
        undone = true;
        restoreCourseMaterial(course.id, removed);
      },
      onDismiss: () => {
        if (!undone && removed.storageKey) {
          deleteFileBlob(removed.storageKey).catch(() => {});
        }
      },
      duration: 6000,
    });
  };

  const handlePreviewMaterial = (mat: Material) => {
    previewMaterial(mat);
  };

  const stats = formatCourseStats(courseSchedules.length, courseAssignments.length, course.materials.length);

  // Header 与 Body 共享 entity swap lifecycle：静态 shell 控件（More/Close）留在 swap 层外
  const swapContentClasses = cn(
    swapPhase === "out"
      ? "-translate-y-[3px] opacity-0 transition-[opacity,transform] duration-[60ms] ease-[var(--ease-standard)]"
      : "ux-detail-swap-in"
  );

  return (
    <Drawer
      presentation="floating"
      open={!!currentCourse}
      onOpenChange={(next) => {
        if (!next) setSelectedCourseId(null);
      }}
      overlayId={OVERLAY_ID}
      aria-label="课程详情"
      focusRestoreKey={currentId}
    >
      {/* HEADER：与 Assignment Floating Detail 同 shell —— breadcrumb + 标题 + More / 关闭 */}
      <header className="shrink-0 border-b border-line bg-[#F7F5F5] px-5 pt-4 pb-3.5">
        <div className="flex items-start justify-between gap-2">
          <div
            key={displayedId ?? "none"}
            className={cn("min-w-0 flex-1", swapContentClasses)}
          >
            <p className="flex items-center gap-1.5 text-xs font-semibold text-sandrift">
              <span
                aria-hidden="true"
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: displayedCourse?.borderHex }}
              />
              {displayedCourse?.code ? `课程资料 · ${displayedCourse.code}` : "课程资料"}
            </p>
            <h2 className="mt-1 break-words text-[19px] font-bold leading-snug text-charcoal">
              {displayedCourse?.name ?? course.name}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <IconButton
                variant="secondary"
                size="sm"
                onClick={() => setMoreOpen((v) => !v)}
                aria-label="更多操作"
                title="更多操作"
              >
                <MoreHorizontal className="h-4 w-4" />
              </IconButton>
              <DropdownMenuPanel open={moreOpen} placement="bottom-end" aria-label="更多操作" className="w-44">
                <DropdownMenuItem label="Ask Kiro" onClick={handleAskKiro} />
                <DropdownMenuDivider />
                <DropdownMenuItem icon={Trash2} label="删除课程" danger onClick={handleDeleteCourse} />
              </DropdownMenuPanel>
            </Popover>
            <IconButton
              variant="secondary"
              size="sm"
              onClick={() => setSelectedCourseId(null)}
              aria-label="关闭"
              title="关闭"
            >
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </header>

      {/* BODY：与 Assignment 一致 p-5 space-y-5；按 displayed 实体渲染（swap 层内） */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div key={displayedId ?? "none"} className={cn("space-y-5", swapContentClasses)}>
          {/* OVERVIEW */}
          <CourseDetailOverview
            course={displayedCourse ?? course}
            stats={stats}
            editing={isEditing}
            draft={draft}
            onDraftChange={setDraft}
            error={editError}
          />

          {/* PRIMARY ACTIONS：上传资料 primary；编辑态切换为 [保存][取消] */}
          {isEditing ? (
            <div className="flex items-center gap-1.5">
              <Button variant="secondary" size="sm" onClick={handleCancelEdit}>
                取消
              </Button>
              <Button variant="primary" size="sm" onClick={handleSaveCourse}>
                保存
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="primary" size="sm" onClick={handleQuickUploadMaterial} className="h-8 px-3">
                <FileUp className="h-3.5 w-3.5" />
                上传资料
              </Button>
              <Button variant="secondary" size="sm" onClick={handleQuickAddAssignment} className="h-8 px-2.5">
                <Plus className="h-3.5 w-3.5" />
                添加任务
              </Button>
              <Button variant="secondary" size="sm" onClick={handleQuickAddSlot} className="h-8 px-2.5">
                <Plus className="h-3.5 w-3.5" />
                添加时段
              </Button>
              <Button variant="secondary" size="sm" onClick={handleStartEdit} className="h-8 px-2.5">
                <PencilLine className="h-3.5 w-3.5" />
                编辑
              </Button>
            </div>
          )}

          {/* SCHEDULE */}
          <CourseScheduleSection
            schedules={courseSchedules}
            courseClassroom={course.classroom}
            addSlotOpen={addSlotOpen}
            onAddSlotOpenChange={setAddSlotOpen}
            autoFocusKey={addSlotAutoFocusKey}
            onAddSlot={handleAddSlot}
            onUpdateSlot={handleUpdateSlot}
            onDeleteSlot={handleDeleteSlot}
            newIds={newScheduleIds}
            sectionRef={scheduleSectionRef}
          />

          <div className="h-px bg-line-soft" aria-hidden="true" />

          {/* TASKS */}
          <CourseTaskSection
            assignments={courseAssignments}
            now={new Date()}
            onOpenAssignment={handleOpenAssignment}
            onAddTask={handleQuickAddAssignment}
          />

          <div className="h-px bg-line-soft" aria-hidden="true" />

          {/* MATERIALS */}
          <CourseMaterialSection
            materials={course.materials}
            uploading={isUploading}
            onUploadClick={handleQuickUploadMaterial}
            onPreview={handlePreviewMaterial}
            onDelete={handleDeleteMaterial}
            newIds={newMaterialIds}
          />
        </div>
      </div>

      {/* Real File Input（上传资料 quick action 触发；id 供既有 E2E 定位） */}
      <input
        ref={materialInputRef}
        id="real-material-upload"
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp"
        onChange={handleRealFileUpload}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
    </Drawer>
  );
}
