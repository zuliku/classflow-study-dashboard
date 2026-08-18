"use client";

import React, { useMemo, useState } from "react";
import { CalendarClock, Check, TriangleAlert, Image as ImageIcon, X, Save, Plus, Trash2, Pencil } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { TimetableImportDraft, TimetableImportProposal } from "@/lib/ai/timetableImport/types";
import { BellScheduleTemplate } from "@/types";
import { preflightScheduleImport } from "@/lib/scheduleImport/preflight";
import { normalizeTimetableImportDraft } from "@/lib/ai/timetableImport/draft";
import { resolveLiveImageSources } from "@/lib/ai/attachments/liveImageRegistry";
import { cn } from "@/lib/utils";

const DAY_LABELS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

interface TimetableImportPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposal: TimetableImportProposal;
  sourceAttachments: ReturnType<typeof resolveLiveImageSources>;
  onApply: (input: {
    skipCourseKeys: Set<string>;
    editableDraft: TimetableImportDraft;
    expectedFingerprint: string;
    pendingBell: BellScheduleTemplate | null;
  }) => void;
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

/** 深度拷贝 draft（editableDraft 独立于 originalProposal） */
function cloneDraft(draft: TimetableImportDraft): TimetableImportDraft {
  return {
    summary: draft.summary,
    courses: draft.courses.map((c) => ({
      ...c,
      slots: c.slots.map((s) => ({ ...s })),
    })),
    pendingItems: draft.pendingItems?.map((p) => ({ ...p })),
  };
}

