// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

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
if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
}

vi.mock("@/hooks/useKiroHandoff", () => ({
  useKiroHandoff: () => ({
    handoffPrompt: vi.fn(),
    handoffAssignmentPrompt: vi.fn(),
    openForWeek: vi.fn(),
    openForGroupProject: vi.fn(),
    openForAssignment: vi.fn(),
  }),
}));
vi.mock("@/components/kiro/KiroSessionProvider", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/components/kiro/KiroSessionProvider")>();
  return {
    ...mod,
    KiroSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useKiroSession: () => ({
      planningPreview: null, setPlanningPreview: vi.fn(),
      studyRebalancePreview: null, setStudyRebalancePreview: vi.fn(),
      handoffPrompt: null,
    }),
    useKiroSessionMeta: () => ({ kiroBusy: false }),
    useKiroSessionActions: () => ({
      claimEmptyIntro: vi.fn(), openSidecar: vi.fn(), closeSidecar: vi.fn(),
      expandSidecar: vi.fn(), minimizeSidecar: vi.fn(), restoreSidecar: vi.fn(),
    }),
  };
});

import { AssignmentDrawer } from "@/components/drawers/AssignmentDrawer";
import { CourseDetailDrawer } from "@/components/drawers/CourseDetailDrawer";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { AssignmentPeekPanel } from "@/components/assignment/AssignmentPeekPanel";
import { useAppStore } from "@/store/useAppStore";
import type { Assignment, Course } from "@/types";

/**
 * Workflow UX Motion Productization M2 —— Detail Surface Continuity：
 * - Drawer A → B：outer shell 不 unmount；DetailContentStage keyed by entity id，
 *   播放一次轻量 swap（data-stage-swap）；同 id 的 status 变化不重新触发 swap
 * - Peek：surface 保持 mounted，J/K 连续浏览只换内容
 * - 全部为 CSS animation（ux-detail-swap-in）+ 全局 reduced contract，无 JS delay
 */

const mkA = (id: string, over: Partial<Assignment> = {}): Assignment =>
  ({ id, courseId: "", title: `任务 ${id}`, description: "", ddl: undefined, priority: "medium", status: "todo", progress: 0, tags: [], ...over }) as Assignment;

function actSet(partial: Record<string, unknown>) {
  // React 18 concurrent：包 act 确保状态刷新同步于断言
  act(() => {
    useAppStore.setState(partial as never);
  });
}

function seed(assignments: Assignment[]) {
  const prefs = useAppStore.getState().preferences;
  useAppStore.setState({
    courses: [],
    assignments,
    schedules: [],
    calendarMarks: [],
    studyBlocks: [],
    reminders: [],
    groupProjects: [],
    scheduleOccurrenceOverrides: [],
    semester: { id: "s", name: "x", startDate: "2026-01-05", totalWeeks: 16 },
    currentSemesterWeek: 1,
    activeTab: "overview" as never,
    selectedAssignmentId: null,
    selectedCourseId: null,
    selectedCalendarMarkId: null,
    focusSessions: [],
    pendingFocusCompletionFollowUp: null,
    preferences: { ...prefs },
  });
}

const titles = () =>
  useAppStore.getState().assignments.map((a) => a.title);

beforeEach(() => {
  cleanup();
  seed([mkA("a1"), mkA("a2"), mkA("a3")]);
});
afterEach(() => {
  cleanup();
});

describe("AssignmentDrawer detail continuity", () => {
  it("A → B：Drawer shell 不 unmount、stage 切到 B、播放一次 swap", () => {
    actSet({ selectedAssignmentId: "a1" });
    const { container } = render(<AssignmentDrawer />);
    const shellBefore = screen.getByTestId("assignment-detail-panel");
    expect(screen.getByText("任务 a1")).toBeTruthy();

    actSet({ selectedAssignmentId: "a2" });

    // outer shell：同一 DOM 节点保持连接（未 unmount/remount）
    const shellAfter = screen.getByTestId("assignment-detail-panel");
    expect(shellAfter).toBe(shellBefore);

    // stage：新内容 + 一次 swap 标记
    expect(screen.getByText("任务 a2")).toBeTruthy();
    expect(document.querySelector('[data-stage-swap="true"]')).toBeTruthy();
  });

  it("同一 Assignment 的 status 变化：stage 不重切（无 swap 标记）、内容即时更新", () => {
    actSet({ selectedAssignmentId: "a1" });
    render(<AssignmentDrawer />);
    // 清除首次 open 后可能残留的标记观察窗口：先切走再切回会重置——此处直接改同 id 字段
    actSet({
      assignments: [mkA("a1", { status: "doing", progress: 40 }), mkA("a2"), mkA("a3")],
    });
    expect(screen.getByText("任务 a1")).toBeTruthy();
    // entityKey 未变（仅 id）→ 不应出现新的 stage-swap 标记节点
    expect(document.querySelector('[data-stage-swap="true"]')).toBeNull();
  });

  it("连续 A → B → C：立即显示 C（不排队动画）", () => {
    actSet({ selectedAssignmentId: "a1" });
    render(<AssignmentDrawer />);
    actSet({ selectedAssignmentId: "a2" });
    actSet({ selectedAssignmentId: "a3" });
    expect(screen.getByText("任务 a3")).toBeTruthy();
    expect(screen.queryByText("任务 a2")).toBeNull();
  });

  function actSet(partial: Record<string, unknown>) {
  // React 18 concurrent：包 act 确保状态刷新同步于断言
  act(() => {
    useAppStore.setState(partial as never);
  });
    useAppStore.setState(partial as never);
  }
});

