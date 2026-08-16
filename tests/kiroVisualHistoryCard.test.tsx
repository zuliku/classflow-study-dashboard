// @vitest-environment jsdom
/**
 * Visual Action Intake V1.3：历史只读 Proposal Card —— 0 mutation entry point + 正确展示。
 * 使用 react-dom/client + act（与 kiroProjectPanel.test.tsx 同一模式；无 testing-library 依赖）。
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { VisualActionProposalHistoryCard } from "@/components/kiro/VisualActionProposalHistoryCard";
import { PersistedVisualProposalView } from "@/lib/ai/history/types";

function makeSnapshot(over: Partial<PersistedVisualProposalView> = {}): PersistedVisualProposalView {
  return {
    id: "snap-1",
    summary: "从截图整理出 4 项",
    imageCount: 2,
    origin: "screenshot",
    actions: [
      { kind: "assignment-create", title: "新建任务：作业", subtitle: "截止 8/20", evidence: "图中显示 8 月 20 日截止" },
      { kind: "ddl-update", title: "调整截止时间", evidence: "图中显示 14:00 截止" },
    ],
    pendingItems: [
      { reason: "ambiguous-entity", evidence: "无法唯一确定课程", description: "课程名称匹配多个候选" },
      { reason: "unsupported-action", evidence: "图片中显示导出操作", description: "当前不支持该操作" },
    ],
    createdAt: 1234567890,
    ...over,
  };
}

function renderCard(proposal: PersistedVisualProposalView) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<VisualActionProposalHistoryCard proposal={proposal} />);
  });
  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { container, text: () => container.textContent ?? "", cleanup };
}

describe("VisualActionProposalHistoryCard（display-only）", () => {
  it("不存在任何执行入口：apply / undo / continue / reanalyze / cancel / close", () => {
    const { container, cleanup } = renderCard(makeSnapshot());
    for (const tid of ["visual-apply", "visual-undo", "visual-continue", "visual-reanalyze", "visual-cancel", "visual-close"]) {
      expect(container.querySelector(`[data-testid="${tid}"]`), `不应存在 ${tid}`).toBeNull();
    }
    expect(container.querySelector("[data-testid='visual-action-proposal-history']")).toBeTruthy();
    cleanup();
  });

  it("正确展示 counts / 历史标识 / 只读声明", () => {
    const { text, cleanup } = renderCard(makeSnapshot());
    expect(text()).toContain("历史操作预览");
    expect(text()).toContain("2 项修改");
    expect(text()).toContain("1 项待确认");
    expect(text()).toContain("1 项暂无法处理");
    expect(text()).toContain("2 张图片");
    expect(text()).toContain("当时未执行修改 · 仅供回看");
    expect(text()).toContain("新建任务：作业");
    cleanup();
  });

  it("clarification origin 显示「根据后续确认生成的操作预览」", () => {
    const { text, cleanup } = renderCard(makeSnapshot({ origin: "clarification" }));
    expect(text()).toContain("根据后续确认生成的操作预览");
    cleanup();
  });

  it("Evidence 可展开查看（display fact；不是按钮执行）", () => {
    const { container, text, cleanup } = renderCard(makeSnapshot());
    expect(text()).not.toContain("图中显示 8 月 20 日截止");
    const toggle = Array.from(container.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("依据"));
    expect(toggle).toBeTruthy();
    act(() => toggle!.click());
    expect(text()).toContain("图中显示 8 月 20 日截止");
    cleanup();
  });

  it("imageCount=0 时不显示「0 张图片」", () => {
    const { text, cleanup } = renderCard(makeSnapshot({ imageCount: 0 }));
    expect(text()).not.toContain("0 张图片");
    cleanup();
  });
});

describe("VisualActionProposalHistoryCard V1.5.1（wording / partial receipt）", () => {
  it("无 receipt：显示「识别出的修改」；绝不出现「可应用修改」", () => {
    const { text, cleanup } = renderCard(makeSnapshot());
    expect(text()).toContain("识别出的修改");
    expect(text()).not.toContain("可应用修改");
    expect(text()).toContain("当时未执行修改 · 仅供回看");
    cleanup();
  });

  it("partial applied receipt：section「操作记录」+ 行级 当时已应用/当时未应用 + footer 未应用计数", () => {
    const { container, text, cleanup } = renderCard(
      makeSnapshot({
        receipt: { status: "applied", count: 1, appliedAt: 100, appliedActionIndexes: [0] },
      })
    );
    expect(text()).toContain("操作记录");
    expect(text()).not.toContain("可应用修改");
    expect(text()).toContain("当时已应用 1 项修改");
    expect(text()).toContain("1 项当时未应用");
    const rowStates = Array.from(container.querySelectorAll('[data-testid="visual-history-row-state"]')) as HTMLSpanElement[];
    expect(rowStates).toHaveLength(2);
    expect(rowStates[0].textContent).toContain("当时已应用");
    expect(rowStates[1].textContent).toContain("当时未应用");
    cleanup();
  });

  it("partial revoked receipt：footer「当时已应用后撤销」+ 行级 revoked/never-applied 正确", () => {
    const { text, container, cleanup } = renderCard(
      makeSnapshot({
        receipt: { status: "revoked", count: 1, appliedAt: 100, revokedAt: 200, appliedActionIndexes: [1] },
      })
    );
    expect(text()).toContain("当时已应用后撤销 1 项修改");
    expect(text()).toContain("1 项当时未应用");
    const rowStates = Array.from(container.querySelectorAll('[data-testid="visual-history-row-state"]')) as HTMLSpanElement[];
    expect(rowStates[0].textContent).toContain("当时未应用");
    expect(rowStates[1].textContent).toContain("当时已应用");
    cleanup();
  });

  it("full applied（无 indexes = 当时全部应用）→ 无「未应用」计数", () => {
    const { text, cleanup } = renderCard(
      makeSnapshot({ receipt: { status: "applied", count: 2, appliedAt: 100 } })
    );
    expect(text()).toContain("当时已应用 2 项修改");
    expect(text()).not.toContain("当时未应用");
    cleanup();
  });
});
