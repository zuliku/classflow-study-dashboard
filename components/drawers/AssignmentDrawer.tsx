"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  X,
  BookOpen,
  ChevronRight,
  Tags,
  Paperclip,
  Plus,
  Check,
  Upload,
  FileText,
  Presentation,
  Link2,
  FileImage,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { Priority, AssignmentStatus, Material, Assignment } from "@/types";
import { formatEstimatedMinutes } from "@/lib/tasks/taskSemantics";
import { resolveAssignmentMaterials } from "@/lib/tasks/taskMaterials";
import { uploadCourseMaterials } from "@/lib/materialUpload";
import { RECURRENCE_LABELS } from "@/lib/tasks/taskRecurrence";
import { AssignmentReminderSection } from "@/components/reminders/AssignmentReminderSection";
import { deriveAssignmentHealthWithAvailability, healthViewMeta, healthExplanation } from "@/lib/tasks/taskHealthView";
import {
  formatDeadlineView,
  formatReminderSummaryText,
  summarizeReminders,
  summarizeStudySchedule,
} from "@/lib/tasks/assignmentDetailView";

import { cn } from "@/lib/utils";
import { openAssignmentEditor } from "@/lib/uiEvents";
import { Drawer } from "@/components/ui/Drawer";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { DropdownMenuPanel, DropdownMenuItem, DropdownMenuDivider } from "@/components/ui/DropdownMenu";
import { useKiroHandoff } from "@/hooks/useKiroHandoff";
import { KIRO_ICON } from "@/components/layout/navItems";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { DetailDisclosure } from "@/components/assignment/detail/DetailDisclosure";
import { AssignmentDetailHero } from "@/components/assignment/detail/AssignmentDetailHero";
import { AssignmentDetailActions } from "@/components/assignment/detail/AssignmentDetailActions";
import { AssignmentDetailExecution } from "@/components/assignment/detail/AssignmentDetailExecution";

const OVERLAY_ID = "assignment-drawer";

/** Kiro Contextual Quick Prompts（deterministic，非 AI 生成；顺序 = 理解 → 估时 → 风险 → 排程） */
const QUICK_PROMPTS: { label: string; prompt: string }[] = [
  { label: "帮我拆解", prompt: "帮我拆解这个任务，拆成 2–8 个可执行的步骤，并估算每步和总耗时。" },
  { label: "估计耗时", prompt: "根据当前任务信息给出预计完成耗时。如果信息不足，请说明估计依据。" },
  { label: "检查风险", prompt: "检查这个任务能否按时完成，并说明原因。" },
  { label: "安排时间", prompt: "帮我安排这个任务的学习时间。" },
];

/** Task 6A：资料类型图标与标签（仅展示，不改 Material Domain） */
const MATERIAL_TYPE_LABELS: Record<Material["type"], string> = {
  pdf: "PDF",
  ppt: "PPT",
  doc: "DOC",
  link: "链接",
  image: "图片",
};

function MaterialTypeIcon({ type, className }: { type: Material["type"]; className?: string }) {
  switch (type) {
    case "pdf":
    case "doc":
      return <FileText className={`w-3.5 h-3.5 shrink-0 text-[#A48F82] ${className ?? ""}`} />;
    case "ppt":
      return <Presentation className={`w-3.5 h-3.5 shrink-0 text-[#A48F82] ${className ?? ""}`} />;
    case "link":
      return <Link2 className={`w-3.5 h-3.5 shrink-0 text-[#A48F82] ${className ?? ""}`} />;
    case "image":
      return <FileImage className={`w-3.5 h-3.5 shrink-0 text-[#A48F82] ${className ?? ""}`} />;
  }
}

/**
 * Assignment Detail Panel（Task/DDL Detail Panel UX Refresh）：
 * - presentation="floating"：有界浮层（非 full-height edge）
 * - 信息架构：Header → Hero（Deadline/Status/Priority/Health/Schedule/Reminder 摘要）→
 *   Primary Actions → Execution → Reminder/说明/资料/Kiro Disclosure
 * - 已打开时切换任务：outer shell 保持 mounted，仅内容两阶段替换（60ms out + 100ms in）
 */
