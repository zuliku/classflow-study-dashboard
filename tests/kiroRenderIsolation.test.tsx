// @vitest-environment jsdom
/**
 * 流式渲染隔离（每 token 全树 reconcile 回归）：
 * - Row 比较器：allMessages 数组 identity 必变，内容 id 序列不变即判等；
 * - KiroComposer 整棵 memo；Surface 传给 memo 孩子的回调全部稳定（无内联箭头）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { areConversationRowsEqual, type KiroConversationRowProps } from "@/components/kiro/KiroConversation";

const stableCallbacks = {
  onUndo: () => {},
  onRetry: () => {},
  onEditUserMessage: async () => true,
} as const;

const stableView = { id: "m1", role: "user", content: "hi", streaming: false, canRegenerate: false } as never;
const stableMessages = [
  { id: "m1", role: "user", content: "hi" },
  { id: "m2", role: "assistant", content: "hello" },
] as never;

function rowProps(overrides: Partial<KiroConversationRowProps> = {}): KiroConversationRowProps {
  return {
    view: stableView,
    allMessages: [...stableMessages] as never,
    actionsReady: true,
    ...stableCallbacks,
    runLive: false,
    ...overrides,
  };
}

describe("areConversationRowsEqual", () => {
  it("同 view + 同 id 序列（新数组）→ 相等（历史行跳过重渲染）", () => {
    const base = rowProps();
    const next = rowProps({
      allMessages: [
        { id: "m1", role: "user", content: "hi" },
        { id: "m2", role: "assistant", content: "hello" },
      ] as never,
    });
    expect(next.allMessages).not.toBe(base.allMessages);
    expect(areConversationRowsEqual(base, next)).toBe(true);
  });

  it("id 序列变化（新消息/编辑/重排）→ 不等", () => {
    const base = rowProps();
    expect(
      areConversationRowsEqual(
        base,
        rowProps({ allMessages: [...(base.allMessages as never[]), { id: "m3" }] as never })
      )
    ).toBe(false);
    expect(
      areConversationRowsEqual(base, rowProps({ allMessages: [{ id: "mX" }] as never }))
    ).toBe(false);
  });

  it("view / 标量 / 回调变化 → 不等", () => {
    const base = rowProps();
    expect(
      areConversationRowsEqual(base, rowProps({ view: { ...base.view, content: "changed" } as never }))
    ).toBe(false);
    expect(areConversationRowsEqual(base, rowProps({ runLive: true }))).toBe(false);
    expect(areConversationRowsEqual(base, rowProps({ onRetry: () => {} }))).toBe(false);
  });
});

describe("流式 memo 接线契约（源码锁定）", () => {
  const surface = readFileSync(join(process.cwd(), "components/kiro/KiroChatSurface.tsx"), "utf8");
  const composer = readFileSync(join(process.cwd(), "components/kiro/KiroComposer.tsx"), "utf8");
  const conversation = readFileSync(join(process.cwd(), "components/kiro/KiroConversation.tsx"), "utf8");

  it("KiroComposer 整棵 memo", () => {
    expect(composer).toMatch(/export const KiroComposer = React\.memo\(/);
  });

  it("Surface 传给 memo 孩子的回调全部稳定（无内联箭头）", () => {
    for (const prop of [
      "onApprovalDecision={handleApprovalDecision}",
      "onUndoComputerTask={handleUndoComputerTask}",
      "onApprovePlan={handleApprovePlan}",
      "onCancelPlan={handleCancelPlan}",
      "onRegenerateAnswer={handleRegenerateAnswer}",
      "onNewChat={handleNewChat}",
      "onDecision={handleApprovalDecision}",
      "onBulkDecision={handleBulkDecision}",
      "onOpenChange={handleReviewDialogOpenChange}",
      "onOpenSettings={openKiroSettings}",
      "onToggleComputer={handleToggleComputer}",
    ]) {
      expect(surface, prop).toContain(prop);
    }
    expect(surface).not.toMatch(/onApprovePlan=\{\(planId\) =>/);
    expect(surface).not.toMatch(/onRegenerateAnswer=\{\(\) =>/);
    expect(surface).not.toMatch(/onNewChat=\{\(\) =>/);
  });

  it("Row 使用自定义比较器（含 allMessages id 序列语义）", () => {
    expect(conversation).toContain("areConversationRowsEqual");
    expect(conversation).toMatch(/\}, areConversationRowsEqual\);/);
  });
});
