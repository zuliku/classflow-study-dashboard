"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, ClipboardList, Clock, Plus, Trash2 } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { Priority, AssignmentStatus, Subtask, TaskRecurrence } from "@/types";
import { combineLocalDateTime, getLocalDDLDate, getLocalDDLTime, parseLocalDDL } from "@/lib/ddl";
import { format } from "date-fns";
import { usePresence } from "@/lib/usePresence";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { cn } from "@/lib/utils";
import { UISelect, SelectOption } from "@/components/ui/Select";
import { onOpenAssignmentEditor } from "@/lib/uiEvents";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";
import { getNewTaskDefaults } from "@/lib/taskDefaults";

const OVERLAY_ID = "add-assignment-modal";

/** Task 7F：重复规则选项（与 Domain TaskRecurrence 一一对应） */
const RECURRENCE_OPTIONS: { value: TaskRecurrence | "none"; label: string }[] = [
  { value: "none", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "biweekly", label: "每两周" },
  { value: "monthly", label: "每月" },
];

export function AddAssignmentModal() {
  const {
    courses,
    addAssignment,
    updateAssignment,
    assignments,
    preferences,
  } = useAppStore();
  const pushToast = useToastStore((s) => s.pushToast);

  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [prefillSource, setPrefillSource] = useState<"course" | "calendar" | null>(null);
  const submittingRef = useRef(false);

  const { mounted, visible } = usePresence(isOpen, 220);
  useRestoreFocus(isOpen);

  // Overlay Stack：Modal 层，Esc 只在最上层时关闭
  useEffect(() => {
    if (!mounted) return;
    pushOverlay(OVERLAY_ID, 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopmostOverlay(OVERLAY_ID)) setIsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      popOverlay(OVERLAY_ID);
      window.removeEventListener("keydown", onKey);
    };
  }, [mounted]);

  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState(courses[0]?.id || "");
  // Task V2：DDL 可选（默认关闭，编辑按原任务有无回填；日历入口自动开启）
  const [ddlEnabled, setDdlEnabled] = useState(false);
  const [ddlDate, setDdlDate] = useState("");
  const [ddlTime, setDdlTime] = useState("23:59");
  // Task 7F：重复规则（"none" = 普通任务；仅在 DDL 启用时有效）
  const [recurrence, setRecurrence] = useState<TaskRecurrence | "none">("none");
  // Task V2：预计耗时（分钟，可选）
  const [estimatedMinutes, setEstimatedMinutes] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [status, setStatus] = useState<AssignmentStatus>("todo");
  const [progress, setProgress] = useState(0);
  const [tagsStr, setTagsStr] = useState("");
  const [description, setDescription] = useState("");
  const [subtasks, setSubtasks] = useState<{ id: string; title: string; completed: boolean }[]>([]);

  // 打开事件：assignmentId → 编辑模式；否则新增模式，支持 courseId / ddlDate 上下文预填
  useEffect(() => {
    const handleOpen = (detail: { assignmentId?: string; courseId?: string; ddlDate?: string }) => {
      if (detail.assignmentId) {
        const target = assignments.find((a) => a.id === detail.assignmentId);
        if (target) {
          setEditingId(target.id);
          setTitle(target.title);
          setCourseId(target.courseId);
          // 统一本地时间语义回填（旧 Z 数据同样按本地墙钟读取）；无 DDL 任务默认关闭
          setDdlEnabled(!!target.ddl && parseLocalDDL(target.ddl) !== null);
          setDdlDate(getLocalDDLDate(target.ddl));
          setDdlTime(getLocalDDLTime(target.ddl) || "23:59");
          setEstimatedMinutes(target.estimatedMinutes ? String(target.estimatedMinutes) : "");
          setPriority(target.priority);
          setStatus(target.status);
          setProgress(target.progress);
          setTagsStr(target.tags ? target.tags.join(", ") : "");
          setDescription(target.description || "");
          setSubtasks(target.subtasks || []);
          setRecurrence(target.recurrence ?? "none");
        }
      } else {
        setEditingId(null);
        setTitle("");
        setCourseId(
          detail.courseId && courses.some((c) => c.id === detail.courseId)
            ? detail.courseId
            : courses[0]?.id || ""
        );
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        // 本地日期格式化（不用 toISOString，避免时区偏移导致日期错误）；日历发起时预填当天
        setDdlDate(detail.ddlDate || format(tomorrow, "yyyy-MM-dd"));
        // Task V2：日历入口语义 = 创建当天截止任务（自动开启 DDL）；其余默认不设截止
        setDdlEnabled(!!detail.ddlDate);
        // 新建任务默认值（截止时刻/优先级/状态）统一来自偏好；
        // 编辑已有任务不受影响，走上方回填分支。
        const defaults = getNewTaskDefaults(preferences);
        setDdlTime(defaults.ddlTime);
        setEstimatedMinutes("");
        setPriority(defaults.priority);
        setStatus(defaults.status);
        setProgress(0);
        setTagsStr("作业, 个人任务");
        setDescription("");
        setSubtasks([]);
        setRecurrence("none");
        setPrefillSource(detail.courseId ? "course" : detail.ddlDate ? "calendar" : null);
      }
      setIsOpen(true);
    };

    return onOpenAssignmentEditor(handleOpen);
  }, [assignments, courses, preferences.defaultDDLTime]);

  if (!mounted) return null;

  const handleAddSubtask = () => {
    setSubtasks([...subtasks, { id: `st_${Date.now()}`, title: "", completed: false }]);
  };

  const handleSubtaskChange = (index: number, val: string) => {
    const updated = [...subtasks];
    updated[index].title = val;
    setSubtasks(updated);
  };

  const handleRemoveSubtask = (index: number) => {
    setSubtasks(subtasks.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || submittingRef.current) return;
    submittingRef.current = true;

    // 本地时间语义：不追加 Z，避免 UTC 解释导致日期偏移；Task V2：未启用 DDL 则不设截止
    const fullDdl = ddlEnabled ? combineLocalDateTime(ddlDate, ddlTime) : undefined;
    const estMinutes = estimatedMinutes.trim()
      ? Number(estimatedMinutes.trim())
      : undefined;
    const tags = tagsStr
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);

    const validSubtasks: Subtask[] = subtasks
      .filter((st) => st.title.trim())
      .map((st) => ({ id: st.id, title: st.title.trim(), completed: st.completed }));

    const baseFields = {
      courseId: courseId || courses[0]?.id || "c_1",
      title,
      description,
      ddl: fullDdl,
      estimatedMinutes: estMinutes,
      priority,
      status,
      progress,
      tags,
      subtasks: validSubtasks,
      // Task 7F：仅 DDL 启用时才提交 recurrence（关闭 DDL 时同步为 none，避免非法组合）
      recurrence: ddlEnabled && recurrence !== "none" ? recurrence : undefined,
    };

    if (editingId) {
      // Update existing assignment in-place preserving original ID
      updateAssignment({
        id: editingId,
        ...baseFields,
      });
      pushToast({ message: "修改已保存" });
    } else {
      // Create new assignment
      addAssignment(baseFields);
      // 从课程/日历发起的任务创建，提示带上下文语义
      pushToast({ message: prefillSource ? "任务已添加" : "任务已创建" });
    }

    setIsOpen(false);
    submittingRef.current = false;
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4",
        "ux-overlay",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      <div
        className={cn(
          "w-full max-w-lg bg-surface rounded-2xl shadow-drawer border border-line overflow-hidden flex flex-col max-h-[90dvh]",
          "ux-modal-panel",
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.985] translate-y-1"
        )}
      >
        {/* Header */}
        <div className="p-4 px-6 border-b border-[#F0EBE1] bg-[#F7F5F5] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <ClipboardList className="w-4 h-4 text-[#A48F82]" />
            <h3 className="text-base font-bold text-charcoal">
              {editingId ? "编辑任务" : "新建任务"}
            </h3>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 rounded-lg text-sandrift hover:bg-alba hover:text-charcoal transition-colors"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto text-xs">
          <div className="space-y-1">
            <label className="font-bold text-sandrift">任务名称 *</label>
            <input
              type="text"
              placeholder="如：计量经济学实证报告"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              className="w-full p-2.5 bg-[#F7F5F5] border border-line rounded-xl focus:outline-none focus:border-charcoal text-charcoal text-xs font-semibold"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-bold text-sandrift">关联课程</label>
              <UISelect
                value={courseId}
                onChange={(v) => setCourseId(v)}
                ariaLabel="关联课程"
                options={courses.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-sandrift">优先级</label>
              <UISelect<Priority>
                value={priority}
                onChange={setPriority}
                ariaLabel="优先级"
                options={[
                  { value: "urgent", label: "紧急" },
                  { value: "high", label: "高优先级" },
                  { value: "medium", label: "中优先级" },
                  { value: "low", label: "低优先级" },
                ]}
              />
            </div>
          </div>

          {/* DDL Date & Time Picker（Task V2：可选；未启用 = 无截止日期） */}
          <div className="p-3 bg-alabaster/60 border border-line-strong rounded-xl space-y-2">
            <label className="flex items-center justify-between font-bold text-charcoal">
              <span className="flex items-center">
                <Clock className="w-3.5 h-3.5 mr-1 text-[#A48F82]" /> 截止时间 (DDL)
              </span>
              <input
                type="checkbox"
                checked={ddlEnabled}
                onChange={(e) => {
                  setDdlEnabled(e.target.checked);
                  // Task 7F：关闭 DDL 必须同步清空重复规则（避免提交非法组合）
                  if (!e.target.checked) setRecurrence("none");
                }}
                className="w-3.5 h-3.5 rounded accent-charcoal"
                aria-label="设置截止时间"
              />
            </label>
            {ddlEnabled ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={ddlDate}
                    onChange={(e) => setDdlDate(e.target.value)}
                    className="w-full p-2 bg-white border border-line-strong rounded-lg font-mono text-xs focus:outline-none"
                    required
                  />
                  <input
                    type="time"
                    value={ddlTime}
                    onChange={(e) => setDdlTime(e.target.value)}
                    className="w-full p-2 bg-white border border-line-strong rounded-lg font-mono text-xs focus:outline-none"
                    required
                  />
                </div>
                {/* Task 7F：重复规则（仅 DDL 启用时显示；完成当前任务后自动生成下一次） */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <label id="task-recurrence-label" className="text-[11px] font-bold text-sandrift">
                    重复
                  </label>
                  <UISelect<TaskRecurrence | "none">
                    value={recurrence}
                    onChange={setRecurrence}
                    ariaLabel="重复"
                    options={RECURRENCE_OPTIONS}
                    triggerClassName="min-w-[120px]"
                  />
                </div>
              </>
            ) : (
              <p className="text-[11px] text-sandrift">未设置截止日期，任务仍可正常创建与安排。</p>
            )}
          </div>

          {/* 预计耗时（分钟，可选） */}
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={estimatedMinutes}
              onChange={(e) => setEstimatedMinutes(e.target.value)}
              placeholder="预计耗时（分钟，可选）"
              aria-label="预计耗时（分钟）"
              className="flex-1 p-2 bg-white border border-line-strong rounded-lg font-mono text-xs focus:outline-none"
            />
          </div>

          {/* Subtasks checklist */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <label className="font-bold text-sandrift">子任务拆解 ({subtasks.length})</label>
              <button
                type="button"
                onClick={handleAddSubtask}
                className="flex items-center space-x-1 text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint px-2 py-0.5 rounded-lg transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>添加子任务</span>
              </button>
            </div>

            <div className="space-y-1.5">
              {subtasks.map((st, idx) => (
                <div key={st.id || idx} className="flex items-center space-x-2">
                  <input
                    type="text"
                    placeholder={`子步骤 #${idx + 1}（如：收集案例数据）`}
                    value={st.title}
                    onChange={(e) => handleSubtaskChange(idx, e.target.value)}
                    className="flex-1 p-2 bg-[#F7F5F5] border border-line rounded-lg text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveSubtask(idx)}
                    className="p-1.5 text-danger hover:bg-danger-bg rounded-lg"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-1">
            <label className="font-bold text-sandrift">标签 (逗号分隔)</label>
            <input
              type="text"
              placeholder="如：个人作业、回归模型、PPT"
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
              className="w-full p-2.5 bg-[#F7F5F5] border border-line rounded-xl focus:outline-none text-xs"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="font-bold text-sandrift">任务要求与说明</label>
            <textarea
              rows={3}
              placeholder="补充任务要求、提交格式等"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2.5 bg-[#F7F5F5] border border-line rounded-xl focus:outline-none resize-none text-xs leading-relaxed"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-2 pt-2 border-t border-[#F0EBE1]">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 text-xs font-medium text-satin-grey bg-[#F7F5F5] border border-line rounded-xl hover:bg-alba"
            >
              取消
            </button>
            <button
              type="submit"
              className="ux-press px-4 py-2 text-xs font-bold text-white bg-charcoal rounded-xl hover:bg-black"
            >
               保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
