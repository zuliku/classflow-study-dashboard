"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  ChevronRight,
  ChevronLeft,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Edit2,
  Trash2,
  BookOpen,
  X,
  CalendarPlus,
  Search,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { TimeSliceFilter, Priority } from "@/types";
import { openAssignmentEditor } from "@/lib/uiEvents";
import { useEnterOnAdd } from "@/lib/useEnterOnAdd";
import { cn, getPriorityMeta } from "@/lib/utils";
import { isToday, differenceInDays } from "date-fns";
import { parseLocalDDL, getLocalDDLDate } from "@/lib/ddl";
import { formatEstimatedMinutes } from "@/lib/tasks/taskSemantics";
import { RECURRENCE_LABELS } from "@/lib/tasks/taskRecurrence";
import { createAssignmentActions } from "@/lib/assignmentActions";
import { getAssignmentContextCommands } from "@/lib/commands";
import { paginate } from "@/lib/pagination";
import {
  toggleSelection,
  rangeSelection,
  selectAllVisible,
  sanitizeSelection,
  sanitizeHighlight,
} from "@/lib/assignmentSelection";
import { AssignmentPeekPanel } from "@/components/assignment/AssignmentPeekPanel";
import { AssignmentContextMenu, ContextMenuCommand } from "@/components/assignment/AssignmentContextMenu";
import { QuickAddCard } from "@/components/assignment/QuickAddCard";
import { deriveTaskWorkspace, PRIMARY_TASK_WORKSPACE_VIEWS, TaskHealthPlanningInput } from "@/lib/tasks/taskViews";
import { healthViewMeta } from "@/lib/tasks/taskHealthView";
import { useKiroHandoff } from "@/hooks/useKiroHandoff";
import { KIRO_ICON } from "@/components/layout/navItems";
import { KiroFlowButton } from "@/components/kiro/KiroFlow";

export interface AssignmentTableProps {
  /** compact：Overview 只读点击式；workspace：Assignments Tab 的键盘优先工作区 */
  mode?: "compact" | "workspace";
}

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "urgent", label: "紧急" },
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
];

/** compact 模式每页任务数（超出后分页，不内部滚动） */
const COMPACT_PAGE_SIZE = 5;

