"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, ClipboardList, Clock, Plus, Trash2 } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { Priority, AssignmentStatus, Subtask } from "@/types";
import { combineLocalDateTime, getLocalDDLDate, getLocalDDLTime } from "@/lib/ddl";
import { format } from "date-fns";
import { usePresence } from "@/lib/usePresence";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { cn } from "@/lib/utils";
import { onOpenAssignmentEditor } from "@/lib/uiEvents";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";

const OVERLAY_ID = "add-assignment-modal";

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
  const [ddlDate, setDdlDate] = useState("");
  const [ddlTime, setDdlTime] = useState("23:59");
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
          // 统一本地时间语义回填（旧 Z 数据同样按本地墙钟读取）
          setDdlDate(getLocalDDLDate(target.ddl));
          setDdlTime(getLocalDDLTime(target.ddl));
          setPriority(target.priority);
          setStatus(target.status);
          setProgress(target.progress);
          setTagsStr(target.tags ? target.tags.join(", ") : "");
          setDescription(target.description || "");
          setSubtasks(target.subtasks || []);
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
        // 新建默认截止时间来自偏好（编辑已有任务不受影响，走上方回填分支）
        setDdlTime(preferences.defaultDDLTime);
        setPriority("medium");
        setStatus("todo");
        setProgress(0);
        setTagsStr("作业, 个人任务");
        setDescription("");
        setSubtasks([]);
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

    // 本地时间语义：不追加 Z，避免 UTC 解释导致日期偏移
    const fullDdl = combineLocalDateTime(ddlDate, ddlTime);
    const tags = tagsStr
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);

    const validSubtasks: Subtask[] = subtasks
      .filter((st) => st.title.trim())
      .map((st) => ({ id: st.id, title: st.title.trim(), completed: st.completed }));

    if (editingId) {
      // Update existing assignment in-place preserving original ID
      updateAssignment({
        id: editingId,
        courseId: courseId || courses[0]?.id || "c_1",
        title,
        description,
        ddl: fullDdl,
        priority,
        status,
        progress,
        tags,
        subtasks: validSubtasks,
      });
      pushToast({ message: "修改已保存" });
    } else {
      // Create new assignment
      addAssignment({
        courseId: courseId || courses[0]?.id || "c_1",
        title,
        description,
        ddl: fullDdl,
        priority,
        status,
        progress,
        tags,
        subtasks: validSubtasks,
      });
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
              <select
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="w-full p-2.5 bg-[#F7F5F5] border border-line rounded-xl focus:outline-none text-xs font-medium"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-bold text-sandrift">优先级</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="w-full p-2.5 bg-[#F7F5F5] border border-line rounded-xl focus:outline-none text-xs font-bold"
              >
                <option value="urgent">紧急</option>
                <option value="high">高优先级</option>
                <option value="medium">中优先级</option>
                <option value="low">低优先级</option>
              </select>
            </div>
          </div>

          {/* DDL Date & Time Picker */}
          <div className="p-3 bg-alabaster/60 border border-line-strong rounded-xl space-y-2">
            <label className="font-bold text-charcoal flex items-center">
              <Clock className="w-3.5 h-3.5 mr-1 text-[#A48F82]" /> 截止时间 (DDL)
            </label>
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
