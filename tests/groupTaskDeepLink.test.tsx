// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";

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
// jsdom 无 scrollIntoView：记录调用供断言（jsdom 环境恒未实现 → 桩必然生效）
const scrollIntoViewCalls: Array<{ el: HTMLElement; opts: ScrollIntoViewOptions | boolean | undefined }> = [];
if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: function (this: HTMLElement, opts?: ScrollIntoViewOptions | boolean) {
      scrollIntoViewCalls.push({ el: this, opts });
    },
  });
}

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

import { GroupCollaborationView } from "@/components/group/GroupCollaborationView";
import { useAppStore } from "@/store/useAppStore";
import type { Course, GroupProject } from "@/types";

/**
 * Workflow UX V12 —— GroupTask Deep Link consume contract：
 * - 完整 identity = projectId + taskId；stale 任一 → 安全 clear，不 blank
 * - 先稳定 project，再处理 taskSearch 隐藏，最后 row 存在才 scroll/focus + consume once
 * - 无 setTimeout / queueMicrotask 赌 render timing
 */

const COURSE: Course = { id: "c1", name: "国际贸易实务" } as unknown as Course;

const mkProject = (
  id: string,
  title: string,
  tasks: Array<{ id: string; title: string; assigneeId?: string }>,
  over: Partial<GroupProject> = {}
): GroupProject =>
  ({
    id,
    courseId: "c1",
    title,
    description: "",
    progress: 0,
    updatedAt: "2026-01-01",
    members: [{ id: "m-lm", name: "李明", role: "member" }],
    tasks: tasks.map((t) => ({ ddl: "2026-08-28T18:00:00", completed: false, ...t })),
    ...over,
  }) as unknown as GroupProject;

const PROJECT_A = mkProject("g-a", "项目 A", [
  { id: "t-a1", title: "任务 A1" },
]);
const PROJECT_B = mkProject("g-b", "项目 B", [
  { id: "t-b1", title: "文献阅读" },
  { id: "t-b2", title: "模型复核" },
]);

function scrollCalls(): Array<{ el: HTMLElement; opts: ScrollIntoViewOptions | boolean | undefined }> {
  return scrollIntoViewCalls;
}

beforeEach(() => {
  cleanup();
  useAppStore.setState({
    courses: [COURSE],
    groupProjects: [PROJECT_A, PROJECT_B],
    selectedGroupProjectId: null,
    pendingGroupTaskTarget: null,
    activeTab: "group" as never,
  });
});
afterEach(() => {
  cleanup();
});