export function AssignmentTable({ mode = "compact" }: AssignmentTableProps) {
  const isWorkspace = mode === "workspace";

  const {
    assignments,
    courses,
    updateAssignmentStatus,
    setActiveTab,
    assignmentTimeSlice,
    setAssignmentTimeSlice,
    assignmentWorkspaceView,
    setAssignmentWorkspaceView,
    studyBlocks,
    schedules,
    calendarMarks,
    semester,
    currentSemesterWeek,
  } = useAppStore();
  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const handoff = useKiroHandoff();

  const highlightedAssignmentId = useAppStore((s) => s.highlightedAssignmentId);
  const setHighlightedAssignmentId = useAppStore((s) => s.setHighlightedAssignmentId);
  const assignmentSelection = useAppStore((s) => s.assignmentSelection);
  const setAssignmentSelection = useAppStore((s) => s.setAssignmentSelection);
  const assignmentPeekId = useAppStore((s) => s.assignmentPeekId);
  const setAssignmentPeekId = useAppStore((s) => s.setAssignmentPeekId);
  // 单键快捷键开关：关闭后 J/K/X/Space 失效，方向键/Enter/Cmd+A/Esc 保留
  const singleKeyEnabled = useAppStore((s) => s.preferences.enableSingleKeyShortcuts);
  const contentDensity = useAppStore((s) => s.preferences.contentDensity);
  const compactDensity = contentDensity === "compact";

  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  // Part B：Focus 内「仅看有风险」轻量筛选（非第六个 Tab）
  const [riskOnly, setRiskOnly] = useState(false);
  // Part B：「···」More 菜单（低频入口：已归档）
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const newTaskIds = useEnterOnAdd(assignments.map((a) => a.id));

  const today = new Date();

  // Health 所需规划数据（workspace 视图派生用；At Risk 视图与行内 Health 提示依赖）
  const planningInput: TaskHealthPlanningInput | null = isWorkspace
    ? { schedules, calendarMarks, semester, currentSemesterWeek }
    : null;

  // 课程筛选（compact / workspace 共用；workspace 的 Search / View 在其后叠加）
  const courseFiltered = assignments.filter(
    (item) => courseFilter === "all" || item.courseId === courseFilter
  );

  // compact：TimeSlice 筛选（Task V2 后保持原逻辑，compact Overview 不动）
  const filteredAssignments = courseFiltered.filter((item) => {
    if (assignmentTimeSlice === "all" || assignmentTimeSlice === "completed") {
      return assignmentTimeSlice === "completed" ? item.status === "completed" : true;
    }
    const ddlDate = parseLocalDDL(item.ddl);
    if (!ddlDate) return false;
    const diff = differenceInDays(ddlDate, today);

    switch (assignmentTimeSlice) {
      case "overdue":
        return item.status !== "completed" && diff < 0 && !isToday(ddlDate);
      case "today":
        return isToday(ddlDate);
      case "3days":
        return item.status !== "completed" && diff >= 0 && diff <= 3;
      case "7days":
        return item.status !== "completed" && diff >= 0 && diff <= 7;
      default:
        return true;
    }
  });

  // Workspace V2：视图派生（view + courseFilter + Health）+ 文本搜索 + Focus 风险筛选
  const workspaceViewResult = isWorkspace
    ? deriveTaskWorkspace(courseFiltered, studyBlocks, assignmentWorkspaceView, today, planningInput ?? undefined)
    : null;
  const workspaceItems = (() => {
    if (!workspaceViewResult) return [];
    let items = workspaceViewResult.items;
    // Part B：Focus 内轻量 Risk Filter（仅看有风险；不新增第六个 Tab）
    if (riskOnly && assignmentWorkspaceView === "focus") {
      items = items.filter(
        (it) => it.meta.health === "at-risk" || it.meta.overdue
      );
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      if (it.task.title.toLowerCase().includes(q)) return true;
      const course = courses.find((c) => c.id === it.task.courseId);
      return course?.name.toLowerCase().includes(q) ?? false;
    });
  })();

  const filteredIds = useMemo(
    () => (isWorkspace ? workspaceItems.map((it) => it.task.id) : filteredAssignments.map((a) => a.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isWorkspace, workspaceViewResult, searchQuery, courseFilter, assignments]
  );
  const filteredIdsKey = filteredIds.join(",");

  // 筛选变化 → 清理隐藏的 selection / highlight（保留可见项）
  useEffect(() => {
    setAssignmentSelection(sanitizeSelection(assignmentSelection, filteredIds));
    setHighlightedAssignmentId(sanitizeHighlight(highlightedAssignmentId, filteredIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredIdsKey]);

  // ---- Compact 分页（纯展示状态，不写入 store） ----
  // workspace 模式保持完整列表（键盘导航/多选语义不截断）
  const [compactPage, setCompactPage] = useState(1);
  const compactPaged = useMemo(() => {
    if (isWorkspace) return null;
    return paginate(filteredAssignments, compactPage, COMPACT_PAGE_SIZE);
  }, [isWorkspace, filteredAssignments, compactPage]);
  // 渲染用 clamp 后的安全页号（数据变化导致总页数减少时自动回退，绝不出现 第 2 / 1 页）
  const pagedAssignments = compactPaged?.items ?? filteredAssignments;
  const compactTotalPages = compactPaged?.totalPages ?? 1;
  const compactSafePage = compactPaged?.currentPage ?? 1;

  // 桌面（Peek 仅 >=1024px）
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // 动作工厂：Context Menu / Bulk Bar / Command Center 同一实现
  const actions = useMemo(
    () =>
      createAssignmentActions({
        getAssignments: () => useAppStore.getState().assignments,
        updateAssignment: (a) => useAppStore.getState().updateAssignment(a),
        setSelectedAssignmentId: (id) => useAppStore.getState().setSelectedAssignmentId(id),
        deleteAssignment: (id) => useAppStore.getState().deleteAssignment(id),
        restoreAssignment: (snapshot) => useAppStore.getState().restoreAssignment(snapshot),
        pushToast: (t) => pushToast(t),
        confirm: (r) => confirmRequest(r),
      }),
    [pushToast, confirmRequest]
  );

  const handleAddAssignmentClick = () => {
    if (isWorkspace) {
      // Quick Add V2：Header 下方 Inline Card（全屏编辑走「更多详情」）
      setQuickAddOpen((v) => !v);
      return;
    }
    openAssignmentEditor(courseFilter !== "all" ? { courseId: courseFilter } : {});
  };

  const handleEditClick = (e: React.MouseEvent, assignmentId: string) => {
    e.stopPropagation();
    openAssignmentEditor({ assignmentId });
  };

  const overdueCount = assignments.filter((a) => {
    if (a.status === "completed") return false;
    const ddlDate = parseLocalDDL(a.ddl);
    if (!ddlDate) return false;
    return differenceInDays(ddlDate, today) < 0 && !isToday(ddlDate);
  }).length;

  // ---- Workspace：highlight / 键盘导航 / selection / peek / context menu ----

  const anchorRef = useRef<string | null>(null);

  const moveHighlight = (dir: 1 | -1) => {
    if (filteredIds.length === 0) return;
    const idx = highlightedAssignmentId ? filteredIds.indexOf(highlightedAssignmentId) : -1;
    let next = idx === -1 ? (dir === 1 ? 0 : filteredIds.length - 1) : idx + dir;
    if (next < 0) next = filteredIds.length - 1;
    if (next >= filteredIds.length) next = 0;
    const nextId = filteredIds[next];
    setHighlightedAssignmentId(nextId);
    // Peek 打开时跟随 highlight 连续预览（不关闭重开）
    if (assignmentPeekId) setAssignmentPeekId(nextId);
  };

  const [ctxMenu, setCtxMenu] = useState<{
    anchorX: number;
    anchorY: number;
    ids: string[];
    highlightedId: string | null;
  } | null>(null);
  const [bulkDdlOpen, setBulkDdlOpen] = useState(false);
  const [bulkDdlDate, setBulkDdlDate] = useState("");
  const [bulkShiftDays, setBulkShiftDays] = useState("");

  // More 菜单：outside click / Esc 关闭（非 modal，不拦截页面交互）
  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!moreMenuRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // 离开 Focus 视图时复位风险筛选；切视图时关闭 More 菜单
  useEffect(() => {
    if (assignmentWorkspaceView !== "focus") setRiskOnly(false);
    setMoreOpen(false);
  }, [assignmentWorkspaceView]);

  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const k = e.key;

    // 单键快捷键关闭：只保留标准可访问键盘操作（方向键 / Enter / Cmd+A / Esc）
    if (!singleKeyEnabled) {
      if (k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        moveHighlight(k === "ArrowDown" ? 1 : -1);
      } else if (k === "Enter") {
        if (ctxMenu) {
          setCtxMenu(null);
          return;
        }
        if (!highlightedAssignmentId) return;
        e.preventDefault();
        setAssignmentPeekId(null);
        actions.openDrawer(highlightedAssignmentId);
      } else if ((e.ctrlKey || e.metaKey) && k === "a") {
        e.preventDefault();
        setAssignmentSelection(selectAllVisible(filteredIds));
      } else if (k === "Escape") {
        if (ctxMenu) {
          setCtxMenu(null);
        } else if (assignmentPeekId) {
          setAssignmentPeekId(null);
        } else if (assignmentSelection.length > 0) {
          setAssignmentSelection([]);
        } else {
          setHighlightedAssignmentId(null);
          (e.currentTarget as HTMLElement).blur();
        }
      }
      return;
    }

    if (k === "ArrowDown" || k === "j" || k === "J") {
      e.preventDefault();
      moveHighlight(1);
    } else if (k === "ArrowUp" || k === "k" || k === "K") {
      e.preventDefault();
      moveHighlight(-1);
    } else if (k === "Enter") {
      if (ctxMenu) {
        setCtxMenu(null);
        return;
      }
      if (!highlightedAssignmentId) return;
      e.preventDefault();
      setAssignmentPeekId(null);
      actions.openDrawer(highlightedAssignmentId);
    } else if (k === " ") {
      if (!desktop || !highlightedAssignmentId) return;
      e.preventDefault();
      setAssignmentPeekId(
        assignmentPeekId === highlightedAssignmentId ? null : highlightedAssignmentId
      );
    } else if (k === "x" || k === "X") {
      if (!highlightedAssignmentId) return;
      e.preventDefault();
      anchorRef.current = highlightedAssignmentId;
      setAssignmentSelection(toggleSelection(assignmentSelection, highlightedAssignmentId));
    } else if ((e.ctrlKey || e.metaKey) && k === "a") {
      e.preventDefault();
      setAssignmentSelection(selectAllVisible(filteredIds));
    } else if (k === "Escape") {
      if (ctxMenu) {
        setCtxMenu(null);
      } else if (assignmentPeekId) {
        setAssignmentPeekId(null);
      } else if (assignmentSelection.length > 0) {
        setAssignmentSelection([]);
      } else {
        setHighlightedAssignmentId(null);
        (e.currentTarget as HTMLElement).blur();
      }
    }
  };

  const handleRowClick = (e: React.MouseEvent, taskId: string) => {
    if (isWorkspace && e.shiftKey) {
      e.preventDefault();
      const anchor = anchorRef.current ?? highlightedAssignmentId ?? taskId;
      setAssignmentSelection(rangeSelection(filteredIds, anchor, taskId));
      anchorRef.current = taskId;
      setHighlightedAssignmentId(taskId);
      return;
    }
    anchorRef.current = taskId;
    setHighlightedAssignmentId(taskId);
    if (isWorkspace) setAssignmentPeekId(null);
    actions.openDrawer(taskId);
  };

  const handleRowContextMenu = (e: React.MouseEvent, taskId: string) => {
    if (!isWorkspace) return;
    e.preventDefault();
    setHighlightedAssignmentId(taskId);
    const ids = assignmentSelection.includes(taskId) ? assignmentSelection : [taskId];
    // 记录 Viewport 锚点（clientX/clientY）；菜单定位在 AssignmentContextMenu 内
    // 按真实尺寸 computeContextMenuPosition（翻转 / clamp），不做 magic 偏移
    setCtxMenu({
      anchorX: e.clientX,
      anchorY: e.clientY,
      ids,
      highlightedId: taskId,
    });
  };

  // Context Menu 项来自 Command Registry（打开/编辑/完成/进行中/优先级/删除）
  const menuCtx = useMemo(() => {
    if (!ctxMenu) return null;
    return {
      assignmentActions: actions,
      highlightedAssignmentId: ctxMenu.highlightedId,
      // 菜单场景无 entity 上下文：不触发「编辑」dedupe，菜单保持完整动作
      selectedAssignmentId: null,
      close: () => setCtxMenu(null),
    } as Parameters<typeof getAssignmentContextCommands>[0];
  }, [ctxMenu, actions]);

  const menuCommands = useMemo<ContextMenuCommand[]>(() => {
    if (!ctxMenu || !menuCtx) return [];
    return getAssignmentContextCommands(menuCtx, ctxMenu.ids).map(
      (cmd): ContextMenuCommand => ({
        ...cmd,
        run: () => cmd.run(menuCtx as never),
      })
    );
  }, [ctxMenu, menuCtx]);

  // 菜单目标任务中是否已有 DDL（决定「清除截止时间」显示）
  const ctxHasDdl = useMemo(() => {
    if (!ctxMenu) return false;
    return ctxMenu.ids.some((id) => assignments.find((a) => a.id === id)?.ddl);
  }, [ctxMenu, assignments]);

  const bulkCount = assignmentSelection.length;
  const applyBulkDDL = () => {
    if (!bulkDdlDate) return;
    actions.setDDLDate(assignmentSelection, bulkDdlDate);
    setBulkDdlOpen(false);
    setBulkDdlDate("");
  };
  const applyBulkShift = () => {
    const days = Number(bulkShiftDays);
    if (!Number.isFinite(days) || days === 0) return;
    actions.shiftDDL(assignmentSelection, days);
    setBulkDdlOpen(false);
    setBulkShiftDays("");
  };
  const applyCtxDDL = (date: string | null) => {
    if (!ctxMenu) return;
    if (date === null) {
      actions.clearDDLDate(ctxMenu.ids);
    } else if (date) {
      actions.setDDLDate(ctxMenu.ids, date);
    }
    setCtxMenu(null);
  };

  return (
    <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle flex flex-col justify-between h-full space-y-3 min-w-0">
      {/* Header & Controls */}
      <div className="space-y-3 border-b border-[#F0EBE1] pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <h3 className="text-sm font-bold text-charcoal">
              {isWorkspace ? "任务与 DDL" : "任务清单"}
            </h3>
            <span className="text-[10px] font-semibold text-sandrift bg-[#F7F5F5] px-1.5 py-0.5 rounded border border-line">
              {isWorkspace
                ? workspaceViewResult
                  ? workspaceViewResult.items.length
                  : 0
                : filteredAssignments.length}{" "}
              项任务
            </span>
            {overdueCount > 0 && (
              <span className="text-[10px] font-bold text-danger bg-danger-bg px-2 py-0.5 rounded-full border border-danger-border flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {overdueCount} 项已逾期
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {isWorkspace && (
              <KiroFlowButton
                icon={KIRO_ICON}
                label="Ask Kiro"
                size="sm"
                className="h-8"
                onClick={() =>
                  highlightedAssignmentId
                    ? handoff.openForAssignment(highlightedAssignmentId)
                    : handoff.openForWeek(currentSemesterWeek)
                }
              />
            )}
            {/* Part C：有 Highlight 时才显示「帮我拆解当前任务」快捷入口 */}
            {isWorkspace && highlightedAssignmentId && (
              <button
                onClick={() => {
                  handoff.openForAssignment(highlightedAssignmentId);
                  handoff.handoffPrompt(
                    "帮我拆解这个任务，拆成 2–8 个可执行的步骤，并估算每步和总耗时。"
                  );
                }}
                title="Kiro 拆解当前高亮任务"
                className="ux-press px-2.5 h-8 text-[11px] font-bold text-charcoal bg-alabaster hover:bg-alba border border-line rounded-lg transition-colors shrink-0"
              >
                帮我拆解当前任务
              </button>
            )}
            <button
              onClick={handleAddAssignmentClick}
              aria-expanded={isWorkspace ? quickAddOpen : undefined}
              className="ux-press flex items-center space-x-1 px-3 py-1.5 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-xl transition-colors shadow-subtle shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isWorkspace && quickAddOpen ? "收起" : "新增任务"}</span>
            </button>
          </div>
        </div>

        {/* Quick Add V2（workspace inline；compact 不显示） */}
        {isWorkspace && quickAddOpen && (
          <QuickAddCard
            defaultCourseId={courseFilter !== "all" ? courseFilter : undefined}
            onClose={() => setQuickAddOpen(false)}
          />
        )}

        {/* Filters Row: Course Filter + (compact: Time Slice Pills | workspace: View Tabs + Search) */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center space-x-1.5 bg-[#F7F5F5] border border-line rounded-xl px-2.5 py-1">
            <BookOpen className="w-3.5 h-3.5 text-[#A48F82]" />
            <select
              value={courseFilter}
              onChange={(e) => {
                setCourseFilter(e.target.value);
                if (!isWorkspace) setCompactPage(1); // 筛选变化回第一页
              }}
              className="bg-transparent text-charcoal text-xs font-semibold focus:outline-none cursor-pointer max-w-[160px] truncate"
            >
              <option value="all">全部课程 ({assignments.length})</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {isWorkspace ? (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Part B：Focus 内轻量 Risk Filter（有风险时显示；不新增第六个 Tab） */}
              {assignmentWorkspaceView === "focus" && (workspaceViewResult?.counts["at-risk"] ?? 0) > 0 && (
                <button
                  onClick={() => setRiskOnly((v) => !v)}
                  data-testid="focus-risk-filter"
                  aria-pressed={riskOnly}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-xl border text-[11px] font-semibold transition-colors ${
                    riskOnly
                      ? "bg-danger-bg border-danger-border text-danger font-bold"
                      : "bg-[#F7F5F5] border-line text-satin-grey hover:text-charcoal"
                  }`}
                >
                  <AlertTriangle className="w-3 h-3" />
                  有风险 {workspaceViewResult?.counts["at-risk"]}
                </button>
              )}

              {/* Search */}
              <div className="flex items-center gap-1.5 bg-[#F7F5F5] border border-line rounded-xl px-2.5 py-1 min-w-[150px]">
                <Search className="w-3.5 h-3.5 text-[#A48F82]" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索任务…"
                  className="bg-transparent text-charcoal text-xs font-medium focus:outline-none w-full placeholder:text-sandrift"
                  aria-label="搜索任务"
                />
              </div>

              {assignmentWorkspaceView === "archive" ? (
                /* Archive：临时状态入口（不新增永久 Tab） */
                <div className="flex items-center gap-1 bg-alabaster p-0.5 rounded-xl border border-line-strong text-[11px] font-medium">
                  <span className="flex items-center gap-1 px-2.5 py-0.5 font-bold text-charcoal">
                    已归档 {workspaceViewResult?.counts.archive ?? 0}
                  </span>
                  <button
                    onClick={() => setAssignmentWorkspaceView("all")}
                    className="px-2.5 py-0.5 rounded-lg text-satin-grey hover:text-charcoal hover:bg-white transition-colors"
                  >
                    ← 返回全部
                  </button>
                </div>
              ) : (
                <>
                  {/* View Tabs：仅 Primary Views（count = 课程筛选后该视图数量；search 不改变 count 语义） */}
                  <div className="flex flex-wrap items-center gap-1 bg-alabaster p-0.5 rounded-xl border border-line-strong text-[11px] font-medium">
                    {PRIMARY_TASK_WORKSPACE_VIEWS.map((view) => {
                      const isActive = assignmentWorkspaceView === view.id;
                      const count = workspaceViewResult?.counts[view.id] ?? 0;
                      return (
                        <button
                          key={view.id}
                          onClick={() => setAssignmentWorkspaceView(view.id)}
                          className={`flex items-center gap-1 px-2.5 py-0.5 rounded-lg transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] ${
                            isActive
                              ? "bg-white text-charcoal font-bold shadow-subtle"
                              : "text-satin-grey hover:text-charcoal"
                          }`}
                        >
                          {view.label}
                          <span
                            className={`text-[9px] font-bold px-1 rounded ${
                              isActive ? "text-sandrift" : "text-satin-grey/60"
                            }`}
                          >
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* More：低频入口（已归档等） */}
                  <div className="relative" ref={moreMenuRef}>
                    <button
                      onClick={() => setMoreOpen((v) => !v)}
                      aria-label="更多视图"
                      aria-expanded={moreOpen}
                      className="w-7 h-6 flex items-center justify-center rounded-lg bg-alabaster border border-line-strong text-satin-grey hover:text-charcoal hover:bg-white transition-colors font-bold leading-none"
                    >
                      ···
                    </button>
                    {moreOpen && (
                      <div
                        data-testid="workspace-more-menu"
                        className="absolute right-0 top-full mt-1.5 w-40 bg-surface border border-line-strong rounded-xl shadow-card p-1 z-40 text-[11px] ux-inline"
                      >
                        <button
                          onClick={() => {
                            setAssignmentWorkspaceView("archive");
                            setMoreOpen(false);
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left font-semibold text-charcoal hover:bg-alabaster transition-colors"
                        >
                          查看已归档
                          <span className="ml-auto text-[9px] font-bold text-sandrift">
                            {workspaceViewResult?.counts.archive ?? 0}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1 bg-alabaster p-0.5 rounded-xl border border-line-strong text-[11px] font-medium">
              {[
                { id: "all", label: "全部" },
                { id: "overdue", label: "已逾期" },
                { id: "today", label: "今日截止" },
                { id: "3days", label: "3天内截止" },
                { id: "7days", label: "7天内截止" },
                { id: "completed", label: "已完成归档" },
              ].map((slice) => {
                const isActive = assignmentTimeSlice === slice.id;
                return (
                  <button
                    key={slice.id}
                    onClick={() => {
                      setAssignmentTimeSlice(slice.id as TimeSliceFilter);
                      if (!isWorkspace) setCompactPage(1); // 筛选变化回第一页
                    }}
                    className={`px-2.5 py-0.5 rounded-lg transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] ${
                      isActive
                        ? "bg-white text-charcoal font-bold shadow-subtle"
                        : "text-satin-grey hover:text-charcoal"
                    }`}
                  >
                    {slice.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Task List：compact = 可伸缩内容区（flex-1 min-h-0）+ 分页；workspace = 完整滚动工作区 */}
      <div
        data-testid="assignment-list"
        data-density={isWorkspace ? contentDensity : undefined}
        tabIndex={isWorkspace ? 0 : undefined}
        onKeyDown={isWorkspace ? handleListKeyDown : undefined}
        className={cn(
          "divide-y divide-line-soft mt-1 flex-1 min-h-0 space-y-1",
          isWorkspace &&
            "overflow-y-auto max-h-[380px] outline-none rounded-xl focus-visible:ring-2 focus-visible:ring-line-strong"
        )}
      >
        {/* 空态判断按模式取正确数据源：workspace = 视图派生结果；compact = 分页结果 */}
        {(isWorkspace ? workspaceItems.length : pagedAssignments.length) === 0 ? (
          // compact：空状态填满 Header/Filters 与 Footer 之间的完整内容区（真正垂直居中，非 py 假居中）；
          // workspace：保持原有内边距样式
          isWorkspace ? (
            <div className="py-10 text-center text-xs text-sandrift space-y-1">
              <CheckCircle2 className="w-8 h-8 mx-auto text-success" />
              <p>该视图暂无任务</p>
            </div>
          ) : (
            <div
              data-testid="assignment-empty"
              className="h-full flex flex-col items-center justify-center gap-2.5 text-center"
            >
              <CheckCircle2 className="w-9 h-9 text-success" />
              <p className="text-xs text-sandrift">该筛选条件下暂无任务</p>
            </div>
          )
        ) : (
          (isWorkspace ? workspaceItems.map((it) => it.task) : pagedAssignments).map((task) => {
            const wsMeta = isWorkspace
              ? workspaceViewResult?.items.find((it) => it.task.id === task.id)?.meta
              : undefined;
            const course = courses.find((c) => c.id === task.courseId);
            const priorityMeta = getPriorityMeta(task.priority);
            const hasDdl = !!task.ddl && parseLocalDDL(task.ddl) !== null;
            const formattedDate = hasDdl ? getLocalDDLDate(task.ddl) : "无截止日期";
            const isCompleted = task.status === "completed";

            const ddlDate = parseLocalDDL(task.ddl);
            const isOverdueTask =
              !!ddlDate &&
              !isCompleted &&
              differenceInDays(ddlDate, today) < 0 &&
              !isToday(ddlDate);

            const isNew = newTaskIds.has(task.id);
            const isHighlighted = isWorkspace && highlightedAssignmentId === task.id;
            const isSelected = isWorkspace && assignmentSelection.includes(task.id);

            return (
              <div
                key={task.id}
                onClick={(e) => handleRowClick(e, task.id)}
                onContextMenu={(e) => handleRowContextMenu(e, task.id)}
                onMouseEnter={() => {
                  if (isWorkspace) setHighlightedAssignmentId(task.id);
                }}
                role="button"
                tabIndex={-1}
                data-assignment-id={task.id}
                className={cn(
                  isWorkspace && compactDensity ? "p-2" : "p-3",
                  "rounded-xl transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] cursor-pointer flex items-center justify-between group",
                  isNew && "animate-enter",
                  isWorkspace
                    ? isSelected
                      ? "bg-pastel-mint border border-line-strong"
                      : isOverdueTask
                      ? "bg-danger-bg border border-danger-border"
                      : isHighlighted
                      ? "bg-alabaster/80 ring-1 ring-inset ring-line-strong border border-transparent"
                      : "hover:bg-alabaster bg-surface border border-line-soft"
                    : isOverdueTask
                    ? "bg-danger-bg border border-danger-border"
                    : "hover:bg-alabaster bg-surface border border-line-soft"
                )}
              >
                <div className="flex items-center space-x-3 min-w-0 flex-1">
                  <input
                    type="checkbox"
                    checked={isCompleted}
                    onChange={(e) => {
                      e.stopPropagation();
                      updateAssignmentStatus(
                        task.id,
                        e.target.checked ? "completed" : "doing"
                      );
                    }}
                    className="w-4 h-4 rounded text-charcoal border-[#CDB9AB] focus:ring-0 cursor-pointer shrink-0"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center space-x-2">
                      <h4
                        className={`text-xs font-bold truncate ${
                          isCompleted
                            ? "line-through text-sandrift"
                            : "text-charcoal group-hover:text-black"
                        }`}
                      >
                        {task.title}
                      </h4>
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded font-bold shrink-0 border ${priorityMeta.bg} ${priorityMeta.text} ${priorityMeta.border}`}
                      >
                        {priorityMeta.label}
                      </span>
                      {isOverdueTask && (
                        <span className="text-[9px] bg-danger text-white px-1.5 py-0.2 rounded font-extrabold shrink-0">
                          已逾期
                        </span>
                      )}
                      {/* Health 异常提示（仅 at-risk / attention；safe 等正常任务保持干净） */}
                      {isWorkspace &&
                        wsMeta?.health &&
                        !isOverdueTask &&
                        (wsMeta.health === "at-risk" || wsMeta.health === "attention") && (
                          <span
                            className={cn(
                              "text-[9px] px-1.5 py-0.2 rounded font-bold shrink-0 border",
                              healthViewMeta(wsMeta.health).className
                            )}
                          >
                            {healthViewMeta(wsMeta.health).label}
                          </span>
                        )}
                    </div>

                    <div className="flex items-center space-x-2 text-[10px] text-sandrift mt-1">
                      <span className="truncate font-semibold">{course?.name || "通用"}</span>
                      <span>·</span>
                      <span className={hasDdl ? "" : "text-satin-grey/70"}>截止: {formattedDate}</span>
                      {task.estimatedMinutes && isWorkspace && (
                        <>
                          <span>·</span>
                          <span>预计 {formatEstimatedMinutes(task.estimatedMinutes)}</span>
                        </>
                      )}
                      {/* Task 7F：重复任务弱标记（仅 workspace 完整模式） */}
                      {isWorkspace && task.recurrence && (
                        <>
                          <span>·</span>
                          <span className="text-satin-grey/70">
                            {RECURRENCE_LABELS[task.recurrence]}
                          </span>
                        </>
                      )}
                      {isWorkspace && wsMeta && wsMeta.studyBlockCount > 0 && (
                        <>
                          <span>·</span>
                          <span className="font-semibold text-success/90">
                            已计划 {formatEstimatedMinutes(wsMeta.scheduledMinutes)}
                          </span>
                        </>
                      )}
                      {task.subtasks && task.subtasks.length > 0 && (
                        <>
                          <span>·</span>
                          <span>
                            子任务: {task.subtasks.filter((st) => st.completed).length} / {task.subtasks.length}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2 shrink-0 ml-2">
                  <div className="w-16 hidden sm:block">
                    <div className="flex justify-between text-[9px] text-sandrift mb-0.5">
                      <span>进度</span>
                      <span className="font-bold text-charcoal">
                        {task.progress}%
                      </span>
                    </div>
                    <div className="w-full bg-alabaster rounded-full h-1 overflow-hidden">
                      <div
                        className="bg-success h-1 rounded-full transition-[width] duration-[var(--motion-data)] ease-[var(--ease-emphasized)]"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  </div>

                  {/* workspace：操作按钮 hover 可见（键盘 highlight 后用 Context Menu / 快捷键） */}
                  <button
                    onClick={(e) => handleEditClick(e, task.id)}
                    className={cn(
                      "p-1.5 rounded-lg text-sandrift hover:bg-alba hover:text-charcoal transition-colors",
                      isWorkspace && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                    )}
                    title="编辑任务"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      actions.remove([task.id]);
                    }}
                    className={cn(
                      "p-1.5 rounded-lg text-danger hover:bg-danger-bg transition-colors",
                      isWorkspace && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                    )}
                    title="删除任务"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>

                  <ChevronRight className="w-3.5 h-3.5 text-sandrift group-hover:text-charcoal transition-colors" />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer：compact = 三段式 grid（左计数 / 中分页恒居中 / 右进入工作区）；workspace = 键盘提示 */}
      <div
        data-testid={isWorkspace ? undefined : "assignment-footer"}
        className={cn(
          "shrink-0 text-xs",
          isWorkspace
            ? "pt-2 border-t border-[#F0EBE1] flex justify-between items-center"
            : "pt-3 pb-1.5 border-t border-[#F0EBE1] grid grid-cols-[1fr_auto_1fr] items-center"
        )}
      >
        {isWorkspace ? (
          <>
            <span className="text-[11px] text-sandrift">
              {singleKeyEnabled
                ? "J/K 移动 · Space 预览 · X 选择 · Enter 打开 · 右键更多"
                : "↑/↓ 移动 · Enter 打开 · 右键更多"}
            </span>
            <span />
          </>
        ) : (
          <>
            <span className="text-[11px] text-sandrift justify-self-start">
              共 {compactPaged?.totalItems ?? filteredAssignments.length} 项任务
            </span>
            {/* 中间列：分页器永远位于卡片真正水平中心，不随左右文案宽度漂移 */}
            {compactTotalPages > 1 && (
              <span className="inline-flex items-center gap-2">
                <button
                  onClick={() => setCompactPage(compactSafePage - 1)}
                  disabled={compactSafePage <= 1}
                  aria-label="上一页"
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-sandrift"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="min-w-[40px] text-center text-[11px] font-mono text-satin-grey">
                  {compactSafePage} / {compactTotalPages}
                </span>
                <button
                  onClick={() => setCompactPage(compactSafePage + 1)}
                  disabled={compactSafePage >= compactTotalPages}
                  aria-label="下一页"
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-sandrift"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </span>
            )}
            <button
              onClick={() => setActiveTab("assignments")}
              className="font-bold text-charcoal hover:underline justify-self-end"
            >
              任务工作区 →
            </button>
          </>
        )}
      </div>

      {/* ---- Workspace：Bulk Action Bar（有选择才出现） ---- */}
      {isWorkspace && bulkCount > 0 && (
        <div
          data-testid="assignment-bulk-bar"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-surface border border-line-strong rounded-2xl shadow-card px-3 py-2 flex items-center gap-2 text-xs ux-inline"
        >
          <span className="font-bold text-charcoal px-1">
            已选 {bulkCount} 项
          </span>
          <span className="w-px h-4 bg-line-strong" />
          <button
            onClick={() => actions.markCompleted(assignmentSelection)}
            className="px-2 py-1 rounded-lg font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
          >
            完成
          </button>
          <button
            onClick={() => actions.markDoing(assignmentSelection)}
            className="px-2 py-1 rounded-lg font-semibold text-satin-grey hover:bg-alabaster transition-colors"
          >
            进行中
          </button>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) {
                actions.setPriority(assignmentSelection, e.target.value as Priority);
                e.target.value = "";
              }
            }}
            className="px-2 py-1 rounded-lg font-semibold text-satin-grey bg-[#F7F5F5] border border-line cursor-pointer focus:outline-none"
            aria-label="修改优先级"
          >
            <option value="" disabled>
              优先级
            </option>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {bulkDdlOpen ? (
            <span
              data-testid="bulk-ddl-popover"
              className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 w-72 bg-surface border border-line-strong rounded-2xl shadow-card p-3 space-y-2.5 text-xs ux-inline"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-charcoal">调整截止时间</span>
                <button
                  onClick={() => setBulkDdlOpen(false)}
                  className="p-1 rounded-lg text-sandrift hover:bg-alabaster transition-colors"
                  aria-label="关闭"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {/* 模式一：指定日期（保留各自原时间） */}
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-sandrift">指定日期</p>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={bulkDdlDate}
                    onChange={(e) => setBulkDdlDate(e.target.value)}
                    className="flex-1 px-1.5 py-1 rounded-lg bg-white border border-line text-[11px] font-mono focus:outline-none"
                    aria-label="指定日期"
                  />
                  <button
                    onClick={applyBulkDDL}
                    disabled={!bulkDdlDate}
                    className="px-2.5 py-1 rounded-lg font-bold text-white bg-charcoal hover:bg-black disabled:opacity-50 transition-colors"
                  >
                    应用
                  </button>
                </div>
              </div>
              {/* 模式二：整体提前/延后 N 天 */}
              <div className="space-y-1 pt-2 border-t border-line-soft">
                <p className="text-[10px] font-bold text-sandrift">整体平移</p>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    value={bulkShiftDays}
                    onChange={(e) => setBulkShiftDays(e.target.value)}
                    placeholder="如 2 或 -1"
                    className="flex-1 px-1.5 py-1 rounded-lg bg-white border border-line text-[11px] font-mono focus:outline-none"
                    aria-label="平移天数"
                  />
                  <button
                    onClick={applyBulkShift}
                    disabled={!Number.isFinite(Number(bulkShiftDays)) || Number(bulkShiftDays) === 0}
                    className="px-2.5 py-1 rounded-lg font-bold text-white bg-charcoal hover:bg-black disabled:opacity-50 transition-colors"
                  >
                    应用
                  </button>
                </div>
                <p className="text-[9px] text-sandrift">各任务相对日期差保持不变，HH:mm 时间均保留</p>
              </div>
            </span>
          ) : (
            <button
              onClick={() => setBulkDdlOpen(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg font-semibold text-satin-grey hover:bg-alabaster transition-colors"
            >
              <CalendarPlus className="w-3.5 h-3.5" />
              调整DDL
            </button>
          )}
          <button
            onClick={() => actions.remove(assignmentSelection)}
            className="px-2 py-1 rounded-lg font-bold text-danger hover:bg-danger-bg transition-colors"
          >
            删除
          </button>
          <button
            onClick={() => setAssignmentSelection([])}
            className="p-1 rounded-lg text-sandrift hover:bg-alabaster transition-colors"
            aria-label="清除选择"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ---- Workspace：Context Menu（Portal + fixed；非 modal，不拦截页面交互） ---- */}
      {isWorkspace && ctxMenu && menuCtx && (
        <AssignmentContextMenu
          anchor={ctxMenu}
          commands={menuCommands}
          hasDdl={ctxHasDdl}
          onRun={(cmd) => cmd.run()}
          onApplyDDL={applyCtxDDL}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* ---- Workspace：Assignment Peek（Desktop >=1024） ---- */}
      {isWorkspace && desktop && <AssignmentPeekPanel />}
    </div>
  );
}
