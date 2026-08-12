"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, ClipboardList, Clock, Plus, Trash2 } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { Priority, AssignmentStatus, Subtask, TaskRecurrence } from "@/types";
import { combineLocalDateTime, getLocalDDLDate, getLocalDDLTime, parseLocalDDL } from "@/lib/ddl";
import { format } from "date-fns";


import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { UISelect, SelectOption } from "@/components/ui/Select";
import { onOpenAssignmentEditor } from "@/lib/uiEvents";

import { getNewTaskDefaults } from "@/lib/taskDefaults";



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
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) setIsOpen(false);
      }}
      overlayId="add-assignment-modal"
      stackZ={50}
      aria-label="添加任务"
      className="max-w-lg max-h-[90dvh]"
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
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto text-xs">
          <Field label="任务名称" required htmlFor="assignment-title">
            <Input
              id="assignment-title"
              type="text"
              placeholder="如：计量经济学实证报告"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="关联课程">
              <UISelect
                value={courseId}
                onChange={(v) => setCourseId(v)}
                ariaLabel="关联课程"
                options={courses.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
              />
            </Field>

            <Field label="优先级">
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
            </Field>
          </div>

          {/* DDL Date & Time Picker（Task V2：可选；未启用 = 无截止日期） */}
          <div className="p-3 bg-alabaster/60 border border-line-strong rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center font-bold text-charcoal text-[11px]">
                <Clock className="w-3.5 h-3.5 mr-1 text-[#A48F82]" /> 截止时间 (DDL)
              </span>
              <Checkbox
                checked={ddlEnabled}
                onChange={(checked) => {
                  setDdlEnabled(checked);
                  // Task 7F：关闭 DDL 必须同步清空重复规则（避免提交非法组合）
                  if (!checked) setRecurrence("none");
                }}
                aria-label="设置截止时间"
              />
            </div>
            {ddlEnabled ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="date"
                    value={ddlDate}
                    onChange={(e) => setDdlDate(e.target.value)}
                    className="bg-white border-line-strong font-mono"
                    required
                  />
                  <Input
                    type="time"
                    value={ddlTime}
                    onChange={(e) => setDdlTime(e.target.value)}
                    className="bg-white border-line-strong font-mono"
                    required
                  />
                </div>
                {/* Task 7F：重复规则（仅 DDL 启用时显示；完成当前任务后自动生成下一次） */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span id="task-recurrence-label" className="text-[11px] font-bold text-sandrift">
                    重复
                  </span>
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
          <Field label="预计耗时" description="可选，单位为分钟">
            <Input
              type="number"
              min={1}
              value={estimatedMinutes}
              onChange={(e) => setEstimatedMinutes(e.target.value)}
              placeholder="如：120"
              aria-label="预计耗时（分钟）"
              className="font-mono"
            />
          </Field>

          {/* Subtasks checklist */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-charcoal">子任务拆解 ({subtasks.length})</label>
              <Button
                type="button"
                variant="accent"
                size="sm"
                onClick={handleAddSubtask}
                className="h-7 px-2.5 text-[11px]"
              >
                <Plus className="w-3 h-3" />
                <span>添加子任务</span>
              </Button>
            </div>

            <div className="space-y-1.5">
              {subtasks.map((st, idx) => (
                <div key={st.id || idx} className="flex items-center gap-2">
                  <Input
                    type="text"
                    placeholder={`子步骤 #${idx + 1}（如：收集案例数据）`}
                    value={st.title}
                    onChange={(e) => handleSubtaskChange(idx, e.target.value)}
                    className="flex-1"
                  />
                  <IconButton
                    variant="danger"
                    size="sm"
                    onClick={() => handleRemoveSubtask(idx)}
                    aria-label="删除子任务"
                    title="删除子任务"
                    className="h-8 w-8"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </IconButton>
                </div>
              ))}
            </div>
          </div>

          {/* Tags */}
          <Field label="标签" description="使用逗号分隔">
            <Input
              type="text"
              placeholder="如：个人作业、回归模型、PPT"
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
            />
          </Field>

          {/* Description */}
          <Field label="任务要求与说明">
            <Textarea
              rows={3}
              placeholder="补充任务要求、提交格式等"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-[#F0EBE1]">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsOpen(false)}
            >
              取消
            </Button>
            <Button type="submit" variant="primary" size="sm">
              保存
            </Button>
          </div>
        </form>
      </Dialog>
  );
}
