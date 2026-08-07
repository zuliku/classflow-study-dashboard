"use client";

import React, { useState } from "react";
import {
  X,
  User,
  MapPin,
  Clock,
  BookOpen,
  FileText,
  Download,
  Plus,
  Calendar,
  Layers,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { getPriorityMeta, getStatusMeta } from "@/lib/utils";

export function CourseDetailDrawer() {
  const {
    courses,
    schedules,
    assignments,
    selectedCourseId,
    setSelectedCourseId,
    setSelectedAssignmentId,
    addAssignment,
  } = useAppStore();

  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDDL, setNewDDL] = useState("2026-08-15T23:59");
  const [newPriority, setNewPriority] = useState<"urgent" | "high" | "medium" | "low">("medium");

  if (!selectedCourseId) return null;

  const course = courses.find((c) => c.id === selectedCourseId);
  if (!course) return null;

  const courseSchedules = schedules.filter((s) => s.courseId === course.id);
  const courseAssignments = assignments.filter((a) => a.courseId === course.id);

  const handleCreateAssignment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    addAssignment({
      courseId: course.id,
      title: newTitle,
      ddl: new Date(newDDL).toISOString(),
      priority: newPriority,
      status: "todo",
      progress: 0,
    });

    setNewTitle("");
    setIsAddingTask(false);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/30 backdrop-blur-sm flex justify-end transition-opacity animate-in fade-in">
      <div className="w-full max-w-lg bg-white h-full shadow-drawer flex flex-col border-l border-[#E7E3DD] overflow-y-auto">
        {/* Header */}
        <div
          className="p-6 border-b border-[#F0EBE1] flex items-center justify-between"
          style={{ backgroundColor: `${course.bgHex}40` }}
        >
          <div className="flex items-center space-x-3">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-lg shadow-subtle border"
              style={{
                backgroundColor: course.bgHex,
                borderColor: course.borderHex,
                color: course.textHex,
              }}
            >
              {course.name.substring(0, 1)}
            </div>
            <div>
              <span className="text-xs font-mono text-[#8C827A] px-2 py-0.5 bg-white/80 rounded border border-[#E0D7C6]">
                {course.code}
              </span>
              <h2 className="text-xl font-bold text-charcoal mt-1">
                {course.name}
              </h2>
            </div>
          </div>
          <button
            onClick={() => setSelectedCourseId(null)}
            className="p-2 rounded-xl bg-white/80 hover:bg-white text-charcoal border border-[#E0D7C6] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 flex-1">
          {/* Metadata Card */}
          <div className="grid grid-cols-3 gap-3 bg-[#F7F5F5] border border-[#E7E3DD] rounded-2xl p-4 text-xs">
            <div className="flex items-center space-x-2">
              <User className="w-4 h-4 text-[#A48F82]" />
              <div>
                <p className="text-[10px] text-[#8C827A]">授课教师</p>
                <p className="font-semibold text-charcoal">{course.teacher}</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <MapPin className="w-4 h-4 text-[#A48F82]" />
              <div>
                <p className="text-[10px] text-[#8C827A]">上课教室</p>
                <p className="font-semibold text-charcoal">{course.classroom}</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Layers className="w-4 h-4 text-[#A48F82]" />
              <div>
                <p className="text-[10px] text-[#8C827A]">课程学分</p>
                <p className="font-semibold text-charcoal">{course.credit} 学分</p>
              </div>
            </div>
          </div>

          {/* Description */}
          {course.description && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-bold text-[#8C827A] uppercase tracking-wider">
                课程简介
              </h4>
              <p className="text-xs text-charcoal leading-relaxed bg-[#F0EBE1]/40 border border-[#E0D7C6] rounded-xl p-3">
                {course.description}
              </p>
            </div>
          )}

          {/* Schedule Slots */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-[#8C827A] uppercase tracking-wider flex items-center">
              <Clock className="w-3.5 h-3.5 mr-1" />
              上课时间安排
            </h4>
            <div className="space-y-2">
              {courseSchedules.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between p-3 bg-white border border-[#E0D7C6] rounded-xl text-xs"
                >
                  <span className="font-semibold text-charcoal">
                    {["周一", "周二", "周三", "周四", "周五", "周六", "周日"][s.dayOfWeek - 1]}
                  </span>
                  <span className="font-mono text-[#676268]">
                    {s.startTime} - {s.endTime}
                  </span>
                  <span className="text-[#8C827A]">{s.location}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Course Materials */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-[#8C827A] uppercase tracking-wider flex items-center">
              <BookOpen className="w-3.5 h-3.5 mr-1" />
              课程资料与课件 ({course.materials?.length || 0})
            </h4>
            <div className="space-y-2">
              {course.materials?.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between p-3 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl text-xs hover:border-[#D5CBC0] transition-colors"
                >
                  <div className="flex items-center space-x-2.5 truncate">
                    <FileText className="w-4 h-4 text-[#A48F82] shrink-0" />
                    <span className="truncate font-medium text-charcoal">{m.title}</span>
                  </div>
                  <button className="flex items-center space-x-1 text-[11px] text-[#A48F82] hover:text-charcoal bg-white border border-[#E0D7C6] px-2.5 py-1 rounded-lg shrink-0">
                    <Download className="w-3 h-3" />
                    <span>{m.size || "下载"}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Linked Assignments & DDLs */}
          <div className="space-y-2.5 pt-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-[#8C827A] uppercase tracking-wider">
                关联作业 DDL ({courseAssignments.length})
              </h4>
              <button
                onClick={() => setIsAddingTask(!isAddingTask)}
                className="flex items-center space-x-1 text-xs text-charcoal font-medium bg-[#E3E6E0] hover:bg-[#D5DCD0] px-2.5 py-1 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>布置新作业</span>
              </button>
            </div>

            {/* Quick Add Task Form */}
            {isAddingTask && (
              <form onSubmit={handleCreateAssignment} className="p-3.5 bg-[#F0EBE1]/80 border border-[#CDB9AB] rounded-xl space-y-3">
                <input
                  type="text"
                  placeholder="作业名称..."
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full text-xs p-2 bg-white border border-[#E0D7C6] rounded-lg focus:outline-none focus:border-charcoal"
                  required
                />
                <div className="flex space-x-2">
                  <input
                    type="datetime-local"
                    value={newDDL}
                    onChange={(e) => setNewDDL(e.target.value)}
                    className="text-xs p-2 bg-white border border-[#E0D7C6] rounded-lg flex-1 focus:outline-none"
                  />
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as any)}
                    className="text-xs p-2 bg-white border border-[#E0D7C6] rounded-lg focus:outline-none"
                  >
                    <option value="urgent">紧急</option>
                    <option value="high">高优先</option>
                    <option value="medium">中优先</option>
                    <option value="low">低优先</option>
                  </select>
                </div>
                <div className="flex justify-end space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsAddingTask(false)}
                    className="px-3 py-1 text-xs text-[#676268] bg-white border border-[#E7E3DD] rounded-lg"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1 text-xs text-white bg-charcoal rounded-lg font-medium"
                  >
                    保存作业
                  </button>
                </div>
              </form>
            )}

            {/* Assignments List */}
            <div className="space-y-2">
              {courseAssignments.length === 0 ? (
                <p className="text-xs text-[#8C827A] py-3 text-center bg-[#F7F5F5] rounded-xl border border-[#E7E3DD]">
                  该课程暂无布置的作业
                </p>
              ) : (
                courseAssignments.map((a) => {
                  const priorityMeta = getPriorityMeta(a.priority);
                  const statusMeta = getStatusMeta(a.status);
                  return (
                    <div
                      key={a.id}
                      onClick={() => {
                        setSelectedCourseId(null);
                        setSelectedAssignmentId(a.id);
                      }}
                      className="p-3 bg-[#F7F5F5] hover:bg-[#F0EBE1]/70 border border-[#E7E3DD] hover:border-[#D5CBC0] rounded-xl transition-all cursor-pointer flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-semibold text-charcoal">{a.title}</span>
                        <div className="flex items-center space-x-2 mt-1">
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${priorityMeta.bg} ${priorityMeta.text} ${priorityMeta.border}`}
                          >
                            {priorityMeta.label}
                          </span>
                          <span className="text-[10px] text-[#8C827A]">
                            进度: {a.progress}%
                          </span>
                        </div>
                      </div>
                      <span
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-medium ${statusMeta.bg} ${statusMeta.text}`}
                      >
                        {statusMeta.label}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
