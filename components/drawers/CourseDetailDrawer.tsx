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
import { Material } from "@/types";
import { saveFileBlob, createStorageKey } from "@/lib/fileStorage";

export function CourseDetailDrawer() {
  const {
    courses,
    schedules,
    selectedCourseId,
    setSelectedCourseId,
    updateCourse,
    deleteCourse,
    addScheduleSlot,
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

  const handleAddSlot = (e: React.FormEvent) => {
    e.preventDefault();
    addScheduleSlot({
      courseId: course.id,
      dayOfWeek: newDay,
      startTime: newStart,
      endTime: newEnd,
      location: newLocation || course.classroom,
      weeks: "1-16周",
    });
    setNewLocation("");
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
        alert(`文件「${file.name}」保存到本地存储失败，已跳过`);
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
                if (confirm(`确定要删除课程《${course.name}》及关联的所有课表时段吗？`)) {
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
              {courseSchedules.map((sched) => (
                <div
                  key={sched.id}
                  className="p-3 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl flex items-center justify-between text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-bold text-charcoal">
                      周{["一", "二", "三", "四", "五", "六", "日"][sched.dayOfWeek - 1]} {sched.startTime} - {sched.endTime}
                    </div>
                    <div className="text-[10px] text-[#8C827A]">
                      📍 {sched.location} · {sched.weeks}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteSchedule(sched.id)}
                    className="p-1 text-[#D94F4F] hover:bg-[#FDF0F0] rounded-lg transition-colors"
                    title="删除此排课时段"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Form to add slot */}
            <form onSubmit={handleAddSlot} className="p-3 bg-[#F0EBE1]/60 border border-[#E0D7C6] rounded-xl space-y-2">
              <span className="font-bold text-charcoal text-[11px]">添加上课时段</span>
              <div className="grid grid-cols-3 gap-2">
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
              </div>
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
                课程讲义与课件资料 ({course.materials.length})
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
                <span>上传真实文件</span>
              </label>
            </div>

            {/* Materials List */}
            <div className="space-y-2">
              {course.materials.length === 0 ? (
                <p className="text-[11px] text-[#8C827A] py-3 text-center bg-[#F7F5F5] rounded-xl">
                  暂无课件资料，支持上传 PDF/PPT/Word/图片 格式
                </p>
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
                        查看/下载 ↗
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`确定要删除资料「${mat.title}」吗？删除后无法恢复。`)) {
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