export function TimetableImportPreviewDialog({
  open,
  onOpenChange,
  proposal,
  sourceAttachments,
  onApply,
  onViewImage,
}: TimetableImportPreviewDialogProps) {
  // editableDraft：用户在 Dialog 内的修改（绝不 mutate originalProposal / Store）
  const [editableDraft, setEditableDraft] = useState<TimetableImportDraft>(() => cloneDraft(proposal.draft));
  const [editingCourseKey, setEditingCourseKey] = useState<string | null>(null);
  const [bellEditorOpen, setBellEditorOpen] = useState(false);
  const [pendingBell, setPendingBell] = useState<BellScheduleTemplate | null>(null);
  const [skippedPendingIndexes, setSkippedPendingIndexes] = useState<Set<number>>(new Set());
  const store = useAppStore();
  const activeBell = pendingBell ?? store.bellSchedules.find((b) => b.id === store.activeBellScheduleId) ?? null;

  // currentPreflight：基于 normalize(editableDraft) + 最新 Store + 当前 Bell 实时重算
  const currentPreflight = useMemo(() => {
    const state = useAppStore.getState();
    const normalized = normalizeTimetableImportDraft(editableDraft);
    return preflightScheduleImport(
      {
        courses: normalized.courses,
        existingCourses: state.courses.map((c) => ({ name: c.name, code: c.code, teacher: c.teacher })),
        existingSchedules: state.schedules,
        bell: activeBell ? { id: activeBell.id, name: activeBell.name, periods: activeBell.periods } : null,
      },
      { strictWeeks: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editableDraft, activeBell, store.courses, store.schedules]);

  // skip 初始状态：duplicate-course 默认 skip（与 preflight 文案一致）
  const [skip, setSkip] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    proposal.preview.issues
      .filter((i) => i.code === "duplicate-course" && i.courseKey)
      .forEach((i) => initial.add(i.courseKey!));
    return initial;
  });

  if (!open) return null;

  const counts = currentPreflight.counts;
  const issues = currentPreflight.issues;
  const blockers = issues.filter((i) => i.severity === "blocker");
  const warnings = issues.filter((i) => i.severity === "warning");
  const selectedCourses = editableDraft.courses.filter((c) => !skip.has(c.draftKey));

  const pendingItems = editableDraft.pendingItems ?? [];
  const unresolvedPendingCount = pendingItems.filter((_, i) => !skippedPendingIndexes.has(i)).length;

  const toggleSkip = (key: string) => {
    setSkip((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateCourse = (key: string, patch: Partial<TimetableImportDraft["courses"][number]>) => {
    setEditableDraft((d) => ({
      ...d,
      courses: d.courses.map((c) => (c.draftKey === key ? { ...c, ...patch } : c)),
    }));
  };

  const updateSlot = (courseKey: string, slotIndex: number, patch: Partial<TimetableImportDraft["courses"][number]["slots"][number]>) => {
    setEditableDraft((d) => ({
      ...d,
      courses: d.courses.map((c) =>
        c.draftKey === courseKey
          ? { ...c, slots: c.slots.map((s, i) => (i === slotIndex ? { ...s, ...patch } : s)) }
          : c
      ),
    }));
  };

  const saveBell = (template: BellScheduleTemplate) => {
    const state = useAppStore.getState();
    state.upsertBellSchedule(template);
    state.setActiveBellSchedule(template.id);
    setPendingBell(template);
  };

  const handleApply = () => {
    onApply({
      skipCourseKeys: skip,
      editableDraft,
      expectedFingerprint: currentPreflight.fingerprint,
      pendingBell,
    });
    onOpenChange(false);
  };

  const applyDisabled = blockers.length > 0 || selectedCourses.length === 0 || unresolvedPendingCount > 0;

  return (
    <div className="fixed inset-x-0 bottom-0 top-[var(--titlebar-h)] z-[90] bg-black/40 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-2xl max-h-full flex flex-col bg-surface border border-line rounded-2xl shadow-drawer overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line-soft shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-charcoal">课表导入预览</h3>
            <p className="text-[10px] text-sandrift mt-0.5">
              识别到 {editableDraft.courses.length} 门课程 ·{" "}
              {editableDraft.courses.reduce((n, c) => n + c.slots.length, 0)} 个上课时段
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

          {/* 课程分组预览（可编辑） */}
          {editableDraft.courses.map((course) => {
            const skipped = skip.has(course.draftKey);
            const editing = editingCourseKey === course.draftKey;
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
                    {editing ? (
                      <div className="space-y-1.5">
                        <input
                          value={course.name}
                          onChange={(e) => updateCourse(course.draftKey, { name: e.target.value })}
                          className="w-full h-7 rounded-lg border border-line bg-white px-2 text-xs font-semibold focus:outline-none focus:border-line-strong"
                          aria-label="课程名称"
                        />
                        <div className="flex gap-1.5">
                          <input
                            value={course.teacher ?? ""}
                            onChange={(e) => updateCourse(course.draftKey, { teacher: e.target.value })}
                            placeholder="教师"
                            className="flex-1 h-7 rounded-lg border border-line bg-white px-2 text-[11px] focus:outline-none focus:border-line-strong"
                            aria-label="教师"
                          />
                          <input
                            value={course.code ?? ""}
                            onChange={(e) => updateCourse(course.draftKey, { code: e.target.value })}
                            placeholder="课程代码"
                            className="flex-1 h-7 rounded-lg border border-line bg-white px-2 text-[11px] focus:outline-none focus:border-line-strong"
                            aria-label="课程代码"
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs font-bold text-charcoal truncate">
                          {course.name}
                          {course.code ? <span className="ml-1.5 text-[10px] font-mono text-sandrift">{course.code}</span> : null}
                        </p>
                        <p className="text-[10px] text-satin-grey truncate">
                          {[course.teacher, course.classroom].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingCourseKey(editing ? null : course.draftKey)}
                    className={cn(
                      "shrink-0 flex items-center gap-1 text-[10px] font-bold rounded-lg px-2 h-6 transition-colors",
                      editing ? "text-white bg-charcoal" : "text-sandrift hover:text-charcoal hover:bg-alabaster"
                    )}
                    aria-label={editing ? "完成编辑" : "编辑课程"}
                  >
                    <Pencil className="w-3 h-3" />
                    {editing ? "完成" : "编辑"}
                  </button>
                  {courseBlockers.length > 0 && (
                    <span className="shrink-0 text-[10px] font-bold text-danger">需处理</span>
                  )}
                </div>
                <div className="mt-2 space-y-1">
                  {course.slots.map((slot, i) => {
                    const resolved = currentPreflight.resolvedCourses
                      .find((c) => c.draftKey === course.draftKey)
                      ?.slots.find((s) => s.sourceSlotIndex === i);
                    return editing ? (
                      <div key={i} className="flex flex-wrap items-center gap-1.5">
                        <select
                          value={slot.dayOfWeek}
                          onChange={(e) => updateSlot(course.draftKey, i, { dayOfWeek: Number(e.target.value) })}
                          className="h-6 rounded-lg border border-line bg-white px-1 text-[10px] focus:outline-none"
                          aria-label="星期"
                        >
                          {DAY_LABELS.slice(1).map((d, idx) => (
                            <option key={idx + 1} value={idx + 1}>{d}</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={slot.periodStart ?? ""}
                          onChange={(e) => updateSlot(course.draftKey, i, { periodStart: e.target.value ? Number(e.target.value) : undefined })}
                          placeholder="起始节"
                          className="w-14 h-6 rounded-lg border border-line bg-white px-1 text-[10px] focus:outline-none"
                          aria-label="起始节次"
                        />
                        <span className="text-[10px] text-sandrift">–</span>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={slot.periodEnd ?? ""}
                          onChange={(e) => updateSlot(course.draftKey, i, { periodEnd: e.target.value ? Number(e.target.value) : undefined })}
                          placeholder="结束节"
                          className="w-14 h-6 rounded-lg border border-line bg-white px-1 text-[10px] focus:outline-none"
                          aria-label="结束节次"
                        />
                        <input
                          value={slot.weekExpression ?? ""}
                          onChange={(e) => updateSlot(course.draftKey, i, { weekExpression: e.target.value })}
                          placeholder="周次（如 1-5,7-17）"
                          className="w-28 h-6 rounded-lg border border-line bg-white px-1 text-[10px] focus:outline-none"
                          aria-label="周次"
                        />
                        <input
                          value={slot.location ?? ""}
                          onChange={(e) => updateSlot(course.draftKey, i, { location: e.target.value })}
                          placeholder="教室"
                          className="w-24 h-6 rounded-lg border border-line bg-white px-1 text-[10px] focus:outline-none"
                          aria-label="教室"
                        />
                      </div>
                    ) : (
                      <div key={i} className="flex items-center gap-2 text-[11px] text-satin-grey">
                        <CalendarClock className="w-3 h-3 text-sandrift shrink-0" />
                        <span className="font-semibold text-charcoal shrink-0 w-8">{DAY_LABELS[slot.dayOfWeek] ?? "?"}</span>
                        <span className="shrink-0">
                          {resolved ? `${resolved.startTime}–${resolved.endTime}` : `第${slot.periodStart ?? "?"}节`}
                        </span>
                        <span className="shrink-0">{slot.weekExpression || "待补充"}</span>
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

          {/* Pending items：必须 resolved 或明确跳过才能 Apply */}
          {pendingItems.length > 0 && (
            <div className="rounded-xl border border-warning-border bg-warning-bg/40 px-3 py-2.5 space-y-1.5">
              <p className="text-[11px] font-bold text-warning">待确认事项（{unresolvedPendingCount} 项未处理）</p>
              {pendingItems.map((item, i) => {
                const skippedItem = skippedPendingIndexes.has(i);
                return (
                  <div key={i} className={cn("flex items-start gap-2", skippedItem && "opacity-50")}>
                    <p className={cn("flex-1 text-[10px]", skippedItem ? "text-satin-grey line-through" : "text-satin-grey")}>
                      {item.description}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setSkippedPendingIndexes((prev) => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          return next;
                        })
                      }
                      className={cn(
                        "shrink-0 text-[10px] font-bold rounded-lg px-2 h-5 transition-colors",
                        skippedItem ? "text-sandrift hover:text-charcoal" : "text-white bg-warning"
                      )}
                    >
                      {skippedItem ? "恢复" : "忽略此项"}
                    </button>
                  </div>
                );
              })}
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
            {counts.blockers > 0 ? `（${counts.blockers} 项需处理）` : ""}
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
              disabled={applyDisabled}
              onClick={handleApply}
              className={cn(
                "flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-[11px] font-bold text-white transition-colors",
                applyDisabled ? "bg-satin-grey/50 cursor-not-allowed" : "bg-charcoal hover:bg-black"
              )}
            >
              <Check className="w-3.5 h-3.5" />
              {unresolvedPendingCount > 0
                ? `还有 ${unresolvedPendingCount} 项需确认`
                : `导入所选课程`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