describe("Peek keyboard continuity", () => {
  it("A → B：Panel surface 保持 mounted；stage 轻量 swap；最终显示 B", () => {
    seed([mkA("p1"), mkA("p2")]);
    actSet({ assignmentPeekId: "p1" });
    const { rerender } = render(<AssignmentPeekPanel />);
    const surfaceBefore = screen.getByTestId("assignment-peek");

    actSet({ assignmentPeekId: "p2" });
    rerender(<AssignmentPeekPanel />);

    const surfaceAfter = screen.getByTestId("assignment-peek");
    expect(surfaceAfter).toBe(surfaceBefore); // shell 保持 mounted（不关闭重开）
    expect(screen.getByText("任务 p2")).toBeTruthy();
    expect(useAppStore.getState().assignmentPeekId).toBe("p2");
    void document;
  });
});

describe("Reduced Motion contract（static）", () => {
  it("swap 动画为纯 CSS（ux-detail-swap-in），全局 reduced 规则直接落位；组件无 JS timer/matchMedia", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const stage = fs.readFileSync(path.join(process.cwd(), "components/ui/DetailContentStage.tsx"), "utf-8");
    expect(stage).toContain("ux-detail-swap-in");
    expect(stage).not.toContain("setTimeout");
    expect(stage).not.toContain("matchMedia");
    const css = await readCss("app/globals.css");
    // 全局 reduced 契约存在（* 选择器覆盖 detail swap 动画）
    expect(css).toMatch(/html\[data-motion-effective="reduced"\] \*,/);
  });

  async function readCss(p: string) {
    const fs = await import("node:fs");
    const path = await import("node:path");
    return fs.readFileSync(path.join(process.cwd(), p), "utf-8");
  }
});

// ============================================================
// Workflow UX Motion M3 P0 —— Course Drawer close ownership regression
// ============================================================

const COURSE: Course = {
  id: "course-a",
  name: "课程 A",
  code: "C-A",
  credit: 3,
  description: "",
  materials: [],
} as unknown as Course;

describe("CourseDetailDrawer close ownership（M3 P0 regression）", () => {
  beforeEach(() => {
    cleanup();
    const prefs = useAppStore.getState().preferences;
    useAppStore.setState({
      courses: [COURSE],
      assignments: [],
      schedules: [],
      calendarMarks: [],
      studyBlocks: [],
      reminders: [],
      groupProjects: [],
      scheduleOccurrenceOverrides: [],
      semester: { id: "s", name: "x", startDate: "2026-01-05", totalWeeks: 16 },
      currentSemesterWeek: 1,
      activeTab: "courses" as never,
      selectedCourseId: null,
      preferences: { ...prefs },
    });
  });

  it("open → setSelectedCourseId(null)：selection 立即清空、Drawer 收到 open=false、exit 后 unmount", async () => {
    vi.useFakeTimers();
    try {
      act(() => {
        useAppStore.getState().setSelectedCourseId("course-a");
      });
      render(<CourseDetailDrawer />);
      expect(screen.getByTestId("course-detail-panel")).toBeTruthy();
      expect(useAppStore.getState().selectedCourseId).toBe("course-a");

      // X / Esc / Ask Kiro 等所有 close path 最终都走 setSelectedCourseId(null)
      fireEvent.click(screen.getByLabelText("关闭"));

      // Selection Entity 立即清空 + Drawer 接收 open=false（shell 在 exit presence 内保持）
      expect(useAppStore.getState().selectedCourseId).toBeNull();
      const panel = screen.getByTestId("course-detail-panel");
      expect(panel.className).toContain("opacity-0"); // exit presence 视觉退场中

      // 退出 presence（--motion-exit-panel = 160ms）后完全 unmount
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MOTION_EXIT_MS.panel + 20);
      });
      expect(screen.queryByTestId("course-detail-panel")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  }, 20000);

  it("静态 ownership contract：open 只能来自 Selection Entity（!!currentCourse）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "components/drawers/CourseDetailDrawer.tsx"), "utf-8");
    expect(src).toContain("open={!!currentCourse}");
    // 禁止 stale/resolved entity 参与 open truth（Motion refactor 曾误写 open={!!course}）
    expect(src).not.toContain("open={!!course}");
    expect(src).not.toContain("open={!!staleCourse}");
  });
});
