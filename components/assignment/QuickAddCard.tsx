"use client";

import React, { useState } from "react";
import { X, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { Priority } from "@/types";
import { combineLocalDateTime } from "@/lib/ddl";
import { format } from "date-fns";
import { openAssignmentEditor } from "@/lib/uiEvents";
import { UISelect } from "@/components/ui/Select";
import { getNewTaskDefaults } from "@/lib/taskDefaults";

/**
 * Quick Add V2：任务工作区的快速捕获入口（Inline Card）。
 * - Capture Layer：标题 + 课程 + 可选 Deadline（默认无 DDL，不造明天截止）+ 创建
 * - Progressive Detail：「更多」展开 Priority / 预计耗时 / Description
 * - 「更多详情」→ 打开 Full Editor（AddAssignmentModal）
 * 提交直接走 Store Domain Action（无 DDL 不创建 CalendarMark；estimatedMinutes 由 normalize 清洗）。
 */
export function QuickAddCard({
  defaultCourseId,
  onClose,
}: {
  defaultCourseId?: string;
  onClose: () => void;
}) {
  const { courses, addAssignment, preferences } = useAppStore();
  const pushToast = useToastStore((s) => s.pushToast);

  const defaults = getNewTaskDefaults(preferences);
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState(
    defaultCourseId && courses.some((c) => c.id === defaultCourseId)
      ? defaultCourseId
      : courses[0]?.id ?? ""
  );
  const [ddlEnabled, setDdlEnabled] = useState(false);
  const [ddlDate, setDdlDate] = useState(() => {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return format(t, "yyyy-MM-dd");
  });
  const [ddlTime, setDdlTime] = useState(defaults.ddlTime);
  const [moreOpen, setMoreOpen] = useState(false);
  const [priority, setPriority] = useState<Priority>(defaults.priority);
  const [estimatedMinutes, setEstimatedMinutes] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    const est = estimatedMinutes.trim() ? Number(estimatedMinutes.trim()) : undefined;
    addAssignment({
      courseId: courseId || courses[0]?.id || "",
      title: title.trim(),
      description: description.trim(),
      // Task V2：未启用 DDL = 无截止日期（合法状态，不自动生成）
      ddl: ddlEnabled ? combineLocalDateTime(ddlDate, ddlTime) : undefined,
      estimatedMinutes: est,
      priority,
      status: defaults.status,
      progress: 0,
      tags: [],
    });
    pushToast({ message: "任务已创建" });
    setTitle("");
    setDescription("");
    setEstimatedMinutes("");
    setDdlEnabled(false);
    setMoreOpen(false);
    setSubmitting(false);
  };

  const handleOpenFullEditor = () => {
    openAssignmentEditor(courseId ? { courseId } : {});
  };

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="quick-add-card"
      className="bg-[#F7F5F5] border border-line-strong rounded-2xl p-3.5 space-y-3 shadow-subtle"
    >
      {/* Capture Layer */}
      <div className="flex items-center justify-between gap-2">
        <label className="sr-only" htmlFor="quick-add-title">
          要完成什么？
        </label>
        <input
          id="quick-add-title"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="要完成什么？"
          className="flex-1 min-w-0 h-9 px-3 bg-white border border-line-strong rounded-xl text-xs font-semibold text-charcoal focus:outline-none focus:border-charcoal placeholder:text-sandrift"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭快速新建"
          className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
              <UISelect
                value={courseId}
                onChange={(v) => setCourseId(v)}
                ariaLabel="关联课程"
                options={courses.map((c) => ({ value: c.id, label: c.name }))}
                triggerClassName="h-8 bg-white border-line-strong text-[11px] font-semibold max-w-[180px]"
              />

        {ddlEnabled ? (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={ddlDate}
              onChange={(e) => setDdlDate(e.target.value)}
              aria-label="截止日期"
              className="h-8 px-2 bg-white border border-line-strong rounded-lg text-[11px] font-mono text-charcoal focus:outline-none"
            />
            <input
              type="time"
              value={ddlTime}
              onChange={(e) => setDdlTime(e.target.value)}
              aria-label="截止时间"
              className="h-8 px-2 bg-white border border-line-strong rounded-lg text-[11px] font-mono text-charcoal focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setDdlEnabled(false)}
              aria-label="移除截止时间"
              className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDdlEnabled(true)}
            className="flex items-center gap-1 h-8 px-2.5 rounded-lg text-[11px] font-semibold text-satin-grey bg-white border border-line-strong hover:text-charcoal hover:border-charcoal transition-colors"
          >
            <Clock className="w-3.5 h-3.5" />
            添加截止时间
          </button>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="ml-auto h-8 px-4 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black disabled:opacity-40 transition-colors"
        >
          创建
        </button>
      </div>

      {/* Progressive Detail */}
      <div className="pt-1 border-t border-line-soft">
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          className="flex items-center gap-1 text-[11px] font-semibold text-sandrift hover:text-charcoal transition-colors"
        >
          {moreOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          更多
        </button>

        {moreOpen && (
          <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-sandrift">优先级</label>
              <UISelect<Priority>
                value={priority}
                onChange={setPriority}
                ariaLabel="优先级"
                options={[
                  { value: "urgent", label: "紧急" },
                  { value: "high", label: "高" },
                  { value: "medium", label: "中" },
                  { value: "low", label: "低" },
                ]}
                triggerClassName="h-8 bg-white border-line-strong text-[11px] font-semibold"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-sandrift">预计耗时（分钟）</label>
              <input
                type="number"
                min={1}
                value={estimatedMinutes}
                onChange={(e) => setEstimatedMinutes(e.target.value)}
                placeholder="可选"
                aria-label="预计耗时（分钟）"
                className="w-full h-8 px-2.5 bg-white border border-line-strong rounded-lg text-[11px] font-mono text-charcoal focus:outline-none placeholder:text-sandrift"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[10px] font-bold text-sandrift">描述</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="可选"
                className="w-full px-2.5 py-2 bg-white border border-line-strong rounded-lg text-[11px] text-charcoal focus:outline-none placeholder:text-sandrift resize-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Secondary：进入 Full Editor */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={handleOpenFullEditor}
          className="text-[11px] font-semibold text-satin-grey hover:text-charcoal transition-colors"
        >
          更多详情（子任务 / 标签 / 状态）…
        </button>
      </div>
    </form>
  );
}
