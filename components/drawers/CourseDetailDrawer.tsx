"use client";

import React, { useState } from "react";
import {
  X,
  Plus,
  BookOpen,
  User,
  MapPin,
  Clock,
  Trash2,
  FileText,
  Edit,
  Save,
  Download,
  Eye,
  FileUp,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { Material, CourseSchedule, ScheduleConflict } from "@/types";
import { saveFileBlob, createStorageKey } from "@/lib/fileStorage";
import { WEEK_RANGE_PRESETS, isValidTimeRange } from "@/lib/schedule";
import { findScheduleConflicts } from "@/lib/conflicts";

const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

/** 周次选择：预设下拉 + 自定义输入（自定义状态由 value 是否命中预设推导） */
function WeeksSelect({ value, onChange }: { value: string; onChange: (weeks: string) => void }) {
  const isCustom = !WEEK_RANGE_PRESETS.some((p) => p.value === value);
  return (
    <div className="space-y-1.5">
      <select
        value={isCustom ? "__custom__" : value}
        onChange={(e) => onChange(e.target.value === "__custom__" ? value : e.target.value)}
        className="w-full p-1.5 bg-white border border-[#E0D7C6] rounded-lg focus:outline-none text-[11px]"
      >
        {WEEK_RANGE_PRESETS.map((preset) => (
          <option key={preset.value} value={preset.value}>
            {preset.label}
          </option>
        ))}
        <option value="__custom__">自定义…</option>
      </select>
      {isCustom && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="如 1-8周 / 单周 / 5-5周"
          className="w-full p-1.5 bg-white border border-[#E0D7C6] rounded-lg focus:outline-none text-[11px]"
        />
      )}
    </div>
  );
}

