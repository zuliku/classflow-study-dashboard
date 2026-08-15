"use client";

import React, { useEffect, useRef, useState } from "react";
import { PencilLine, Plus, Trash2, X } from "lucide-react";
import { CourseSchedule } from "@/types";
import { WEEK_RANGE_PRESETS } from "@/lib/schedule";
import { UISelect } from "@/components/ui/Select";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/utils";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";

export interface ScheduleForm {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  location: string;
  weeks: string;
}

const DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7].map((d) => ({
  value: d,
  label: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][d - 1],
}));

/** 周次选择：预设下拉 + 自定义输入（自定义状态由 value 是否命中预设推导） */
function WeeksSelect({ value, onChange }: { value: string; onChange: (weeks: string) => void }) {
  const isCustom = !WEEK_RANGE_PRESETS.some((p) => p.value === value);
  return (
    <div className="space-y-1">
      <UISelect
        value={isCustom ? "__custom__" : value}
        onChange={(v) => onChange(v === "__custom__" ? value : v)}
        ariaLabel="周次规则"
        options={[
          ...WEEK_RANGE_PRESETS.map((p) => ({ value: p.value, label: p.label })),
          { value: "__custom__", label: "自定义…" },
        ]}
        triggerClassName="bg-[#F7F5F5] text-[11px]"
      />
      {isCustom && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="如 1-8周 / 单周 / 5-5周"
          aria-label="自定义周次"
          className="w-full rounded-lg border border-line-strong bg-[#F7F5F5] p-1.5 text-[11px] focus:outline-none"
        />
      )}
    </div>
  );
}

/**
 * Course Schedule Section（Course Detail V2）：
 * - Add form 默认 CLOSED（DisclosureRegion）；Quick Action 联动展开 + scroll + focus
 * - 同一时间只允许一个 editor：Add form 与 Edit existing slot 互斥
 * - Row 轻量 divider；excludedWeeks 以 muted warning 展示
 * - 冲突/验证 Domain 保留在 orchestration（onAddSlot/onUpdateSlot 返回错误文案）
 */
