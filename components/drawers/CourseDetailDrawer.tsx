"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Plus,
  BookOpen,
  User,
  MapPin,
  Clock,
  Trash2,
  FileText,
  Edit,
  Save,
  FileUp,
  Loader2,
  ClipboardList,
  ChevronRight,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { Material, CourseSchedule, ScheduleConflict, Course } from "@/types";
import { deleteFileBlob } from "@/lib/fileStorage";
import { uploadCourseMaterials } from "@/lib/materialUpload";
import { getLocalDDLDate } from "@/lib/ddl";
import { WEEK_RANGE_PRESETS, isValidTimeRange } from "@/lib/schedule";
import { findScheduleConflicts } from "@/lib/conflicts";


import { cn } from "@/lib/utils";
import { UISelect } from "@/components/ui/Select";
import { openAssignmentEditor, previewMaterial } from "@/lib/uiEvents";

import { useKiroHandoff } from "@/hooks/useKiroHandoff";
import { KIRO_ICON } from "@/components/layout/navItems";
import { KiroFlowButton } from "@/components/kiro/KiroFlow";
import { useEnterOnAdd } from "@/lib/useEnterOnAdd";
import { Drawer } from "@/components/ui/Drawer";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";


const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

/** 周次选择：预设下拉 + 自定义输入（自定义状态由 value 是否命中预设推导） */
function WeeksSelect({ value, onChange }: { value: string; onChange: (weeks: string) => void }) {
  const isCustom = !WEEK_RANGE_PRESETS.some((p) => p.value === value);
  return (
    <div className="space-y-1.5">
      <UISelect
        value={isCustom ? "__custom__" : value}
        onChange={(v) => onChange(v === "__custom__" ? value : v)}
        ariaLabel="周次规则"
        options={[
          ...WEEK_RANGE_PRESETS.map((p) => ({ value: p.value, label: p.label })),
          { value: "__custom__", label: "自定义…" },
        ]}
        triggerClassName="bg-white border-line-strong text-[11px]"
      />
      {isCustom && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="如 1-8周 / 单周 / 5-5周"
          className="w-full p-1.5 bg-white border border-line-strong rounded-lg focus:outline-none text-[11px]"
        />
      )}
    </div>
  );
}

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

  const [isEditing, setIsEditing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const scheduleSectionRef = useRef<HTMLDivElement | null>(null);
  const materialInputRef = useRef<HTMLInputElement | null>(null);

  // Form State for editing course
  const [name, setName] = useState("");
  const [teacher, setTeacher] = useState("");
  const [classroom, setClassroom] = useState("");
  const [credit, setCredit] = useState(3);
  const [description, setDescription] = useState("");

  // Form State for adding schedule slot
  const [newDay, setNewDay] = useState(1);
  const [newStart, setNewStart] = useState("08:00");
  const [newEnd, setNewEnd] = useState("09:40");
  const [newLocation, setNewLocation] = useState("");
  const [newWeeks, setNewWeeks] = useState("1-16周");

  // Form State for editing a schedule slot (inline)
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [slotForm, setSlotForm] = useState({
    dayOfWeek: 1,
    startTime: "08:00",
    endTime: "09:40",
    location: "",
    weeks: "1-16周",
  });
  const [slotError, setSlotError] = useState<string | null>(null);
  const [slotConflict, setSlotConflict] = useState<string | null>(null);

  const currentCourse = courses.find((c) => c.id === selectedCourseId);
  // 关闭（selected 清空）期间保留最后一次内容渲染，让 Drawer exit presence 生效
  const [staleCourse, setStaleCourse] = useState<Course | null>(null);
  const course = currentCourse ?? staleCourse;
  useEffect(() => {
    if (currentCourse) setStaleCourse(currentCourse);
  }, [currentCourse?.id]);
  const courseSchedules = schedules.filter((s) => s.courseId === selectedCourseId);
  const courseAssignments = assignments.filter((a) => a.courseId === selectedCourseId);

  const newScheduleIds = useEnterOnAdd(courseSchedules.map((s) => s.id));
  const newMaterialIds = useEnterOnAdd(course?.materials.map((m) => m.id) ?? []);

  if (!course) return null;

  const handleStartEdit = () => {    setName(course.name);
    setTeacher(course.teacher);
    setClassroom(course.classroom);
    setCredit(course.credit);
    setDescription(course.description);
    setIsEditing(true);
  };

  // 快捷操作：添加任务（自动预选当前课程）
  const handleQuickAddAssignment = () => {
    openAssignmentEditor({ courseId: course.id });
  };

  // 快捷操作：滚动到排课时段编辑区
  const handleQuickAddSlot = () => {
    scheduleSectionRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "center",
    });
  };

  // 快捷操作：触发资料上传文件选择
  const handleQuickUploadMaterial = () => {
    materialInputRef.current?.click();
  };

  // Ask Kiro：固定课程 Entry Context → 关闭 Drawer → 打开 Sidecar
  const handleAskKiro = () => {
    handoff.openForCourse(course.id);
    setSelectedCourseId(null);
  };

  // 相关任务：直接打开 AssignmentDrawer（保持上下文，不跳 Tab）
  const handleOpenAssignment = (assignmentId: string) => {
    setSelectedCourseId(null);
    setSelectedAssignmentId(assignmentId);
  };

  const handleSaveCourse = () => {
    updateCourse({
      ...course,
      name,
      teacher,
      classroom,
      credit,
      description,
    });
    setIsEditing(false);
    pushToast({ message: "课程已更新" });
  };

  const handleDeleteCourse = () => {
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

  // ---- Schedule 表单验证与冲突检测（新增/编辑共用，全站一致） ----
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

  /** 候选时段 vs 其他时段：找出涉及候选时段的冲突 */
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

  // ---- 新增时段 ----
  const handleAddSlot = (e: React.FormEvent) => {
    e.preventDefault();

    const error = validateSlot({ dayOfWeek: newDay, startTime: newStart, endTime: newEnd, weeks: newWeeks });
    if (error) {
      setSlotError(error);
      setSlotConflict(null);
      return;
    }

    const candidate: CourseSchedule = {
      id: "__candidate__",
      courseId: course.id,
      dayOfWeek: newDay,
      startTime: newStart,
      endTime: newEnd,
      location: newLocation || course.classroom,
      weeks: newWeeks,
    };
    const conflicts = findCandidateConflicts(candidate);
    if (conflicts.length > 0) {
      setSlotError(null);
      setSlotConflict(formatConflictMessage(conflicts, candidate.id));
      return;
    }

    addScheduleSlot({
      courseId: course.id,
      dayOfWeek: newDay,
      startTime: newStart,
      endTime: newEnd,
      location: newLocation || course.classroom,
      weeks: newWeeks,
    });
    setNewLocation("");
    setNewWeeks("1-16周");
    setSlotError(null);
    setSlotConflict(null);
  };

  // ---- 编辑时段 ----
  const handleStartEditSlot = (sched: CourseSchedule) => {
    setSlotForm({
      dayOfWeek: sched.dayOfWeek,
      startTime: sched.startTime,
      endTime: sched.endTime,
      location: sched.location,
      weeks: sched.weeks,
    });
    setSlotError(null);
    setSlotConflict(null);
    setEditingSlotId(sched.id);
  };

  const handleCancelEditSlot = () => {
    setEditingSlotId(null);
    setSlotError(null);
    setSlotConflict(null);
  };

  const handleSaveSlotEdit = (sched: CourseSchedule) => {
    const error = validateSlot(slotForm);
    if (error) {
      setSlotError(error);
      setSlotConflict(null);
      return;
    }

    // 保留 id / courseId / excludedWeeks，只更新可编辑字段
    const candidate: CourseSchedule = {
      ...sched,
      dayOfWeek: slotForm.dayOfWeek,
      startTime: slotForm.startTime,
      endTime: slotForm.endTime,
      location: slotForm.location.trim() || sched.location,
      weeks: slotForm.weeks,
    };
    const conflicts = findCandidateConflicts(candidate, sched.id);
    if (conflicts.length > 0) {
      setSlotError(null);
      setSlotConflict(formatConflictMessage(conflicts, candidate.id));
      return;
    }

    updateSchedule(candidate);
    handleCancelEditSlot();
  };

  // Real File Upload Handler: File → IndexedDB 保存 Blob → 生成 storageKey → Zustand 只存 metadata
  // （Task 6B-B：统一走 lib/materialUpload，Course / Task 上传不再维护两份逻辑）
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

  return (
    <Drawer
      open={!!currentCourse}
      onOpenChange={(next) => {
        if (!next) setSelectedCourseId(null);
      }}
      overlayId="course-detail-drawer"
      aria-label="课程详情"
      className="max-w-lg justify-between"
    >
        {/* Header */}
        <div
          className="p-6 border-b border-line-strong flex items-center justify-between"
          style={{ backgroundColor: `${course.bgHex}80` }}
        >
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-white border border-line-strong flex items-center justify-center text-charcoal shadow-subtle shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 bg-white/90 rounded border border-line-strong text-charcoal">
                {course.code}
              </span>
              <h2 className="text-lg font-bold text-charcoal truncate mt-1">
                {course.name}
              </h2>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 shrink-0">
            {!isEditing ? (
              <IconButton
                variant="secondary"
                size="sm"
                onClick={handleStartEdit}
                title="编辑课程信息"
                aria-label="编辑课程信息"
              >
                <Edit className="w-4 h-4" />
              </IconButton>
            ) : (
              <IconButton
                variant="primary"
                size="sm"
                onClick={handleSaveCourse}
                title="保存修改"
                aria-label="保存修改"
              >
                <Save className="w-4 h-4" />
              </IconButton>
            )}

            <IconButton
              variant="danger"
              size="sm"
              onClick={handleDeleteCourse}
              title="删除课程"
              aria-label="删除课程"
            >
              <Trash2 className="w-4 h-4" />
            </IconButton>

            <IconButton
              variant="secondary"
              size="sm"
              onClick={() => setSelectedCourseId(null)}
              title="关闭"
              aria-label="关闭"
            >
              <X className="w-4 h-4" />
            </IconButton>
          </div>
        </div>

        {/* 快捷操作：高频入口，保持克制 */}
        <div className="px-6 py-2.5 border-b border-line-strong/60 bg-surface/80 flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleQuickAddAssignment}
            className="flex items-center space-x-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-charcoal hover:bg-white border border-transparent hover:border-line-strong transition-colors"
          >
            <ClipboardList className="w-3.5 h-3.5 text-[#A48F82]" />
            <span>添加任务</span>
          </button>
          <button
            onClick={handleQuickAddSlot}
            className="flex items-center space-x-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-charcoal hover:bg-white border border-transparent hover:border-line-strong transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-[#A48F82]" />
            <span>添加时段</span>
          </button>
          <button
            onClick={handleQuickUploadMaterial}
            className="flex items-center space-x-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-charcoal hover:bg-white transition-colors"
          >
            <FileUp className="w-3.5 h-3.5 text-[#A48F82]" />
            <span>上传资料</span>
          </button>
          <KiroFlowButton
            icon={KIRO_ICON}
            label="Ask Kiro"
            size="sm"
            className="h-8"
            onClick={handleAskKiro}
          />
        </div>

        {/* Content Body */}
        <div className="p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] overflow-y-auto space-y-6 flex-1 text-xs">
          {/* Edit Form or Readonly View */}
          {isEditing ? (
            <div className="space-y-4 p-4 bg-[#F7F5F5] rounded-2xl border border-line">
              <h3 className="text-[13px] font-bold text-charcoal">修改课程信息</h3>
              <Field label="课程名称">
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="课程名称"
                />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="授课教师">
                  <Input
                    type="text"
                    value={teacher}
                    onChange={(e) => setTeacher(e.target.value)}
                    placeholder="授课教师"
                  />
                </Field>
                <Field label="上课教室">
                  <Input
                    type="text"
                    value={classroom}
                    onChange={(e) => setClassroom(e.target.value)}
                    placeholder="上课教室"
                  />
                </Field>
              </div>
              <Field label="课程说明">
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="课程大纲与要求"
                  rows={2}
                />
              </Field>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-satin-grey text-xs leading-relaxed">
                {course.description || "暂无课程大纲与简介"}
              </p>
              <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-charcoal pt-2">
                <span className="flex items-center">
                  <User className="w-3.5 h-3.5 mr-1 text-[#A48F82]" />
                  {course.teacher}
                </span>
                <span className="flex items-center">
                  <MapPin className="w-3.5 h-3.5 mr-1 text-[#A48F82]" />
                  {course.classroom}
                </span>
                <span className="flex items-center">
                  <Clock className="w-3.5 h-3.5 mr-1 text-[#A48F82]" />
                  {course.credit} 学分
                </span>
              </div>
            </div>
          )}

          {/* Schedule Slots Section */}
          <div ref={scheduleSectionRef} className="space-y-3 pt-4 border-t border-[#F0EBE1] scroll-mt-4">
            <h3 className="font-bold text-charcoal text-sm flex items-center justify-between">
              <span>上课时间安排 ({courseSchedules.length} 个时段)</span>
            </h3>

            {/* List of slots */}
            <div className="space-y-2">
              {courseSchedules.map((sched) => {
                const isEditing = editingSlotId === sched.id;
                if (isEditing) {
                  return (
                    <div
                      key={sched.id}
                      className="p-3 bg-white border border-[#CDB9AB] rounded-xl space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-sandrift">编辑时段</span>
                        <IconButton
                          variant="ghost"
                          size="sm"
                          onClick={handleCancelEditSlot}
                          aria-label="取消编辑"
                          title="取消编辑"
                          className="h-6 w-6"
                        >
                          <X className="w-3.5 h-3.5" />
                        </IconButton>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-sandrift">星期</label>
                          <UISelect<number>
                            value={slotForm.dayOfWeek}
                            onChange={(v) => setSlotForm({ ...slotForm, dayOfWeek: v })}
                            ariaLabel="星期"
                            options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({
                              value: d,
                              label: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][d - 1],
                            }))}
                            triggerClassName="bg-[#F7F5F5] text-[11px]"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-sandrift">周次</label>
                          <WeeksSelect
                            value={slotForm.weeks}
                            onChange={(weeks) => setSlotForm({ ...slotForm, weeks })}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-sandrift">开始</label>
                          <Input
                            type="time"
                            value={slotForm.startTime}
                            onChange={(e) => setSlotForm({ ...slotForm, startTime: e.target.value })}
                            className="bg-[#F7F5F5] font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-sandrift">结束</label>
                          <Input
                            type="time"
                            value={slotForm.endTime}
                            onChange={(e) => setSlotForm({ ...slotForm, endTime: e.target.value })}
                            className="bg-[#F7F5F5] font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-sandrift">教室</label>
                          <Input
                            type="text"
                            value={slotForm.location}
                            onChange={(e) => setSlotForm({ ...slotForm, location: e.target.value })}
                            placeholder={sched.location}
                            className="bg-[#F7F5F5]"
                          />
                        </div>
                      </div>

                      {slotError && (
                        <p className="text-[10px] text-danger font-bold">{slotError}</p>
                      )}
                      {slotConflict && (
                        <p className="text-[10px] text-danger font-bold">
                          {slotConflict}，已阻止保存。可取消编辑后调整时间或周次。
                        </p>
                      )}

                      <div className="flex justify-end gap-2 pt-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleCancelEditSlot}
                          className="h-7 px-2.5 text-[11px]"
                        >
                          取消
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleSaveSlotEdit(sched)}
                          className="h-7 px-2.5 text-[11px]"
                        >
                          保存时段
                        </Button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={sched.id}
                    className={cn(
                      "p-3 bg-[#F7F5F5] border border-line rounded-xl flex items-center justify-between text-xs",
                      newScheduleIds.has(sched.id) && "animate-enter"
                    )}
                  >
                    <div className="space-y-0.5">
                      <div className="font-bold text-charcoal">
                        周{DAY_LABELS[sched.dayOfWeek - 1]} {sched.startTime} - {sched.endTime}
                      </div>
                      <div className="text-[10px] text-sandrift">
                        {sched.location} · {sched.weeks}
                        {sched.excludedWeeks && sched.excludedWeeks.length > 0 && (
                          <span className="text-warning">
                            {" "}· 停课周 {sched.excludedWeeks.join(",")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-0.5 shrink-0">
                      <IconButton
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStartEditSlot(sched)}
                        aria-label="编辑此排课时段"
                        title="编辑此排课时段"
                        className="h-7 w-7"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </IconButton>
                      <IconButton
                        variant="danger"
                        size="sm"
                        onClick={() => handleDeleteSlot(sched)}
                        aria-label="删除此排课时段"
                        title="删除此排课时段"
                        className="h-7 w-7"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconButton>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Form to add slot */}
            <form onSubmit={handleAddSlot} className="p-3 bg-alabaster/60 border border-line-strong rounded-xl space-y-2">
              <span className="font-bold text-charcoal text-[11px]">添加上课时段</span>
              <div className="grid grid-cols-2 gap-2">
                <UISelect<number>
                  value={newDay}
                  onChange={setNewDay}
                  ariaLabel="星期"
                  options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({
                    value: d,
                    label: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][d - 1],
                  }))}
                  triggerClassName="bg-white border-line-strong text-xs"
                />
                <WeeksSelect value={newWeeks} onChange={setNewWeeks} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Input
                  type="time"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                  className="bg-white border-line-strong font-mono"
                  aria-label="开始时间"
                />
                <Input
                  type="time"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                  className="bg-white border-line-strong font-mono"
                  aria-label="结束时间"
                />
                <Input
                  type="text"
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  placeholder={course.classroom}
                  className="bg-white border-line-strong"
                  aria-label="教室"
                />
              </div>
              {slotError && (
                <p className="text-[10px] text-danger font-bold">{slotError}</p>
              )}
              {slotConflict && (
                <p className="text-[10px] text-danger font-bold">
                  {slotConflict}，已阻止添加。
                </p>
              )}
              <Button
                type="submit"
                variant="primary"
                size="sm"
                className="w-full"
              >
                + 添加排课
              </Button>
            </form>
          </div>

          {/* 相关任务：直接进入 AssignmentDrawer，保持上下文 */}
          <div className="space-y-2.5 pt-4 border-t border-[#F0EBE1]">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-charcoal text-sm flex items-center gap-1.5">
                <ClipboardList className="w-4 h-4 text-[#A48F82]" />
                相关任务 ({courseAssignments.length})
              </h3>
              <button
                onClick={handleQuickAddAssignment}
                className="text-[11px] font-semibold text-sandrift hover:text-charcoal transition-colors"
              >
                + 添加任务
              </button>
            </div>
            {courseAssignments.length === 0 ? (
              <p className="text-[11px] text-sandrift py-2 text-center bg-[#F7F5F5] rounded-xl">
                暂无任务
              </p>
            ) : (
              <div className="space-y-1.5">
                {courseAssignments.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => handleOpenAssignment(a.id)}
                    className="w-full flex items-center justify-between p-2.5 bg-[#F7F5F5] hover:bg-alabaster border border-line rounded-xl text-left transition-colors group"
                  >
                    <span className="text-xs font-semibold text-charcoal truncate min-w-0">
                      {a.title}
                    </span>
                    <span className="flex items-center shrink-0 ml-2 text-[10px] text-sandrift">
                      {getLocalDDLDate(a.ddl)}
                      <ChevronRight className="w-3 h-3 ml-0.5 transition-transform duration-[var(--motion-fast)] group-hover:translate-x-px" />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Real Course Materials & Storage Upload */}
          <div className="space-y-3 pt-4 border-t border-[#F0EBE1]">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-charcoal text-sm flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-[#A48F82]" />
                课程资料 ({course.materials.length})
              </h3>

              {/* Real File Input Button */}
              <input
                ref={materialInputRef}
                type="file"
                multiple
                onChange={handleRealFileUpload}
                className="hidden"
                id="real-material-upload"
              />
              <Button
                variant="primary"
                size="sm"
                loading={isUploading}
                loadingLabel="上传中"
                onClick={() => document.getElementById("real-material-upload")?.click()}
                className="min-w-[96px]"
              >
                <FileUp className="w-3 h-3" />
                上传资料
              </Button>
            </div>

            {/* Materials List */}
            <div className="space-y-2">
              {course.materials.length === 0 ? (
                <div className="py-4 text-center bg-[#F7F5F5] rounded-xl space-y-0.5">
                  <p className="text-[11px] text-sandrift font-semibold">暂无课程资料</p>
                  <p className="text-[10px] text-sandrift">支持 PDF、PPT、Word 和图片</p>
                </div>
              ) : (
                course.materials.map((mat) => (
                  <div
                    key={mat.id}
                    onClick={() => handlePreviewMaterial(mat)}
                    className={cn(
                      "p-3 bg-[#F7F5F5] hover:bg-alabaster border border-line rounded-xl flex items-center justify-between text-xs cursor-pointer transition-colors group",
                      newMaterialIds.has(mat.id) && "animate-enter"
                    )}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <FileText className="w-4 h-4 text-[#A48F82] shrink-0" />
                      <div className="min-w-0">
                        <h4 className="font-bold text-charcoal truncate">
                          {mat.title}
                        </h4>
                        <span className="text-[10px] text-sandrift">
                          {mat.size || "1.5 MB"} · {mat.uploadDate}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      <span className="text-[10px] bg-white border border-line-strong px-2 py-0.5 rounded font-bold text-charcoal group-hover:bg-charcoal group-hover:text-white transition-colors">
                        查看
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteMaterial(mat);
                        }}
                        className="p-1.5 text-danger hover:bg-danger-bg rounded-lg transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                        title="删除此资料"
                        aria-label="删除此资料"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        </Drawer>
  );
}
