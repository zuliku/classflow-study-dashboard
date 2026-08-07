"use client";

import React, { useState } from "react";
import { X, BookOpen, Clock, Calendar, Plus, Trash2 } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

const COLOR_OPTIONS = [
  { name: "薄荷灰绿", bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032" },
  { name: "象牙浅米", bgHex: "#F0EBE1", borderHex: "#E0D7C6", textHex: "#313032" },
  { name: "灰米暖调", bgHex: "#CCCBC4", borderHex: "#B8B7B0", textHex: "#313032" },
  { name: "石褐沙土", bgHex: "#CDB9AB", borderHex: "#BBA494", textHex: "#313032" },
  { name: "深砂棕", bgHex: "#A48F82", borderHex: "#8D786B", textHex: "#FFFFFF" },
];

const WEEK_RANGE_PRESETS = [
  { label: "1-16周 (全学期)", value: "1-16周" },
  { label: "1-8周 (前半学期)", value: "1-8周" },
  { label: "9-16周 (后半学期)", value: "9-16周" },
  { label: "单周 (1,3,5,7,9...)", value: "单周" },
  { label: "双周 (2,4,6,8,10...)", value: "双周" },
];

interface SlotInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  location: string;
  weeks: string;
}

export function AddCourseModal() {
  const { isAddCourseModalOpen, setAddCourseModalOpen, addCourseWithSchedule } = useAppStore();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [teacher, setTeacher] = useState("");
  const [classroom, setClassroom] = useState("");
  const [credit, setCredit] = useState(3);
  const [description, setDescription] = useState("");
  const [colorIndex, setColorIndex] = useState(0);

  // Multi-slot schedule state (支持一门课多个上课时间)
  const [scheduleSlots, setScheduleSlots] = useState<SlotInput[]>([
    { dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "", weeks: "1-16周" },
  ]);

  if (!isAddCourseModalOpen) return null;

  const handleAddSlot = () => {
    setScheduleSlots([
      ...scheduleSlots,
      { dayOfWeek: 3, startTime: "10:00", endTime: "11:40", location: classroom, weeks: "1-16周" },
    ]);
  };

  const handleRemoveSlot = (index: number) => {
    if (scheduleSlots.length === 1) return;
    setScheduleSlots(scheduleSlots.filter((_, i) => i !== index));
  };

  const handleSlotChange = (index: number, field: keyof SlotInput, value: any) => {
    const updated = [...scheduleSlots];
    updated[index] = { ...updated[index], [field]: value };
    setScheduleSlots(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const color = COLOR_OPTIONS[colorIndex];
    const defaultLocation = classroom || "教二 201";

    const formattedSlots = scheduleSlots.map((s) => ({
      dayOfWeek: Number(s.dayOfWeek),
      startTime: s.startTime,
      endTime: s.endTime,
      location: s.location || defaultLocation,
      weeks: s.weeks,
    }));

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
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-drawer border border-[#E7E3DD] overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 px-6 border-b border-[#F0EBE1] bg-[#F7F5F5] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <BookOpen className="w-4 h-4 text-[#A48F82]" />
            <h3 className="text-base font-bold text-charcoal">添加新课程与排课</h3>
          </div>
          <button
            onClick={() => setAddCourseModalOpen(false)}
            className="p-1 rounded-lg text-[#8C827A] hover:bg-[#E0D7C6] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-bold text-[#8C827A]">课程名称 *</label>
              <input
                type="text"
                placeholder="例如: 行为经济学"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none focus:border-charcoal text-charcoal"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-[#8C827A]">课程代码</label>
              <input
                type="text"
                placeholder="例如: ECON-305"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none focus:border-charcoal text-charcoal font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="font-bold text-[#8C827A]">授课教师</label>
              <input
                type="text"
                placeholder="教师姓名"
                value={teacher}
                onChange={(e) => setTeacher(e.target.value)}
                className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-[#8C827A]">默认教室</label>
              <input
                type="text"
                placeholder="例如: 教二 401"
                value={classroom}
                onChange={(e) => setClassroom(e.target.value)}
                className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-[#8C827A]">学分</label>
              <input
                type="number"
                min="1"
                max="10"
                value={credit}
                onChange={(e) => setCredit(Number(e.target.value))}
                className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none"
              />
            </div>
          </div>

          {/* Dynamic Schedule Slots List (支持一门课多个上课时间) */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-charcoal flex items-center">
                <Clock className="w-3.5 h-3.5 mr-1 text-[#A48F82]" /> 上课时间与周次 ({scheduleSlots.length} 时段)
              </h4>
              <button
                type="button"
                onClick={handleAddSlot}
                className="flex items-center space-x-1 text-[11px] font-bold text-charcoal bg-[#E3E6E0] hover:bg-[#D0D5CC] px-2.5 py-1 rounded-lg transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>添加上课时段</span>
              </button>
            </div>

            <div className="space-y-2.5">
              {scheduleSlots.map((slot, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-[#F0EBE1]/60 border border-[#E0D7C6] rounded-xl space-y-2 relative"
                >
                  <div className="flex items-center justify-between border-b border-[#E0D7C6]/60 pb-1.5 text-[11px]">
                    <span className="font-bold text-[#8C827A]">时段 #{idx + 1}</span>
                    {scheduleSlots.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveSlot(idx)}
                        className="text-[#D94F4F] hover:bg-[#FDF0F0] p-0.5 rounded transition-colors"
                        title="删除此时段"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-[#8C827A]">周次规则</label>
                      <select
                        value={slot.weeks}
                        onChange={(e) => handleSlotChange(idx, "weeks", e.target.value)}
                        className="w-full p-1.5 bg-white border border-[#E0D7C6] rounded-lg focus:outline-none text-[11px]"
                      >
                        {WEEK_RANGE_PRESETS.map((preset) => (
                          <option key={preset.value} value={preset.value}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] text-[#8C827A]">星期</label>
                      <select
                        value={slot.dayOfWeek}
                        onChange={(e) => handleSlotChange(idx, "dayOfWeek", Number(e.target.value))}
                        className="w-full p-1.5 bg-white border border-[#E0D7C6] rounded-lg focus:outline-none text-[11px]"
                      >
                        <option value={1}>周一</option>
                        <option value={2}>周二</option>
                        <option value={3}>周三</option>
                        <option value={4}>周四</option>
                        <option value={5}>周五</option>
                        <option value={6}>周六</option>
                        <option value={7}>周日</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-[#8C827A]">开始时间</label>
                      <input
                        type="time"
                        value={slot.startTime}
                        onChange={(e) => handleSlotChange(idx, "startTime", e.target.value)}
                        className="w-full p-1.5 bg-white border border-[#E0D7C6] rounded-lg focus:outline-none font-mono text-[11px]"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#8C827A]">结束时间</label>
                      <input
                        type="time"
                        value={slot.endTime}
                        onChange={(e) => handleSlotChange(idx, "endTime", e.target.value)}
                        className="w-full p-1.5 bg-white border border-[#E0D7C6] rounded-lg focus:outline-none font-mono text-[11px]"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#8C827A]">教室 (选填)</label>
                      <input
                        type="text"
                        placeholder={classroom || "教室"}
                        value={slot.location}
                        onChange={(e) => handleSlotChange(idx, "location", e.target.value)}
                        className="w-full p-1.5 bg-white border border-[#E0D7C6] rounded-lg focus:outline-none text-[11px]"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Color Theme Selector */}
          <div className="space-y-1.5 pt-1">
            <label className="font-bold text-[#8C827A]">卡片主题配色</label>
            <div className="flex space-x-2">
              {COLOR_OPTIONS.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setColorIndex(i)}
                  className={`w-8 h-8 rounded-xl border flex items-center justify-center transition-all ${
                    colorIndex === i ? "ring-2 ring-charcoal ring-offset-1 scale-105" : ""
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
          <div className="space-y-1">
            <label className="font-bold text-[#8C827A]">课程说明</label>
            <textarea
              rows={2}
              placeholder="备注 / 课程说明..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-2 pt-2 border-t border-[#F0EBE1]">
            <button
              type="button"
              onClick={() => setAddCourseModalOpen(false)}
              className="px-4 py-2 text-xs font-medium text-[#676268] bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl hover:bg-[#E0D7C6]"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-charcoal rounded-xl hover:bg-black font-bold"
            >
              保存并创建
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
