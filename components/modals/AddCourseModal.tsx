"use client";

import React, { useState } from "react";
import { X, BookOpen, Clock, Calendar } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

const COLOR_OPTIONS = [
  { name: "薄荷灰绿 (Pastel Mint)", bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032" },
  { name: "象牙浅米 (Alabaster)", bgHex: "#F0EBE1", borderHex: "#E0D7C6", textHex: "#313032" },
  { name: "灰米暖调 (Ashy Beige)", bgHex: "#CCCBC4", borderHex: "#B8B7B0", textHex: "#313032" },
  { name: "石褐沙土 (Stone Beige)", bgHex: "#CDB9AB", borderHex: "#BBA494", textHex: "#313032" },
  { name: "深砂棕 (Sandrift)", bgHex: "#A48F82", borderHex: "#8D786B", textHex: "#FFFFFF" },
];

const WEEK_RANGE_PRESETS = [
  { label: "1-16周 (全学期)", value: "1-16周" },
  { label: "1-8周 (前半学期)", value: "1-8周" },
  { label: "9-16周 (后半学期)", value: "9-16周" },
  { label: "单周 (1,3,5,7,9...)", value: "单周" },
  { label: "双周 (2,4,6,8,10...)", value: "双周" },
  { label: "1-6周", value: "1-6周" },
  { label: "10-14周", value: "10-14周" },
];

export function AddCourseModal() {
  const { isAddCourseModalOpen, setAddCourseModalOpen, addCourseWithSchedule } = useAppStore();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [teacher, setTeacher] = useState("");
  const [classroom, setClassroom] = useState("");
  const [credit, setCredit] = useState(3);
  const [description, setDescription] = useState("");
  const [colorIndex, setColorIndex] = useState(0);

  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("09:40");
  const [weeksRange, setWeeksRange] = useState("1-16周");

  if (!isAddCourseModalOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const color = COLOR_OPTIONS[colorIndex];

    addCourseWithSchedule(
      {
        name,
        code: code || `COURSE-${Math.floor(Math.random() * 900 + 100)}`,
        teacher: teacher || "待定",
        classroom: classroom || "待定",
        credit: Number(credit),
        bgHex: color.bgHex,
        borderHex: color.borderHex,
        textHex: color.textHex,
        description,
      },
      [{ dayOfWeek: Number(dayOfWeek), startTime, endTime, weeks: weeksRange }]
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
            <h3 className="text-base font-bold text-charcoal">添加新课程与排课周次</h3>
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
              <label className="font-bold text-[#8C827A]">上课教室</label>
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

          {/* Schedule Time Slot & Week Range */}
          <div className="p-3.5 bg-[#F0EBE1]/60 border border-[#E0D7C6] rounded-xl space-y-3">
            <h4 className="font-bold text-charcoal flex items-center justify-between">
              <span className="flex items-center">
                <Clock className="w-3.5 h-3.5 mr-1 text-[#A48F82]" /> 上课时间与周次区间
              </span>
            </h4>

            {/* Week Range Selector */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-[#8C827A] flex items-center">
                <Calendar className="w-3 h-3 mr-1" /> 上课周次区间（支持单双周与非衔接区间）
              </label>
              <select
                value={weeksRange}
                onChange={(e) => setWeeksRange(e.target.value)}
                className="w-full p-2 bg-white border border-[#E0D7C6] rounded-lg focus:outline-none font-semibold text-charcoal"
              >
                {WEEK_RANGE_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-[#8C827A]">星期</label>
                <select
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  className="w-full p-2 bg-white border border-[#E0D7C6] rounded-lg focus:outline-none"
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
              <div>
                <label className="text-[10px] text-[#8C827A]">开始时间</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full p-2 bg-white border border-[#E0D7C6] rounded-lg focus:outline-none font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#8C827A]">结束时间</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full p-2 bg-white border border-[#E0D7C6] rounded-lg focus:outline-none font-mono"
                />
              </div>
            </div>
          </div>

          {/* Color Theme Selector */}
          <div className="space-y-1.5">
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
            <label className="font-bold text-[#8C827A]">课程简介</label>
            <textarea
              rows={2}
              placeholder="课程大纲与要求..."
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
              className="px-4 py-2 text-xs font-medium text-white bg-charcoal rounded-xl hover:bg-black"
            >
              保存并创建
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
