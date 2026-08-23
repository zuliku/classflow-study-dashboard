// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";

// Polyfills（jsdom 缺失的浏览器 API）
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as Record<string, unknown>).ResizeObserver = RO as unknown as typeof ResizeObserver;
if (typeof window !== "undefined" && !window.matchMedia) {
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// Kiro handoff 与 session 域 mock（Workspace 状态一致性测试不涉及 Kiro 行为）
vi.mock("@/hooks/useKiroHandoff", () => ({
  useKiroHandoff: () => ({
    openForGroupProject: vi.fn(),
    openForWeek: vi.fn(),
  }),
}));
vi.mock("@/components/kiro/KiroSessionProvider", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/components/kiro/KiroSessionProvider")>();
  return {
    ...mod,
    KiroSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import { CoursesWorkspace } from "@/components/course/CoursesWorkspace";
import { GroupCollaborationView } from "@/components/group/GroupCollaborationView";
import { AssignmentTable } from "@/components/dashboard/AssignmentTable";
import { WorkspaceEmptyState } from "@/components/ui/WorkspaceEmptyState";
import { useAppStore } from "@/store/useAppStore";
import type { AssignmentWorkspaceController } from "@/hooks/useAssignmentWorkspaceController";
import type { Assignment, Course, GroupProject } from "@/types";

/**
 * UI Productization V2.3 —— Workspace Shell & State Consistency：
 * 1. Zero-data / Contextual Empty 语义区分（Courses / Group / Assignments）
 * 2. Group zero-project 不渲染 master-detail split
 * 3. Horizontal gutter 单一来源（workspace-gutter）static guard
 */

function makeCourse(id: string): Course {
  return {
    id,
    name: `课程 ${id}`,
    code: id.toUpperCase(),
    credit: 2,
    teacher: "张老师",
    classroom: "",
    color: "#E3E6E0",
    bgHex: "#E3E6E0",
    borderHex: "#CCCBC4",
    textHex: "#313032",
    materials: [],
  } as unknown as Course;
}

function makeAssignment(id: string): Assignment {
  return {
    id,
    courseId: "c1",
    title: `任务 ${id}`,
    ddl: "2026-12-01T23:59:00",
    priority: "medium",
    status: "todo",
    progress: 0,
    tags: [],
  } as unknown as Assignment;
}

beforeEach(() => {
  cleanup();
  const s = useAppStore.getState();
  useAppStore.setState({
    courses: [makeCourse("c1")],
    assignments: [makeAssignment("a1")],
    groupProjects: [
      {
        id: "g1",
        name: "项目一",
        courseId: "c1",
        description: "",
        members: [],
        tasks: [],
        createdAt: new Date().toISOString(),
      } as unknown as GroupProject,
    ],
    selectedCourseId: null,
    addCourseModalOpen: false,
    importScheduleModalOpen: false,
  });
});
afterEach(() => {
  cleanup();
});

describe("Courses zero-data → WorkspaceEmptyState", () => {
  it("courses=0：渲染 workspace empty（title/description），Add Course / Import 均可触发", () => {
    useAppStore.setState({ courses: [] });
    const setAdd = vi.spyOn(useAppStore.getState(), "setAddCourseModalOpen");
    const setImport = vi.spyOn(useAppStore.getState(), "setImportScheduleModalOpen");

    render(<CoursesWorkspace />);

    const empty = screen.getByTestId("workspace-empty-state");
    expect(empty).toBeTruthy();
    expect(screen.getByText("暂无课程")).toBeTruthy();
    // CTA 触发（empty 内按钮；Header primaryAction 同语义不重复断言）
    fireEvent.click(within(empty).getByRole("button", { name: /添加课程/ }));
    expect(setAdd).toHaveBeenCalledWith(true);
    fireEvent.click(within(empty).getByRole("button", { name: /导入课表/ }));
    expect(setImport).toHaveBeenCalledWith(true);
    setAdd.mockRestore();
    setImport.mockRestore();
  });

  it("courses>0：不渲染 empty，渲染课程 grid", () => {
    render(<CoursesWorkspace />);
    expect(screen.queryByTestId("workspace-empty-state")).toBeNull();
    expect(screen.getByText(/课程 c1/)).toBeTruthy();
  });
});

describe("Group zero-project composition", () => {
  it("groupProjects=0：不渲染 project rail split，渲染 full-body WorkspaceEmptyState", () => {
    useAppStore.setState({ groupProjects: [] });
    const openCreateSpy = vi.fn();
    // openCreateProject 由组件内部实现；此处验证 UI 组成与 CTA 存在
    render(<GroupCollaborationView />);

    // full-width empty：出现统一 empty surface
    expect(screen.getByTestId("workspace-empty-state")).toBeTruthy();
    expect(screen.getByText("还没有小组项目")).toBeTruthy();
    // 不再渲染空 rail（300px aside）与 detail panel
    const empty = screen.getByTestId("workspace-empty-state");
    // empty 位于 body 内，而非窄 rail 中：其祖先链不含 w-[300px] aside
    let cur: HTMLElement | null = empty;
    let inRail = false;
    while (cur) {
      if (cur.className && String(cur.className).includes("w-[300px]")) inRail = true;
      cur = cur.parentElement;
    }
    expect(inRail).toBe(false);
    // Primary CTA 存在（Header primaryAction 与 empty CTA 同语义；至少 empty 内有一个）
    expect(screen.getAllByRole("button", { name: /新建项目/ }).length).toBeGreaterThanOrEqual(1);
  });

  it("有项目时：master-detail split 完整保留", () => {
    render(<GroupCollaborationView />);
    expect(screen.queryByTestId("workspace-empty-state")).toBeNull();
    // rail 存在（项目列表 Surface）
    expect(screen.getByText("项目")).toBeTruthy();
  });
});

describe("Assignments zero-data vs contextual empty", () => {
  function makeController(items: { task: Assignment; meta?: unknown }[]): AssignmentWorkspaceController {
    return {
      view: "all",
      setView: vi.fn(),
      courseFilter: "all",
      setCourseFilter: vi.fn(),
      searchQuery: "",
      setSearchQuery: vi.fn(),
      riskOnly: false,
      setRiskOnly: vi.fn(),
      moreOpen: false,
      setMoreOpen: vi.fn(),
      items: items as never,
      counts: { all: items.length, today: 0, week: 0, month: 0, done: 0, archive: 0 },
      atRiskCount: 0,
    } as unknown as AssignmentWorkspaceController;
  }

  it("domain 零任务 → 「还没有任务」zero-data 文案（无 CheckCircle 全完成语义）", () => {
    useAppStore.setState({ assignments: [] });
    render(<AssignmentTable mode="workspace" workspaceController={makeController([])} />);
    expect(screen.getByTestId("assignment-zero-data")).toBeTruthy();
    expect(screen.getByText("还没有任务")).toBeTruthy();
    expect(screen.queryByText("该视图暂无任务")).toBeNull();
  });

  it("domain 有数据但当前视图无结果 → contextual「该视图暂无任务」", () => {
    render(<AssignmentTable mode="workspace" workspaceController={makeController([])} />);
    expect(screen.queryByTestId("assignment-zero-data")).toBeNull();
    expect(screen.getByText("该视图暂无任务")).toBeTruthy();
  });
});

describe("WorkspaceEmptyState primitive", () => {
  it("icon/actions slots 渲染；无 icon 时无装饰节点", () => {
    const { rerender } = render(
      <WorkspaceEmptyState title="T" description="D" actions={<button>act</button>} />
    );
    expect(screen.getByText("T")).toBeTruthy();
    expect(screen.getByText("D")).toBeTruthy();
    expect(screen.getByRole("button", { name: "act" })).toBeTruthy();

    rerender(<WorkspaceEmptyState title="T2" />);
    expect(screen.queryByText("D")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Horizontal gutter source guard", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("主要 Workspace body 水平 gutter 使用 workspace-gutter（不再手写 px-4 md:px-6 / p-4 md:p-6）", () => {
    for (const f of [
      "components/timeline/TimelineWorkspace.tsx",
      "components/assignment/AssignmentsWorkspace.tsx",
      "components/course/CoursesWorkspace.tsx",
      "components/group/GroupCollaborationView.tsx",
      "components/analytics/LearningAnalyticsView.tsx",
    ]) {
      const src = read(f);
      expect(src).toContain("workspace-gutter");
      // 手写基础横向 gutter 已收口（纵向 pt/pb 允许自由声明）
      expect(src).not.toMatch(/md:(p|px)-6/);
    }
  });

  it("Overview 保持既有 workspace-gutter 用法（不回归）", () => {
    expect(read("components/dashboard/OverviewWorkspace.tsx")).toContain("workspace-gutter");
  });
});
