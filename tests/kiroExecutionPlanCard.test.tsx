// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { KiroExecutionPlanCard } from "@/components/kiro/run/KiroExecutionPlanCard";
import type { PersistedExecutionPlan } from "@/lib/ai/computer/plans/types";

const plan = (over: Partial<PersistedExecutionPlan> = {}): PersistedExecutionPlan => ({
  planId: "plan-1",
  conversationId: "conv-1",
  title: "整理工作区",
  goal: "清爽",
  status: "proposed",
  steps: [
    { id: "step-1", title: "建目录", toolName: "create_directory", path: "docs", done: false },
    { id: "step-2", title: "跑测试", toolName: "run_terminal_command", commandPrefix: "npm test", done: false },
  ],
  proposingToolCallId: "call-1",
  proposingMessageId: "m-1",
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
  deviationCount: 0,
  ...over,
});

function renderCard(p: PersistedExecutionPlan, handlers: { onApprove?: (id: string) => void; onCancel?: (id: string) => void } = {}) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(<KiroExecutionPlanCard plan={p} onApprove={handlers.onApprove} onCancel={handlers.onCancel} />);
  });
  return { el, cleanup: () => act(() => root.unmount()) };
}

describe("KiroExecutionPlanCard", () => {
  it("proposed：标题/目标/步骤/scope + 批准/取消按钮可点", () => {
    const onApprove = vi.fn();
    const onCancel = vi.fn();
    const { el, cleanup } = renderCard(plan(), { onApprove, onCancel });
    expect(el.querySelector('[data-testid="kiro-execution-plan"]')?.getAttribute("data-state")).toBe("proposed");
    expect(el.textContent).toContain("整理工作区");
    expect(el.textContent).toContain("create_directory");
    expect(el.textContent).toContain("npm test");
    const approve = el.querySelector('[data-testid="kiro-plan-approve"]') as HTMLButtonElement;
    const cancel = el.querySelector('[data-testid="kiro-plan-cancel"]') as HTMLButtonElement;
    expect(approve).toBeTruthy();
    expect(cancel).toBeTruthy();
    act(() => approve.click());
    expect(onApprove).toHaveBeenCalledWith("plan-1");
    act(() => cancel.click());
    expect(onCancel).toHaveBeenCalledWith("plan-1");
    cleanup();
  });
  it("approved：进度 + 取消计划，无批准按钮", () => {
    const { el, cleanup } = renderCard(plan({ status: "approved", steps: [
      { id: "step-1", title: "建目录", toolName: "create_directory", path: "docs", done: true },
      { id: "step-2", title: "跑测试", toolName: "run_terminal_command", commandPrefix: "npm test", done: false },
    ] }));
    expect(el.querySelector('[data-testid="kiro-plan-approve"]')).toBeNull();
    expect(el.querySelector('[data-testid="kiro-plan-cancel"]')).toBeTruthy();
    expect(el.textContent).toContain("1/2");
    cleanup();
  });
  it("deviated：偏离提示 + 计数；completed：完成态无按钮", () => {
    const { el: dev, cleanup: c1 } = renderCard(plan({ status: "deviated", deviationCount: 2 }));
    expect(dev.textContent).toContain("2 次超计划");
    c1();
    const { el: done, cleanup: c2 } = renderCard(plan({ status: "completed" }));
    expect(done.textContent).toContain("全部完成");
    expect(done.querySelector('[data-testid="kiro-plan-approve"]')).toBeNull();
    expect(done.querySelector('[data-testid="kiro-plan-cancel"]')).toBeNull();
    c2();
  });
  it("cancelled/superseded：纯展示无按钮", () => {
    for (const status of ["cancelled", "superseded"] as const) {
      const { el, cleanup } = renderCard(plan({ status }));
      expect(el.querySelector('[data-testid="kiro-plan-approve"]')).toBeNull();
      expect(el.querySelector('[data-testid="kiro-plan-cancel"]')).toBeNull();
      cleanup();
    }
  });
});
