"use client";

import React, { useState } from "react";
import {
  Users2,
  Plus,
  CheckSquare,
  Square,
  Clock,
  User,
  Calendar,
  ChevronRight,
  FolderPlus,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { formatDistanceToNow, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";

export function GroupCollaborationView() {
  const { groupProjects, toggleGroupTask, addGroupProject, courses } = useAppStore();
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    groupProjects[0]?.id || ""
  );
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCourseId, setNewCourseId] = useState(courses[0]?.id || "");
  const [newDesc, setNewDesc] = useState("");

  const activeProject = groupProjects.find((p) => p.id === selectedProjectId) || groupProjects[0];

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    addGroupProject({
      courseId: newCourseId,
      title: newTitle,
      description: newDesc || "小组大作业分工与进度追踪",
      members: [
        {
          id: "m_user",
          name: "张同学 (我)",
          avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
          role: "leader",
          major: "金融学",
        },
        {
          id: "m_2",
          name: "李同学",
          avatarUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
          role: "member",
          major: "会计学",
        },
      ],
      tasks: [
        {
          id: `gt_${Date.now()}_1`,
          title: "查找文献与前期资料收集",
          assigneeName: "李同学",
          assigneeAvatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
          ddl: new Date(Date.now() + 86400000 * 3).toISOString(),
          completed: false,
        },
        {
          id: `gt_${Date.now()}_2`,
          title: "撰写项目报告第一章节与框架大纲",
          assigneeName: "张同学 (我)",
          assigneeAvatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
          ddl: new Date(Date.now() + 86400000 * 5).toISOString(),
          completed: false,
        },
      ],
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
          <h2 className="text-base font-bold text-charcoal mb-0.5 flex items-center gap-2">
            <Users2 className="w-4 h-4 text-[#A48F82]" />
            小组大作业协作
          </h2>
          <p className="text-xs text-[#8C827A]">
            小组成员分工与任务进度
          </p>
        </div>
        <button
          onClick={() => setIsCreatingProject(!isCreatingProject)}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-charcoal hover:bg-black text-white text-xs font-medium rounded-xl transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>新建小组项目</span>
        </button>
      </div>

      {/* New Project Form */}
      {isCreatingProject && (
        <form onSubmit={handleCreateProject} className="bg-white border border-[#CDB9AB] rounded-2xl p-4 shadow-subtle space-y-3">
          <h3 className="text-sm font-bold text-charcoal flex items-center gap-1.5">
            <FolderPlus className="w-4 h-4 text-[#A48F82]" />
            创建大作业协同项目
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <input
              type="text"
              placeholder="项目/大作业名称 (例如: DTC品牌4P营销案例研讨)..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none focus:border-charcoal"
              required
            />
            <select
              value={newCourseId}
              onChange={(e) => setNewCourseId(e.target.value)}
              className="p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none"
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>
          <textarea
            rows={2}
            placeholder="项目说明与组内要求..."
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            className="w-full text-xs p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl focus:outline-none resize-none"
          />
          <div className="flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => setIsCreatingProject(false)}
              className="px-3 py-1.5 text-xs text-[#676268] bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 text-xs text-white bg-charcoal rounded-xl font-medium"
            >
              确认创建
            </button>
          </div>
        </form>
      )}

      {/* Main Grid: Projects List + Project Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Left 1/3: Projects Selector List */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-[#8C827A] uppercase tracking-wider px-1">
            参与的大作业项目 ({groupProjects.length})
          </h3>
          <div className="space-y-2">
            {groupProjects.map((p) => {
              const isSelected = activeProject?.id === p.id;
              const course = courses.find((c) => c.id === p.courseId);
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedProjectId(p.id)}
                  className={`p-4 rounded-2xl border transition-all duration-200 cursor-pointer shadow-subtle flex flex-col justify-between ${
                    isSelected
                      ? "bg-[#E3E6E0]/60 border-[#CDB9AB] ring-1 ring-[#CDB9AB]"
                      : "bg-white border-[#E7E3DD] hover:bg-[#F7F5F5]"
                  }`}
                >
                  <div>
                    <span className="text-[10px] font-mono px-2 py-0.5 bg-white border border-[#E0D7C6] rounded text-[#8C827A]">
                      {course?.name || "通用课题"}
                    </span>
                    <h4 className="text-sm font-bold text-charcoal mt-2">
                      {p.title}
                    </h4>
                    <p className="text-xs text-[#676268] mt-1 line-clamp-2 leading-relaxed">
                      {p.description}
                    </p>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-[#E0D7C6]/60 flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-1.5">
                      <div className="flex -space-x-1.5">
                        {p.members.map((m) => (
                          <img
                            key={m.id}
                            src={m.avatarUrl}
                            alt={m.name}
                            className="w-5 h-5 rounded-full border border-white object-cover"
                            title={`${m.name} (${m.role === "leader" ? "组长" : "组员"})`}
                          />
                        ))}
                      </div>
                      <span className="text-[10px] text-[#8C827A]">
                        {p.members.length} 人
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-bold text-charcoal">
                        {p.progress}%
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-[#8C827A]" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right 2/3: Active Project Detail Panel */}
        {activeProject && (
          <div className="lg:col-span-2 space-y-4">
            {/* Project Overview Card */}
            <div className="bg-white border border-[#E7E3DD] rounded-2xl p-5 shadow-subtle space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#F0EBE1] pb-3">
                <div>
                  <span className="text-xs font-mono text-[#8C827A] px-2 py-0.5 bg-[#F7F5F5] rounded border border-[#E7E3DD]">
                    {courses.find((c) => c.id === activeProject.courseId)?.name}
                  </span>
                  <h3 className="text-lg font-bold text-charcoal mt-1.5">
                    {activeProject.title}
                  </h3>
                </div>
                <div className="text-right">
                  <span className="text-xs text-[#8C827A]">团队总进度</span>
                  <div className="text-2xl font-extrabold text-charcoal">
                    {activeProject.progress}%
                  </div>
                </div>
              </div>

              <p className="text-xs text-[#676268] bg-[#F7F5F5] p-3 rounded-xl border border-[#E7E3DD] leading-relaxed">
                {activeProject.description}
              </p>

              {/* Progress Bar */}
              <div className="w-full bg-[#F0EBE1] rounded-full h-2 overflow-hidden">
                <div
                  className="bg-[#4A7C59] h-2 rounded-full transition-all duration-500"
                  style={{ width: `${activeProject.progress}%` }}
                />
              </div>

              {/* Member Avatars & Roles */}
              <div className="space-y-2 pt-2">
                <h4 className="text-xs font-bold text-[#8C827A] uppercase tracking-wider">
                  小组成员与角色分工
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {activeProject.members.map((m) => (
                    <div
                      key={m.id}
                      className="p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl flex items-center space-x-2 text-xs"
                    >
                      <img
                        src={m.avatarUrl}
                        alt={m.name}
                        className="w-7 h-7 rounded-full object-cover border border-[#CDB9AB]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-charcoal truncate">{m.name}</p>
                        <span
                          className={`text-[9px] px-1 rounded ${
                            m.role === "leader"
                              ? "bg-[#CDB9AB] text-white"
                              : "bg-[#E3E6E0] text-[#676268]"
                          }`}
                        >
                          {m.role === "leader" ? "组长" : "成员"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Task Breakdown Checklist */}
            <div className="bg-white border border-[#E7E3DD] rounded-2xl p-5 shadow-subtle space-y-3">
              <div className="flex items-center justify-between border-b border-[#F0EBE1] pb-2.5">
                <h4 className="text-sm font-bold text-charcoal flex items-center gap-1.5">
                  <CheckSquare className="w-4 h-4 text-[#A48F82]" />
                  分工任务清单 ({activeProject.tasks.filter((t) => t.completed).length} / {activeProject.tasks.length})
                </h4>
              </div>

              <div className="space-y-2">
                {activeProject.tasks.map((task) => {
                  const ddlDate = parseISO(task.ddl);
                  return (
                    <div
                      key={task.id}
                      onClick={() => toggleGroupTask(activeProject.id, task.id)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between text-xs ${
                        task.completed
                          ? "bg-[#F7F5F5] border-[#E7E3DD] opacity-60 line-through"
                          : "bg-white border-[#E0D7C6] hover:border-charcoal"
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <button className="text-charcoal transition-colors">
                          {task.completed ? (
                            <CheckSquare className="w-4 h-4 text-[#4A7C59]" />
                          ) : (
                            <Square className="w-4 h-4 text-[#8C827A]" />
                          )}
                        </button>
                        <div>
                          <span className="font-semibold text-charcoal">
                            {task.title}
                          </span>
                          <div className="flex items-center space-x-3 mt-1 text-[10px] text-[#8C827A]">
                            <span className="flex items-center space-x-1">
                              <User className="w-3 h-3" />
                              <span>负责人: {task.assigneeName}</span>
                            </span>
                            <span className="flex items-center space-x-1">
                              <Clock className="w-3 h-3" />
                              <span>
                                DDL: {formatDistanceToNow(ddlDate, { addSuffix: true, locale: zhCN })}
                              </span>
                            </span>
                          </div>
                        </div>
                      </div>

                      <img
                        src={task.assigneeAvatar}
                        alt={task.assigneeName}
                        className="w-6 h-6 rounded-full border border-[#CDB9AB] shrink-0"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
