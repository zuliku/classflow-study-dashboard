// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

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
      planningPreview: null,
      setPlanningPreview: vi.fn(),
      studyRebalancePreview: null,
      setStudyRebalancePreview: vi.fn(),
      handoffPrompt: null,
    }),
    useKiroSessionMeta: () => ({ kiroBusy: false }),
    useKiroSessionActions: () => ({
      claimEmptyIntro: vi.fn(),
      openSidecar: vi.fn(),
      closeSidecar: vi.fn(),
      expandSidecar: vi.fn(),
      minimizeSidecar: vi.fn(),
      restoreSidecar: vi.fn(),
    }),
  };
});

import { FocusRuntime } from "@/components/focus/FocusRuntime";
import { AssignmentDrawer } from "@/components/drawers/AssignmentDrawer";
import {
  revalidateTimerCompletionHandoff,
  resolveTimerCompletionHandoff,
} from "@/lib/focus/focusRuntime";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import type { Assignment, Course, FocusSession, Semester } from "@/types";

/**
 * Workflow UX V11 —— Focus Completion → Assignment Follow-up Handoff：
 * - live timer 完成（Drawer 关闭 + 任务有效）→ Toast「查看任务」→ 点击 revalidate
 *   → 写一次性 intent → 打开 Drawer（activeTab 不变）→ 复用现有 follow-up
 * - recovered / manual 不走 handoff；Drawer 已在同一任务时 Toast 不加 action
 * - intent 为 transient store 字段：不 persist、consume once、reset-race 安全
 */

const T0 = new Date("2026-01-10T10:00:00").getTime();

const COURSE_A: Course = { id: "c-1", name: "计量经济学" } as unknown as Course;
const ASSIGNMENT_A: Assignment = {
  id: "a-1",
  courseId: "c-1",
  title: "实证报告",
  description: "",
  status: "doing",
  progress: 0,
  tags: [],
} as unknown as Assignment;
const SEMESTER: Semester = { id: "s1", name: "x", startDate: "2025-09-01", totalWeeks: 16 };

const mkCompletedTimerSession = (over: Partial<FocusSession> = {}): FocusSession =>
  ({
    id: "f-done",
    plannedMinutes: 25,
    startedAt: T0 - 26 * 60_000,
    accumulatedActiveMs: 25 * 60_000,
    status: "completed" as const,
    endedAt: T0 - 60_000,
    endReason: "timer" as const,
    actualActiveMs: 25 * 60_000,
    assignmentId: "a-1",
    source: "manual" as const,
    createdAt: T0 - 26 * 60_000,
    updatedAt: T0 - 60_000,
    ...over,
  }) as FocusSession;

function seedBase() {
  const prefs = useAppStore.getState().preferences;
  useAppStore.setState({
    courses: [COURSE_A],
    assignments: [{ ...ASSIGNMENT_A }],
    schedules: [],
    calendarMarks: [],
    studyBlocks: [],
    reminders: [],
    groupProjects: [],
    scheduleOccurrenceOverrides: [],
    semester: { ...SEMESTER },
    currentSemesterWeek: 1,
    activeTab: "timetable" as never,
    selectedAssignmentId: null,
    selectedCourseId: null,
    selectedCalendarMarkId: null,
    pendingTimelineArrangeAssignmentId: null,
    pendingFocusCompletionFollowUp: null,
    focusSessions: [],
    preferences: { ...prefs },
  });
  useToastStore.setState({ toasts: [] });
}

