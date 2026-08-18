"use client";

import React, { useMemo, useState } from "react";
import { CalendarClock, Check, TriangleAlert, Image as ImageIcon, X, Save, Plus, Trash2 } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { TimetableImportProposal } from "@/lib/ai/timetableImport/types";
import { BellScheduleTemplate } from "@/types";
import { resolveLiveImageSources } from "@/lib/ai/attachments/liveImageRegistry";
import { cn } from "@/lib/utils";

const DAY_LABELS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

interface TimetableImportPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposal: TimetableImportProposal;
  sourceAttachments: ReturnType<typeof resolveLiveImageSources>;
  onApply: (skipCourseKeys: Set<string>) => void;
  onViewImage: () => void;
}

/** Bell Schedule 内联编辑器：设置学校作息时间（节次 → 具体时间） */
function BellScheduleEditor({
  onSave,
  onClose,
}: {
  onSave: (template: BellScheduleTemplate) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Array<{ period: number; startTime: string; endTime: string }>>(
    Array.from({ length: 2 }, (_, i) => ({ period: i + 1, startTime: "08:00", endTime: "08:45" }))
  );
  const [name, setName] = useState("我的作息");

  const updateRow = (index: number, patch: Partial<{ startTime: string; endTime: string }>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const save = () => {
    const periods = rows
      .map((r) => ({ ...r, period: r.period }))
      .filter((r) => r.startTime && r.endTime);
    if (periods.length === 0) return;
    onSave({ id: `bell_${Date.now().toString(36)}`, name: name.trim() || "我的作息", periods });
    onClose();
  };

  return (
    <div className="space-y-2.5">
      <p className="text-[11px] text-sandrift leading-relaxed">
        课表只标注节次（如第1-2节），需要你的学校作息时间才能转换为具体时间。请填写各节次的起止时间。
      </p>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-satin-grey shrink-0">名称</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 h-7 rounded-lg border border-line bg-[#F7F5F5] px-2 text-[11px] focus:outline-none focus:border-line-strong"
        />
      </div>
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-14 text-[11px] font-semibold text-charcoal shrink-0">第{row.period}节</span>
            <input
              type="time"
              value={row.startTime}
              onChange={(e) => updateRow(i, { startTime: e.target.value })}
              className="h-7 rounded-lg border border-line bg-[#F7F5F5] px-2 text-[11px] tabular-nums flex-1 focus:outline-none focus:border-line-strong"
            />
            <span className="text-[10px] text-sandrift">–</span>
            <input
              type="time"
              value={row.endTime}
              onChange={(e) => updateRow(i, { endTime: e.target.value })}
              className="h-7 rounded-lg border border-line bg-[#F7F5F5] px-2 text-[11px] tabular-nums flex-1 focus:outline-none focus:border-line-strong"
            />
            <button
              type="button"
              onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
              className="p-1 rounded text-sandrift hover:text-danger transition-colors"
              aria-label="删除此节次"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, { period: prev.length + 1, startTime: "08:00", endTime: "08:45" }])}
        className="flex items-center gap-1 text-[11px] font-semibold text-sandrift hover:text-charcoal transition-colors"
      >
        <Plus className="w-3 h-3" /> 添加节次
      </button>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="h-7 px-2.5 rounded-lg text-[11px] font-semibold text-satin-grey hover:bg-alabaster transition-colors">
          取消
        </button>
        <button
          type="button"
          onClick={save}
          className="flex items-center gap-1 h-7 px-3 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors"
        >
          <Save className="w-3 h-3" /> 保存作息时间
        </button>
      </div>
    </div>
  );
}

