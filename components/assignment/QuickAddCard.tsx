"use client";

import React, { useRef, useState } from "react";
import { X, ChevronDown, Clock } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { Priority } from "@/types";
import { combineLocalDateTime } from "@/lib/ddl";
import { format } from "date-fns";
import { openAssignmentEditor } from "@/lib/uiEvents";
import { UISelect } from "@/components/ui/Select";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { getNewTaskDefaults } from "@/lib/taskDefaults";
import { normalizeEstimatedMinutes } from "@/lib/tasks/taskSemantics";
import { cn } from "@/lib/utils";

/**
 * Quick Add V3：任务工作区的快速捕获入口（Capture Surface，非 Inline Form Card）。
 * - Capture Layer：标题（最强视觉）+ 创建；低权重 metadata 行：课程 / 截止时间 / 更多
 * - Progressive Detail：「更多」展开 Priority / 预计耗时 / Description
 * - 「更多详情」→ 打开 Full Editor（AddAssignmentModal）
 * - Escape 关闭（内部 Select / 原生 date picker 的 Escape 由各自组件优先消费，不会误关）
 * - 创建后：清空标题 + 焦点回到标题输入
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
  const titleRef = useRef<HTMLInputElement | null>(null);
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

  /** 预计耗时统一清洗（Quick Add 直提与 Full Editor handoff 同一规则，不产生双标准） */
  const parseEstimate = (): number | undefined =>
    estimatedMinutes.trim() ? normalizeEstimatedMinutes(Number(estimatedMinutes.trim())) : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    addAssignment({
      courseId: courseId || courses[0]?.id || "",
      title: title.trim(),
      description: description.trim(),
      // Task V2：未启用 DDL = 无截止日期（合法状态，不自动生成）
      ddl: ddlEnabled ? combineLocalDateTime(ddlDate, ddlTime) : undefined,
      estimatedMinutes: parseEstimate(),
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
    titleRef.current?.focus();
  };

  const handleOpenFullEditor = () => {
    // Workflow UX V5：草稿 ownership transfer——Quick Add 不提前创建任务，
    // 全部已输入内容经 draft 移交 Full Editor；随后关闭 Capture Surface，
    // 避免 Full Editor 保存后旧草稿残留导致重复创建。
    openAssignmentEditor({
      draft: {
        title: title.trim() || undefined,
        courseId: courseId || undefined,
        ddl: ddlEnabled ? combineLocalDateTime(ddlDate, ddlTime) : undefined,
        estimatedMinutes: parseEstimate(),
        priority,
        status: defaults.status,
        description: description.trim() || undefined,
      },
    });
    onClose();
  };

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="quick-add-card"
      onKeyDown={(e) => {
        // 仅 Escape 关闭 Quick Add 本体；内部 UISelect / 原生 date picker 的 Escape
        // 由组件自身优先消费（select 在 window capture 拦截），不会误关
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      className="bg-[#F7F5F5] border border-line rounded-xl p-3 space-y-2.5"
    >
      {/* Capture Layer：标题最强 + 创建 */}
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="quick-add-title">
          要完成什么？
        </label>
        <input
          ref={titleRef}
          id="quick-add-title"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="要完成什么？"
          className="flex-1 min-w-0 h-10 px-1 bg-transparent rounded-lg text-sm font-bold text-charcoal focus:outline-none placeholder:text-sandrift placeholder:font-semibold"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="ux-press shrink-0 h-8 px-3.5 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black disabled:opacity-40 transition-colors"
        >
          创建
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭快速新建"
          className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Metadata Layer：低权重，不与标题竞争 */}
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
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          className="ml-auto flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
        >
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 transition-transform duration-[var(--motion-fast)]",
              moreOpen && "rotate-180"
            )}
            aria-hidden="true"
          />
          更多
        </button>
      </div>

      {/* Progressive Detail */}
      <DisclosureRegion open={moreOpen} innerClassName="pt-2 border-t border-line-soft grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            aria-label="描述"
            className="w-full px-2.5 py-2 bg-white border border-line-strong rounded-lg text-[11px] text-charcoal focus:outline-none placeholder:text-sandrift resize-none"
          />
        </div>
      </DisclosureRegion>

      {/* Secondary：进入 Full Editor */}
      <div className="flex items-center justify-end pt-1">
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
