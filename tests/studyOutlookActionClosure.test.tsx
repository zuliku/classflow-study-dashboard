// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const kiroActionMocks = vi.hoisted(() => ({
  handoffPrompt: vi.fn(),
  handoffAssignmentPrompt: vi.fn(),
}));

vi.mock("@/components/kiro/KiroSessionProvider", () => ({
  KiroSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useKiroSessionActions: () => ({
    handoffPrompt: kiroActionMocks.handoffPrompt,
    handoffAssignmentPrompt: kiroActionMocks.handoffAssignmentPrompt,
    claimEmptyIntro: vi.fn(),
    openSidecar: vi.fn(),
    closeSidecar: vi.fn(),
    expandSidecar: vi.fn(),
    minimizeSidecar: vi.fn(),
    restoreSidecar: vi.fn(),
  }),
}));

import { StudyOutlookCard } from "@/components/analytics/StudyOutlookCard";
import { handleOpenOutlookAssignment } from "@/lib/analytics/outlookAssignmentAction";
import { useAppStore } from "@/store/useAppStore";
import { OutlookTask, StudyOutlook } from "@/lib/outlook/types";
import type { Assignment } from "@/types";

/**
 * Workflow UX V13 —— Study Outlook → Exact Assignment Action Closure：
 * - row 主内容区 = 原生 button（aria-label 打开任务《...》）→ onOpenAssignment(exact id)
 * - 「估算任务」= sibling control → handoffAssignmentPrompt(exact id, ESTIMATE_PROMPT)，
 *   不再 generic handoffPrompt；两个 action DOM 结构上分离，互不触发
 * - 打开 Assignment 只写 selectedAssignmentId（fresh Store stale 校验），不切 Workspace
 */

const mkTask = (over: Partial<OutlookTask> & { assignmentId: string; title: string }): OutlookTask =>
  ({
    health: "at-risk",
    reasons: [],
    deadline: "2026-09-01T23:59:00",
    estimatedMinutes: 120,
    capacityComplete: true,
    combinedCapacityComplete: null,
    unscheduledMinutes: 30,
    ...over,
  }) as unknown as OutlookTask;

const mkOutlook = (tasks: OutlookTask[]): StudyOutlook =>
  ({
    summary: {
      counts: {
        totalDue: tasks.length,
        atRisk: 0,
        attention: 0,
        missingEstimate: tasks.filter((t) => t.reasons.includes("missing_estimate")).length,
      },
      workload: { preferredShortfallMinutes: 0, combinedShortfallMinutes: 0, remainingKnownMinutes: 0 },
    },
    tasks,
    bottleneckDays: [],
    firstCapacityShortfall: null,
  }) as unknown as StudyOutlook;

const TASK_A = mkTask({ assignmentId: "a-outlook-1", title: "实证报告", health: "at-risk" });
const TASK_B = mkTask({
  assignmentId: "a-outlook-2",
  title: "论文初稿",
  health: "unknown",
  reasons: ["missing_estimate"],
  estimatedMinutes: null,
  capacityComplete: null,
});
const OUTLOOK = mkOutlook([TASK_A, TASK_B]);

function renderCard(onOpenAssignment = vi.fn()) {
  render(
    <StudyOutlookCard
      outlook={OUTLOOK}
      horizonDays={7}
      onHorizonChange={() => {}}
      onOpenAssignment={onOpenAssignment}
    />
  );
  return onOpenAssignment;
}

beforeEach(() => {
  cleanup();
  kiroActionMocks.handoffPrompt.mockClear();
  kiroActionMocks.handoffAssignmentPrompt.mockClear();
  const prefs = useAppStore.getState().preferences;
  useAppStore.setState({
    assignments: [
      { id: "a-outlook-1", title: "实证报告", status: "doing" } as unknown as Assignment,
      { id: "a-outlook-2", title: "论文初稿", status: "todo" } as unknown as Assignment,
    ],
    selectedAssignmentId: null,
    activeTab: "analytics" as never,
    preferences: { ...prefs },
  });
});
afterEach(() => {
  cleanup();
});

