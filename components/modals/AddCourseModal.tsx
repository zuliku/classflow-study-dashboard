"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, BookOpen, Clock, Plus, Trash2 } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { WEEK_RANGE_PRESETS, isValidTimeRange } from "@/lib/schedule";
import { findScheduleConflicts } from "@/lib/conflicts";
import { COURSE_COLOR_OPTIONS } from "@/lib/courseAppearance";


import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { UISelect } from "@/components/ui/Select";




const COLOR_OPTIONS = COURSE_COLOR_OPTIONS;

interface SlotInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  location: string;
  weeks: string;
}

export function AddCourseModal() {
  const { isAddCourseModalOpen, setAddCourseModalOpen, addCourseWithSchedule, schedules, courses } = useAppStore();
  const pushToast = useToastStore((s) => s.pushToast);
  const submittingRef = useRef(false);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [teacher, setTeacher] = useState("");
  const [classroom, setClassroom] = useState("");
  const [credit, setCredit] = useState(3);
  const [description, setDescription] = useState("");
  const [colorIndex, setColorIndex] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);

  // Multi-slot schedule state (支持一门课多个上课时间)
  const [scheduleSlots, setScheduleSlots] = useState<SlotInput[]>([
    { dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "", weeks: "1-16周" },
  ]);

  const handleAddSlot = () => {
    setFormError(null);
    setScheduleSlots([
      ...scheduleSlots,
      { dayOfWeek: 3, startTime: "10:00", endTime: "11:40", location: classroom, weeks: "1-16周" },
    ]);
  };

  const handleRemoveSlot = (index: number) => {
    if (scheduleSlots.length === 1) return;
    setFormError(null);
    setScheduleSlots(scheduleSlots.filter((_, i) => i !== index));
  };

  const handleSlotChange = (index: number, field: keyof SlotInput, value: string | number) => {
    const updated = [...scheduleSlots];
    updated[index] = { ...updated[index], [field]: value };
    setScheduleSlots(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submittingRef.current) return;
    submittingRef.current = true;

    // 槽位基础校验（星期/时间/周次），错误不写入 Store
    for (let i = 0; i < scheduleSlots.length; i++) {
      const s = scheduleSlots[i];
      if (!Number.isInteger(s.dayOfWeek) || s.dayOfWeek < 1 || s.dayOfWeek > 7) {
        setFormError(`时段 #${i + 1}：星期必须为 1-7`);
        return;
      }
      if (!isValidTimeRange(s.startTime, s.endTime)) {
        setFormError(`时段 #${i + 1}：时间格式非法或结束时间需晚于开始时间`);
        return;
      }
      if (!s.weeks.trim()) {
        setFormError(`时段 #${i + 1}：周次不能为空`);
        return;
      }
    }

    const color = COLOR_OPTIONS[colorIndex];
    const defaultLocation = classroom || "教二 201";

    const formattedSlots: SlotInput[] = scheduleSlots.map((s) => ({
      dayOfWeek: Number(s.dayOfWeek),
      startTime: s.startTime,
      endTime: s.endTime,
      location: s.location || defaultLocation,
      weeks: s.weeks,
    }));

    // 冲突检测：新时段 vs 现有课表（与 CourseDetailDrawer 同一套 findScheduleConflicts）
    const candidates = formattedSlots.map((s, idx) => ({
      id: `__candidate_${idx}`,
      courseId: "__new_course__",
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      location: s.location,
      weeks: s.weeks,
    }));
    const candidateIds = new Set(candidates.map((c) => c.id));
    const conflict = findScheduleConflicts([...schedules, ...candidates]).find(
      (c) => candidateIds.has(c.scheduleA.id) || candidateIds.has(c.scheduleB.id)
    );
    if (conflict) {
      const other = candidateIds.has(conflict.scheduleA.id) ? conflict.scheduleB : conflict.scheduleA;
      const otherCourse = courses.find((x) => x.id === other.courseId);
      const dayLabel = ["一", "二", "三", "四", "五", "六", "日"][other.dayOfWeek - 1];
      setFormError(
        `与现有课程《${otherCourse?.name || "未知课程"}》周${dayLabel} ${other.startTime}–${other.endTime} 存在时间冲突，已阻止添加`
      );
      return;
    }

    setFormError(null);
    addCourseWithSchedule(
      {
        name,
        code: code || `COURSE-${Math.floor(Math.random() * 900 + 100)}`,
        teacher: teacher || "待定",
        classroom: defaultLocation,
        credit: Number(credit),
        bgHex: color.bgHex,
        borderHex: color.borderHex,
        textHex: color.textHex,
        description,
      },
      formattedSlots
    );

    setName("");
    setCode("");
    setTeacher("");
    setClassroom("");
    setAddCourseModalOpen(false);
    submittingRef.current = false;
    pushToast({ message: "课程已创建" });
  };

  return (
    <Dialog
      open={isAddCourseModalOpen}
      onOpenChange={(next) => {
        if (!next) setAddCourseModalOpen(false);
      }}
      overlayId="add-course-modal"
      stackZ={50}
      aria-label="添加课程"
      className="max-w-lg max-h-[90dvh]"
    >
        {/* Header */}
        <div className="p-4 px-6 border-b border-[#F0EBE1] bg-[#F7F5F5] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <BookOpen className="w-4 h-4 text-[#A48F82]" />
            <h3 className="text-base font-bold text-charcoal">添加课程</h3>
          </div>
          <button
            onClick={() => setAddCourseModalOpen(false)}
            className="p-1 rounded-lg text-sandrift hover:bg-alba transition-colors"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="课程名称" required htmlFor="course-name">
              <Input
                id="course-name"
                type="text"
                placeholder="如：行为经济学"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </Field>
            <Field label="课程代码">
              <Input
                type="text"
                placeholder="如：ECON-305"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                mono
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="授课教师">
              <Input
                type="text"
                placeholder="教师姓名"
                value={teacher}
                onChange={(e) => setTeacher(e.target.value)}
              />
            </Field>
            <Field label="默认教室">
              <Input
                type="text"
                placeholder="如：教二 401"
                value={classroom}
                onChange={(e) => setClassroom(e.target.value)}
              />
            </Field>
            <Field label="学分">
              <Input
                type="number"
                min="1"
                max="10"
                value={credit}
                onChange={(e) => setCredit(Number(e.target.value))}
              />
            </Field>
          </div>

          {/* Dynamic Schedule Slots List (支持一门课多个上课时间) */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <h4 className="text-[12px] font-bold text-charcoal flex items-center">
                <Clock className="w-3.5 h-3.5 mr-1 text-[#A48F82]" /> 上课时间与周次 ({scheduleSlots.length} 时段)
              </h4>
              <Button
                type="button"
                variant="accent"
                size="sm"
                onClick={handleAddSlot}
                className="h-7 px-2.5 text-[11px]"
              >
                <Plus className="w-3 h-3" />
                <span>添加上课时段</span>
              </Button>
            </div>

            <div className="space-y-2.5">
              {scheduleSlots.map((slot, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-alabaster/60 border border-line-strong rounded-xl space-y-2 relative"
                >
                  <div className="flex items-center justify-between border-b border-line-strong/60 pb-1.5 text-[11px]">
                    <span className="font-bold text-sandrift">时段 #{idx + 1}</span>
                    {scheduleSlots.length > 1 && (
                      <IconButton
                        variant="danger"
                        size="sm"
                        type="button"
                        onClick={() => handleRemoveSlot(idx)}
                        aria-label="删除此时段"
                        title="删除此时段"
                        className="h-7 w-7"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconButton>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-sandrift">周次规则</label>
                      <UISelect
                        value={slot.weeks}
                        onChange={(v) => handleSlotChange(idx, "weeks", v)}
                        ariaLabel="周次规则"
                        options={WEEK_RANGE_PRESETS}
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-sandrift">星期</label>
                      <UISelect<number>
                        value={slot.dayOfWeek}
                        onChange={(v) => handleSlotChange(idx, "dayOfWeek", v)}
                        ariaLabel="星期"
                        options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({
                          value: d,
                          label: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][d - 1],
                        }))}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-sandrift">开始时间</label>
                      <Input
                        type="time"
                        value={slot.startTime}
                        onChange={(e) => handleSlotChange(idx, "startTime", e.target.value)}
                        className="bg-white border-line-strong font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-sandrift">结束时间</label>
                      <Input
                        type="time"
                        value={slot.endTime}
                        onChange={(e) => handleSlotChange(idx, "endTime", e.target.value)}
                        className="bg-white border-line-strong font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-sandrift">教室 (选填)</label>
                      <Input
                        type="text"
                        placeholder={classroom || "教室"}
                        value={slot.location}
                        onChange={(e) => handleSlotChange(idx, "location", e.target.value)}
                        className="bg-white border-line-strong"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Color Theme Selector（业务特定 UI：保留色块按钮模型，仅统一 focus/size/radius/selected ring） */}
          <div className="space-y-1.5 pt-1">
            <label className="text-[11px] font-bold text-charcoal">卡片主题配色</label>
            <div className="flex space-x-2">
              {COLOR_OPTIONS.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setColorIndex(i)}
                  className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] focus-visible:outline-2 focus-visible:outline-charcoal/30 focus-visible:outline-offset-1 ${
                    colorIndex === i ? "ring-2 ring-charcoal ring-offset-1" : ""
                  }`}
                  style={{ backgroundColor: c.bgHex, borderColor: c.borderHex }}
                  title={c.name}
                >
                  {colorIndex === i && <span className="text-[10px] text-charcoal font-bold">✓</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <Field label="课程说明">
            <Textarea
              rows={2}
              placeholder="课程说明"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          {/* Actions */}
          {formError && (
            <p className="text-[11px] text-danger font-bold p-2.5 bg-danger-bg border border-danger-border rounded-xl">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-[#F0EBE1]">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setAddCourseModalOpen(false)}
            >
              取消
            </Button>
            <Button type="submit" variant="primary" size="sm">
              创建课程
            </Button>
          </div>
        </form>
      </Dialog>
  );
}
