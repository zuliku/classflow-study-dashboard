"use client";

import React, { useState } from "react";
import {
  Users2,
  Plus,
  CheckSquare,
  Square,
  Clock,
  BookOpen,
  User,
  Share2,
  MessageSquare,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

export function GroupCollaborationView() {
  const { groupProjects, courses, toggleGroupTask, addGroupProject } = useAppStore();
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    groupProjects[0]?.id || ""
  );

  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCourseId, setNewCourseId] = useState(courses[0]?.id || "c1");
  const [newDesc, setNewDesc] = useState("");

  const selectedProject = groupProjects.find((p) => p.id === selectedProjectId) || groupProjects[0];
  const relatedCourse = courses.find((c) => c.id === selectedProject?.courseId);

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    addGroupProject({
      courseId: newCourseId,
      title: newTitle,
      description: newDesc,
      members: [
        {
          id: "m1",
          name: "张同学",
          avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
          role: "leader",
          major: "经济学",
        },
      ],
      tasks: [],
    });

    setNewTitle("");
    setNewDesc("");
    setIsCreatingProject(false);
  };

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-charcoal flex items-center gap-2">
            <Users2 className="w-4 h-4 text-[#A48F82]" />
            小组协同与大作业管理
          </h2>
          <p className="text-xs text-[#8C827A] mt-0.5">
            团队分工、任务进度跟踪与成员协作看盘
          </p>
        </div>
        <button
          onClick={() => setIsCreatingProject(true)}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-charcoal hover:bg-black text-white text-xs font-medium rounded-xl transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>新建小组项目</span>
        </button>
      </div>

      {/* Main Grid: Projects List (Left) + Detail View (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Left Column: Project Cards List */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-[#8C827A] uppercase tracking-wider px-1">
            我的协同小组 ({groupProjects.length})
          </h3>
          {groupProjects.map((proj) => {
            const course = courses.find((c) => c.id === proj.courseId);
            const isSelected = proj.id === selectedProjectId;

            return (
              <div
                key={proj.id}
                onClick={() => setSelectedProjectId(proj.id)}
                className={cn(
                  "p-4 rounded-2xl border transition-all cursor-pointer space-y-3 shadow-subtle",
                  isSelected
                    ? "bg-[#F0EBE1] border-[#CDB9AB] ring-1 ring-[#CDB9AB]"
                    : "bg-white border-[#E7E3DD] hover:bg-[#F7F5F5]"
                )}
              >
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-mono px-2 py-0.5 bg-white/80 rounded border border-[#E0D7C6] text-charcoal font-medium">
                    {course?.name || "通用课程"}
                  </span>
                  <span className="text-[10px] text-[#8C827A]">
                    更新于 {proj.updatedAt}
                  </span>
                </div>

                <h4 className="text-sm font-bold text-charcoal leading-snug">
                  {proj.title}
                </h4>

                {/* Member Avatars */}
                <div className="flex items-center justify-between pt-1 border-t border-[#E0D7C6]/60">
                  <div className="flex -space-x-1.5 overflow-hidden">
                    {proj.members.map((m) => (
                      <img
                        key={m.id}
                        src={m.avatarUrl}
                        alt={m.name}
                        className="inline-block h-6 w-6 rounded-full ring-2 ring-white object-cover"
                        title={`${m.name} (${m.role === "leader" ? "组长" : "成员"})`}
                      />
                    ))}
                  </div>

                  {/* Progress Badge */}
                  <span className="text-[11px] font-semibold text-charcoal bg-white px-2 py-0.5 rounded-md border border-[#E0D7C6]">
                    进度 {proj.progress}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Column: Selected Project Detail 看板 */}
        {selectedProject && (
          <div className="lg:col-span-2 space-y-4">
            {/* Project Overview Box */}
            <div className="bg-white border border-[#E7E3DD] rounded-2xl p-5 shadow-subtle space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-mono text-[#8C827A] px-2 py-0.5 bg-[#F7F5F5] rounded border border-[#E7E3DD]">
                    {relatedCourse?.name || "小组大作业"}
                  </span>
                  <h3 className="text-lg font-bold text-charcoal mt-2">
                    {selectedProject.title}
                  </h3>
                  <p className="text-xs text-[#676268] mt-1 leading-relaxed">
                    {selectedProject.description}
                  </p>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1.5 bg-[#F7F5F5] border border-[#E7E3DD] p-3 rounded-xl">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-[#8C827A]">项目总完成度</span>
                  <span className="font-bold text-charcoal">{selectedProject.progress}%</span>
                </div>
                <div className="w-full bg-[#E3E6E0] rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-sandrift h-2 rounded-full transition-all duration-300"
                    style={{ width: `${selectedProject.progress}%` }}
                  />
                </div>
              </div>

              {/* Group Members Cards */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-[#8C827A] uppercase tracking-wider">
                  小组成员 ({selectedProject.members.length} 人)
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {selectedProject.members.map((m) => (
                    <div
                      key={m.id}
                      className="p-3 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl flex items-center space-x-2.5"
                    >
                      <img
                        src={m.avatarUrl}
                        alt={m.name}
                        className="w-8 h-8 rounded-full object-cover border border-[#CDB9AB]"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center space-x-1">
                          <span className="text-xs font-bold text-charcoal truncate">
                            {m.name}
                          </span>
                          {m.role === "leader" && (
                            <span className="text-[9px] px-1 bg-[#F0EBE1] text-[#A48F82] border border-[#CDB9AB] rounded font-semibold">
                              组长
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-[#8C827A] truncate">{m.major}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Task Breakdown Checklist */}
              <div className="space-y-2.5 pt-2">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-bold text-[#8C827A] uppercase tracking-wider">
                    团队分工与任务清单 ({selectedProject.tasks.filter((t) => t.completed).length} / {selectedProject.tasks.length})
                  </h4>
                </div>

                <div className="space-y-2">
                  {selectedProject.tasks.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => toggleGroupTask(selectedProject.id, task.id)}
                      className="p-3 bg-[#F7F5F5] hover:bg-[#F0EBE1]/60 border border-[#E7E3DD] rounded-xl flex items-center justify-between cursor-pointer transition-colors text-xs"
                    >
                      <div className="flex items-center space-x-2.5">
                        {task.completed ? (
                          <CheckSquare className="w-4 h-4 text-[#065F46] shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-[#A48F82] shrink-0" />
                        )}
                        <span
                          className={`text-charcoal font-medium ${
                            task.completed ? "line-through text-[#8C827A]" : ""
                          }`}
                        >
                          {task.title}
                        </span>
                      </div>

                      <div className="flex items-center space-x-2 shrink-0">
                        <span className="text-[10px] text-[#8C827A] font-mono">
                          DDL: {task.ddl}
                        </span>
                        <div className="flex items-center space-x-1 bg-white border border-[#E0D7C6] px-2 py-0.5 rounded-full">
                          <img
                            src={task.assigneeAvatar}
                            alt={task.assigneeName}
                            className="w-3.5 h-3.5 rounded-full object-cover"
                          />
                          <span className="text-[10px] text-charcoal">{task.assigneeName}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Create Group Project Modal */}
      {isCreatingProject && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-drawer border border-[#E7E3DD] p-6 space-y-4">
            <h3 className="text-base font-bold text-charcoal">创建新协同小组</h3>
            <form onSubmit={handleCreateProject} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-[#8C827A]">关联课程</label>
                <select
                  value={newCourseId}
                  onChange={(e) => setNewCourseId(e.target.value)}
                  className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none mt-1"
                >
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-[#8C827A]">项目名称</label>
                <input
                  type="text"
                  placeholder="例如: 计量经济学期末论文小组"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none mt-1"
                  required
                />
              </div>

              <div>
                <label className="font-bold text-[#8C827A]">项目说明/任务目标</label>
                <textarea
                  rows={3}
                  placeholder="研究主题、分工规划及交付产物要求..."
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none mt-1 resize-none"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-[#F0EBE1]">
                <button
                  type="button"
                  onClick={() => setIsCreatingProject(false)}
                  className="px-4 py-2 text-xs font-medium text-[#676268] bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium text-white bg-charcoal rounded-xl"
                >
                  创建小组
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
