"use client";

import React, { useState, useEffect } from "react";

import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { SearchField } from "@/components/ui/SearchField";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Plus,
  CheckSquare,

  Clock,
  User,
  ChevronRight,
  FolderPlus,
  Trash2,
  Pencil,
  X,

} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { UISelect } from "@/components/ui/Select";
import { format, formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cardKeyHandler } from "@/lib/utils";
import { useEnterOnAdd } from "@/lib/useEnterOnAdd";
import { parseLocalDDL, getLocalDDLDate, getLocalDDLTime, combineLocalDateTime } from "@/lib/ddl";
import { formatLocalDate } from "@/lib/groupProject";



import { useKiroHandoff } from "@/hooks/useKiroHandoff";
import { KIRO_ICON } from "@/components/layout/navItems";
import { KiroFlowButton } from "@/components/kiro/KiroFlow";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/Dialog";
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

/** 小组模块统一弹窗壳（enter/exit 动画 + Esc 顶层关闭 + 焦点恢复 → 委托全局 Dialog；保留 feature-local wrapper） */
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      overlayId={overlayId}
      stackZ={50}
      aria-label="小组项目"
      className="max-w-md max-h-[85dvh]"
    >
      <div className="p-4 px-5 border-b border-line-soft flex items-center justify-between shrink-0">
        <h3 className="text-sm font-bold text-charcoal flex items-center gap-2">{title}</h3>
        <IconButton
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="关闭"
        >
          <X className="w-4 h-4" />
        </IconButton>
      </div>
      <div className="p-5 space-y-3 overflow-y-auto text-xs">{children}</div>
      {footer && (
        <div className="px-5 py-3 border-t border-line-soft flex justify-end space-x-2 shrink-0">{footer}</div>
      )}
    </Dialog>
  );
}