export function TimetableImportPreviewDialog({
  open,
  onOpenChange,
  proposal,
  sourceAttachments,
  onApply,
  onViewImage,
}: TimetableImportPreviewDialogProps) {
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [bellEditorOpen, setBellEditorOpen] = useState(false);
  const [pendingBell, setPendingBell] = useState<BellScheduleTemplate | null>(null);
  const { bellSchedules, activeBellScheduleId } = useAppStore();
  const activeBell = pendingBell ?? bellSchedules.find((b) => b.id === activeBellScheduleId) ?? null;

  if (!open) return null;

  const counts = proposal.preview.counts;
  const issues = proposal.preview.issues;
  const blockers = issues.filter((i) => i.severity === "blocker");
  const warnings = issues.filter((i) => i.severity === "warning");
  const selectedCourses = proposal.draft.courses.filter((c) => !skip.has(c.draftKey));

  const toggleSkip = (key: string) => {
    setSkip((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const saveBell = (template: BellScheduleTemplate) => {
    const store = useAppStore.getState();
    store.upsertBellSchedule(template);
    store.setActiveBellSchedule(template.id);
    setPendingBell(template);
  };

  const handleApply = () => {
    onApply(skip);
    onOpenChange(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 top-[var(--titlebar-h)] z-[90] bg-black/40 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-2xl max-h-full flex flex-col bg-surface border border-line rounded-2xl shadow-drawer overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line-soft shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-charcoal">课表导入预览</h3>
            <p className="text-[10px] text-sandrift mt-0.5">
              {counts.courses} 门课程 · {counts.slots} 个上课时段
              {blockers.length > 0 ? ` · ${blockers.length} 项需处理` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {sourceAttachments.length > 0 && (
              <button
                type="button"
                onClick={onViewImage}
                className="flex items-center gap-1 text-[11px] font-semibold text-sandrift hover:text-charcoal transition-colors"
                aria-label="查看课表原图"
              >
                <ImageIcon className="w-3.5 h-3.5" /> 原图
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
              aria-label="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
          {/* Bell Schedule 状态 */}
          <div className={cn("rounded-xl border px-3 py-2.5", activeBell ? "border-line-soft bg-[#F7F5F5]" : "border-warning-border bg-warning-bg/40")}>
            {activeBell ? (
              <p className="text-[11px] font-semibold text-charcoal flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-success" />
                学校作息时间：{activeBell.name}（{activeBell.periods.length} 个节次）
                <button type="button" onClick={() => setBellEditorOpen((v) => !v)} className="text-[10px] font-bold text-sandrift hover:text-charcoal underline ml-1">
                  修改
                </button>
              </p>
            ) : (
              <p className="text-[11px] font-semibold text-warning flex items-center gap-1.5">
                <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
                尚未设置学校作息时间，节次无法转换为具体时间。
                <button type="button" onClick={() => setBellEditorOpen(true)} className="text-[10px] font-bold underline ml-1">
                  立即设置
                </button>
              </p>
            )}
            {bellEditorOpen && (
              <div className="pt-2.5">
                <BellScheduleEditor
                  onSave={(t) => {
                    saveBell(t);
                    setBellEditorOpen(false);
                  }}
                  onClose={() => setBellEditorOpen(false)}
                />
              </div>
            )}
          </div>

          {/* 课程分组预览 */}
          {proposal.draft.courses.map((course) => {
            const skipped = skip.has(course.draftKey);
            const courseIssues = issues.filter((i) => i.courseKey === course.draftKey);
            const courseBlockers = courseIssues.filter((i) => i.severity === "blocker");
            return (
              <div key={course.draftKey} className={cn("rounded-xl border border-line bg-[#F7F5F5] px-3 py-2.5", skipped && "opacity-55")}>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!skipped}
                    onChange={() => toggleSkip(course.draftKey)}
                    className="w-4 h-4 rounded text-charcoal border-[#CDB9AB] shrink-0 cursor-pointer"
                    aria-label={`导入《${course.name}》`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-charcoal truncate">
                      {course.name}
                      {course.code ? <span className="ml-1.5 text-[10px] font-mono text-sandrift">{course.code}</span> : null}
                    </p>
                    <p className="text-[10px] text-satin-grey truncate">
                      {[course.teacher, course.classroom].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  {courseBlockers.length > 0 && (
                    <span className="shrink-0 text-[10px] font-bold text-danger">需处理</span>
                  )}
                </div>
                <div className="mt-2 space-y-1">
                  {course.slots.map((slot, i) => {
                    const resolved = proposal.preview.resolvedCourses
                      .find((c) => c.draftKey === course.draftKey)
                      ?.slots[i];
                    return (
                      <div key={i} className="flex items-center gap-2 text-[11px] text-satin-grey">
                        <CalendarClock className="w-3 h-3 text-sandrift shrink-0" />
                        <span className="font-semibold text-charcoal shrink-0 w-8">{DAY_LABELS[slot.dayOfWeek] ?? "?"}</span>
                        <span className="shrink-0">
                          {resolved ? `${resolved.startTime}–${resolved.endTime}` : `第${slot.periodStart ?? "?"}节`}
                        </span>
                        <span className="shrink-0">{slot.weekExpression || "1-16周"}</span>
                        {slot.location && <span className="truncate">{slot.location}</span>}
                        {resolved && slot.periodStart !== undefined && (
                          <span className="text-[10px] text-sandrift shrink-0">（第{slot.periodStart}{slot.periodEnd && slot.periodEnd !== slot.periodStart ? `-${slot.periodEnd}` : ""}节）</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {courseIssues.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {courseIssues.map((issue, i) => (
                      <p key={i} className={cn("text-[10px] font-semibold", issue.severity === "blocker" ? "text-danger" : "text-warning")}>
                        {issue.message}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Pending items */}
          {proposal.draft.pendingItems && proposal.draft.pendingItems.length > 0 && (
            <div className="rounded-xl border border-warning-border bg-warning-bg/40 px-3 py-2.5">
              <p className="text-[11px] font-bold text-warning">待确认事项</p>
              {proposal.draft.pendingItems.map((item, i) => (
                <p key={i} className="text-[10px] text-satin-grey mt-1">
                  {item.description}
                </p>
              ))}
            </div>
          )}

          {/* 全局 warning */}
          {warnings.length > 0 && (
            <div className="rounded-xl border border-line-soft bg-[#F7F5F5] px-3 py-2">
              <p className="text-[10px] font-semibold text-warning">
                {warnings.map((w) => w.message).join("；")}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-line-soft shrink-0">
          <p className="text-[10px] text-sandrift">
            将导入 {selectedCourses.length} 门课程 ·{" "}
            {selectedCourses.reduce((n, c) => n + c.slots.length, 0)} 个上课时段
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-8 px-3 rounded-lg text-[11px] font-semibold text-satin-grey hover:bg-alabaster transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              disabled={blockers.length > 0 || selectedCourses.length === 0}
              onClick={handleApply}
              className={cn(
                "flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-[11px] font-bold text-white transition-colors",
                blockers.length > 0 || selectedCourses.length === 0
                  ? "bg-satin-grey/50 cursor-not-allowed"
                  : "bg-charcoal hover:bg-black"
              )}
            >
              <Check className="w-3.5 h-3.5" />
              导入所选课程
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