export function AssignmentDrawer() {
  const {
    assignments,
    courses,
    schedules,
    calendarMarks,
    semester,
    currentSemesterWeek,
    studyBlocks,
    reminders,
    selectedAssignmentId,
    setSelectedAssignmentId,
    setSelectedCourseId,
    setActiveTab,
    updateAssignmentStatus,
    updateAssignmentProgress,
    updateAssignmentPriority,
    toggleSubtask,
    setAssignmentMaterialIds,
    deleteAssignment,
    restoreAssignment,
  } = useAppStore();
  const pushToast = useToastStore((s) => s.pushToast);
  const handoff = useKiroHandoff();
  const reducedMotion = useEffectiveReducedMotion();
  // Task 6A：关联资料 Mini Picker 展开状态
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false);
  // Task 6B-B：添加资料下拉（选择课程资料 / 上传文件）与上传中状态
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Header More（低频/破坏性操作）
  const [moreOpen, setMoreOpen] = useState(false);
  // 「提醒」主操作 → 展开 Reminder disclosure
  const [reminderOpen, setReminderOpen] = useState(false);

  const currentAssignment = assignments.find((a) => a.id === selectedAssignmentId);
  // 关闭（selected 清空）期间保留最后一次内容渲染，让 Drawer exit presence 生效
  const [staleAssignment, setStaleAssignment] = useState<Assignment | null>(null);
  useEffect(() => {
    if (currentAssignment) setStaleAssignment(currentAssignment);
  }, [currentAssignment?.id]);

  // 已打开时切换任务：outer shell 保持 mounted，内容两阶段替换（old fade-out 60ms → new fade-in）。
  // 首次打开不做 content swap（面板 enter presence 已承担进入动画；swap 只用于任务间切换）。
  const openedOnceRef = useRef(false);
  const currentId = currentAssignment?.id ?? null;
  const [swap, setSwap] = useState<{ id: string | null; visible: boolean }>({
    id: currentId,
    visible: true,
  });
  useEffect(() => {
    if (!currentId) return;
    const firstOpen = !openedOnceRef.current;
    openedOnceRef.current = true;
    if (swap.id === currentId) return;
    if (reducedMotion || firstOpen) {
      setSwap({ id: currentId, visible: true });
      return;
    }
    setSwap((s) => ({ ...s, visible: false }));
    const t = window.setTimeout(() => setSwap({ id: currentId, visible: true }), 60);
    return () => window.clearTimeout(t);
  }, [currentId, reducedMotion, swap.id]);

  const assignment =
    assignments.find((a) => a.id === (swap.id ?? staleAssignment?.id ?? null)) ??
    currentAssignment ??
    staleAssignment;

  if (!assignment) return null;

  const handleDelete = () => {
    const removed = deleteAssignment(assignment.id);
    setMoreOpen(false);
    if (removed) {
      pushToast({
        message: "任务已删除",
        actionLabel: "撤销",
        onAction: () => restoreAssignment(removed),
      });
    }
  };

  // 返回链路：任务 → 课程 Drawer
  const handleOpenCourse = () => {
    if (!course) return;
    setSelectedAssignmentId(null);
    setSelectedCourseId(course.id);
  };

  const handleEdit = () => {
    openAssignmentEditor({ assignmentId: assignment.id });
  };

  // Ask Kiro：固定 Entry Context → 关闭 Drawer → 打开 Sidecar（保持当前 Workspace）
  const handleAskKiro = () => {
    setMoreOpen(false);
    handoff.openForAssignment(assignment.id);
    setSelectedAssignmentId(null);
  };

  const handleQuickPrompt = (prompt: string) => {
    handoff.handoffAssignmentPrompt(assignment.id, prompt);
    setSelectedAssignmentId(null);
  };

  // Task 6A：添加/解除关联（只改 Task 关系，绝不触碰 Course Material 原文件）
  const toggleMaterial = (materialId: string) => {
    const current = assignment.materialIds ?? [];
    const next = current.includes(materialId)
      ? current.filter((id) => id !== materialId)
      : [...current, materialId];
    setAssignmentMaterialIds(assignment.id, next);
  };

  // Task 6B-B：上传文件 → 创建真实 Course Material → 自动关联当前任务
  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const fresh = useAppStore.getState();
      const result = await uploadCourseMaterials({
        courseId: assignment.courseId,
        files: Array.from(files),
        addMaterial: fresh.addCourseMaterial,
      });
      if (result.succeeded.length > 0) {
        const current = fresh.assignments.find((a) => a.id === assignment.id);
        const existing = current?.materialIds ?? [];
        fresh.setAssignmentMaterialIds(assignment.id, [
          ...existing,
          ...result.succeeded.map((m) => m.id),
        ]);
        pushToast({
          message:
            result.succeeded.length === 1
              ? "已添加 1 份任务资料"
              : `已添加 ${result.succeeded.length} 份任务资料`,
        });
      }
      if (result.failed.length > 0) {
        pushToast({
          type: "warning",
          message:
            result.failed.length === 1
              ? `《${result.failed[0]}》上传失败`
              : `另有 ${result.failed.length} 份上传失败`,
        });
      }
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  // Task 6A：根据关联资料请 Kiro 分析（轻量快捷入口，复用现有 Handoff）
  const handleMaterialAskKiro = () => {
    handoff.handoffAssignmentPrompt(
      assignment.id,
      "请根据当前任务关联的课程资料，梳理任务要求并给出执行建议。"
    );
    setSelectedAssignmentId(null);
  };

  const handleViewInTimeline = () => {
    setSelectedAssignmentId(null);
    setActiveTab("timetable");
  };

  const course = courses.find((c) => c.id === assignment.courseId);

  // Task 6A：关联资料（按 materialIds 原顺序解析；Course.materials 是 Source of Truth）
  const linkedMaterials = resolveAssignmentMaterials(assignment, courses);
  const courseMaterials = course?.materials ?? [];

  // ---- Detail Panel 派生（全部来自 Domain 纯函数） ----
  const deadline = formatDeadlineView(assignment.ddl, new Date());
  const health = deriveAssignmentHealthWithAvailability(
    assignment,
    studyBlocks,
    { schedules, calendarMarks, semester, currentSemesterWeek },
    new Date()
  );
  const healthMeta = healthViewMeta(health.state);
  const healthHint = healthExplanation(health);
  const blocks = studyBlocks.filter((b) => b.assignmentId === assignment.id);
  const scheduleSummary = summarizeStudySchedule(blocks);
  const reminderSummary = summarizeReminders(
    reminders,
    "assignment",
    assignment.id,
    assignment.autoReminderDisabled === true
  );
  const completed = assignment.status === "completed";

  return (
    <Drawer
      presentation="floating"
      open={!!currentAssignment}
      onOpenChange={(next) => {
        if (!next) setSelectedAssignmentId(null);
      }}
      overlayId={OVERLAY_ID}
      aria-label="任务详情"
      data-testid="assignment-detail-panel"
    >
      {/* HEADER：上下文 breadcrumb + 标题 + More / 关闭（不放状态/优先级/进度） */}
      <header className="shrink-0 space-y-2 border-b border-line bg-[#F7F5F5] px-5 pb-3.5 pt-4">
        <div className="flex items-center justify-between gap-2">
          {course ? (
            <button
              onClick={handleOpenCourse}
              className="group flex min-w-0 items-center gap-1 text-xs font-semibold text-sandrift"
              title="查看课程"
            >
              <BookOpen className="h-3.5 w-3.5 text-[#A48F82]" />
              <span className="truncate transition-colors group-hover:text-charcoal group-hover:underline">
                {course.name}
              </span>
              <ChevronRight className="h-3 w-3 text-[#CDB9AB]" />
              <span className="shrink-0 text-sandrift">任务</span>
            </button>
          ) : (
            <span className="flex items-center text-xs font-semibold text-sandrift">
              <BookOpen className="h-3.5 w-3.5 text-[#A48F82]" />
              常规任务
            </span>
          )}
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
                <DropdownMenuItem
                  icon={KIRO_ICON}
                  label="Ask Kiro"
                  onClick={handleAskKiro}
                />
                <DropdownMenuDivider />
                <DropdownMenuItem icon={Trash2} label="删除任务" danger onClick={handleDelete} />
              </DropdownMenuPanel>
            </Popover>
            <IconButton
              variant="secondary"
              size="sm"
              onClick={() => setSelectedAssignmentId(null)}
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
        <h2 className="break-words text-[19px] font-bold leading-snug text-charcoal">
          {assignment.title}
        </h2>
      </header>

      {/* BODY：内容切换时 outer shell 保持；仅此层 key 替换 + 两阶段动画 */}
      <div
        key={assignment.id}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain",
          swap.visible
            ? "ux-detail-swap-in"
            : "-translate-y-[3px] opacity-0 transition-[opacity,transform] duration-[60ms] ease-[var(--ease-standard)]"
        )}
      >
        <div className="space-y-5 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {/* HERO：Deadline / Remaining / Status / Priority / Health / 摘要 */}
          <AssignmentDetailHero
            assignment={assignment}
            deadline={deadline}
            scheduleSummary={scheduleSummary}
            reminderSummary={reminderSummary}
            healthLabel={healthMeta.label}
            healthClassName={healthMeta.className}
            healthHint={healthHint}
            recurrenceLabel={
              assignment.recurrence ? RECURRENCE_LABELS[assignment.recurrence] : undefined
            }
            onStatusChange={(s) => updateAssignmentStatus(assignment.id, s)}
            onPriorityChange={(p) => updateAssignmentPriority(assignment.id, p)}
          />

          {/* PRIMARY ACTIONS：完成 / 重新打开 / 日程 / 提醒 / 编辑 */}
          <AssignmentDetailActions
            completed={completed}
            onComplete={() => updateAssignmentStatus(assignment.id, "completed")}
            onReopen={() => updateAssignmentStatus(assignment.id, "todo")}
            onSchedule={handleViewInTimeline}
            onReminder={() => setReminderOpen(true)}
            onEdit={handleEdit}
          />

          {/* EXECUTION：截止 / 预计耗时 / 学习安排 / 进度 + 子任务 */}
          <AssignmentDetailExecution
            deadline={deadline}
            estimatedMinutesLabel={
              assignment.estimatedMinutes
                ? formatEstimatedMinutes(assignment.estimatedMinutes) ?? "未估时"
                : "未估时"
            }
            scheduleSummary={scheduleSummary}
            onViewSchedule={handleViewInTimeline}
            subtasks={(assignment.subtasks ?? []).map((st) => ({
              id: st.id,
              title: st.title,
              completed: st.completed,
            }))}
            onToggleSubtask={(subtaskId) => toggleSubtask(assignment.id, subtaskId)}
            progress={assignment.progress}
            onProgressChange={(p) => updateAssignmentProgress(assignment.id, p)}
            showProgressControl={!completed}
          />

          {/* REMINDER：默认 collapsed summary；展开 = 现有 AssignmentReminderSection（Domain 不变） */}
          <DetailDisclosure
            title="提醒"
            summary={formatReminderSummaryText(reminderSummary)}
            open={reminderOpen}
            onOpenChange={setReminderOpen}
            testid="reminder-disclosure-trigger"
          >
            <div className="pb-0.5">
              <AssignmentReminderSection assignment={assignment} />
            </div>
          </DetailDisclosure>

          {/* 任务说明：有内容默认展开；无内容只留轻量添加入口 */}
          {assignment.description ? (
            <DetailDisclosure title="任务说明" defaultOpen>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-charcoal">
                {assignment.description}
              </p>
            </DetailDisclosure>
          ) : (
            <button
              type="button"
              onClick={handleEdit}
              className="text-xs font-semibold text-satin-grey transition-colors hover:text-charcoal"
            >
              添加任务说明
            </button>
          )}

          {/* 关联资料：collapsed summary + 添加/上传/解除/分析（Material Domain 不变） */}
          <DetailDisclosure
            title="关联资料"
            summary={linkedMaterials.length > 0 ? `(${linkedMaterials.length})` : "(0)"}
            action={
              <div className="flex items-center gap-1.5">
                {linkedMaterials.length > 0 && (
                  <button
                    onClick={handleMaterialAskKiro}
                    title="根据关联资料请 Kiro 分析"
                    className="text-[10px] font-semibold text-satin-grey hover:text-charcoal transition-colors"
                  >
                    根据资料分析
                  </button>
                )}
                <Popover open={addMenuOpen} onOpenChange={setAddMenuOpen}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setAddMenuOpen((v) => !v);
                      setMaterialPickerOpen(false);
                    }}
                    loading={uploading}
                    loadingLabel="上传中"
                    className="h-6 px-1.5 text-[10px]"
                  >
                    <Plus className="h-3 w-3" />
                    添加
                  </Button>
                  <DropdownMenuPanel open={addMenuOpen} placement="bottom-end" aria-label="添加资料" className="w-48">
                    <DropdownMenuItem
                      icon={BookOpen}
                      label="选择课程资料"
                      onClick={() => {
                        setAddMenuOpen(false);
                        setMaterialPickerOpen((v) => !v);
                      }}
                    />
                    <DropdownMenuItem
                      icon={Upload}
                      label="上传文件"
                      onClick={() => {
                        setAddMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                    />
                    <p className="px-2.5 pt-1 pb-1.5 text-[9px] text-sandrift">
                      上传后自动关联本任务（同时出现在课程资料）
                    </p>
                  </DropdownMenuPanel>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp"
                    onChange={handleUploadFiles}
                    className="hidden"
                    aria-hidden="true"
                    tabIndex={-1}
                  />
                </Popover>
              </div>
            }
          >
            <div className="space-y-2 pt-0.5">
              {linkedMaterials.length > 0 && (
                <div className="space-y-1">
                  {linkedMaterials.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-alabaster/70"
                    >
                      <MaterialTypeIcon type={m.type} />
                      <span className="min-w-0 flex-1 truncate font-medium text-charcoal">{m.title}</span>
                      <span className="shrink-0 text-[9px] font-semibold text-sandrift">
                        {MATERIAL_TYPE_LABELS[m.type]}
                      </span>
                      <IconButton
                        variant="danger"
                        size="sm"
                        onClick={() => toggleMaterial(m.id)}
                        aria-label={`解除关联 ${m.title}`}
                        title="解除关联（不删除课程资料）"
                        className="h-6 w-6"
                      >
                        <X className="h-3 w-3" />
                      </IconButton>
                    </div>
                  ))}
                </div>
              )}

              {materialPickerOpen && (
                <div data-testid="material-picker" className="space-y-0.5 rounded-xl border border-line bg-[#F7F5F5] p-2">
                  {courseMaterials.length === 0 ? (
                    <div className="space-y-1 px-1 py-0.5">
                      <p className="text-[11px] text-satin-grey">暂无课程资料</p>
                      <button
                        onClick={handleOpenCourse}
                        className="text-[11px] font-semibold text-satin-grey hover:text-charcoal transition-colors"
                      >
                        前往课程资料 →
                      </button>
                    </div>
                  ) : (
                    courseMaterials.map((m) => {
                      const linkedNow = linkedMaterials.some((l) => l.id === m.id);
                      return (
                        <button
                          key={m.id}
                          onClick={() => toggleMaterial(m.id)}
                          className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white transition-colors"
                        >
                          <MaterialTypeIcon type={m.type} />
                          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-charcoal">
                            {m.title}
                          </span>
                          <span className="text-[9px] font-semibold text-sandrift shrink-0">
                            {MATERIAL_TYPE_LABELS[m.type]}
                          </span>
                          {linkedNow && <Check className="h-3.5 w-3.5 shrink-0 text-success" />}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </DetailDisclosure>

          {/* 标签：一行 chip；无 tag 不占 section */}
          {assignment.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {assignment.tags.map((t) => (
                <span
                  key={t}
                  className="rounded border border-line bg-[#F7F5F5] px-1.5 py-0.5 text-[10px] font-semibold text-satin-grey"
                >
                  #{t}
                </span>
              ))}
            </div>
          )}

          {/* Kiro 帮助：默认 collapsed；Ask Kiro 是辅助能力（Header More 也有入口） */}
          <DetailDisclosure title="Kiro 帮助">
            <div className="space-y-0.5 pt-0.5">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => handleQuickPrompt(q.prompt)}
                  className="ux-press flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-satin-grey transition-colors hover:bg-alabaster hover:text-charcoal"
                >
                  <KIRO_ICON className="h-3.5 w-3.5 shrink-0 text-[#A48F82]" />
                  {q.label}
                </button>
              ))}
              <button
                type="button"
                onClick={handleAskKiro}
                className="ux-press flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-satin-grey transition-colors hover:bg-alabaster hover:text-charcoal"
              >
                <KIRO_ICON className="h-3.5 w-3.5 shrink-0 text-[#A48F82]" />
                Ask Kiro
              </button>
            </div>
          </DetailDisclosure>
        </div>
      </div>
    </Drawer>
  );
}