export function CourseScheduleSection({
  schedules,
  courseClassroom,
  addSlotOpen,
  onAddSlotOpenChange,
  autoFocusKey,
  onAddSlot,
  onUpdateSlot,
  onDeleteSlot,
  newIds,
  sectionRef,
}: {
  schedules: CourseSchedule[];
  courseClassroom: string;
  addSlotOpen: boolean;
  onAddSlotOpenChange: (open: boolean) => void;
  /** >0 变化时：展开 Add form 并 focus 第一个字段（Quick Action 联动） */
  autoFocusKey: number;
  onAddSlot: (form: ScheduleForm) => string | null;
  onUpdateSlot: (id: string, form: ScheduleForm) => string | null;
  onDeleteSlot: (sched: CourseSchedule) => void;
  newIds: Set<string>;
  sectionRef?: React.Ref<HTMLDivElement>;
}) {
  const reducedMotion = useEffectiveReducedMotion();

  // Add form state
  const [addForm, setAddForm] = useState<ScheduleForm>({
    dayOfWeek: 1,
    startTime: "08:00",
    endTime: "09:40",
    location: "",
    weeks: "1-16周",
  });
  const [addError, setAddError] = useState<string | null>(null);

  // Edit slot state（与 Add form 互斥）
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ScheduleForm>({
    dayOfWeek: 1,
    startTime: "08:00",
    endTime: "09:40",
    location: "",
    weeks: "1-16周",
  });
  const [editError, setEditError] = useState<string | null>(null);

  // Quick Action 联动：展开 + 滚到 section + focus 星期字段
  const lastAutoFocusKey = useRef(autoFocusKey);
  useEffect(() => {
    if (autoFocusKey === lastAutoFocusKey.current) return;
    lastAutoFocusKey.current = autoFocusKey;
    if (autoFocusKey <= 0) return;
    onAddSlotOpenChange(true);
    setEditingSlotId(null);
    setEditError(null);
    setAddError(null);
    // form 挂载有微小延迟（DisclosureRegion presence）：最多重试 3 次
    let attempts = 0;
    let timer = 0;
    const focusDaySelect = () => {
      const el = document.querySelector<HTMLButtonElement>('[data-testid="schedule-add-day"]');
      if (el) {
        el.focus();
        return;
      }
      attempts += 1;
      if (attempts < 3) timer = window.setTimeout(focusDaySelect, 80);
    };
    timer = window.setTimeout(focusDaySelect, reducedMotion ? 0 : 80);
    return () => window.clearTimeout(timer);
  }, [autoFocusKey, onAddSlotOpenChange, reducedMotion]);

  const openAddForm = () => {
    setEditingSlotId(null);
    setEditError(null);
    setAddError(null);
    onAddSlotOpenChange(true);
  };

  /** Disclosure trigger：再次点击收起 Add form（与 编辑 slot 互斥） */
  const toggleAddForm = () => {
    if (addSlotOpen) {
      setAddError(null);
      onAddSlotOpenChange(false);
      return;
    }
    openAddForm();
  };

  const handleSubmitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const error = onAddSlot(addForm);
    if (error) {
      setAddError(error);
      return;
    }
    setAddForm((f) => ({ ...f, location: "", weeks: "1-16周" }));
    setAddError(null);
  };

  const handleStartEditSlot = (sched: CourseSchedule) => {
    onAddSlotOpenChange(false);
    setAddError(null);
    setEditingSlotId(sched.id);
    setEditForm({
      dayOfWeek: sched.dayOfWeek,
      startTime: sched.startTime,
      endTime: sched.endTime,
      location: sched.location,
      weeks: sched.weeks,
    });
    setEditError(null);
  };

  const handleCancelEditSlot = () => {
    setEditingSlotId(null);
    setEditError(null);
  };

  const handleSaveSlotEdit = (sched: CourseSchedule) => {
    const error = onUpdateSlot(sched.id, editForm);
    if (error) {
      setEditError(error);
      return;
    }
    setEditingSlotId(null);
    setEditError(null);
  };

  return (
    <div ref={sectionRef} data-testid="course-schedule-section" className="space-y-2.5 scroll-mt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-charcoal">
          上课安排{" "}
          <span className="text-[11px] font-semibold text-sandrift">
            {schedules.length} 个时段
          </span>
        </h3>
        <button
          type="button"
          onClick={toggleAddForm}
          aria-expanded={addSlotOpen}
          className="ux-press flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal"
        >
          <Plus className="h-3.5 w-3.5" />
          添加时段
        </button>
      </div>

      {/* Add form：默认 CLOSED */}
      <DisclosureRegion open={addSlotOpen}>
        <form
          data-testid="schedule-add-form"
          onSubmit={handleSubmitAdd}
          className="space-y-2.5 rounded-xl border border-line bg-[#F7F5F5] p-3"
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-bold text-sandrift">星期</label>
              <UISelect<number>
                value={addForm.dayOfWeek}
                onChange={(v) => setAddForm({ ...addForm, dayOfWeek: v })}
                ariaLabel="星期"
                options={DAY_OPTIONS}
                testid="schedule-add-day"
                triggerClassName="bg-white border-line-strong text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold text-sandrift">周次</label>
              <WeeksSelect
                value={addForm.weeks}
                onChange={(weeks) => setAddForm({ ...addForm, weeks })}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input
              type="time"
              value={addForm.startTime}
              onChange={(e) => setAddForm({ ...addForm, startTime: e.target.value })}
              className="bg-white border-line-strong font-mono"
              aria-label="开始时间"
            />
            <Input
              type="time"
              value={addForm.endTime}
              onChange={(e) => setAddForm({ ...addForm, endTime: e.target.value })}
              className="bg-white border-line-strong font-mono"
              aria-label="结束时间"
            />
            <Input
              type="text"
              value={addForm.location}
              onChange={(e) => setAddForm({ ...addForm, location: e.target.value })}
              placeholder={courseClassroom || "教室"}
              className="bg-white border-line-strong"
              aria-label="教室"
            />
          </div>
          {addError && <p className="text-[11px] font-bold text-danger">{addError}</p>}
          <Button type="submit" variant="primary" size="sm" className="w-full">
            + 添加排课
          </Button>
        </form>
      </DisclosureRegion>

      {/* Slot rows / edit inline */}
      {schedules.length === 0 && !addSlotOpen ? (
        <button
          type="button"
          onClick={openAddForm}
          className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-[11px] font-semibold text-sandrift transition-colors hover:bg-alabaster hover:text-charcoal"
        >
          <span>暂无排课</span>
          <span className="flex items-center gap-1 font-bold">
            <Plus className="h-3.5 w-3.5" />
            添加时段
          </span>
        </button>
      ) : (
        <div className="divide-y divide-line-soft">
          {schedules.map((sched) => {
            if (editingSlotId === sched.id) {
              return (
                <div
                  key={sched.id}
                  data-testid="schedule-edit-form"
                  className="space-y-2.5 rounded-xl border border-[#CDB9AB] bg-[#F7F5F5] px-3 py-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-sandrift">编辑时段</span>
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
                      <label className="mb-1 block text-[10px] font-bold text-sandrift">星期</label>
                      <UISelect<number>
                        value={editForm.dayOfWeek}
                        onChange={(v) => setEditForm({ ...editForm, dayOfWeek: v })}
                        ariaLabel="星期"
                        options={DAY_OPTIONS}
                        triggerClassName="bg-white text-[11px]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-bold text-sandrift">周次</label>
                      <WeeksSelect
                        value={editForm.weeks}
                        onChange={(weeks) => setEditForm({ ...editForm, weeks })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Input
                      type="time"
                      value={editForm.startTime}
                      onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value })}
                      aria-label="开始时间"
                      className="bg-white font-mono"
                    />
                    <Input
                      type="time"
                      value={editForm.endTime}
                      onChange={(e) => setEditForm({ ...editForm, endTime: e.target.value })}
                      aria-label="结束时间"
                      className="bg-white font-mono"
                    />
                    <Input
                      type="text"
                      value={editForm.location}
                      onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                      placeholder={sched.location}
                      aria-label="教室"
                      className="bg-white"
                    />
                  </div>
                  {editError && <p className="text-[11px] font-bold text-danger">{editError}</p>}
                  <div className="flex justify-end gap-2">
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
                  "group flex items-center justify-between gap-2 px-1 py-2.5",
                  newIds.has(sched.id) && "animate-enter"
                )}
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="text-xs font-bold text-charcoal">
                    周{["一", "二", "三", "四", "五", "六", "日"][sched.dayOfWeek - 1]}{" "}
                    {sched.startTime}–{sched.endTime}
                  </p>
                  <p className="text-[11px] text-sandrift">
                    {[sched.location, sched.weeks].filter(Boolean).join(" · ") || "未填写"}
                    {sched.excludedWeeks && sched.excludedWeeks.length > 0 && (
                      <span className="text-[#A87952]"> · 停课：第 {sched.excludedWeeks.join("、")} 周</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => handleStartEditSlot(sched)}
                    aria-label={`编辑时段 周${["一", "二", "三", "四", "五", "六", "日"][sched.dayOfWeek - 1]} ${sched.startTime}`}
                    title="编辑此排课时段"
                    className="rounded-lg p-1.5 text-sandrift transition-colors hover:bg-alabaster hover:text-charcoal"
                  >
                    <PencilLine className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteSlot(sched)}
                    aria-label={`删除时段 周${["一", "二", "三", "四", "五", "六", "日"][sched.dayOfWeek - 1]} ${sched.startTime}`}
                    title="删除此排课时段"
                    className="rounded-lg p-1.5 text-sandrift transition-colors hover:bg-danger-bg hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
