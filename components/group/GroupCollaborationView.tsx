"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
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
  X,
  Search,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { format, formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cardKeyHandler } from "@/lib/utils";
import { useEnterOnAdd } from "@/lib/useEnterOnAdd";
import { parseLocalDDL, getLocalDDLDate, getLocalDDLTime, combineLocalDateTime } from "@/lib/ddl";
import { formatLocalDate } from "@/lib/groupProject";
import { usePresence } from "@/lib/usePresence";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";
import { useKiroHandoff } from "@/hooks/useKiroHandoff";
import { KIRO_ICON } from "@/components/layout/navItems";
import { cn } from "@/lib/utils";
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

/** 小组模块统一弹窗壳（进入/退出动画 + Esc 顶层关闭 + 焦点恢复） */
function GroupModal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const overlayId = usePresenceId();
  const { mounted, visible } = usePresence(open, 220);
  useRestoreFocus(open);

  useEffect(() => {
    if (!mounted) return;
    pushOverlay(overlayId, 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopmostOverlay(overlayId)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      popOverlay(overlayId);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  if (!mounted) return null;

  // Portal 到 body：避免被 main 滚动容器 / 页面过渡等祖先的
  // transform、overflow、contain 约束，backdrop 保证全屏覆盖 Sidebar 与 Header
  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4",
        "ux-overlay",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      <div
        className={cn(
          "w-full max-w-md bg-surface rounded-2xl shadow-drawer border border-line overflow-hidden flex flex-col max-h-[85dvh]",
          "ux-modal-panel",
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.985] translate-y-1"
        )}
      >
        <div className="p-4 px-5 border-b border-line-soft flex items-center justify-between shrink-0">
          <h3 className="text-sm font-bold text-charcoal flex items-center gap-2">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto text-xs">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t border-line-soft flex justify-end space-x-2 shrink-0">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
}

let modalCounter = 0;
function usePresenceId(): string {
  const [id] = useState(() => `group-modal-${modalCounter++}`);
  return id;
}

const inputCls =
  "w-full p-2.5 bg-white border border-line-strong rounded-xl focus:outline-none focus:border-sandrift text-xs";
const labelCls = "font-bold text-sandrift block mb-1";

export function GroupCollaborationView() {
  const {
    groupProjects,
    courses,
    addGroupProject,
    updateGroupProject,
    deleteGroupProject,
    addGroupMember,
    updateGroupMember,
    deleteGroupMember,
    addGroupTask,
    updateGroupTask,
    deleteGroupTask,
    toggleGroupTask,
  } = useAppStore();
  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const handoff = useKiroHandoff();

  const [selectedProjectId, setSelectedProjectId] = useState<string>(groupProjects[0]?.id || "");

  // 弹窗表单状态：null = 关闭
  const [projectForm, setProjectForm] = useState<null | { mode: "create" } | { mode: "edit"; projectId: string }>(null);
  const [memberForm, setMemberForm] = useState<null | { mode: "create" } | { mode: "edit"; memberId: string }>(null);
  const [taskForm, setTaskForm] = useState<null | { mode: "create" } | { mode: "edit"; taskId: string }>(null);
  const [taskSearch, setTaskSearch] = useState("");

  // 新增小组任务：仅新创建的 item 出场（页面初次渲染不 stagger）
  const selectedProjectTasks = groupProjects.find((p) => p.id === selectedProjectId);
  const newTaskIds = useEnterOnAdd(selectedProjectTasks?.tasks.map((t) => t.id) ?? []);

  // 表单字段
  const [pName, setPName] = useState("");
  const [pCourseId, setPCourseId] = useState(courses[0]?.id || "");
  const [pDesc, setPDesc] = useState("");

  const [mName, setMName] = useState("");
  const [mRole, setMRole] = useState<GroupMember["role"]>("member");
  const [mMajor, setMMajor] = useState("");
  const [mAvatar, setMAvatar] = useState("");

  const [tTitle, setTTitle] = useState("");
  const [tAssigneeId, setTAssigneeId] = useState("");
  const [tDate, setTDate] = useState("");
  const [tTime, setTTime] = useState("23:59");

  const activeProject = groupProjects.find((p) => p.id === selectedProjectId) || groupProjects[0];
  const selectedProject = groupProjects.find((p) => p.id === selectedProjectId) || null;

  // ---- 项目表单 ----
  const openCreateProject = () => {
    setPName("");
    setPCourseId(courses[0]?.id || "");
    setPDesc("");
    setProjectForm({ mode: "create" });
  };

  const openEditProject = () => {
    if (!selectedProject) return;
    setPName(selectedProject.title);
    setPCourseId(selectedProject.courseId);
    setPDesc(selectedProject.description);
    setProjectForm({ mode: "edit", projectId: selectedProject.id });
  };

  const submitProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pName.trim() || !projectForm) return;
    if (projectForm.mode === "edit") {
      updateGroupProject(projectForm.projectId, {
        title: pName.trim(),
        description: pDesc,
        courseId: pCourseId || courses[0]?.id || "",
      });
      pushToast({ message: "项目已更新" });
    } else {
      const newId = addGroupProject({
        courseId: pCourseId || courses[0]?.id || "",
        title: pName.trim(),
        description: pDesc,
      });
      setSelectedProjectId(newId); // 创建后进入新项目
      pushToast({ message: "项目已创建" });
    }
    setProjectForm(null);
  };

  const handleDeleteProject = () => {
    if (!selectedProject) return;
    confirmRequest({
      title: "删除项目？",
      description: "项目中的成员与任务也会一并删除。",
      confirmLabel: "删除项目",
      danger: true,
      onConfirm: () => {
        deleteGroupProject(selectedProject.id);
        // 自动选中下一个项目，没有则进入空态
        const remaining = groupProjects.filter((p) => p.id !== selectedProject.id);
        setSelectedProjectId(remaining[0]?.id || "");
        pushToast({ message: "项目已删除" });
      },
    });
  };

  // ---- 成员表单 ----
  const openAddMember = () => {
    setMName("");
    setMRole("member");
    setMMajor("");
    setMAvatar("");
    setMemberForm({ mode: "create" });
  };

  const openEditMember = (member: GroupMember) => {
    setMName(member.name);
    setMRole(member.role);
    setMMajor(member.major ?? "");
    setMAvatar(member.avatarUrl ?? "");
    setMemberForm({ mode: "edit", memberId: member.id });
  };

  const submitMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || !mName.trim() || !memberForm) return;
    if (memberForm.mode === "edit") {
      const existing = selectedProject.members.find((m) => m.id === memberForm.memberId);
      if (existing) {
        updateGroupMember(selectedProject.id, {
          ...existing,
          name: mName.trim(),
          role: mRole,
          major: mMajor.trim() || undefined,
          avatarUrl: mAvatar.trim() || undefined,
        });
      }
      pushToast({ message: "成员已更新" });
    } else {
      addGroupMember(selectedProject.id, {
        name: mName.trim(),
        role: mRole,
        major: mMajor.trim() || undefined,
        avatarUrl: mAvatar.trim() || undefined,
      });
      pushToast({ message: "成员已添加" });
    }
    setMemberForm(null);
  };

  const handleRemoveMember = (memberId: string) => {
    if (!selectedProject) return;
    const result = deleteGroupMember(selectedProject.id, memberId);
    if (!result.ok) {
      pushToast({
        type: "warning",
        message: result.reason === "last_leader" ? "项目至少需要一名组长" : "成员不存在",
      });
      return;
    }
    pushToast({ message: "成员已移除，相关任务已设为未分配" });
  };

  // ---- 任务表单 ----
  const openAddTask = () => {
    setTTitle("");
    setTAssigneeId("");
    setTDate(formatLocalDate());
    setTTime("23:59");
    setTaskForm({ mode: "create" });
  };

  const openEditTask = (taskId: string) => {
    if (!selectedProject) return;
    const task = selectedProject.tasks.find((t) => t.id === taskId);
    if (!task) return;
    setTTitle(task.title);
    setTAssigneeId(task.assigneeId ?? "");
    setTDate(getLocalDDLDate(task.ddl));
    setTTime(getLocalDDLTime(task.ddl));
    setTaskForm({ mode: "edit", taskId });
  };

  const submitTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || !tTitle.trim() || !tDate || !taskForm) return;
    const ddl = combineLocalDateTime(tDate, tTime || "23:59");
    if (taskForm.mode === "edit") {
      const existing = selectedProject.tasks.find((t) => t.id === taskForm.taskId);
      if (existing) {
        updateGroupTask(selectedProject.id, {
          ...existing,
          title: tTitle.trim(),
          assigneeId: tAssigneeId || undefined,
          ddl,
        });
      }
      pushToast({ message: "任务已更新" });
    } else {
      addGroupTask(selectedProject.id, {
        title: tTitle.trim(),
        assigneeId: tAssigneeId || undefined,
        ddl,
      });
      pushToast({ message: "任务已添加" });
    }
    setTaskForm(null);
  };

  const handleDeleteTask = (taskId: string) => {
    if (!selectedProject) return;
    deleteGroupTask(selectedProject.id, taskId);
    pushToast({ message: "任务已删除" });
  };

  const filteredTasks = selectedProject
    ? selectedProject.tasks.filter((t) => t.title.toLowerCase().includes(taskSearch.trim().toLowerCase()))
    : [];

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-charcoal mb-0.5 flex items-center gap-2">
            <Users2 className="w-4 h-4 text-sandrift" />
            小组协作
          </h2>
          <p className="text-xs text-sandrift">管理小组项目、成员与任务分工</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {activeProject && (
            <button
              onClick={() => handoff.openForGroupProject(activeProject.id)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-pastel-mint hover:bg-pastel-mint text-charcoal text-xs font-bold rounded-xl transition-colors shrink-0"
              title="Ask Kiro"
            >
              <KIRO_ICON className="w-3.5 h-3.5" />
              <span>Ask Kiro</span>
            </button>
          )}
          <button
            onClick={openCreateProject}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-charcoal hover:bg-black text-white text-xs font-medium rounded-xl transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新建项目</span>
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Left: Project List */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-sandrift uppercase tracking-wider px-1">
            参与的大作业项目 ({groupProjects.length})
          </h3>
          {groupProjects.length === 0 ? (
            <div className="py-10 text-center space-y-2 bg-surface border border-line rounded-2xl">
              <p className="text-xs font-semibold text-charcoal">还没有小组项目</p>
              <p className="text-[11px] text-sandrift">创建项目后，可以在这里管理成员和任务分工。</p>
              <button
                onClick={openCreateProject}
                className="inline-flex items-center space-x-1 px-3 py-1.5 bg-charcoal hover:bg-black text-white text-[11px] font-bold rounded-xl transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>新建项目</span>
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {groupProjects.map((p) => {
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
                        <span className="text-[10px] font-bold text-charcoal">
                          {p.tasks.filter((t) => t.completed).length} / {p.tasks.length} · {p.progress}%
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 text-sandrift" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Project Detail */}
        {selectedProject && (
          <div className="lg:col-span-2 space-y-4">
            {/* Overview */}
            <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line-soft pb-3">
                <div className="min-w-0">
                  <span className="text-xs font-mono text-sandrift px-2 py-0.5 bg-white rounded border border-line-strong">
                    {courses.find((c) => c.id === selectedProject.courseId)?.name || "通用课题"}
                  </span>
                  <div className="flex items-center space-x-2 mt-1.5">
                    <h3 className="text-lg font-bold text-charcoal truncate">{selectedProject.title}</h3>
                    <button
                      onClick={openEditProject}
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
                </div>
                <div className="text-right">
                  <span className="text-xs text-sandrift">团队总进度</span>
                  <div className="text-2xl font-extrabold text-charcoal">{selectedProject.progress}%</div>
                </div>
              </div>

              <p className="text-xs text-satin-grey bg-white p-3 rounded-xl border border-line leading-relaxed">
                {selectedProject.description || "暂无项目说明"}
              </p>

              <div className="w-full bg-alabaster rounded-full h-2 overflow-hidden">
                <div
                  className="bg-success h-2 rounded-full transition-[width] duration-[var(--motion-data)] ease-[var(--ease-emphasized)]"
                  style={{ width: `${selectedProject.progress}%` }}
                />
              </div>

              {/* Members */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-sandrift uppercase tracking-wider">
                    小组成员 ({selectedProject.members.length})
                  </h4>
                  <button
                    onClick={openAddMember}
                    className="flex items-center space-x-1 text-[11px] font-bold text-charcoal hover:bg-alabaster px-2 py-1 rounded-lg transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>添加成员</span>
                  </button>
                </div>

                {selectedProject.members.length === 0 ? (
                  <div className="py-6 text-center space-y-2 bg-white border border-line rounded-xl">
                    <p className="text-[11px] text-sandrift">还没有成员</p>
                    <button
                      onClick={openAddMember}
                      className="inline-flex items-center space-x-1 px-3 py-1.5 bg-charcoal hover:bg-black text-white text-[11px] font-bold rounded-lg"
                    >
                      <Plus className="w-3 h-3" />
                      <span>添加成员</span>
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {selectedProject.members.map((m) => (
                      <div
                        key={m.id}
                        className="p-2.5 bg-white border border-line rounded-xl flex items-center space-x-2 text-xs group"
                      >
                        <MemberAvatar member={m} size="w-7 h-7" ring />
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-charcoal truncate">{m.name}</p>
                          <div className="flex items-center space-x-1.5">
                            <span
                              className={cn(
                                "text-[9px] px-1 rounded",
                                m.role === "leader"
                                  ? "bg-stone-beige text-white"
                                  : "bg-pastel-mint text-satin-grey"
                              )}
                            >
                              {m.role === "leader" ? "组长" : "组员"}
                            </span>
                            {m.major && (
                              <span className="text-[9px] text-sandrift truncate">{m.major}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col shrink-0">
                          <button
                            onClick={() => openEditMember(m)}
                            className="p-1 text-sandrift hover:bg-alabaster rounded-lg opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                            title="编辑成员"
                            aria-label={`编辑成员 ${m.name}`}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleRemoveMember(m.id)}
                            className="p-1 text-sandrift hover:bg-danger-bg hover:text-danger rounded-lg opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                            title="移除成员"
                            aria-label={`移除成员 ${m.name}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Tasks */}
            <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle space-y-3">
              <div className="flex items-center justify-between border-b border-line-soft pb-2.5 gap-2">
                <h4 className="text-sm font-bold text-charcoal flex items-center gap-1.5">
                  <CheckSquare className="w-4 h-4 text-sandrift" />
                  任务清单 ({selectedProject.tasks.filter((t) => t.completed).length} / {selectedProject.tasks.length})
                </h4>
                <div className="flex items-center space-x-2">
                  {/* 任务检索 */}
                  <div className="flex items-center space-x-1 bg-white border border-line-strong rounded-lg px-2 py-1">
                    <Search className="w-3 h-3 text-sandrift shrink-0" />
                    <input
                      type="text"
                      placeholder="检索任务"
                      value={taskSearch}
                      onChange={(e) => setTaskSearch(e.target.value)}
                      className="w-24 sm:w-32 bg-transparent text-[11px] focus:outline-none placeholder-sandrift"
                      aria-label="检索任务"
                    />
                    {taskSearch && (
                      <button onClick={() => setTaskSearch("")} aria-label="清除检索" className="text-sandrift hover:text-charcoal">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <button
                    onClick={openAddTask}
                    className="flex items-center space-x-1 px-2.5 py-1.5 bg-charcoal hover:bg-black text-white text-[11px] font-bold rounded-lg transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>添加任务</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {filteredTasks.length === 0 ? (
                  <div className="py-6 text-center space-y-2 bg-white border border-line rounded-xl">
                    <p className="text-[11px] text-sandrift">
                      {selectedProject.tasks.length === 0 ? "还没有任务" : "没有匹配的任务"}
                    </p>
                    {selectedProject.tasks.length === 0 && (
                      <button
                        onClick={openAddTask}
                        className="inline-flex items-center space-x-1 px-3 py-1.5 bg-charcoal hover:bg-black text-white text-[11px] font-bold rounded-lg"
                      >
                        <Plus className="w-3 h-3" />
                        <span>添加任务</span>
                      </button>
                    )}
                  </div>
                ) : (
                  filteredTasks.map((task) => {
                    const assignee = selectedProject.members.find((m) => m.id === task.assigneeId);
                    const ddlDate = parseLocalDDL(task.ddl);
                    return (
                      <div
                        key={task.id}
                        className={cn(
                          "p-3 rounded-xl border transition-colors flex items-center justify-between text-xs group",
                          newTaskIds.has(task.id) && "animate-enter",
                          task.completed
                            ? "bg-white border-line"
                            : "bg-white border-line-strong hover:border-charcoal"
                        )}
                      >
                        <div className="flex items-center space-x-3 min-w-0">
                          <button
                            onClick={() => toggleGroupTask(selectedProject.id, task.id)}
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
                            <span className={cn("font-semibold", task.completed ? "text-satin-grey line-through" : "text-charcoal")}>
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
                                    {format(ddlDate, "M月d日 HH:mm", { locale: zhCN })}
                                    {" · "}
                                    {formatDistanceToNow(ddlDate, { addSuffix: true, locale: zhCN })}
                                  </span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-1 shrink-0">
                          {assignee ? <MemberAvatar member={assignee} size="w-6 h-6" ring /> : null}
                          <button
                            onClick={() => openEditTask(task.id)}
                            className="p-1 text-sandrift hover:bg-alabaster rounded-lg opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                            title="编辑任务"
                            aria-label={`编辑任务 ${task.title}`}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            className="p-1 text-sandrift hover:bg-danger-bg hover:text-danger rounded-lg opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                            title="删除任务"
                            aria-label={`删除任务 ${task.title}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ===== 弹窗表单 ===== */}

      {/* 新建 / 编辑项目 */}
      <GroupModal
        open={!!projectForm}
        title={
          <span className="flex items-center gap-2">
            <FolderPlus className="w-4 h-4 text-sandrift" />
            {projectForm?.mode === "edit" ? "编辑项目" : "新建项目"}
          </span>
        }
        onClose={() => setProjectForm(null)}
      >
          <form id="group-project-form" onSubmit={submitProject} className="space-y-3">
            <div>
              <label className={labelCls}>项目名称 *</label>
              <input type="text" value={pName} onChange={(e) => setPName(e.target.value)} className={inputCls} autoFocus required />
            </div>
            <div>
              <label className={labelCls}>关联课程 *</label>
              <select value={pCourseId} onChange={(e) => setPCourseId(e.target.value)} className={inputCls}>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>项目说明</label>
              <textarea rows={3} value={pDesc} onChange={(e) => setPDesc(e.target.value)} className={`${inputCls} resize-none`} />
            </div>
          </form>
          <div className="flex justify-end space-x-2">
            <button onClick={() => setProjectForm(null)} className="px-4 py-2 text-xs font-medium text-satin-grey bg-alabaster border border-line rounded-xl hover:bg-alba">
              取消
            </button>
            <button
              type="submit"
              form="group-project-form"
              className="ux-press px-4 py-2 text-xs font-bold text-white bg-charcoal rounded-xl hover:bg-black"
            >
              {projectForm?.mode === "edit" ? "保存修改" : "创建项目"}
            </button>
          </div>
        </GroupModal>

      {/* 添加 / 编辑成员 */}
      <GroupModal
        open={!!memberForm && !!selectedProject}
        title={
          <span className="flex items-center gap-2">
            <User className="w-4 h-4 text-sandrift" />
            {memberForm?.mode === "edit" ? "编辑成员" : "添加成员"}
          </span>
        }
        onClose={() => setMemberForm(null)}
      >
          <form id="group-member-form" onSubmit={submitMember} className="space-y-3">
            <div>
              <label className={labelCls}>姓名 *</label>
              <input type="text" value={mName} onChange={(e) => setMName(e.target.value)} className={inputCls} autoFocus required />
            </div>
            <div>
              <label className={labelCls}>身份</label>
              <select value={mRole} onChange={(e) => setMRole(e.target.value as GroupMember["role"])} className={inputCls}>
                <option value="member">组员</option>
                <option value="leader">组长</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>专业（可选）</label>
              <input type="text" value={mMajor} onChange={(e) => setMMajor(e.target.value)} className={inputCls} placeholder="如：经济学" />
            </div>
            <div>
              <label className={labelCls}>头像 URL（可选）</label>
              <input type="text" value={mAvatar} onChange={(e) => setMAvatar(e.target.value)} className={inputCls} placeholder="留空则显示姓名首字" />
            </div>
          </form>
          <div className="flex justify-end space-x-2">
            <button onClick={() => setMemberForm(null)} className="px-4 py-2 text-xs font-medium text-satin-grey bg-alabaster border border-line rounded-xl hover:bg-alba">
              取消
            </button>
            <button type="submit" form="group-member-form" className="ux-press px-4 py-2 text-xs font-bold text-white bg-charcoal rounded-xl hover:bg-black">
              {memberForm?.mode === "edit" ? "保存修改" : "添加成员"}
            </button>
          </div>
        </GroupModal>

      {/* 添加 / 编辑任务 */}
      <GroupModal
        open={!!taskForm && !!selectedProject}
        title={
          <span className="flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-sandrift" />
            {taskForm?.mode === "edit" ? "编辑任务" : "添加任务"}
          </span>
        }
        onClose={() => setTaskForm(null)}
      >
          <form id="group-task-form" onSubmit={submitTask} className="space-y-3">
            <div>
              <label className={labelCls}>任务名称 *</label>
              <input type="text" value={tTitle} onChange={(e) => setTTitle(e.target.value)} className={inputCls} autoFocus required />
            </div>
            <div>
              <label className={labelCls}>负责人</label>
              <select value={tAssigneeId} onChange={(e) => setTAssigneeId(e.target.value)} className={inputCls}>
                <option value="">未分配</option>
                {(selectedProject?.members ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>截止日期 *</label>
                <input type="date" value={tDate} onChange={(e) => setTDate(e.target.value)} className={inputCls} required />
              </div>
              <div>
                <label className={labelCls}>截止时间</label>
                <input type="time" value={tTime} onChange={(e) => setTTime(e.target.value)} className={inputCls} />
              </div>
            </div>
          </form>
          <div className="flex justify-end space-x-2">
            <button onClick={() => setTaskForm(null)} className="px-4 py-2 text-xs font-medium text-satin-grey bg-alabaster border border-line rounded-xl hover:bg-alba">
              取消
            </button>
            <button type="submit" form="group-task-form" className="ux-press px-4 py-2 text-xs font-bold text-white bg-charcoal rounded-xl hover:bg-black">
              {taskForm?.mode === "edit" ? "保存修改" : "添加任务"}
            </button>
          </div>
        </GroupModal>
    </div>
  );
}