// ============================================================
// Row interaction（原生 button 语义）
// ============================================================
describe("Outlook task row → exact Assignment", () => {
  it("main surface 是原生 button，aria-label = 打开任务《...》", () => {
    renderCard();
    const btn = screen.getByLabelText("打开任务《实证报告》") as HTMLElement;
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("点击 main surface → onOpenAssignment(exact assignmentId)（非 title / 非 index 导航）", () => {
    const spy = renderCard();
    fireEvent.click(screen.getByLabelText("打开任务《实证报告》"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("a-outlook-1");

    // 第二行：exact id 不同（排除按 index / title 匹配的可能）
    fireEvent.click(screen.getByLabelText("打开任务《论文初稿》"));
    expect(spy).toHaveBeenLastCalledWith("a-outlook-2");
  });

  it("keyboard Enter 触发 exact open（原生 button activation）", () => {
    const spy = renderCard();
    const btn = screen.getByLabelText("打开任务《实证报告》");
    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.click(btn); // 浏览器对 Enter 的默认 activation = detail 0 click
    expect(spy).toHaveBeenCalledWith("a-outlook-1");
  });

  it("keyboard Space 同样触发（无需手写 keydown handler）", () => {
    const spy = renderCard();
    const btn = screen.getByLabelText("打开任务《实证报告》");
    fireEvent.keyDown(btn, { key: " " });
    fireEvent.keyUp(btn, { key: " " });
    fireEvent.click(btn);
    expect(spy).toHaveBeenCalledWith("a-outlook-1");
  });

  it("health badge 属于 main surface 内容（span），不是独立 clickable control", () => {
    renderCard();
    const badge = screen.getByText("时间可能不足");
    expect(badge.tagName).toBe("SPAN");
    expect(badge.closest("button")!.getAttribute("aria-label")).toBe("打开任务《实证报告》");
  });

  it("无 nested interactive：estimate button 不是 main surface 后代", () => {
    renderCard();
    const main = screen.getByLabelText("打开任务《论文初稿》");
    const estimate = screen.getByRole("button", { name: /估算任务/ });
    expect(main.contains(estimate)).toBe(false);
    expect(estimate.closest('[data-testid="study-outlook-card"]')).toBeTruthy();
  });
});

// ============================================================
// Estimate exact Kiro context
// ============================================================
describe("Estimate action → handoffAssignmentPrompt(exact id)", () => {
  it("missing_estimate 任务显示「估算任务」；点击调用 handoffAssignmentPrompt(exactId, ESTIMATE_PROMPT)", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /估算任务/ }));
    expect(kiroActionMocks.handoffAssignmentPrompt).toHaveBeenCalledTimes(1);
    const [id, prompt] = kiroActionMocks.handoffAssignmentPrompt.mock.calls[0];
    expect(id).toBe("a-outlook-2");
    expect(prompt).toContain("估算预计耗时");
    // 不再走 generic handoff
    expect(kiroActionMocks.handoffPrompt).not.toHaveBeenCalled();
  });

  it("estimate click 不触发 onOpenAssignment；main click 不触发 handoffAssignmentPrompt", () => {
    const spy = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /估算任务/ }));
    expect(spy).not.toHaveBeenCalled();

    // 分离两段 action 的 mock 计数后再验证反向隔离
    kiroActionMocks.handoffAssignmentPrompt.mockClear();
    fireEvent.click(screen.getByLabelText("打开任务《实证报告》"));
    expect(kiroActionMocks.handoffAssignmentPrompt).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith("a-outlook-1");
  });

  it("非 missing_estimate 任务不显示「估算任务」", () => {
    renderCard();
    // 仅 TASK_B（missing_estimate）提供该 secondary control
    expect(screen.getAllByRole("button", { name: /估算任务/ })).toHaveLength(1);
    expect(screen.getByLabelText("打开任务《实证报告》").textContent).not.toContain("估算任务");
  });
});