beforeEach(async () => {
  cleanup();
  seedBase();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ============================================================
// 纯决策：resolve / revalidate（FocusRuntime 薄层的行为契约）
// ============================================================
describe("resolveTimerCompletionHandoff（Toast action 资格）", () => {
  it("live timer + 有效 Assignment + Drawer 关闭 → handoff 目标成立", () => {
    expect(
      resolveTimerCompletionHandoff({
        assignmentId: "a-1",
        sessionId: "f-done",
        selectedAssignmentId: null,
        assignments: [{ id: "a-1" }],
      })
    ).toEqual({ assignmentId: "a-1", sessionId: "f-done" });
  });

  it("Drawer 已打开同一任务 → 不加 action（observer 已覆盖）", () => {
    expect(
      resolveTimerCompletionHandoff({
        assignmentId: "a-1",
        sessionId: "f-done",
        selectedAssignmentId: "a-1",
        assignments: [{ id: "a-1" }],
      })
    ).toBeNull();
  });

  it("Assignment 已删除 → 无 action；course-only（无 assignmentId）→ 无 action", () => {
    expect(
      resolveTimerCompletionHandoff({
        assignmentId: "a-gone",
        sessionId: "f-done",
        selectedAssignmentId: null,
        assignments: [{ id: "a-1" }],
      })
    ).toBeNull();
    expect(
      resolveTimerCompletionHandoff({
        assignmentId: undefined,
        sessionId: "f-done",
        selectedAssignmentId: null,
        assignments: [{ id: "a-1" }],
      })
    ).toBeNull();
  });
});

describe("revalidateTimerCompletionHandoff（点击时刻 safety）", () => {
  it("全部满足 → 返回 intent", () => {
    expect(
      revalidateTimerCompletionHandoff({
        assignmentId: "a-1",
        sessionId: "f-done",
        assignments: [{ id: "a-1" }],
        focusSessions: [mkCompletedTimerSession()],
      })
    ).toEqual({ assignmentId: "a-1", sessionId: "f-done" });
  });

  it("Assignment 已删除 / session 不存在 / 非 completed timer / assignmentId 不匹配 → 全部 no-op", () => {
    const base = { sessionId: "f-done", assignments: [{ id: "a-1" }] };
    expect(
      revalidateTimerCompletionHandoff({ ...base, assignmentId: "a-1", assignments: [], focusSessions: [mkCompletedTimerSession()] })
    ).toBeNull();
    expect(
      revalidateTimerCompletionHandoff({ ...base, assignmentId: "a-1", focusSessions: [] })
    ).toBeNull();
    expect(
      revalidateTimerCompletionHandoff({
        ...base,
        assignmentId: "a-1",
        focusSessions: [mkCompletedTimerSession({ endReason: "recovered" })],
      })
    ).toBeNull();
    expect(
      revalidateTimerCompletionHandoff({
        ...base,
        assignmentId: "a-1",
        focusSessions: [mkCompletedTimerSession({ assignmentId: "a-other" })],
      })
    ).toBeNull();
  });
});

// ============================================================
// FocusRuntime live timer 集成（fake timers + 真实 hydration gate）
// ============================================================
async function renderRuntimeWithRunningSession(opts?: { openDrawerOn?: string | null }) {
  vi.useFakeTimers({ now: T0 });
  await act(async () => {
    await useAppStore.persist.rehydrate();
  });
  act(() => {
    useAppStore.getState().startFocusSession({
      plannedMinutes: 25,
      assignmentId: "a-1",
      source: "manual",
    });
  });
  if (opts?.openDrawerOn) {
    act(() => {
      useAppStore.setState({ selectedAssignmentId: opts.openDrawerOn! });
    });
  }
  // AssignmentDrawer 为 global mount（app/page.tsx）：closed 时仅不渲染内容，hooks/effects 仍在
  render(
    <>
      <FocusRuntime />
      <AssignmentDrawer />
    </>
  );
}

describe("FocusRuntime live timer completion handoff", () => {
  it(
    "live 完成 + Drawer 关闭 → Toast 带「查看任务」；点击 → pending intent + Drawer 打开 + activeTab 不变 + Follow-up 显示",
    async () => {
      await renderRuntimeWithRunningSession();
      // 快进 25 分钟 → timer 到期 → complete("timer") + toast
      await act(async () => {
        await vi.advanceTimersByTimeAsync(25 * 60_000);
      });
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].actionLabel).toBe("查看任务");

      act(() => toasts[0].onAction?.());

      // zustand set 会替换 state 对象，断言必须重新 getState；
      // Drawer global mount 下同一 act 内即完成「intent 写入 → 打开 → 消费」全链路，
      // 因此最终态 = pending 已被 consume-once 清空 + Follow-up 显示
      const after = useAppStore.getState();
      expect(after.selectedAssignmentId).toBe("a-1");
      expect(after.activeTab).toBe("timetable");
      expect(useAppStore.getState().pendingFocusCompletionFollowUp).toBeNull();
      // Follow-up 显示（实体 guard：assignmentId 匹配的 timer session）
      expect(screen.getByTestId("focus-follow-up").textContent).toContain("本次专注完成");
    },
    20000
  );

  it(
    "完成时 Drawer 已打开同一任务 → Toast 无 action，现有 observer 显示 Follow-up",
    async () => {
      await renderRuntimeWithRunningSession({ openDrawerOn: "a-1" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(25 * 60_000);
      });
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].actionLabel).toBeUndefined();
      expect(screen.getByTestId("focus-follow-up")).toBeTruthy();
      // observer 路径不写 global intent
      expect(useAppStore.getState().pendingFocusCompletionFollowUp).toBeNull();
    },
    20000
  );

  it(
    "Toast 停留期间 Assignment 被删除 → 点击 no-op（不写 selection、不建 orphan intent）",
    async () => {
      await renderRuntimeWithRunningSession();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(25 * 60_000);
      });
      const toasts = useToastStore.getState().toasts;
      expect(toasts[0].actionLabel).toBe("查看任务");

      act(() => {
        useAppStore.setState({ assignments: [] });
      });
      act(() => toasts[0].onAction?.());
      expect(useAppStore.getState().selectedAssignmentId).toBeNull();
      expect(useAppStore.getState().pendingFocusCompletionFollowUp).toBeNull();
    },
    20000
  );

  it("boot recovered 完成仍是原恢复文案，无「查看任务」action", async () => {
    vi.useFakeTimers({ now: T0 });
    await act(async () => {
      await useAppStore.persist.rehydrate();
    });
    // booting 前已 overdue 的 running session → complete-recovered
    act(() => {
      useAppStore.setState({
        focusSessions: [
          mkCompletedTimerSession({
            id: "f-stale",
            status: "running" as never,
            endReason: undefined,
            endedAt: undefined,
            activeStartedAt: T0 - 30 * 60_000,
            startedAt: T0 - 55 * 60_000,
          }),
        ],
      });
    });
    render(<FocusRuntime />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("上次的专注会话已自动完成");
    expect(toasts[0].actionLabel).toBeUndefined();
    expect(useAppStore.getState().pendingFocusCompletionFollowUp).toBeNull();
  }, 20000);
});

