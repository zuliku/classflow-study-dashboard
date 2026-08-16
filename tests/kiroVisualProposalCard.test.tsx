// @vitest-environment jsdom
/**
 * Visual Action Intake V1.4：Live Card 由 Conversation Runtime 驱动。
 * - remount 后 applied 保持（visual-apply 消失、undo 仍可用）
 * - Card Undo + Toast Undo 同源 one-shot
 * - stale remount 保持
 * 使用 mock 的 useKiroSession（runtime 用真实 createVisualProposalRuntime）+ mock executor。
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { VisualActionProposalCard } from "@/components/kiro/VisualActionProposalCard";
import { createVisualProposalRuntime } from "@/lib/ai/visual/receipt";
import { VisualActionProposal } from "@/lib/ai/visual/types";

const mocks = vi.hoisted(() => {
  let version = 0;
  return {
    runtime: null as ReturnType<typeof createVisualProposalRuntime> | null,
    getVersion: () => version,
    bump: () => {
      version++;
    },
    resetVersion: () => {
      version = 0;
    },
    executor: { executeVisualActionProposal: vi.fn() },
    toast: { pushToast: vi.fn() },
  };
});

vi.mock("@/components/kiro/KiroSessionProvider", () => ({
  useKiroSession: () => ({
    handoffPrompt: vi.fn(),
    handoffVisualPendingContinuation: vi.fn(),
    visualProposalRuntime: mocks.runtime!,
    visualProposalVersion: mocks.getVersion(),
  }),
}));

vi.mock("@/store/useToastStore", () => ({
  useToastStore: (sel: (s: { pushToast: unknown }) => unknown) => sel({ pushToast: mocks.toast.pushToast }),
}));

vi.mock("@/lib/ai/visual/executor", () => ({
  executeVisualActionProposal: (args: { proposal: VisualActionProposal }) =>
    mocks.executor.executeVisualActionProposal(args),
}));

vi.mock("@/lib/ai/visual/continuation", () => ({
  buildVisualPendingContinuation: () => undefined,
}));

function makeProposal(): VisualActionProposal {
  return {
    id: "p-live-1",
    sourceAttachmentIds: ["img-1"],
    summary: "从截图整理出 2 项",
    actions: [
      {
        id: "pa-1",
        change: { tool: "create_assignment", input: { title: "作业" } } as never,
        evidence: { text: "图中显示 8 月 20 日截止" },
        display: { kind: "assignment-create", title: "新建任务：作业" },
      },
      {
        id: "pa-2",
        change: { tool: "set_assignment_ddl", input: { title: "作业" } } as never,
        evidence: { text: "图中显示 14:00" },
        display: { kind: "ddl-update", title: "调整截止时间" },
      },
    ],
    pendingItems: [],
    createdAt: 123,
    reservedIds: [],
  };
}

function renderCard() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = () => {
    act(() => {
      root.render(<VisualActionProposalCard proposal={makeProposal()} />);
    });
  };
  render();
  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { container, text: () => container.textContent ?? "", render, cleanup };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtime = createVisualProposalRuntime();
  mocks.resetVersion();
});

describe("VisualActionProposalCard（V1.4 Runtime-owned）", () => {
  it("idle：Apply 存在；Apply 成功后 → applied；remount 后仍 applied 且无 visual-apply、Undo 可用", async () => {
    const undoMock = vi.fn();
    mocks.executor.executeVisualActionProposal.mockResolvedValue({ ok: true, count: 2, undo: undoMock });
    const card = renderCard();
    expect(card.container.querySelector('[data-testid="visual-apply"]')).toBeTruthy();

    // Apply → runtime recordApplied（bump version；测试中手动 re-render 模拟 provider rerender）
    await act(async () => {
      (card.container.querySelector('[data-testid="visual-apply"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    mocks.bump();
    card.render();
    expect(card.text()).toContain("已应用 2 项修改");
    expect(card.container.querySelector('[data-testid="visual-apply"]')).toBeNull();
    expect(card.container.querySelector('[data-testid="visual-undo"]')).toBeTruthy();
    expect(mocks.runtime.getState("p-live-1")?.status).toBe("applied");

    // remount：unmount → 重新 render 同一 proposal
    card.cleanup();
    const card2 = renderCard();
    mocks.bump();
    card2.render();
    expect(card2.text()).toContain("已应用 2 项修改");
    expect(card2.container.querySelector('[data-testid="visual-apply"]')).toBeNull();
    expect(card2.container.querySelector('[data-testid="visual-undo"]')).toBeTruthy();

    // Undo（remount 后同一 runtime）：undo 只执行一次
    await act(async () => {
      (card2.container.querySelector('[data-testid="visual-undo"]') as HTMLButtonElement).click();
    });
    mocks.bump();
    card2.render();
    expect(card2.text()).toContain("已撤销 2 项修改");
    expect(card2.container.querySelector('[data-testid="visual-undo"]')).toBeNull();
    expect(undoMock).toHaveBeenCalledTimes(1);
    card2.cleanup();
  });

  it("Toast Undo 与 Card Undo 同源：Toast 先触发 → revoked，Card 按钮消失（one-shot）", async () => {
    const undoMock = vi.fn();
    mocks.executor.executeVisualActionProposal.mockResolvedValue({ ok: true, count: 1, undo: undoMock });
    const card = renderCard();
    await act(async () => {
      (card.container.querySelector('[data-testid="visual-apply"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    mocks.bump();
    card.render();
    // Toast onAction（recordApplied 时注册）→ consumeUndo（同源）
    const toastOnAction = mocks.toast.pushToast.mock.calls.find((c) => c[0]?.actionLabel === "撤销")?.[0]?.onAction as () => void;
    expect(typeof toastOnAction).toBe("function");
    act(() => {
      toastOnAction();
    });
    mocks.bump();
    card.render();
    // 已 revoked：Card Undo 按钮消失（不可能二次触发）；undo 只执行一次
    expect(undoMock).toHaveBeenCalledTimes(1);
    expect(mocks.runtime.getState("p-live-1")?.status).toBe("revoked");
    expect(card.container.querySelector('[data-testid="visual-undo"]')).toBeNull();
    expect(card.container.querySelector('[data-testid="visual-apply"]')).toBeNull();
    card.cleanup();
  });

  it("stale → Runtime 拥有：remount 后仍显示「方案已过期」，无 Apply", async () => {
    mocks.executor.executeVisualActionProposal.mockResolvedValue({ ok: false, stale: true, message: "" });
    const card = renderCard();
    await act(async () => {
      (card.container.querySelector('[data-testid="visual-apply"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    mocks.bump();
    card.render();
    expect(card.text()).toContain("方案已过期");
    expect(card.container.querySelector('[data-testid="visual-apply"]')).toBeNull();
    expect(card.container.querySelector('[data-testid="visual-reanalyze"]')).toBeTruthy();
    // remount
    card.cleanup();
    const card2 = renderCard();
    mocks.bump();
    card2.render();
    expect(card2.text()).toContain("方案已过期");
    expect(card2.container.querySelector('[data-testid="visual-apply"]')).toBeNull();
    card2.cleanup();
  });
});