export function CourseDetailDrawer() {
  const {
    courses,
    schedules,
    selectedCourseId,
    setSelectedCourseId,
    updateCourse,
    deleteCourse,
    addScheduleSlot,
    updateSchedule,
    deleteSchedule,
    addCourseMaterial,
    deleteCourseMaterial,
  } = useAppStore();

  const [isEditing, setIsEditing] = useState(false);

  // Form State for editing course
  const [name, setName] = useState("");
  const [teacher, setTeacher] = useState("");
  const [classroom, setClassroom] = useState("");
  const [credit, setCredit] = useState(3);
  const [description, setDescription] = useState("");

  // Form State for adding schedule slot
  const [newDay, setNewDay] = useState(1);
  const [newStart, setNewStart] = useState("08:00");
  const [newEnd, setNewEnd] = useState("09:40");
  const [newLocation, setNewLocation] = useState("");
  const [newWeeks, setNewWeeks] = useState("1-16周");

  // Form State for editing a schedule slot (inline)
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [slotForm, setSlotForm] = useState({
    dayOfWeek: 1,
    startTime: "08:00",
    endTime: "09:40",
    location: "",
    weeks: "1-16周",
  });
  const [slotError, setSlotError] = useState<string | null>(null);
  const [slotConflict, setSlotConflict] = useState<string | null>(null);

  const course = courses.find((c) => c.id === selectedCourseId);
  const courseSchedules = schedules.filter((s) => s.courseId === selectedCourseId);

  if (!course) return null;

  const handleStartEdit = () => {
    setName(course.name);
    setTeacher(course.teacher);
    setClassroom(course.classroom);
    setCredit(course.credit);
    setDescription(course.description);
    setIsEditing(true);
  };

  const handleSaveCourse = () => {
    updateCourse({
      ...course,
      name,
      teacher,
      classroom,
      credit,
      description,
    });
    setIsEditing(false);
  };

  // ---- Schedule 表单验证与冲突检测（新增/编辑共用，全站一致） ----
  const validateSlot = (form: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    weeks: string;
  }): string | null => {
    if (!Number.isInteger(form.dayOfWeek) || form.dayOfWeek < 1 || form.dayOfWeek > 7) {
      return "星期必须为 1-7";
    }
    if (!isValidTimeRange(form.startTime, form.endTime)) {
      return "时间格式非法或结束时间需晚于开始时间";
    }
    if (!form.weeks.trim()) {
      return "周次不能为空";
    }
    return null;
  };

  /** 候选时段 vs 其他时段：找出涉及候选时段的冲突 */
  const findCandidateConflicts = (
    candidate: CourseSchedule,
    excludeId?: string
  ): ScheduleConflict[] => {
    const others = schedules.filter((s) => s.id !== excludeId);
    return findScheduleConflicts([...others, candidate]).filter(
      (c) => c.scheduleA.id === candidate.id || c.scheduleB.id === candidate.id
    );
  };

  const formatConflictMessage = (conflicts: ScheduleConflict[], candidateId: string): string => {
    const c = conflicts[0];
    const other = c.scheduleA.id === candidateId ? c.scheduleB : c.scheduleA;
    const otherCourse = courses.find((x) => x.id === other.courseId);
    return `与《${otherCourse?.name || "未知课程"}》周${DAY_LABELS[other.dayOfWeek - 1]} ${other.startTime}–${other.endTime} 存在时间冲突`;
  };

  // ---- 新增时段 ----
  const handleAddSlot = (e: React.FormEvent) => {
    e.preventDefault();

    const error = validateSlot({ dayOfWeek: newDay, startTime: newStart, endTime: newEnd, weeks: newWeeks });
    if (error) {
      setSlotError(error);
      setSlotConflict(null);
      return;
    }

    const candidate: CourseSchedule = {
      id: "__candidate__",
      courseId: course.id,
      dayOfWeek: newDay,
      startTime: newStart,
      endTime: newEnd,
      location: newLocation || course.classroom,
      weeks: newWeeks,
    };
    const conflicts = findCandidateConflicts(candidate);
    if (conflicts.length > 0) {
      setSlotError(null);
      setSlotConflict(formatConflictMessage(conflicts, candidate.id));
      return;
    }

    addScheduleSlot({
      courseId: course.id,
      dayOfWeek: newDay,
      startTime: newStart,
      endTime: newEnd,
      location: newLocation || course.classroom,
      weeks: newWeeks,
    });
    setNewLocation("");
    setNewWeeks("1-16周");
    setSlotError(null);
    setSlotConflict(null);
  };

  // ---- 编辑时段 ----
  const handleStartEditSlot = (sched: CourseSchedule) => {
    setSlotForm({
      dayOfWeek: sched.dayOfWeek,
      startTime: sched.startTime,
      endTime: sched.endTime,
      location: sched.location,
      weeks: sched.weeks,
    });
    setSlotError(null);
    setSlotConflict(null);
    setEditingSlotId(sched.id);
  };

  const handleCancelEditSlot = () => {
    setEditingSlotId(null);
    setSlotError(null);
    setSlotConflict(null);
  };

  const handleSaveSlotEdit = (sched: CourseSchedule) => {
    const error = validateSlot(slotForm);
    if (error) {
      setSlotError(error);
      setSlotConflict(null);
      return;
    }

    // 保留 id / courseId / excludedWeeks，只更新可编辑字段
    const candidate: CourseSchedule = {
      ...sched,
      dayOfWeek: slotForm.dayOfWeek,
      startTime: slotForm.startTime,
      endTime: slotForm.endTime,
      location: slotForm.location.trim() || sched.location,
      weeks: slotForm.weeks,
    };
    const conflicts = findCandidateConflicts(candidate, sched.id);
    if (conflicts.length > 0) {
      setSlotError(null);
      setSlotConflict(formatConflictMessage(conflicts, candidate.id));
      return;
    }

    updateSchedule(candidate);
    handleCancelEditSlot();
  };

  // Real File Upload Handler: File → IndexedDB 保存 Blob → 生成 storageKey → Zustand 只存 metadata
  const handleRealFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const storageKey = createStorageKey();
      try {
        await saveFileBlob(storageKey, file);
      } catch {
        alert(`《${file.name}》保存失败，请重新上传`);
        continue;
      }

      const sizeStr = (file.size / (1024 * 1024)).toFixed(2) + " MB";
      const ext = file.name.split(".").pop()?.toLowerCase() || "";

      let type: Material["type"] = "doc";
      if (ext === "pdf") type = "pdf";
      else if (["ppt", "pptx"].includes(ext)) type = "ppt";
      else if (["png", "jpg", "jpeg", "svg", "gif", "webp"].includes(ext)) type = "image";

      addCourseMaterial(course.id, {
        title: file.name,
        type,
        size: sizeStr,
        storageKey,
      });
    }
    e.target.value = "";
  };

  const handlePreviewMaterial = (mat: Material) => {
    window.dispatchEvent(
      new CustomEvent("preview-material", { detail: { material: mat } })
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end animate-in fade-in">
      <div className="w-full max-w-lg bg-white h-full shadow-drawer border-l border-[#E7E3DD] flex flex-col justify-between overflow-hidden">
        {/* Header */}
        <div
          className="p-6 border-b border-[#E0D7C6] flex items-center justify-between"
          style={{ backgroundColor: `${course.bgHex}80` }}
        >
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-white border border-[#E0D7C6] flex items-center justify-center text-charcoal shadow-subtle shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 bg-white/90 rounded border border-[#E0D7C6] text-charcoal">
                {course.code}
              </span>
              <h2 className="text-lg font-bold text-charcoal truncate mt-1">
                {course.name}
              </h2>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {!isEditing ? (
              <button
                onClick={handleStartEdit}
                className="p-2 rounded-xl text-[#8C827A] hover:bg-white hover:text-charcoal transition-colors border border-[#E0D7C6] bg-white/70"
                title="编辑课程信息"
              >
                <Edit className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleSaveCourse}
                className="p-2 rounded-xl text-white bg-charcoal hover:bg-black transition-colors"
                title="保存修改"
              >
                <Save className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={() => {
                if (confirm(`删除课程《${course.name}》及其所有排课时段？`)) {
                  deleteCourse(course.id);
                  setSelectedCourseId(null);
                }
              }}
              className="p-2 rounded-xl text-[#D94F4F] hover:bg-[#FDF0F0] transition-colors border border-[#F8D7D7] bg-white/70"
              title="删除课程"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            <button
              onClick={() => setSelectedCourseId(null)}
              className="p-2 rounded-xl text-[#8C827A] hover:bg-white hover:text-charcoal transition-colors border border-[#E0D7C6] bg-white/70"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {/* Edit Form or Readonly View */}
          {isEditing ? (
            <div className="space-y-3 p-4 bg-[#F7F5F5] rounded-2xl border border-[#E7E3DD]">
              <h3 className="font-bold text-charcoal">修改课程信息</h3>
              <div className="space-y-2">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="课程名称"
                  className="w-full p-2 bg-white border border-[#E7E3DD] rounded-xl font-bold"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={teacher}
                    onChange={(e) => setTeacher(e.target.value)}
                    placeholder="授课教师"
                    className="p-2 bg-white border border-[#E7E3DD] rounded-xl"
                  />
                  <input
                    type="text"
                    value={classroom}
                    onChange={(e) => setClassroom(e.target.value)}
                    placeholder="上课教室"
                    className="p-2 bg-white border border-[#E7E3DD] rounded-xl"
                  />
                </div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="课程大纲与要求"
                  rows={2}
                  className="w-full p-2 bg-white border border-[#E7E3DD] rounded-xl"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[#676268] text-xs leading-relaxed">
                {course.description || "暂无课程大纲与简介"}
              </p>
              <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-charcoal pt-2">
                <span className="flex items-center">
                  <User className="w-3.5 h-3.5 mr-1 text-[#A48F82]" />
                  {course.teacher}
                </span>
                <span className="flex items-center">
                  <MapPin className="w-3.5 h-3.5 mr-1 text-[#A48F82]" />
                  {course.classroom}
                </span>
                <span className="flex items-center">
                  <Clock className="w-3.5 h-3.5 mr-1 text-[#A48F82]" />
                  {course.credit} 学分
                </span>
              </div>
            </div>
          )}

          {/* Schedule Slots Section */}
          <div className="space-y-3 pt-4 border-t border-[#F0EBE1]">
            <h3 className="font-bold text-charcoal text-sm flex items-center justify-between">
              <span>上课时间安排 ({courseSchedules.length} 个时段)</span>
            </h3>

            {/* List of slots */}
            <div className="space-y-2">
              {courseSchedules.map((sched) => {
                const isEditing = editingSlotId === sched.id;
                if (isEditing) {
                  return (
                    <div
                      key={sched.id}
                      className="p-3 bg-white border border-[#CDB9AB] rounded-xl space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-[#8C827A]">编辑时段</span>
                        <button
                          onClick={handleCancelEditSlot}
                          className="p-0.5 text-[#8C827A] hover:text-charcoal rounded transition-colors"
                          title="取消编辑"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-[#8C827A]">星期</label>
                          <select
                            value={slotForm.dayOfWeek}
                            onChange={(e) =>
                              setSlotForm({ ...slotForm, dayOfWeek: Number(e.target.value) })
                            }
                            className="w-full p-1.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-lg focus:outline-none text-[11px]"
                          >
                            {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((label, i) => (
                              <option key={i} value={i + 1}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] text-[#8C827A]">周次</label>
                          <WeeksSelect
                            value={slotForm.weeks}
                            onChange={(weeks) => setSlotForm({ ...slotForm, weeks })}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] text-[#8C827A]">开始</label>
                          <input
                            type="time"
                            value={slotForm.startTime}
                            onChange={(e) => setSlotForm({ ...slotForm, startTime: e.target.value })}
                            className="w-full p-1.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-lg font-mono text-[11px] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-[#8C827A]">结束</label>
                          <input
                            type="time"
                            value={slotForm.endTime}
                            onChange={(e) => setSlotForm({ ...slotForm, endTime: e.target.value })}
                            className="w-full p-1.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-lg font-mono text-[11px] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-[#8C827A]">教室</label>
                          <input
                            type="text"
                            value={slotForm.location}
                            onChange={(e) => setSlotForm({ ...slotForm, location: e.target.value })}
                            placeholder={sched.location}
                            className="w-full p-1.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-lg text-[11px] focus:outline-none"
                          />
                        </div>
                      </div>

                      {slotError && (
                        <p className="text-[10px] text-[#D94F4F] font-bold">{slotError}</p>
                      )}
                      {slotConflict && (
                        <p className="text-[10px] text-[#D94F4F] font-bold">
                          {slotConflict}，已阻止保存。可取消编辑后调整时间或周次。
                        </p>
                      )}

                      <div className="flex justify-end space-x-2 pt-1">
                        <button
                          onClick={handleCancelEditSlot}
                          className="px-3 py-1 text-[11px] font-medium text-[#676268] bg-[#F7F5F5] border border-[#E7E3DD] rounded-lg hover:bg-[#E0D7C6]"
                        >
                          取消
                        </button>
                        <button
                          onClick={() => handleSaveSlotEdit(sched)}
                          className="px-3 py-1 text-[11px] font-bold text-white bg-charcoal hover:bg-black rounded-lg"
                        >
                          保存时段
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={sched.id}
                    className="p-3 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl flex items-center justify-between text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="font-bold text-charcoal">
                        周{DAY_LABELS[sched.dayOfWeek - 1]} {sched.startTime} - {sched.endTime}
                      </div>
                      <div className="text-[10px] text-[#8C827A]">
                        {sched.location} · {sched.weeks}
                        {sched.excludedWeeks && sched.excludedWeeks.length > 0 && (
                          <span className="text-[#D97706]">
                            {" "}· 停课周 {sched.excludedWeeks.join(",")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-1 shrink-0">
                      <button
                        onClick={() => handleStartEditSlot(sched)}
                        className="p-1 text-[#8C827A] hover:bg-[#E0D7C6] rounded-lg transition-colors"
                        title="编辑此排课时段"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteSchedule(sched.id)}
                        className="p-1 text-[#D94F4F] hover:bg-[#FDF0F0] rounded-lg transition-colors"
                        title="删除此排课时段"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Form to add slot */}
            <form onSubmit={handleAddSlot} className="p-3 bg-[#F0EBE1]/60 border border-[#E0D7C6] rounded-xl space-y-2">
              <span className="font-bold text-charcoal text-[11px]">添加上课时段</span>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={newDay}
                  onChange={(e) => setNewDay(Number(e.target.value))}
                  className="p-1.5 bg-white border border-[#E0D7C6] rounded-lg text-xs"
                >
                  {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((label, i) => (
                    <option key={i} value={i + 1}>
                      {label}
                    </option>
                  ))}
                </select>
                <WeeksSelect value={newWeeks} onChange={setNewWeeks} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="time"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                  className="p-1.5 bg-white border border-[#E0D7C6] rounded-lg text-xs font-mono"
                />
                <input
                  type="time"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                  className="p-1.5 bg-white border border-[#E0D7C6] rounded-lg text-xs font-mono"
                />
                <input
                  type="text"
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  placeholder={course.classroom}
                  className="p-1.5 bg-white border border-[#E0D7C6] rounded-lg text-xs"
                />
              </div>
              {slotError && (
                <p className="text-[10px] text-[#D94F4F] font-bold">{slotError}</p>
              )}
              {slotConflict && (
                <p className="text-[10px] text-[#D94F4F] font-bold">
                  {slotConflict}，已阻止添加。
                </p>
              )}
              <button
                type="submit"
                className="w-full py-1.5 bg-charcoal hover:bg-black text-white font-bold rounded-lg text-xs transition-colors"
              >
                + 添加排课
              </button>
            </form>
          </div>

          {/* Real Course Materials & Storage Upload */}
          <div className="space-y-3 pt-4 border-t border-[#F0EBE1]">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-charcoal text-sm flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-[#A48F82]" />
                课程资料 ({course.materials.length})
              </h3>

              {/* Real File Input Button */}
              <input
                type="file"
                multiple
                onChange={handleRealFileUpload}
                className="hidden"
                id="real-material-upload"
              />
              <label
                htmlFor="real-material-upload"
                className="flex items-center space-x-1 px-2.5 py-1 bg-charcoal hover:bg-black text-white text-[11px] font-bold rounded-xl cursor-pointer transition-colors"
              >
                <FileUp className="w-3 h-3" />
                <span>上传资料</span>
              </label>
            </div>

            {/* Materials List */}
            <div className="space-y-2">
              {course.materials.length === 0 ? (
                <div className="py-4 text-center bg-[#F7F5F5] rounded-xl space-y-0.5">
                  <p className="text-[11px] text-[#8C827A] font-semibold">暂无课程资料</p>
                  <p className="text-[10px] text-[#8C827A]">支持 PDF、PPT、Word 和图片</p>
                </div>
              ) : (
                course.materials.map((mat) => (
                  <div
                    key={mat.id}
                    onClick={() => handlePreviewMaterial(mat)}
                    className="p-3 bg-[#F7F5F5] hover:bg-[#F0EBE1] border border-[#E7E3DD] rounded-xl flex items-center justify-between text-xs cursor-pointer transition-colors group"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <FileText className="w-4 h-4 text-[#A48F82] shrink-0" />
                      <div className="min-w-0">
                        <h4 className="font-bold text-charcoal group-hover:underline truncate">
                          {mat.title}
                        </h4>
                        <span className="text-[10px] text-[#8C827A]">
                          {mat.size || "1.5 MB"} · {mat.uploadDate}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      <span className="text-[10px] bg-white border border-[#E0D7C6] px-2 py-0.5 rounded font-bold text-charcoal group-hover:bg-charcoal group-hover:text-white transition-colors">
                        查看
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`删除资料「${mat.title}」？删除后无法恢复。`)) {
                            deleteCourseMaterial(course.id, mat.id);
                          }
                        }}
                        className="p-1 text-[#D94F4F] hover:bg-[#FDF0F0] rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        title="删除此资料"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
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