// ============================================================
// Manual finish（Drawer 内）：立即 follow-up，不走 global intent
// ============================================================
describe("Manual finish path unchanged", () => {
  it("Drawer 内手动结束 → Follow-up 立即出现；pending 保持 null", async () => {
    vi.useFakeTimers({ now: T0 });
    await act(async () => {
      await useAppStore.persist.rehydrate();
    });
    act(() => {
      useAppStore.setState({ selectedAssignmentId: "a-1" });
      useAppStore.getState().startFocusSession({
        plannedMinutes: 25,
        assignmentId: "a-1",
        source: "manual",
      });
    });
    render(<AssignmentDrawer />);

    fireEvent.click(screen.getByRole("button", { name: /结束专注/ }));
    expect(screen.getByTestId("focus-follow-up")).toBeTruthy();
    expect(useAppStore.getState().pendingFocusCompletionFollowUp).toBeNull();
  }, 20000);
});

// ============================================================
// AssignmentDrawer intent 消费（含 currentId reset race 回归）
// ============================================================
describe("AssignmentDrawer consumes completion intent", () => {
  function seedIntent(over: Partial<FocusSession> = {}) {
    const session = mkCompletedTimerSession(over);
    act(() => {
      useAppStore.setState({
        focusSessions: [session],
        pendingFocusCompletionFollowUp: { assignmentId: session.assignmentId!, sessionId: session.id },
      });
    });
    return session;
  }

  it("reset race：closed(null) + valid pending → setSelectedAssignmentId(target) → Follow-up 最终存在且 pending 清空", () => {
    seedIntent();
    render(<AssignmentDrawer />);
    expect(screen.queryByTestId("focus-follow-up")).toBeNull();

    act(() => {
      useAppStore.setState({ selectedAssignmentId: "a-1" });
    });
    // 不能出现：先 consume → currentId reset effect 又清掉
    expect(screen.getByTestId("focus-follow-up")).toBeTruthy();
    expect(useAppStore.getState().pendingFocusCompletionFollowUp).toBeNull();
  });

  it("session mismatch（sessionId 属于其它任务的会话）→ pending 清空、Follow-up 不显示", () => {
    act(() => {
      useAppStore.setState({
        focusSessions: [mkCompletedTimerSession({ id: "f-x", assignmentId: "a-other" })],
        pendingFocusCompletionFollowUp: { assignmentId: "a-1", sessionId: "f-x" },
      });
    });
    act(() => {
      useAppStore.setState({ selectedAssignmentId: "a-1" });
    });
    render(<AssignmentDrawer />);
    expect(screen.queryByTestId("focus-follow-up")).toBeNull();
    expect(useAppStore.getState().pendingFocusCompletionFollowUp).toBeNull();
  });

  it("session 不是 completed → pending 清空、Follow-up 不显示", () => {
    act(() => {
      useAppStore.setState({
        focusSessions: [
          mkCompletedTimerSession({ id: "f-run", status: "running" as never, endReason: undefined, endedAt: undefined }),
        ],
        pendingFocusCompletionFollowUp: { assignmentId: "a-1", sessionId: "f-run" },
      });
    });
    act(() => {
      useAppStore.setState({ selectedAssignmentId: "a-1" });
    });
    render(<AssignmentDrawer />);
    expect(screen.queryByTestId("focus-follow-up")).toBeNull();
    expect(useAppStore.getState().pendingFocusCompletionFollowUp).toBeNull();
  });

  it("assignment mismatch：intent 目标 A 但先打开 B → B 无 Follow-up 且 pending 保留；再打开 A → 正常消费", () => {
    act(() => {
      useAppStore.setState({
        courses: [COURSE_A, { id: "c-2", name: "线代" } as unknown as Course],
        assignments: [
          { ...ASSIGNMENT_A },
          { id: "a-2", courseId: "c-2", title: "习题集", description: "", status: "todo", progress: 0, tags: [] } as unknown as Assignment,
        ],
        focusSessions: [mkCompletedTimerSession()],
        pendingFocusCompletionFollowUp: { assignmentId: "a-1", sessionId: "f-done" },
      });
    });
    act(() => {
      useAppStore.setState({ selectedAssignmentId: "a-2" });
    });
    render(<AssignmentDrawer />);
    expect(screen.queryByTestId("focus-follow-up")).toBeNull();
    expect(useAppStore.getState().pendingFocusCompletionFollowUp).not.toBeNull();

    act(() => {
      useAppStore.setState({ selectedAssignmentId: "a-1" });
    });
    expect(screen.getByTestId("focus-follow-up")).toBeTruthy();
    expect(useAppStore.getState().pendingFocusCompletionFollowUp).toBeNull();
  });

  it("consume once：关闭 Drawer 再打开同一任务 → Follow-up 不重新出现", async () => {
    seedIntent();
    act(() => {
      useAppStore.setState({ selectedAssignmentId: "a-1" });
    });
    render(<AssignmentDrawer />);
    expect(screen.getByTestId("focus-follow-up")).toBeTruthy();

    act(() => {
      useAppStore.setState({ selectedAssignmentId: null });
    });
    // 退场保留 160ms 后卸载（对称进退；消费语义不变：重开仍不出现）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 220));
    });
    expect(screen.queryByTestId("focus-follow-up")).toBeNull();
    act(() => {
      useAppStore.setState({ selectedAssignmentId: "a-1" });
    });
    expect(screen.queryByTestId("focus-follow-up")).toBeNull();
  });

  it("目标 Assignment 已删除后打开其它任务 → pending 被丢弃、无 Follow-up", () => {
    act(() => {
      useAppStore.setState({
        assignments: [], // a-1 已删除
        focusSessions: [mkCompletedTimerSession()],
        pendingFocusCompletionFollowUp: { assignmentId: "a-1", sessionId: "f-done" },
      });
    });
    act(() => {
      useAppStore.setState({ selectedAssignmentId: null });
    });
    render(<AssignmentDrawer />);
    expect(screen.queryByTestId("focus-follow-up")).toBeNull();
    // 触发一次 deps 变化驱动 consume effect 清理
    act(() => {
      useAppStore.setState({ focusSessions: [mkCompletedTimerSession(), mkCompletedTimerSession({ id: "f-y" })] });
    });
    expect(useAppStore.getState().pendingFocusCompletionFollowUp).toBeNull();
  });
});

// ============================================================
// Persistence guard：transient intent 绝不进入持久化白名单
// ============================================================
describe("pendingFocusCompletionFollowUp persistence guard", () => {
  it("partialize 白名单不含该字段（transient）；setter roundtrip 正常", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "store/useAppStore.ts"), "utf8");
    const partializeMatch = src.match(/partialize: \(state\)[\s\S]*?\}\),/);
    expect(partializeMatch).toBeTruthy();
    expect(partializeMatch![0]).not.toContain("pendingFocusCompletionFollowUp");
    // persist version 未 bump（仍为 V8 后的 8）
    expect(src).toMatch(/version: 8/);

    act(() => {
      useAppStore.getState().setPendingFocusCompletionFollowUp({ assignmentId: "a-1", sessionId: "f-done" });
    });
    expect(useAppStore.getState().pendingFocusCompletionFollowUp).toEqual({
      assignmentId: "a-1",
      sessionId: "f-done",
    });
    act(() => {
      useAppStore.getState().setPendingFocusCompletionFollowUp(null);
    });
    expect(useAppStore.getState().pendingFocusCompletionFollowUp).toBeNull();
  });
});
