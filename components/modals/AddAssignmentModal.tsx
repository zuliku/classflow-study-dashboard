"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, ClipboardList, Clock, Plus, Trash2, FileText } from "lucide-react";
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
import { FormSection } from "@/components/ui/FormSection";
import {
  onOpenAssignmentEditor,
  OpenAssignmentEditorDetail,
} from "@/lib/uiEvents";
import { sanitizeAssignmentMaterialIds } from "@/lib/tasks/taskMaterials";

import { getNewTaskDefaults } from "@/lib/taskDefaults";
import { normalizeEstimatedMinutes } from "@/lib/tasks/taskSemantics";



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
    updateAssignmentPatch,
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
  /**
   * Workflow UX V7：Resource → Task Promotion——create-only 关联资料 context。
   * 编辑模式恒为 null（assignmentId 是事实源）；课程切换即清除（不搬运/不恢复）；
   * 提交时经 Store write-boundary sanitize 最终校验。
   */
  const [initialMaterialId, setInitialMaterialId] = useState<string | null>(null);

  /** context chip 展示信息：跨全部 Course 反查（仅在仍真实存在时显示） */
  const initialMaterial = (() => {
    if (!initialMaterialId) return null;
    for (const c of courses) {
      const m = c.materials.find((x) => x.id === initialMaterialId);
      if (m) return m;
    }
    return null;
  })();

  /** 课程切换：预关联资料不属于新课程 → 立即清除（切回原课也不自动恢复） */
  const handleCourseChange = (v: string) => {
    setCourseId(v);
    if (initialMaterialId) {
      const stillValid =
        sanitizeAssignmentMaterialIds({ courseId: v }, courses, [initialMaterialId]).length > 0;
      if (!stillValid) setInitialMaterialId(null);
    }
  };

  // 打开事件：assignmentId → 编辑模式（已有 Assignment 是事实源，忽略 draft）；
  // 否则新增模式，precedence：draft（Quick Add capture handoff）→ legacy context（courseId / ddlDate）→ preferences defaults
  useEffect(() => {
    const handleOpen = (detail: OpenAssignmentEditorDetail) => {
      if (detail.assignmentId) {
        const target = assignments.find((a) => a.id === detail.assignmentId);
        if (target) {
          // 编辑模式：已有 Assignment 是事实源——忽略 draft / materialId create context
          setInitialMaterialId(null);
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
        setInitialMaterialId(null);
        setProgress(0);
        setTagsStr("");
        setSubtasks([]);
        setRecurrence("none");
        const defaults = getNewTaskDefaults(preferences);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const legacyCourseValid =
          !!detail.courseId && courses.some((c) => c.id === detail.courseId);

        let nextCourseId = "";
        if (detail.draft) {
          // ---- Workflow UX V5：Quick Add 草稿移交（capture continuity）----
          const draft = detail.draft;
          setTitle(draft.title ?? "");
          const draftCourseValid =
            !!draft.courseId && courses.some((c) => c.id === draft.courseId);
          nextCourseId = draftCourseValid
            ? draft.courseId!
            : legacyCourseValid
            ? detail.courseId!  // detail.courseId 存在时已验证合法
            : courses[0]?.id || "";
          setCourseId(nextCourseId);
          const draftDdlValid = !!draft.ddl && parseLocalDDL(draft.ddl) !== null;
          if (draftDdlValid) {
            setDdlEnabled(true);
            setDdlDate(getLocalDDLDate(draft.ddl));
            setDdlTime(getLocalDDLTime(draft.ddl) || defaults.ddlTime);
          } else {
            setDdlEnabled(false);
            setDdlDate(format(tomorrow, "yyyy-MM-dd"));
            setDdlTime(defaults.ddlTime);
          }
          const estDraft =
            draft.estimatedMinutes !== undefined
              ? normalizeEstimatedMinutes(draft.estimatedMinutes)
              : undefined;
          setEstimatedMinutes(estDraft !== undefined ? String(estDraft) : "");
          setPriority(draft.priority ?? defaults.priority);
          setStatus(draft.status ?? defaults.status);
          setDescription(draft.description ?? "");
          setPrefillSource(null); // draft 移交不属于 course/calendar legacy source
        } else {
          // ---- Legacy create context ----
          setTitle("");
          nextCourseId = legacyCourseValid ? detail.courseId! : courses[0]?.id || "";
          setCourseId(nextCourseId);
          setDdlDate(detail.ddlDate || format(tomorrow, "yyyy-MM-dd"));
          setDdlEnabled(!!detail.ddlDate);
          setDdlTime(defaults.ddlTime);
          setEstimatedMinutes("");
          setPriority(defaults.priority);
          setStatus(defaults.status);
          setDescription("");
          setPrefillSource(detail.courseId ? "course" : detail.ddlDate ? "calendar" : null);
        }

        // ---- Workflow UX V7：materialId create-only context（Resource → Task）----
        // 经 Domain sanitize 校验真实归属 resolved Course（非字符串比较）；编辑模式不进入此分支。
        if (detail.materialId && nextCourseId) {
          const valid = sanitizeAssignmentMaterialIds(
            { courseId: nextCourseId },
            courses,
            [detail.materialId]
          );
          setInitialMaterialId(valid.length > 0 ? detail.materialId : null);
        } else {
          setInitialMaterialId(null);
        }
      }
      setIsOpen(true);
    };

    return onOpenAssignmentEditor(handleOpen);
    // Preference listener deps：defaults 同时读取 defaultDDLTime / defaultTaskPriority /
    // defaultTaskStatus——三者任一变化都需重建 listener，否则旧 closure 继续生效。
  }, [assignments, courses, preferences.defaultDDLTime, preferences.defaultTaskPriority, preferences.defaultTaskStatus]);


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
      // 无课程时存空字符串，Assignment UI 已有「通用」fallback 语义（不制造 c_1）
      courseId: courseId || courses[0]?.id || "",
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
      // P0 数据完整性：Full Editor 只写自己拥有的字段（field-level patch）。
      // materialIds / autoReminderDisabled / recurrenceSeriesId / recurrenceParentId
      // 不属于本表单 ownership——经 current merge 原值保留，不再被整对象覆盖清空。
      updateAssignmentPatch(editingId, {
        courseId: baseFields.courseId,
        title: baseFields.title,
        description: baseFields.description,
        ddl: baseFields.ddl,
        estimatedMinutes: baseFields.estimatedMinutes,
        priority: baseFields.priority,
        status: baseFields.status,
        progress: baseFields.progress,
        tags: baseFields.tags,
        subtasks: baseFields.subtasks,
        recurrence: baseFields.recurrence,
      });
      pushToast({ message: "修改已保存" });
    } else {
      // Create：material context（仍有效时）随表单一并提交；
      // 最终 relation 由 Store write-boundary sanitize 保证（stale / 已删自动清除）。
      const createPayload = {
        ...baseFields,
        materialIds: initialMaterialId ? [initialMaterialId] : undefined,
      };
      const newId = addAssignment(createPayload);
      const linkedCreated = !!useAppStore
        .getState()
        .assignments.find((a) => a.id === newId)?.materialIds?.length;
      if (linkedCreated) {
        pushToast({ message: "任务已创建并关联资料" });
      } else {
        // 从课程/日历发起的任务创建，提示带上下文语义
        pushToast({ message: prefillSource ? "任务已添加" : "任务已创建" });
      }
      setInitialMaterialId(null);
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
      className="max-w-lg max-h-[90dvh] flex flex-col"
    >
        {/* Header */}
        <div className="shrink-0 p-4 px-6 border-b border-line bg-[#F7F5F5] flex items-center justify-between">
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

        {/* Form：Header / Body(scroll) / Footer 三段式，长表单 footer 不滚走 */}
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5 text-xs">
            {/* 基本信息 */}
            <FormSection title="基本信息">
              {/* Resource → Task context chip（create-only；课程切换即清除） */}
              {initialMaterial && initialMaterialId && (
                <div
                  data-testid="editor-material-context"
                  className="flex items-center gap-2 rounded-lg border border-line bg-background px-2.5 py-1.5"
                >
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-sandrift shrink-0">
                    <FileText className="h-3 w-3 text-sandrift" />
                    关联资料
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-charcoal">
                    {initialMaterial.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => setInitialMaterialId(null)}
                    aria-label="移除关联资料"
                    title="移除关联资料（不删除课程资料）"
                    className="shrink-0 rounded-md p-0.5 text-sandrift transition-colors hover:bg-danger-bg hover:text-danger"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <span className="sr-only">创建后将自动关联此资料</span>
                </div>
              )}
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
                    onChange={handleCourseChange}
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
            </FormSection>

            {/* 时间：DDL 保留 inset surface（有 enabled/disabled 状态），无 shadow */}
            <FormSection title="时间">
              <div className="p-3 bg-[#F7F5F5] border border-line rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center font-bold text-charcoal text-[11px]">
                    <Clock className="w-3.5 h-3.5 mr-1 text-[#A48F82]" /> 截止时间
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
                  aria-label="预计耗时"
                  className="font-mono"
                />
              </Field>
            </FormSection>

            {/* 详细信息 */}
            <FormSection title="详细信息">
              {/* Subtasks checklist */}
              <div className="space-y-2">
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
            </FormSection>
          </div>

          {/* Footer：稳定不随滚动 */}
          <div className="shrink-0 flex justify-end gap-2 px-5 py-3 border-t border-line-soft">
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