// ============================================================
// Bottom generic outlook-level Kiro actions 保持不变
// ============================================================
describe("Generic outlook Kiro actions regression", () => {
  it("「让 Kiro 帮我规划」仍为 generic handoffPrompt（outlook 级 context）", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /让 Kiro 帮我规划/ }));
    expect(kiroActionMocks.handoffPrompt).toHaveBeenCalledTimes(1);
    expect(kiroActionMocks.handoffPrompt.mock.calls[0][0]).toContain("学习前瞻");
    expect(kiroActionMocks.handoffAssignmentPrompt).not.toHaveBeenCalled();
  });

  it("存在容量缺口时「优化已有计划」出现且仍为 generic prompt", () => {
    const shortfall = mkOutlook([
      mkTask({
        assignmentId: "a-sf",
        title: "缺口任务",
        health: "at-risk",
        capacityComplete: false,
        combinedCapacityShortfallMinutes: 60,
        unscheduledMinutes: 90,
      }),
    ]) as unknown as StudyOutlook & {
      firstCapacityShortfall: unknown;
    };
    shortfall.firstCapacityShortfall = {
      deadline: "2026-09-01T23:59:00",
      shortfallMinutes: 60,
      affectedAssignmentIds: ["a-sf"],
    };
    shortfall.summary.workload.preferredShortfallMinutes = 60;
    render(
      <StudyOutlookCard
        outlook={shortfall}
        horizonDays={7}
        onHorizonChange={() => {}}
        onOpenAssignment={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /优化已有计划/ }));
    expect(kiroActionMocks.handoffPrompt).toHaveBeenCalledTimes(1);
    expect(kiroActionMocks.handoffPrompt.mock.calls[0][0]).toContain("重排建议");
  });
});

// ============================================================
// Analytics → Drawer integration（open callback contract）
// ============================================================
describe("handleOpenOutlookAssignment（View navigation ownership）", () => {
  it("有效 Assignment → 只写 selectedAssignmentId；activeTab 保持 analytics", () => {
    expect(handleOpenOutlookAssignment("a-outlook-1")).toBe(true);
    const s = useAppStore.getState();
    expect(s.selectedAssignmentId).toBe("a-outlook-1");
    expect(s.activeTab).toBe("analytics");
    // 关闭 Drawer（模拟）后仍在 Analytics：selection 清理不影响 tab
    useAppStore.setState({ selectedAssignmentId: null });
    expect(useAppStore.getState().activeTab).toBe("analytics");
  });

  it("stale snapshot：点击前 Assignment 已删除 → no-op，不写 stale selection", () => {
    useAppStore.setState({ assignments: [] }); // fresh Store 已删除
    const prevSelection = null;
    expect(handleOpenOutlookAssignment("a-outlook-1")).toBe(false);
    expect(useAppStore.getState().selectedAssignmentId).toBe(prevSelection);
  });

  it("已有其它 selection 时 stale 点击不覆盖", () => {
    useAppStore.setState({
      assignments: [{ id: "a-other", title: "别的任务" } as unknown as Assignment],
      selectedAssignmentId: "a-other",
    });
    expect(handleOpenOutlookAssignment("a-outlook-1")).toBe(false);
    expect(useAppStore.getState().selectedAssignmentId).toBe("a-other");
  });
});

// ============================================================
// Static contract：View 与 Card 的 wiring（horizon continuity 由 local state 保证）
// ============================================================
describe("View wiring static contract", () => {
  it("LearningAnalyticsView 将 handleOpenOutlookAssignment 传入卡片；action 模块不切 Workspace", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const viewSrc = fs.readFileSync(
      path.join(process.cwd(), "components/analytics/LearningAnalyticsView.tsx"),
      "utf8"
    );
    expect(viewSrc).toContain("onOpenAssignment={handleOpenOutlookAssignment}");
    const actionSrc = fs.readFileSync(
      path.join(process.cwd(), "lib/analytics/outlookAssignmentAction.ts"),
      "utf8"
    );
    expect(actionSrc).not.toMatch(/setActiveTab\(/);
    // horizon 是 View local state，打开 Drawer 不触碰
    expect(viewSrc).toContain("useState<StudyOutlookHorizon>(7)");
  });
});
