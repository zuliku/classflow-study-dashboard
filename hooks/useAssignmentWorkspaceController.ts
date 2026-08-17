"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import {
  deriveTaskWorkspace,
  PRIMARY_TASK_WORKSPACE_VIEWS,
  TaskHealthPlanningInput,
  TaskWorkspaceItem,
  TaskWorkspaceView,
} from "@/lib/tasks/taskViews";

/**
 * Assignment Workspace 控制器（App Chrome V2）：
 * ViewBar 与 AssignmentTable 共享同一份 local controls 与派生结果（避免两处各 derive 一次）。
 * - view（store 持久化）/ courseFilter / searchQuery / riskOnly / moreOpen
 * - items + counts 只在这里派生一次
 * - 视图变化时复位 riskOnly（Focus 专属）并关闭 More 菜单
 * 业务事实来源不变：PRIMARY_TASK_WORKSPACE_VIEWS / TASK_WORKSPACE_VIEWS / deriveTaskWorkspace。
 */
export interface AssignmentWorkspaceController {
  view: TaskWorkspaceView;
  setView: (view: TaskWorkspaceView) => void;
  courseFilter: string;
  setCourseFilter: (filter: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  riskOnly: boolean;
  setRiskOnly: (v: boolean) => void;
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
  items: TaskWorkspaceItem[];
  counts: Record<TaskWorkspaceView, number>;
  /** 当前课程范围下 Focus 视图的风险计数（Risk Filter 是否显示依据） */
  atRiskCount: number;
}

export function useAssignmentWorkspaceController(): AssignmentWorkspaceController {
  const {
    assignments,
    courses,
    studyBlocks,
    schedules,
    calendarMarks,
    semester,
    currentSemesterWeek,
    assignmentWorkspaceView,
    setAssignmentWorkspaceView,
  } = useAppStore();

  const [courseFilter, setCourseFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  // Part B：Focus 内「仅看有风险」轻量筛选（非第六个 Tab）
  const [riskOnly, setRiskOnly] = useState(false);
  // Part B：「···」More 菜单（低频入口：已归档）
  const [moreOpen, setMoreOpen] = useState(false);

  const today = useMemo(() => new Date(), []);

  // Health 所需规划数据（workspace 视图派生用；At Risk 视图与行内 Health 提示依赖）
  const planningInput: TaskHealthPlanningInput = {
    schedules,
    calendarMarks,
    semester,
    currentSemesterWeek,
  };

  // 课程筛选 → 视图派生（view + courseFilter + Health）→ 文本搜索 + Focus 风险筛选
  const courseFiltered = useMemo(
    () =>
      assignments.filter(
        (item) => courseFilter === "all" || item.courseId === courseFilter
      ),
    [assignments, courseFilter]
  );

  const viewResult = useMemo(
    () =>
      deriveTaskWorkspace(courseFiltered, studyBlocks, assignmentWorkspaceView, today, planningInput),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [courseFiltered, studyBlocks, assignmentWorkspaceView, today]
  );

  const items = useMemo(() => {
    let list = viewResult.items;
    // Part B：Focus 内轻量 Risk Filter（仅看有风险；不新增第六个 Tab）
    if (riskOnly && assignmentWorkspaceView === "focus") {
      list = list.filter((it) => it.meta.health === "at-risk" || it.meta.overdue);
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((it) => {
      if (it.task.title.toLowerCase().includes(q)) return true;
      const course = courses.find((c) => c.id === it.task.courseId);
      return course?.name.toLowerCase().includes(q) ?? false;
    });
  }, [viewResult, riskOnly, assignmentWorkspaceView, searchQuery, courses]);

  // 离开 Focus 视图时复位风险筛选；切视图时关闭 More 菜单
  useEffect(() => {
    if (assignmentWorkspaceView !== "focus") setRiskOnly(false);
    setMoreOpen(false);
  }, [assignmentWorkspaceView]);

  return {
    view: assignmentWorkspaceView,
    setView: setAssignmentWorkspaceView,
    courseFilter,
    setCourseFilter,
    searchQuery,
    setSearchQuery,
    riskOnly,
    setRiskOnly,
    moreOpen,
    setMoreOpen,
    items,
    counts: viewResult.counts,
    atRiskCount: viewResult.counts["at-risk"],
  };
}

/** ViewBar 用：全部主视图（业务事实来源，禁止复制 label） */
export const ASSIGNMENT_VIEWBAR_VIEWS = PRIMARY_TASK_WORKSPACE_VIEWS;
