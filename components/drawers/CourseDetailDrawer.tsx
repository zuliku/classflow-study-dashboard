"use client";

import React, { useState } from "react";
import {
  X,
  BookOpen,
  User,
  MapPin,
  Clock,
  Plus,
  FileText,
  Trash2,
  Edit2,
  Calendar,
  Save,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

const WEEK_NAMES = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const WEEK_RANGE_PRESETS = [
  { label: "1-16周 (全学期)", value: "1-16周" },
  { label: "1-8周 (前半学期)", value: "1-8周" },
  { label: "9-16周 (后半学期)", value: "9-16周" },
  { label: "单周 (1,3,5,7...)", value: "单周" },
  { label: "双周 (2,4,6,8...)", value: "双周" },
];

export function CourseDetailDrawer() {
  const {
    selectedCourseId,
    setSelectedCourseId,
    courses,
    schedules,
    updateCourse,
    deleteCourse,
    addScheduleSlot,
    updateSchedule,
    deleteSchedule,
    addCourseMaterial,
    assignments,
    setSelectedAssignmentId,
  } = useAppStore();

  const [isEditingCourse, setIsEditingCourse] = useState(false);
  const [isAddingSlot, setIsAddingSlot] = useState(false);
  const [isAddingMaterial, setIsAddingMaterial] = useState(false);

  // Edit Course Form state
  const [editName, setEditName] = useState("");
  const [editTeacher, setEditTeacher] = useState("");
  const [editClassroom, setEditClassroom] = useState("");
  const [editCredit, setEditCredit] = useState(3);
  const [editDesc, setEditDesc] = useState("");

  // New Slot Form state
  const [newSlotDay, setNewSlotDay] = useState(1);
  const [newSlotStart, setNewSlotStart] = useState("08:00");
  const [newSlotEnd, setNewSlotEnd] = useState("09:40");
  const [newSlotWeeks, setNewSlotWeeks] = useState("1-16周");
  const [newSlotLocation, setNewSlotLocation] = useState("");

  // Material Form state
  const [matTitle, setMatTitle] = useState("");
  const [matType, setMatType] = useState<"pdf" | "ppt" | "doc" | "link">("pdf");
  const [matSize, setMatSize] = useState("2.5 MB");

  if (!selectedCourseId) return null;

  const course = courses.find((c) => c.id === selectedCourseId);
  if (!course) return null;

  const courseSchedules = schedules.filter((s) => s.courseId === course.id);
  const courseAssignments = assignments.filter((a) => a.courseId === course.id);

  const startEditCourse = () => {
    setEditName(course.name);
    setEditTeacher(course.teacher);
    setEditClassroom(course.classroom);
    setEditCredit(course.credit);
    setEditDesc(course.description);
    setIsEditingCourse(true);
  };

  const handleSaveCourseEdit = (e: React.FormEvent) => {
    e.preventDefault();
    updateCourse({
      ...course,
      name: editName,
      teacher: editTeacher,
      classroom: editClassroom,
      credit: editCredit,
      description: editDesc,
    });
    setIsEditingCourse(false);
  };

  const handleDeleteCourseClick = () => {
    if (confirm(`确定要彻底删除课程《${course.name}》及其所有排课和讲义资料吗？`)) {
      deleteCourse(course.id);
      setSelectedCourseId(null);
    }
  };

  const handleAddSlotSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addScheduleSlot({
      courseId: course.id,
      dayOfWeek: Number(newSlotDay),
      startTime: newSlotStart,
      endTime: newSlotEnd,
      location: newSlotLocation || course.classroom,
      weeks: newSlotWeeks,
    });
    setIsAddingSlot(false);
  };

  const handleAddMaterialSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!matTitle.trim()) return;
    addCourseMaterial(course.id, {
      title: matTitle,
      type: matType,
      size: matSize,
    });
    setMatTitle("");
    setIsAddingMaterial(false);
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-xs flex justify-end animate-in fade-in">
      <div className="w-full max-w-lg bg-white h-full shadow-drawer border-l border-[#E7E3DD] flex flex-col justify-between overflow-hidden">
        {/* Header */}
        <div
          className="p-5 border-b border-[#E0D7C6] flex items-center justify-between"
          style={{ backgroundColor: `${course.bgHex}80` }}
        >
          <div className="flex items-center space-x-2.5 min-w-0 flex-1">
            <span className="text-xs font-mono px-2 py-0.5 bg-white/90 rounded border border-[#E0D7C6] text-charcoal font-semibold shrink-0">
              {course.code}
            </span>
            <h2 className="text-lg font-bold text-charcoal truncate">
              {course.name}
            </h2>
          </div>
          <div className="flex items-center space-x-1 shrink-0 ml-2">
            <button
              onClick={startEditCourse}
              className="p-1.5 rounded-xl bg-white/80 hover:bg-white text-charcoal transition-colors border border-[#E0D7C6]"
              title="编辑课程"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleDeleteCourseClick}
              className="p-1.5 rounded-xl bg-white/80 hover:bg-[#FDF0F0] text-[#D94F4F] transition-colors border border-[#F8D7D7]"
              title="删除课程"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setSelectedCourseId(null)}
              className="p-1.5 rounded-xl bg-white/80 hover:bg-white text-charcoal transition-colors border border-[#E0D7C6]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 text-xs">
          {/* Edit Course Form */}
          {isEditingCourse ? (
            <form onSubmit={handleSaveCourseEdit} className="p-4 bg-[#F7F5F5] border border-[#CDB9AB] rounded-2xl space-y-3">
              <h3 className="font-bold text-charcoal flex items-center gap-1.5 text-sm">
                <Edit2 className="w-4 h-4 text-[#A48F82]" /> 编辑课程基本信息
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-[#8C827A]">课程名称</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full p-2 bg-white border border-[#E7E3DD] rounded-xl text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[#8C827A]">授课教师</label>
                  <input
                    type="text"
                    value={editTeacher}
                    onChange={(e) => setEditTeacher(e.target.value)}
                    className="w-full p-2 bg-white border border-[#E7E3DD] rounded-xl text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-[#8C827A]">默认教室</label>
                  <input
                    type="text"
                    value={editClassroom}
                    onChange={(e) => setEditClassroom(e.target.value)}
                    className="w-full p-2 bg-white border border-[#E7E3DD] rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[#8C827A]">学分</label>
                  <input
                    type="number"
                    value={editCredit}
                    onChange={(e) => setEditCredit(Number(e.target.value))}
                    className="w-full p-2 bg-white border border-[#E7E3DD] rounded-xl text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-[#8C827A]">课程说明</label>
                <textarea
                  rows={2}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full p-2 bg-white border border-[#E7E3DD] rounded-xl text-xs resize-none"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsEditingCourse(false)}
                  className="px-3 py-1.5 text-xs text-[#676268] bg-white border border-[#E7E3DD] rounded-xl"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 text-xs text-white bg-charcoal rounded-xl font-bold flex items-center gap-1"
                >
                  <Save className="w-3.5 h-3.5" /> 保存修改
                </button>
              </div>
            </form>
          ) : (
            /* Standard Course Info Card */
            <div className="bg-[#F7F5F5] border border-[#E7E3DD] rounded-2xl p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="flex items-center space-x-2">
                  <User className="w-4 h-4 text-[#A48F82]" />
                  <div>
                    <span className="text-[10px] text-[#8C827A] block">授课教师</span>
                    <span className="font-bold text-charcoal">{course.teacher}</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <MapPin className="w-4 h-4 text-[#A48F82]" />
                  <div>
                    <span className="text-[10px] text-[#8C827A] block">默认教室</span>
                    <span className="font-bold text-charcoal">{course.classroom}</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-[#676268] leading-relaxed pt-2 border-t border-[#E7E3DD]">
                {course.description}
              </p>
            </div>
          )}

          {/* Section 1: Schedules & Rescheduling (排课与调课) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-[#F0EBE1] pb-2">
              <h3 className="font-bold text-charcoal flex items-center gap-1.5 text-sm">
                <Clock className="w-4 h-4 text-[#A48F82]" /> 上课时间与调课 ({courseSchedules.length})
              </h3>
              <button
                onClick={() => setIsAddingSlot(!isAddingSlot)}
                className="flex items-center space-x-1 text-[11px] font-bold text-charcoal bg-[#E3E6E0] hover:bg-[#D0D5CC] px-2.5 py-1 rounded-lg transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>新增上课时间</span>
              </button>
            </div>

            {/* Add Schedule Slot Form */}
            {isAddingSlot && (
              <form onSubmit={handleAddSlotSubmit} className="p-3 bg-[#F0EBE1]/70 border border-[#E0D7C6] rounded-xl space-y-2">
                <h4 className="font-bold text-charcoal text-xs">新增上课时间时段</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#8C827A]">星期</label>
                    <select
                      value={newSlotDay}
                      onChange={(e) => setNewSlotDay(Number(e.target.value))}
                      className="w-full p-1.5 bg-white border border-[#E0D7C6] rounded-lg text-xs"
                    >
                      {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                        <option key={d} value={d}>{WEEK_NAMES[d]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8C827A]">周次规则</label>
                    <select
                      value={newSlotWeeks}
                      onChange={(e) => setNewSlotWeeks(e.target.value)}
                      className="w-full p-1.5 bg-white border border-[#E0D7C6] rounded-lg text-xs"
                    >
                      {WEEK_RANGE_PRESETS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-[#8C827A]">开始</label>
                    <input
                      type="time"
                      value={newSlotStart}
                      onChange={(e) => setNewSlotStart(e.target.value)}
                      className="w-full p-1.5 bg-white border border-[#E0D7C6] rounded-lg font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8C827A]">结束</label>
                    <input
                      type="time"
                      value={newSlotEnd}
                      onChange={(e) => setNewSlotEnd(e.target.value)}
                      className="w-full p-1.5 bg-white border border-[#E0D7C6] rounded-lg font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8C827A]">教室</label>
                    <input
                      type="text"
                      placeholder={course.classroom}
                      value={newSlotLocation}
                      onChange={(e) => setNewSlotLocation(e.target.value)}
                      className="w-full p-1.5 bg-white border border-[#E0D7C6] rounded-lg text-xs"
                    />
                  </div>
                </div>
                <div className="flex justify-end space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsAddingSlot(false)}
                    className="px-2.5 py-1 text-xs text-[#676268] bg-white border border-[#E0D7C6] rounded-lg"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-2.5 py-1 text-xs text-white bg-charcoal rounded-lg font-bold"
                  >
                    保存排课
                  </button>
                </div>
              </form>
            )}

            {/* List of Schedules with Edit / Reschedule / Delete Buttons */}
            <div className="space-y-2">
              {courseSchedules.map((s) => (
                <div
                  key={s.id}
                  className="p-3 bg-white border border-[#E0D7C6] rounded-xl flex items-center justify-between shadow-subtle text-xs"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-charcoal">
                        {WEEK_NAMES[s.dayOfWeek]} {s.startTime} - {s.endTime}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-[#F7F5F5] rounded border border-[#E7E3DD] text-[#8C827A]">
                        {s.weeks}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#676268] mt-0.5">
                      📍 {s.location} {s.excludedWeeks?.length ? `(已调课/停课 ${s.excludedWeeks.length} 周)` : ""}
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      if (confirm("确定要删除此时段排课吗？")) {
                        deleteSchedule(s.id);
                      }
                    }}
                    className="p-1 text-[#D94F4F] hover:bg-[#FDF0F0] rounded-lg transition-colors"
                    title="删除此排课"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Section 2: Course Materials & Lecture Notes */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-[#F0EBE1] pb-2">
              <h3 className="font-bold text-charcoal flex items-center gap-1.5 text-sm">
                <BookOpen className="w-4 h-4 text-[#A48F82]" /> 课件与资料 ({course.materials.length})
              </h3>
              <button
                onClick={() => setIsAddingMaterial(!isAddingMaterial)}
                className="flex items-center space-x-1 text-[11px] font-bold text-charcoal bg-white border border-[#E0D7C6] hover:bg-[#F0EBE1] px-2.5 py-1 rounded-lg transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>导入资料</span>
              </button>
            </div>

            {/* Add Material Form */}
            {isAddingMaterial && (
              <form onSubmit={handleAddMaterialSubmit} className="p-3 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl space-y-2">
                <h4 className="font-bold text-charcoal text-xs">导入课件 / 讲义</h4>
                <input
                  type="text"
                  placeholder="资料名称 (如: 阶段复习要点与练习题.pdf)..."
                  value={matTitle}
                  onChange={(e) => setMatTitle(e.target.value)}
                  className="w-full p-2 bg-white border border-[#E7E3DD] rounded-lg text-xs"
                  required
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#8C827A]">类型</label>
                    <select
                      value={matType}
                      onChange={(e) => setMatType(e.target.value as any)}
                      className="w-full p-1.5 bg-white border border-[#E7E3DD] rounded-lg text-xs"
                    >
                      <option value="pdf">PDF 文档</option>
                      <option value="ppt">PPT 幻灯片</option>
                      <option value="doc">Word / 笔记</option>
                      <option value="link">外部链接</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8C827A]">文件大小</label>
                    <input
                      type="text"
                      value={matSize}
                      onChange={(e) => setMatSize(e.target.value)}
                      className="w-full p-1.5 bg-white border border-[#E7E3DD] rounded-lg text-xs"
                    />
                  </div>
                </div>
                <div className="flex justify-end space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsAddingMaterial(false)}
                    className="px-2.5 py-1 text-xs text-[#676268] bg-white border border-[#E7E3DD] rounded-lg"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-2.5 py-1 text-xs text-white bg-charcoal rounded-lg font-bold"
                  >
                    导入资料
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-2">
              {course.materials.map((m) => (
                <div
                  key={m.id}
                  className="p-3 bg-white border border-[#E7E3DD] rounded-xl flex items-center justify-between hover:border-charcoal transition-all shadow-subtle cursor-pointer"
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <FileText className="w-4 h-4 text-[#A48F82] shrink-0" />
                    <div className="min-w-0">
                      <h4 className="font-semibold text-charcoal truncate">{m.title}</h4>
                      <p className="text-[10px] text-[#8C827A] mt-0.5">
                        {m.size} · 上传于 {m.uploadDate}
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-charcoal bg-[#F0EBE1] px-2 py-0.5 rounded border border-[#E0D7C6]">
                    下载 / 打开
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Related Course Assignments */}
          <div className="space-y-3">
            <h3 className="font-bold text-charcoal flex items-center gap-1.5 text-sm border-b border-[#F0EBE1] pb-2">
              <Calendar className="w-4 h-4 text-[#A48F82]" /> 关联课程作业 ({courseAssignments.length})
            </h3>

            <div className="space-y-2">
              {courseAssignments.length === 0 ? (
                <p className="text-[#8C827A] text-center py-3">暂无关联作业</p>
              ) : (
                courseAssignments.map((a) => (
                  <div
                    key={a.id}
                    onClick={() => {
                      setSelectedCourseId(null);
                      setSelectedAssignmentId(a.id);
                    }}
                    className="p-3 bg-[#F7F5F5] hover:bg-[#F0EBE1] border border-[#E7E3DD] rounded-xl flex items-center justify-between cursor-pointer transition-colors"
                  >
                    <div>
                      <h4 className="font-bold text-charcoal">{a.title}</h4>
                      <p className="text-[10px] text-[#8C827A] mt-0.5">
                        DDL: {a.ddl.split("T")[0]}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                        a.status === "completed"
                          ? "bg-[#E3E6E0] text-[#4A7C59]"
                          : "bg-white text-charcoal border border-[#E0D7C6]"
                      }`}
                    >
                      {a.status === "completed" ? "已完成" : "代办"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
