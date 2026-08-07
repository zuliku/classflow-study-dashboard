"use client";

import React, { useState } from "react";
import {
  Users2,
  Plus,
  CheckSquare,
  Square,
  Clock,
  User,
  ChevronRight,
  FolderPlus,
  Trash2,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { formatDistanceToNow } from "date-fns";
import { cardKeyHandler } from "@/lib/utils";
import { parseLocalDDL, combineLocalDateTime } from "@/lib/ddl";
import { formatLocalDate } from "@/lib/groupProject";
import { zhCN } from "date-fns/locale";
import { GroupMember } from "@/types";

/** 头像 fallback：无头像时显示姓名首字 */
function MemberAvatar({ member, size = "w-7 h-7", ring = false }: { member: GroupMember; size?: string; ring?: boolean }) {
  if (member.avatarUrl) {
    return (
      <img
        src={member.avatarUrl}
        alt={member.name}
        className={`${size} rounded-full object-cover ${ring ? "border border-stone-beige" : "border border-white"} shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${size} rounded-full bg-pastel-mint text-charcoal flex items-center justify-center text-[10px] font-bold ${
        ring ? "border border-stone-beige" : "border border-white"
      } shrink-0`}
    >
      {(member.name || "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

export function GroupCollaborationView() {
  const {
    groupProjects,
    courses,
    addGroupProject,
    updateGroupProject,
    deleteGroupProject,
    addGroupMember,
    deleteGroupMember,
    addGroupTask,
    deleteGroupTask,
    toggleGroupTask,
  } = useAppStore();
  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);

  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    groupProjects[0]?.id || ""
  );
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCourseId, setNewCourseId] = useState(courses[0]?.id || "");
  const [newDesc, setNewDesc] = useState("");

  // 编辑项目
  const [isEditingProject, setIsEditingProject] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // 添加成员
  const [memberName, setMemberName] = useState("");
  // 添加任务
  const [taskTitle, setTaskTitle] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState("");
  const [taskDdl, setTaskDdl] = useState("");

  const activeProject = groupProjects.find((p) => p.id === selectedProjectId) || groupProjects[0];

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    addGroupProject({
      courseId: newCourseId,
      title: newTitle,
      description: newDesc,
    });

    setNewTitle("");
    setNewDesc("");
    setIsCreatingProject(false);
    pushToast({ message: "项目已创建" });
  };

  const handleStartEditProject = () => {
    if (!activeProject) return;
    setEditTitle(activeProject.title);
    setEditDesc(activeProject.description);
    setIsEditingProject(true);
  };

  const handleSaveProject = () => {
    if (!activeProject || !editTitle.trim()) return;
    updateGroupProject(activeProject.id, { title: editTitle.trim(), description: editDesc });
    setIsEditingProject(false);
    pushToast({ message: "项目已更新" });
  };

  const handleDeleteProject = () => {
    if (!activeProject) return;
    confirmRequest({
      title: "删除项目？",
      description: `项目《${activeProject.title}》的成员与任务会一并删除，此操作无法撤销。`,
      confirmLabel: "删除项目",
      danger: true,
      onConfirm: () => {
        deleteGroupProject(activeProject.id);
        setSelectedProjectId("");
        pushToast({ message: "项目已删除" });
      },
    });
  };

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject || !memberName.trim()) return;
    addGroupMember(activeProject.id, { name: memberName.trim() });
    setMemberName("");
  };

  const handleRemoveMember = (memberId: string) => {
    if (!activeProject) return;
    const result = deleteGroupMember(activeProject.id, memberId);
    if (!result.ok) {
      pushToast({
        type: "warning",
        message: result.reason === "last_leader" ? "项目至少需要一名组长" : "成员不存在",
      });
    }
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject || !taskTitle.trim()) return;
    const date = taskDdl || formatLocalDate();
    addGroupTask(activeProject.id, {
      title: taskTitle.trim(),
      assigneeId: taskAssigneeId || undefined,
      ddl: combineLocalDateTime(date, "23:59"),
    });
    setTaskTitle("");
    setTaskAssigneeId("");
    setTaskDdl("");
  };

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-charcoal mb-0.5 flex items-center gap-2">
            <Users2 className="w-4 h-4 text-sandrift" />
            小组协作
          </h2>
          <p className="text-xs text-sandrift">
            小组成员与任务进度
          </p>
        </div>
        <button
          onClick={() => setIsCreatingProject(!isCreatingProject)}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-charcoal hover:bg-black text-white text-xs font-medium rounded-xl transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>新建项目</span>
        </button>
      </div>

      {/* New Project Form */}
      {isCreatingProject && (
        <form onSubmit={handleCreateProject} className="bg-surface border border-stone-beige rounded-2xl p-4 shadow-subtle space-y-3">
          <h3 className="text-sm font-bold text-charcoal flex items-center gap-1.5">
            <FolderPlus className="w-4 h-4 text-sandrift" />
            项目信息
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <input
              type="text"
              placeholder="项目 / 大作业名称"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="p-2.5 bg-white border border-line-strong rounded-xl focus:outline-none focus:border-sandrift"
              required
            />
            <select
              value={newCourseId}
              onChange={(e) => setNewCourseId(e.target.value)}
              className="p-2.5 bg-white border border-line-strong rounded-xl focus:outline-none"
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
            placeholder="项目说明"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            className="w-full text-xs p-2.5 bg-white border border-line-strong rounded-xl focus:outline-none resize-none"
          />
          <div className="flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => setIsCreatingProject(false)}
              className="px-3 py-1.5 text-xs text-satin-grey bg-alabaster border border-line rounded-xl"
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
          <h3 className="text-xs font-bold text-sandrift uppercase tracking-wider px-1">
            参与的大作业项目 ({groupProjects.length})
          </h3>
          <div className="space-y-2">
            {groupProjects.length === 0 ? (
              <div className="py-10 text-center text-xs text-sandrift bg-surface border border-line rounded-2xl">
                还没有小组项目
              </div>
            ) : (
              groupProjects.map((p) => {
                const isSelected = activeProject?.id === p.id;
                const course = courses.find((c) => c.id === p.courseId);
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedProjectId(p.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={cardKeyHandler(() => setSelectedProjectId(p.id))}
                    className={`p-4 rounded-2xl border transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)] cursor-pointer shadow-subtle flex flex-col justify-between ${
                      isSelected
                        ? "bg-pastel-mint/60 border-stone-beige ring-1 ring-stone-beige"
                        : "bg-surface border-line hover:bg-alabaster"
                    }`}
                  >
                    <div>
                      <span className="text-[10px] font-mono px-2 py-0.5 bg-white border border-line-strong rounded text-sandrift">
                        {course?.name || "通用课题"}
                      </span>
                      <h4 className="text-sm font-bold text-charcoal mt-2">{p.title}</h4>
                      <p className="text-xs text-satin-grey mt-1 line-clamp-2 leading-relaxed">
                        {p.description}
                      </p>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-line-strong/60 flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-1.5">
                        <div className="flex -space-x-1.5">
                          {p.members.map((m) => (
                            <MemberAvatar key={m.id} member={m} size="w-5 h-5" />
                          ))}
                        </div>
                        <span className="text-[10px] text-sandrift">{p.members.length} 人</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="text-[10px] font-bold text-charcoal">{p.progress}%</span>
                        <ChevronRight className="w-3.5 h-3.5 text-sandrift" />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right 2/3: Active Project Detail Panel */}
        {activeProject && (
          <div className="lg:col-span-2 space-y-4">
            {/* Project Overview Card */}
            <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line-soft pb-3">
                <div className="min-w-0">
                  <span className="text-xs font-mono text-sandrift px-2 py-0.5 bg-white rounded border border-line-strong">
                    {courses.find((c) => c.id === activeProject.courseId)?.name || "通用课题"}
                  </span>
                  {isEditingProject ? (
                    <div className="mt-1.5 flex items-center space-x-2">
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="p-1.5 bg-white border border-line-strong rounded-lg text-sm font-bold"
                      />
                      <button onClick={handleSaveProject} title="保存" aria-label="保存">
                        <Check className="w-4 h-4 text-success" />
                      </button>
                      <button onClick={() => setIsEditingProject(false)} title="取消" aria-label="取消">
                        <X className="w-4 h-4 text-sandrift" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2 mt-1.5">
                      <h3 className="text-lg font-bold text-charcoal">{activeProject.title}</h3>
                      <button
                        onClick={handleStartEditProject}
                        className="p-1 text-sandrift hover:bg-alabaster rounded-lg"
                        title="编辑项目"
                        aria-label="编辑项目"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={handleDeleteProject}
                        className="p-1 text-danger hover:bg-danger-bg rounded-lg"
                        title="删除项目"
                        aria-label="删除项目"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-xs text-sandrift">团队总进度</span>
                  <div className="text-2xl font-extrabold text-charcoal">{activeProject.progress}%</div>
                </div>
              </div>

              {isEditingProject ? (
                <textarea
                  rows={2}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full text-xs p-2.5 bg-white border border-line-strong rounded-xl focus:outline-none resize-none"
                  placeholder="项目说明"
                />
              ) : (
                <p className="text-xs text-satin-grey bg-white p-3 rounded-xl border border-line leading-relaxed">
                  {activeProject.description || "暂无项目说明"}
                </p>
              )}

              {/* Progress Bar */}
              <div className="w-full bg-alabaster rounded-full h-2 overflow-hidden">
                <div
                  className="bg-success h-2 rounded-full transition-[width] duration-[var(--motion-data)] ease-[var(--ease-emphasized)]"
                  style={{ width: `${activeProject.progress}%` }}
                />
              </div>

              {/* Members */}
              <div className="space-y-2 pt-2">
                <h4 className="text-xs font-bold text-sandrift uppercase tracking-wider">
                  小组成员 ({activeProject.members.length})
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {activeProject.members.map((m) => (
                    <div
                      key={m.id}
                      className="p-2.5 bg-white border border-line rounded-xl flex items-center space-x-2 text-xs group"
                    >
                      <MemberAvatar member={m} size="w-7 h-7" ring />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-charcoal truncate">{m.name}</p>
                        <span
                          className={`text-[9px] px-1 rounded ${
                            m.role === "leader"
                              ? "bg-stone-beige text-white"
                              : "bg-pastel-mint text-satin-grey"
                          }`}
                        >
                          {m.role === "leader" ? "组长" : "成员"}
                        </span>
                      </div>
                      <button
                        onClick={() => handleRemoveMember(m.id)}
                        className="p-1 text-sandrift hover:bg-danger-bg hover:text-danger rounded-lg opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                        title="移除成员"
                        aria-label={`移除成员 ${m.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add Member */}
                <form onSubmit={handleAddMember} className="flex items-center space-x-2 pt-1">
                  <input
                    type="text"
                    placeholder="成员姓名"
                    value={memberName}
                    onChange={(e) => setMemberName(e.target.value)}
                    className="flex-1 p-2 bg-white border border-line-strong rounded-lg text-xs focus:outline-none focus:border-sandrift"
                  />
                  <button
                    type="submit"
                    className="flex items-center space-x-1 px-2.5 py-2 bg-charcoal hover:bg-black text-white text-[11px] font-bold rounded-lg"
                  >
                    <Plus className="w-3 h-3" />
                    <span>添加成员</span>
                  </button>
                </form>
              </div>
            </div>

            {/* Task Checklist */}
            <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle space-y-3">
              <div className="flex items-center justify-between border-b border-line-soft pb-2.5">
                <h4 className="text-sm font-bold text-charcoal flex items-center gap-1.5">
                  <CheckSquare className="w-4 h-4 text-sandrift" />
                  任务清单 ({activeProject.tasks.filter((t) => t.completed).length} / {activeProject.tasks.length})
                </h4>
              </div>

              <div className="space-y-2">
                {activeProject.tasks.length === 0 && (
                  <p className="text-[11px] text-sandrift py-3 text-center bg-white border border-line rounded-xl">
                    还没有任务
                  </p>
                )}
                {activeProject.tasks.map((task) => {
                  const assignee = activeProject.members.find((m) => m.id === task.assigneeId);
                  const ddlDate = parseLocalDDL(task.ddl);
                  return (
                    <div
                      key={task.id}
                      className={`p-3 rounded-xl border transition-all flex items-center justify-between text-xs ${
                        task.completed
                          ? "bg-white border-line opacity-60"
                          : "bg-white border-line-strong hover:border-charcoal"
                      }`}
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <button
                          onClick={() => toggleGroupTask(activeProject.id, task.id)}
                          className="text-charcoal transition-colors shrink-0"
                          title={task.completed ? "标记未完成" : "标记完成"}
                          aria-label={task.completed ? "标记未完成" : "标记完成"}
                        >
                          {task.completed ? (
                            <CheckSquare className="w-4 h-4 text-success" />
                          ) : (
                            <Square className="w-4 h-4 text-sandrift" />
                          )}
                        </button>
                        <div className="min-w-0">
                          <span className={`font-semibold text-charcoal ${task.completed ? "line-through" : ""}`}>
                            {task.title}
                          </span>
                          <div className="flex items-center space-x-3 mt-1 text-[10px] text-sandrift">
                            <span className="flex items-center space-x-1">
                              <User className="w-3 h-3" />
                              <span>负责人：{assignee?.name ?? "未分配"}</span>
                            </span>
                            {ddlDate && (
                              <span className="flex items-center space-x-1">
                                <Clock className="w-3 h-3" />
                                <span>
                                  DDL: {formatDistanceToNow(ddlDate, { addSuffix: true, locale: zhCN })}
                                </span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {assignee ? (
                        <MemberAvatar member={assignee} size="w-6 h-6" ring />
                      ) : (
                        <span className="text-[10px] text-sandrift shrink-0">未分配</span>
                      )}
                      <button
                        onClick={() => deleteGroupTask(activeProject.id, task.id)}
                        className="p-1 ml-2 text-sandrift hover:bg-danger-bg hover:text-danger rounded-lg shrink-0"
                        title="删除任务"
                        aria-label={`删除任务 ${task.title}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Add Task */}
              <form onSubmit={handleAddTask} className="space-y-2 pt-1 border-t border-line-soft">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    placeholder="任务标题"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    className="sm:col-span-1 p-2 bg-white border border-line-strong rounded-lg text-xs focus:outline-none focus:border-sandrift"
                    required
                  />
                  <select
                    value={taskAssigneeId}
                    onChange={(e) => setTaskAssigneeId(e.target.value)}
                    className="p-2 bg-white border border-line-strong rounded-lg text-xs focus:outline-none"
                  >
                    <option value="">未分配</option>
                    {activeProject.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={taskDdl}
                    onChange={(e) => setTaskDdl(e.target.value)}
                    className="p-2 bg-white border border-line-strong rounded-lg text-xs font-mono focus:outline-none"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="flex items-center space-x-1 px-3 py-1.5 bg-charcoal hover:bg-black text-white text-[11px] font-bold rounded-lg"
                  >
                    <Plus className="w-3 h-3" />
                    <span>添加任务</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
