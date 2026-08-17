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
import { isCourseEntityInteractive, resolveMaterialUploadTarget } from "@/lib/courseDetailOwnership";

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
import { EntityActivitySection } from "@/components/history/EntityActivitySection";

const OVERLAY_ID = "course-detail-drawer";
const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

/**
 * Course Detail —— Floating Course Hub（orchestration）：
 * - presentation="floating"（non-blocking contextual panel；背景可交互、不声明 aria-modal）
 * - 水平靠右 + 垂直居中（overlay items-center）；宽度约 500px
 * - 高度 content-fit：!h-auto + base max-h（desktop 32px / mobile 24px inset），超限 Body 内部滚动
 * - Header：Identity（breadcrumb + 标题）+ [···] [关闭]；编辑在 Body Actions，删除进 More（confirm 语义不变）
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
    scheduleOccurrenceOverrides,
    deleteScheduleOccurrenceOverride,
    restoreScheduleOccurrenceOverride,
  } = useAppStore();
  const pushToast = useToastStore((s) => s.pushToast);
  const handoff = useKiroHandoff();
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const reducedMotion = useEffectiveReducedMotion();

  const [isEditing, setIsEditing] = useState(false);
  // 上传状态按「目标课程」归属（entity-local truth）：A 上传进行中切到 B，B 不显示上传中
  const [uploadingCourseId, setUploadingCourseId] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  // Add Schedule form 默认 CLOSED；Quick Action 通过 autoFocusKey 联动展开+聚焦
  const [addSlotOpen, setAddSlotOpen] = useState(false);
  const [addSlotAutoFocusKey, setAddSlotAutoFocusKey] = useState(0);

  const scheduleSectionRef = useRef<HTMLDivElement | null>(null);
  const materialInputRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Async upload target：点击「上传资料」时 capture 的 courseId，整个 Promise 生命周期固定
  const materialUploadTargetCourseIdRef = useRef<string | null>(null);

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

  // Entity Ownership（V1 closure）：
  // - Selection Entity = currentCourse/currentId：只负责 open/close、swap 驱动、focus restore
  // - Displayed Entity = displayedCourse/displayedId：Header / Overview / stats / schedule /
  //   tasks / materials / activity / 全部 mutation target 的唯一来源
  // - swap-out 与 close presence 期间：旧实体内容仅视觉退场 → non-interactive（inert + pointer-events-none）
  const entityInteractive = isCourseEntityInteractive(currentId, displayedId, swapPhase);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (entityInteractive) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  }, [entityInteractive]);

  const displayedCourse =
    courses.find((c) => c.id === displayedId) ?? currentCourse ?? staleCourse;

  const courseSchedules = schedules.filter((s) => s.courseId === displayedCourse?.id);
  const courseAssignments = assignments.filter((a) => a.courseId === displayedCourse?.id);
  const newScheduleIds = useEnterOnAdd(courseSchedules.map((s) => s.id), displayedCourse?.id);
  const newMaterialIds = useEnterOnAdd(
    displayedCourse?.materials.map((m) => m.id) ?? [],
    displayedCourse?.id
  );

  if (!displayedCourse) return null;

  // ---- Course Edit（只允许 interactive 的 displayed entity；draft 来自 displayed snapshot）----
  const handleStartEdit = () => {
    if (!entityInteractive) return;
    setDraft({
      name: displayedCourse.name,
      teacher: displayedCourse.teacher,
      classroom: displayedCourse.classroom,
      credit: displayedCourse.credit,
      description: displayedCourse.description,
    });
    setEditError(null);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditError(null);
  };

  const handleSaveCourse = () => {
    if (!entityInteractive) return;
    if (!draft.name.trim()) {
      setEditError("课程名称不能为空");
      return;
    }
    if (!Number.isFinite(draft.credit) || draft.credit <= 0) {
      setEditError("学分必须为大于 0 的数字");
      return;
    }
    updateCourse({
      ...displayedCourse,
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

  // 快捷操作：添加任务（自动预选当前 displayed 课程）
  const handleQuickAddAssignment = () => {
    if (!entityInteractive) return;
    openAssignmentEditor({ courseId: displayedCourse.id });
  };

  // 快捷操作：展开 Add Schedule form + 滚动 + focus（由 section 的 autoFocusKey 联动）
  const handleQuickAddSlot = () => {
    if (!entityInteractive) return;
    setAddSlotAutoFocusKey((k) => k + 1);
    scheduleSectionRef.current?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });
  };

  // 快捷操作：触发资料上传文件选择。capture 点击时的 displayed 课程作为 async 上传 target
  const handleQuickUploadMaterial = () => {
    if (!entityInteractive) return;
    materialUploadTargetCourseIdRef.current = displayedCourse.id;
    materialInputRef.current?.click();
  };

  // Ask Kiro：固定 displayed 课程 Entry Context → 关闭 Drawer → 打开 Sidecar
  const handleAskKiro = () => {
    if (!entityInteractive) return;
    setMoreOpen(false);
    handoff.openForCourse(displayedCourse.id);
    setSelectedCourseId(null);
  };

  // 相关任务：Course 关闭 + Assignment Floating Detail（state 立即切换，presence 负责视觉）
  const handleOpenAssignment = (assignmentId: string) => {
    setSelectedCourseId(null);
    setSelectedAssignmentId(assignmentId);
  };

  // Delete Course：capture 用户点下 Delete 时的 displayed 实体；
  // confirm 生命周期内 selection 变化也不改变删除目标
  const handleDeleteCourse = () => {
    if (!entityInteractive) return;
    setMoreOpen(false);
    const target = displayedCourse;
    confirmRequest({
      title: "删除课程？",
      description: `课程《${target.name}》的排课、相关任务和本地资料也会一并删除，此操作无法撤销。`,
      confirmLabel: "删除课程",
      danger: true,
      onConfirm: () => {
        deleteCourse(target.id);
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

  /** 新增时段：返回错误文案（null = 成功）；target 恒为 displayed 实体 */
  const handleAddSlot = (form: ScheduleForm): string | null => {
    if (!entityInteractive) return null;
    const error = validateSlot(form);
    if (error) return error;
    const candidate: CourseSchedule = {
      id: "__candidate__",
      courseId: displayedCourse.id,
      dayOfWeek: form.dayOfWeek,
      startTime: form.startTime,
      endTime: form.endTime,
      location: form.location || displayedCourse.classroom,
      weeks: form.weeks,
    };
    const conflicts = findCandidateConflicts(candidate);
    if (conflicts.length > 0) {
      return formatConflictMessage(conflicts, candidate.id) + slotConflictSuffix(false);
    }
    addScheduleSlot({
      courseId: displayedCourse.id,
      dayOfWeek: form.dayOfWeek,
      startTime: form.startTime,
      endTime: form.endTime,
      location: form.location || displayedCourse.classroom,
      weeks: form.weeks,
    });
    return null;
  };

  /** 编辑时段：返回错误文案（null = 成功）；只能更新 displayed 实体的 slot */
  const handleUpdateSlot = (id: string, form: ScheduleForm): string | null => {
    if (!entityInteractive) return null;
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
  // target = 点击「上传资料」时 capture 的课程（async 生命周期固定；resolve 时 displayed 已变也不改目标）
  const handleRealFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const targetCourseId = resolveMaterialUploadTarget(
      materialUploadTargetCourseIdRef.current,
      displayedCourse.id
    );
    if (!targetCourseId) return;

    setUploadingCourseId(targetCourseId);
    try {
      const { succeeded, failed } = await uploadCourseMaterials({
        courseId: targetCourseId,
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
      // 只清 input / uploading 状态；不改变 target semantic、不中断 Promise
      setUploadingCourseId(null);
      e.target.value = "";
    }
  };

  // 删除资料：先移除 metadata，Blob 在撤销窗口结束后再删；courseId 恒为 displayed 实体
  const handleDeleteMaterial = (mat: Material) => {
    if (!entityInteractive) return;
    const targetCourseId = displayedCourse.id;
    const removed = deleteCourseMaterial(targetCourseId, mat.id);
    if (!removed) return;
    let undone = false;
    pushToast({
      type: "info",
      message: "资料已删除",
      actionLabel: "撤销",
      onAction: () => {
        undone = true;
        restoreCourseMaterial(targetCourseId, removed);
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

  const stats = formatCourseStats(
    courseSchedules.length,
    courseAssignments.length,
    displayedCourse.materials.length
  );

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
      // Floating Course Hub：水平靠右 + 垂直居中（only Course Hub 使用 items-center）
      overlayClassName="items-center"
      // 内容驱动高度：!h-auto 覆盖 floating base 的 h-full；max-h 由 base 提供（desktop 32px / mobile 24px inset）
      className="!h-auto sm:w-[500px]"
    >
      {/* HEADER：与 Assignment Floating Detail 同 shell —— breadcrumb + 标题 + More / 关闭 */}
      <header className="shrink-0 border-b border-line bg-[#F7F5F5] px-5 pt-4 pb-3.5">
        <div className="flex items-start justify-between gap-2">
          <div
            key={displayedId ?? "none"}
            data-displayed-course-id={displayedCourse.id}
            className={cn("min-w-0 flex-1", swapContentClasses)}
          >
            <p className="flex items-center gap-1.5 text-xs font-semibold text-sandrift">
              <span
                aria-hidden="true"
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: displayedCourse.borderHex }}
              />
              {displayedCourse.code ? `课程资料 · ${displayedCourse.code}` : "课程资料"}
            </p>
            <h2 className="mt-1 break-words text-[19px] font-bold leading-snug text-charcoal">
              {displayedCourse.name}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <IconButton
                variant="secondary"
                size="sm"
                disabled={!entityInteractive}
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

      {/* BODY：content-fit 下的正确 flex contract —— 自然高度 <= max 时按内容展开；
          超过 max（parent max-h 封顶）时 flex-shrink + overflow-y-auto 内部滚动。
          非 interactive（swap-out / close presence）：inert + pointer-events-none，
          旧实体内容仅供视觉退场，mouse 与 Tab/Enter 均不可操作 */}
      <div
        ref={bodyRef}
        data-testid="course-detail-body"
        data-displayed-course-id={displayedCourse.id}
        className={cn(
          "min-h-0 flex-[0_1_auto] overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]",
          !entityInteractive && "pointer-events-none"
        )}
      >
        <div key={displayedId ?? "none"} className={cn("space-y-5", swapContentClasses)}>
          {/* OVERVIEW */}
          <CourseDetailOverview
            course={displayedCourse}
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
              <Button
                variant="secondary"
                size="sm"
                onClick={handleStartEdit}
                aria-label="编辑课程信息"
                className="h-8 px-2.5"
              >
                <PencilLine className="h-3.5 w-3.5" />
                编辑
              </Button>
            </div>
          )}

          {/* SCHEDULE */}
          <CourseScheduleSection
            schedules={courseSchedules}
            courseClassroom={displayedCourse.classroom}
            courseName={displayedCourse.name}
            overrides={scheduleOccurrenceOverrides.filter((o) => o.courseId === displayedCourse.id)}
            onDeleteOverride={(overrideId) => {
              const removed = deleteScheduleOccurrenceOverride(overrideId);
              if (removed) {
                pushToast({
                  message: "已移除临时调整",
                  actionLabel: "撤销",
                  onAction: () => restoreScheduleOccurrenceOverride(removed),
                });
              }
            }}
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
            materials={displayedCourse.materials}
            uploading={uploadingCourseId === displayedCourse.id}
            onUploadClick={handleQuickUploadMaterial}
            onPreview={handlePreviewMaterial}
            onDelete={handleDeleteMaterial}
            newIds={newMaterialIds}
          />

          <div className="h-px bg-line-soft" aria-hidden="true" />

          {/* 活动记录：secondary context，默认 collapsed，lazy 加载真实 Learning History */}
          <EntityActivitySection scope="course" courseId={displayedCourse.id} />
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
