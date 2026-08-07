"use client";

import React, { useState, useEffect } from "react";
import { X, ClipboardList, Clock, AlertCircle, Tag, Plus, Trash2 } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { Assignment, Priority, AssignmentStatus, Subtask } from "@/types";

export function AddAssignmentModal() {
  const {
    courses,
    addAssignment,
    updateAssignmentProgress,
    assignments,
    selectedAssignmentId,
    setSelectedAssignmentId,
  } = useAppStore();

  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

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

  // Listen to custom open events or window trigger
  useEffect(() => {
    const handleOpen = (e: CustomEvent) => {
      if (e.detail?.assignmentId) {
        const target = assignments.find((a) => a.id === e.detail.assignmentId);
        if (target) {
          setEditingId(target.id);
          setTitle(target.title);
          setCourseId(target.courseId);
          const [d, t] = target.ddl.split("T");
          setDdlDate(d);
          setDdlTime(t ? t.substring(0, 5) : "23:59");
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
        setCourseId(courses[0]?.id || "");
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        setDdlDate(tomorrow.toISOString().split("T")[0]);
        setDdlTime("23:59");
        setPriority("medium");
        setStatus("todo");
        setProgress(0);
        setTagsStr("作业, 个人任务");
        setDescription("");
        setSubtasks([]);
      }
      setIsOpen(true);
    };

    window.addEventListener("open-assignment-modal" as any, handleOpen);
    return () => window.removeEventListener("open-assignment-modal" as any, handleOpen);
  }, [assignments, courses]);

  if (!isOpen) return null;

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
    if (!title.trim()) return;

    const fullDdl = `${ddlDate}T${ddlTime}:00.000Z`;
    const tags = tagsStr
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);

    const validSubtasks: Subtask[] = subtasks
      .filter((st) => st.title.trim())
      .map((st) => ({ id: st.id, title: st.title.trim(), completed: st.completed }));

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

    setIsOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-drawer border border-[#E7E3DD] overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 px-6 border-b border-[#F0EBE1] bg-[#F7F5F5] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <ClipboardList className="w-4 h-4 text-[#A48F82]" />
            <h3 className="text-base font-bold text-charcoal">
              {editingId ? "编辑作业 DDL 任务" : "新增作业 DDL 任务"}
            </h3>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 rounded-lg text-[#8C827A] hover:bg-[#E0D7C6] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto text-xs">
          <div className="space-y-1">
            <label className="font-bold text-[#8C827A]">作业名称 *</label>
            <input
              type="text"
              placeholder="例如: 计量经济学第4章实证报告..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none focus:border-charcoal text-charcoal text-xs font-semibold"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-bold text-[#8C827A]">关联课程</label>
              <select
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none text-xs font-medium"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-bold text-[#8C827A]">优先级</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none text-xs font-bold"
              >
                <option value="urgent">紧急</option>
                <option value="high">高优先级</option>
                <option value="medium">中优先级</option>
                <option value="low">低优先级</option>
              </select>
            </div>
          </div>

          {/* DDL Date & Time Picker */}
          <div className="p-3 bg-[#F0EBE1]/60 border border-[#E0D7C6] rounded-xl space-y-2">
            <label className="font-bold text-charcoal flex items-center">
              <Clock className="w-3.5 h-3.5 mr-1 text-[#A48F82]" /> 截止时间 (DDL)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={ddlDate}
                onChange={(e) => setDdlDate(e.target.value)}
                className="w-full p-2 bg-white border border-[#E0D7C6] rounded-lg font-mono text-xs focus:outline-none"
                required
              />
              <input
                type="time"
                value={ddlTime}
                onChange={(e) => setDdlTime(e.target.value)}
                className="w-full p-2 bg-white border border-[#E0D7C6] rounded-lg font-mono text-xs focus:outline-none"
                required
              />
            </div>
          </div>

          {/* Subtasks checklist */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <label className="font-bold text-[#8C827A]">子任务拆解 ({subtasks.length})</label>
              <button
                type="button"
                onClick={handleAddSubtask}
                className="flex items-center space-x-1 text-[11px] font-bold text-charcoal bg-[#E3E6E0] hover:bg-[#D0D5CC] px-2 py-0.5 rounded-lg transition-colors"
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
                    placeholder={`子步骤 #${idx + 1} (如: 收集案例数据)...`}
                    value={st.title}
                    onChange={(e) => handleSubtaskChange(idx, e.target.value)}
                    className="flex-1 p-2 bg-[#F7F5F5] border border-[#E7E3DD] rounded-lg text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveSubtask(idx)}
                    className="p-1.5 text-[#D94F4F] hover:bg-[#FDF0F0] rounded-lg"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-1">
            <label className="font-bold text-[#8C827A]">标签 (逗号分隔)</label>
            <input
              type="text"
              placeholder="如: 个人作业, 回归模型, PPT"
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
              className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none text-xs"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="font-bold text-[#8C827A]">作业要求与详细说明</label>
            <textarea
              rows={3}
              placeholder="请输入作业详细要求、提交格式、字数限制等..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none resize-none text-xs leading-relaxed"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-2 pt-2 border-t border-[#F0EBE1]">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 text-xs font-medium text-[#676268] bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl hover:bg-[#E0D7C6]"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-bold text-white bg-charcoal rounded-xl hover:bg-black"
            >
              保存作业任务
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