let modalCounter = 0;
function usePresenceId(): string {
  const [id] = useState(() => `group-modal-${modalCounter++}`);
  return id;
}

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
      {/* Task 1：统一 Workspace Header（Banner 已删除；Ask Kiro 仅 activeProject 时显示） */}
      <WorkspaceHeader
        title="小组协作"
        context={`${groupProjects.length} 个项目`}
        actions={
          activeProject ? (
            <KiroFlowButton
              icon={KIRO_ICON}
              label="Ask Kiro"
              size="sm"
              className="h-8"
              onClick={() => handoff.openForGroupProject(activeProject.id)}
            />
          ) : undefined
        }
        primaryAction={
          <Button variant="primary" size="sm" onClick={openCreateProject}>
            <Plus className="h-3.5 w-3.5" />
            <span>新建项目</span>
          </Button>
        }
        sticky
      />

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
              <Button variant="primary" size="sm" onClick={openCreateProject}>
                <Plus className="w-3 h-3" />
                <span>新建项目</span>
              </Button>
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
                  <div className="flex items-center space-x-1 mt-1.5">
                    <h3 className="text-lg font-bold text-charcoal truncate">{selectedProject.title}</h3>
                    <IconButton
                      variant="ghost"
                      size="sm"
                      onClick={openEditProject}
                      title="编辑项目"
                      aria-label="编辑项目"
                      className="h-7 w-7"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </IconButton>
                    <IconButton
                      variant="danger"
                      size="sm"
                      onClick={handleDeleteProject}
                      title="删除项目"
                      aria-label="删除项目"
                      className="h-7 w-7"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </IconButton>
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
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={openAddMember}
                    className="h-7 px-2 text-[11px]"
                  >
                    <Plus className="w-3 h-3" />
                    <span>添加成员</span>
                  </Button>
                </div>

                {selectedProject.members.length === 0 ? (
                  <div className="py-6 text-center space-y-2 bg-white border border-line rounded-xl">
                    <p className="text-[11px] text-sandrift">还没有成员</p>
                    <Button variant="primary" size="sm" onClick={openAddMember}>
                      <Plus className="w-3 h-3" />
                      <span>添加成员</span>
                    </Button>
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
                          <IconButton
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditMember(m)}
                            aria-label={`编辑成员 ${m.name}`}
                            title="编辑成员"
                            className="h-6 w-6 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          >
                            <Pencil className="w-3 h-3" />
                          </IconButton>
                          <IconButton
                            variant="danger"
                            size="sm"
                            onClick={() => handleRemoveMember(m.id)}
                            aria-label={`移除成员 ${m.name}`}
                            title="移除成员"
                            className="h-6 w-6 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          >
                            <Trash2 className="w-3 h-3" />
                          </IconButton>
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
                <div className="flex items-center gap-2">
                  {/* 任务检索 */}
                  <SearchField
                    value={taskSearch}
                    onChange={(e) => setTaskSearch(e.target.value)}
                    onClear={() => setTaskSearch("")}
                    placeholder="检索任务"
                    aria-label="检索任务"
                    className="w-28 sm:w-36"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={openAddTask}
                    className="h-7 px-2.5 text-[11px]"
                  >
                    <Plus className="w-3 h-3" />
                    <span>添加任务</span>
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {filteredTasks.length === 0 ? (
                  <div className="py-6 text-center space-y-2 bg-white border border-line rounded-xl">
                    <p className="text-[11px] text-sandrift">
                      {selectedProject.tasks.length === 0 ? "还没有任务" : "没有匹配的任务"}
                    </p>
                    {selectedProject.tasks.length === 0 && (
                      <Button variant="primary" size="sm" onClick={openAddTask}>
                        <Plus className="w-3 h-3" />
                        <span>添加任务</span>
                      </Button>
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
                          <Checkbox
                            checked={task.completed}
                            onChange={() => toggleGroupTask(selectedProject.id, task.id)}
                            aria-label={task.completed ? "标记未完成" : "标记完成"}
                          />
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
                          <IconButton
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditTask(task.id)}
                            aria-label={`编辑任务 ${task.title}`}
                            title="编辑任务"
                            className="h-6 w-6 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          >
                            <Pencil className="w-3 h-3" />
                          </IconButton>
                          <IconButton
                            variant="danger"
                            size="sm"
                            onClick={() => handleDeleteTask(task.id)}
                            aria-label={`删除任务 ${task.title}`}
                            title="删除任务"
                            className="h-6 w-6 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          >
                            <Trash2 className="w-3 h-3" />
                          </IconButton>
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
          <form id="group-project-form" onSubmit={submitProject} className="space-y-4">
            <Field label="项目名称" required htmlFor="group-project-name">
              <Input
                id="group-project-name"
                type="text"
                value={pName}
                onChange={(e) => setPName(e.target.value)}
                autoFocus
                required
              />
            </Field>
            <Field label="关联课程" required>
              <UISelect
                value={pCourseId}
                onChange={setPCourseId}
                ariaLabel="关联课程"
                options={courses.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
              />
            </Field>
            <Field label="项目说明">
              <Textarea rows={3} value={pDesc} onChange={(e) => setPDesc(e.target.value)} />
            </Field>
          </form>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setProjectForm(null)}>
              取消
            </Button>
            <Button
              type="submit"
              form="group-project-form"
              variant="primary"
              size="sm"
            >
              {projectForm?.mode === "edit" ? "保存修改" : "创建项目"}
            </Button>
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
          <form id="group-member-form" onSubmit={submitMember} className="space-y-4">
            <Field label="姓名" required htmlFor="group-member-name">
              <Input
                id="group-member-name"
                type="text"
                value={mName}
                onChange={(e) => setMName(e.target.value)}
                autoFocus
                required
              />
            </Field>
            <Field label="身份">
              <UISelect<GroupMember["role"]>
                value={mRole}
                onChange={setMRole}
                ariaLabel="成员角色"
                options={[{ value: "member", label: "组员" }, { value: "leader", label: "组长" }]}
              />
            </Field>
            <Field label="专业" description="可选">
              <Input
                type="text"
                value={mMajor}
                onChange={(e) => setMMajor(e.target.value)}
                placeholder="如：经济学"
              />
            </Field>
            <Field label="头像 URL" description="留空则显示姓名首字">
              <Input
                type="text"
                value={mAvatar}
                onChange={(e) => setMAvatar(e.target.value)}
                placeholder="https://…"
              />
            </Field>
          </form>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setMemberForm(null)}>
              取消
            </Button>
            <Button type="submit" form="group-member-form" variant="primary" size="sm">
              {memberForm?.mode === "edit" ? "保存修改" : "添加成员"}
            </Button>
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
          <form id="group-task-form" onSubmit={submitTask} className="space-y-4">
            <Field label="任务名称" required htmlFor="group-task-title">
              <Input
                id="group-task-title"
                type="text"
                value={tTitle}
                onChange={(e) => setTTitle(e.target.value)}
                autoFocus
                required
              />
            </Field>
            <Field label="负责人">
              <UISelect
                value={tAssigneeId}
                onChange={setTAssigneeId}
                ariaLabel="负责人"
                options={[{ value: "", label: "未分配" }, ...(selectedProject?.members ?? []).map((m) => ({ value: m.id, label: m.name }))]}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="截止日期" required>
                <Input
                  type="date"
                  value={tDate}
                  onChange={(e) => setTDate(e.target.value)}
                  required
                />
              </Field>
              <Field label="截止时间">
                <Input
                  type="time"
                  value={tTime}
                  onChange={(e) => setTTime(e.target.value)}
                />
              </Field>
            </div>
          </form>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setTaskForm(null)}>
              取消
            </Button>
            <Button type="submit" form="group-task-form" variant="primary" size="sm">
              {taskForm?.mode === "edit" ? "保存修改" : "添加任务"}
            </Button>
          </div>
        </GroupModal>
    </div>
  );
}
