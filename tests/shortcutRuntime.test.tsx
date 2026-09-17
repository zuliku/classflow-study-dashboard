// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useAppStore } from "@/store/useAppStore";
import { clearOverlayStack } from "@/lib/overlayStack";
import { GlobalShortcutController } from "@/components/command/GlobalShortcutController";
import { AssignmentTable } from "@/components/dashboard/AssignmentTable";
import type { AssignmentWorkspaceController } from "@/hooks/useAssignmentWorkspaceController";
import type { TaskWorkspaceItem } from "@/lib/tasks/taskViews";
import { openAssignmentEditor } from "@/lib/uiEvents";

vi.mock("@/lib/uiEvents", () => ({
  openAssignmentEditor: vi.fn(),
}));

// AssignmentTable 仅持有 handoff（本文件不触发其行为），stub 避免挂载 KiroSessionProvider
vi.mock("@/hooks/useKiroHandoff", () => ({
  useKiroHandoff: () => ({}),
}));

if (typeof (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof (window as unknown as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = (
    globalThis as unknown as { ResizeObserver: unknown }
  ).ResizeObserver;
}
function mockDesktopMatchMedia(matchesDesktop: boolean) {
  (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) =>
    ({
      matches: matchesDesktop && query.includes("1024"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }) as unknown as MediaQueryList;
}
mockDesktopMatchMedia(true);

function pressKey(target: Element | Window, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("GlobalShortcutController 行为不变", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    localStorage.clear();
    clearOverlayStack();
    vi.mocked(openAssignmentEditor).mockClear();
    useAppStore.setState({ isSearchModalOpen: false, searchModalView: "palette" });
    useAppStore.getState().updatePreferences({ enableSingleKeyShortcuts: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<GlobalShortcutController />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("N → 快速新建任务", () => {
    pressKey(window, "n");
    expect(openAssignmentEditor).toHaveBeenCalledTimes(1);
    pressKey(window, "N");
    expect(openAssignmentEditor).toHaveBeenCalledTimes(2);
  });

  it("/ → 打开搜索", () => {
    pressKey(window, "/");
    expect(useAppStore.getState().isSearchModalOpen).toBe(true);
    expect(useAppStore.getState().searchModalView).toBe("palette");
  });

  it("? → 打开快捷键帮助", () => {
    pressKey(window, "?");
    expect(useAppStore.getState().isSearchModalOpen).toBe(true);
    expect(useAppStore.getState().searchModalView).toBe("guide");
  });

  it("单键关闭后 N / ? 不触发，标准行为保留", () => {
    act(() => {
      useAppStore.getState().updatePreferences({ enableSingleKeyShortcuts: false });
    });
    pressKey(window, "n");
    expect(openAssignmentEditor).not.toHaveBeenCalled();
    pressKey(window, "?");
    expect(useAppStore.getState().isSearchModalOpen).toBe(false);
  });

  it("输入框内按键不触发单键行为", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    pressKey(input, "n");
    expect(openAssignmentEditor).not.toHaveBeenCalled();
    input.remove();
  });
});

describe("AssignmentTable workspace 键盘行为不变", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let ids: string[];

  function fakeController(items: TaskWorkspaceItem[]): AssignmentWorkspaceController {
    return {
      view: "all",
      setView: () => {},
      courseFilter: "all",
      setCourseFilter: () => {},
      searchQuery: "",
      setSearchQuery: () => {},
      riskOnly: false,
      setRiskOnly: () => {},
      moreOpen: false,
      setMoreOpen: () => {},
      items,
      counts: { focus: 2, today: 2, upcoming: 2, "at-risk": 0, unscheduled: 0, all: 2, archive: 0 },
      atRiskCount: 0,
    };
  }

  function listEl(): HTMLElement {
    const el = container.querySelector('[tabindex="0"]');
    if (!el) throw new Error("workspace list container not found");
    return el as HTMLElement;
  }

  beforeEach(async () => {
    localStorage.clear();
    clearOverlayStack();
    // 跨用例 store 隔离（同文件共享模块实例）：重置任务与选择态
    useAppStore.setState({
      assignments: [],
      assignmentSelection: [],
      assignmentPeekId: null,
      highlightedAssignmentId: null,
    });
    const store = useAppStore.getState();
    store.updatePreferences({ enableSingleKeyShortcuts: true });
    const id1 = store.addAssignment({
      courseId: "c1",
      title: "任务一",
      description: "",
      priority: "medium",
      status: "todo",
      progress: 0,
      tags: [],
    });
    const id2 = store.addAssignment({
      courseId: "c1",
      title: "任务二",
      description: "",
      priority: "medium",
      status: "todo",
      progress: 0,
      tags: [],
    });
    ids = [id1, id2];
    const items: TaskWorkspaceItem[] = useAppStore
      .getState()
      .assignments.filter((a) => ids.includes(a.id))
      .map((task) => ({
        task,
        meta: {
          hasDeadline: false,
          scheduledMinutes: 0,
          studyBlockCount: 0,
          scheduledToday: false,
          deadlineToday: false,
          overdue: false,
        },
      }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<AssignmentTable mode="workspace" workspaceController={fakeController(items)} />);
    });
    act(() => {
      useAppStore.getState().setHighlightedAssignmentId(ids[0]);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("J 向下 / K 向上移动 highlight", () => {
    pressKey(listEl(), "j");
    expect(useAppStore.getState().highlightedAssignmentId).toBe(ids[1]);
    pressKey(listEl(), "k");
    expect(useAppStore.getState().highlightedAssignmentId).toBe(ids[0]);
  });

  it("ArrowDown / ArrowUp 仍可导航", () => {
    pressKey(listEl(), "ArrowDown");
    expect(useAppStore.getState().highlightedAssignmentId).toBe(ids[1]);
    pressKey(listEl(), "ArrowUp");
    expect(useAppStore.getState().highlightedAssignmentId).toBe(ids[0]);
  });

  it("Home / End 跳转首尾（单键开关均可用，属标准键盘操作）", () => {
    const start = useAppStore.getState().highlightedAssignmentId;
    pressKey(listEl(), "Home");
    const first = useAppStore.getState().highlightedAssignmentId;
    pressKey(listEl(), "End");
    const last = useAppStore.getState().highlightedAssignmentId;
    // 两项列表：首尾互异且往返稳定（不断言具体顺序，顺序由视图派生）
    expect([first, last].sort()).toEqual([...ids].sort());
    expect(first).not.toBe(last);
    pressKey(listEl(), "Home");
    expect(useAppStore.getState().highlightedAssignmentId).toBe(first);
    pressKey(listEl(), "End");
    expect(useAppStore.getState().highlightedAssignmentId).toBe(last);
    act(() => {
      useAppStore.getState().updatePreferences({ enableSingleKeyShortcuts: false });
    });
    pressKey(listEl(), "Home");
    expect(useAppStore.getState().highlightedAssignmentId).toBe(first);
    pressKey(listEl(), "End");
    expect(useAppStore.getState().highlightedAssignmentId).toBe(last);
  });

  it("X 切换选择且绝不删除任务", () => {
    pressKey(listEl(), "x");
    expect(useAppStore.getState().assignmentSelection).toContain(ids[0]);
    expect(useAppStore.getState().assignments).toHaveLength(2);
    pressKey(listEl(), "x");
    expect(useAppStore.getState().assignmentSelection).not.toContain(ids[0]);
    expect(useAppStore.getState().assignments).toHaveLength(2);
  });

  it("Space 预览任务（桌面端），行为保留", () => {
    pressKey(listEl(), " ");
    expect(useAppStore.getState().assignmentPeekId).toBe(ids[0]);
  });

  it("单键关闭后 J/K/X/Space 失效，方向键保留", () => {
    act(() => {
      useAppStore.getState().updatePreferences({ enableSingleKeyShortcuts: false });
    });
    pressKey(listEl(), "j");
    expect(useAppStore.getState().highlightedAssignmentId).toBe(ids[0]);
    pressKey(listEl(), "x");
    expect(useAppStore.getState().assignmentSelection).toHaveLength(0);
    pressKey(listEl(), " ");
    expect(useAppStore.getState().assignmentPeekId).toBeNull();
    pressKey(listEl(), "ArrowDown");
    expect(useAppStore.getState().highlightedAssignmentId).toBe(ids[1]);
  });
});