describe("GroupTask deep link consume", () => {
  it("17/18/19/20. A→B 真实 transition：切 project B → B2 可见 → row focused → pending cleared", () => {
    act(() => {
      useAppStore.setState({ selectedGroupProjectId: "g-a" });
      useAppStore.getState().setPendingGroupTaskTarget({ projectId: "g-b", taskId: "t-b2" });
      useAppStore.getState().setSelectedGroupProjectId("g-b");
      useAppStore.getState().setActiveTab("group");
    });
    render(<GroupCollaborationView />);

    // project B 已选中且 B2 在可见列表
    expect(useAppStore.getState().selectedGroupProjectId).toBe("g-b");
    expect(screen.getByTestId("group-task-row-t-b2")).toBeTruthy();
    expect(screen.queryByTestId("group-task-row-t-a1")).toBeNull();
    // exact row 被 focus 定位
    expect(document.activeElement).toBe(screen.getByTestId("group-task-row-t-b2"));
    // scrollIntoView 已调用（jsdom stub 记录）
    expect(scrollCalls().some((c) => c.el.getAttribute("data-testid") === "group-task-row-t-b2")).toBe(true);
    // consume once
    expect(useAppStore.getState().pendingGroupTaskTarget).toBeNull();
  });

  it("21. stale taskSearch 隐藏目标 → 自动清空搜索并完成定位（filter regression）", () => {
    act(() => {
      useAppStore.setState({ selectedGroupProjectId: "g-b" });
    });
    render(<GroupCollaborationView />);
    // 用户此前输入了不匹配的搜索词
    const searchInput = screen.getByLabelText("检索任务") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "不存在的关键词" } });
    expect(screen.queryByTestId("group-task-row-t-b2")).toBeNull();

    act(() => {
      useAppStore.getState().setPendingGroupTaskTarget({ projectId: "g-b", taskId: "t-b2" });
    });

    // 搜索被清理、目标可见、被定位、pending 清空（不会永久卡住）
    expect((screen.getByLabelText("检索任务") as HTMLInputElement).value).toBe("");
    expect(screen.getByTestId("group-task-row-t-b2")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId("group-task-row-t-b2"));
    expect(useAppStore.getState().pendingGroupTaskTarget).toBeNull();
  });

  it("23. stale projectId → pending 安全清除，workspace 不 blank", () => {
    act(() => {
      useAppStore.setState({ selectedGroupProjectId: "g-a" });
      useAppStore.getState().setPendingGroupTaskTarget({ projectId: "g-gone", taskId: "t-x" });
    });
    render(<GroupCollaborationView />);
    // 正常渲染 project A 内容（无 blank），pending 已清除
    expect(screen.getByText("任务 A1")).toBeTruthy();
    expect(useAppStore.getState().pendingGroupTaskTarget).toBeNull();
  });

  it("24. project 存在但 taskId 不属于它（存在于其它 project）→ 清除，不跳错 project", () => {
    act(() => {
      useAppStore.setState({ selectedGroupProjectId: "g-a" });
      // t-b2 属于 g-b，intent 却声明 parent=g-a → identity 校验失败
      useAppStore.getState().setPendingGroupTaskTarget({ projectId: "g-a", taskId: "t-b2" });
    });
    render(<GroupCollaborationView />);
    expect(useAppStore.getState().selectedGroupProjectId).toBe("g-a");
    expect(useAppStore.getState().pendingGroupTaskTarget).toBeNull();
  });

  it("26. consume 后切换 tab 再回来 → 不重新定位旧 target（一次性导航响应）", async () => {
    act(() => {
      useAppStore.setState({ selectedGroupProjectId: "g-a" });
      useAppStore.getState().setPendingGroupTaskTarget({ projectId: "g-b", taskId: "t-b2" });
      useAppStore.getState().setSelectedGroupProjectId("g-b");
    });
    const { unmount } = render(<GroupCollaborationView />);
    expect(useAppStore.getState().pendingGroupTaskTarget).toBeNull();

    unmount();
    render(<GroupCollaborationView />);
    // 二次 mount：无 pending → 不发生额外 scroll/focus（activeElement 保持 body）
    expect(document.activeElement).not.toBe(screen.getByTestId("group-task-row-t-b2"));
    expect(useAppStore.getState().pendingGroupTaskTarget).toBeNull();
  });

  it("project 缺失时 normalization 与 consume 共存：落到第一项目且无 blank", () => {
    act(() => {
      useAppStore.setState({ groupProjects: [PROJECT_A] });
      useAppStore.getState().setPendingGroupTaskTarget({ projectId: "g-b", taskId: "t-b2" });
    });
    render(<GroupCollaborationView />);
    expect(screen.getByText("任务 A1")).toBeTruthy();
    expect(useAppStore.getState().pendingGroupTaskTarget).toBeNull();
  });
});

// ============================================================
// Persistence guard：pendingGroupTaskTarget 绝不持久化
// ============================================================
describe("pendingGroupTaskTarget persistence guard", () => {
  it("partialize 白名单不含该字段；version 未 bump；reload 语义为 null", async () => {
    const src = fs.readFileSync(path.join(process.cwd(), "store/useAppStore.ts"), "utf8");
    const partializeMatch = src.match(/partialize: \(state\)[\s\S]*?\}\),/);
    expect(partializeMatch).toBeTruthy();
    expect(partializeMatch![0]).not.toContain("pendingGroupTaskTarget");
    expect(src).toMatch(/version: 8/);

    act(() => {
      useAppStore.getState().setPendingGroupTaskTarget({ projectId: "g-b", taskId: "t-b2" });
    });
    expect(useAppStore.getState().pendingGroupTaskTarget).toEqual({ projectId: "g-b", taskId: "t-b2" });
    act(() => {
      useAppStore.getState().setPendingGroupTaskTarget(null);
    });
    expect(useAppStore.getState().pendingGroupTaskTarget).toBeNull();
  });
});
