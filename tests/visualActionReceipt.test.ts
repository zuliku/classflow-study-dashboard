/**
 * Visual Action Intake V1.4：Durable Execution Receipt Runtime（纯逻辑）。
 * - recordApplied / one-shot Undo / stale 不落 snapshot / clear 隔离 / Proposal B 独立
 * - buildConversationPersistenceSignature（save invalidation）
 * - sanitizeVisualProposalReceipt（History boundary 独立 bound）
 */
import { describe, it, expect } from "vitest";
import {
  createVisualProposalRuntime,
  buildConversationPersistenceSignature,
  sanitizeVisualProposalReceipt,
} from "@/lib/ai/visual/receipt";

describe("createVisualProposalRuntime", () => {
  it("recordApplied → 状态 applied + 同步 snapshot 立即可见（无需 rerender）", () => {
    const rt = createVisualProposalRuntime();
    rt.recordApplied({ proposalId: "p1", count: 2, undo: () => {} });
    expect(rt.getState("p1")?.status).toBe("applied");
    expect(rt.getState("p1")?.count).toBe(2);
    expect(typeof rt.getState("p1")?.appliedAt).toBe("number");
    // pagehide / persist 同步读取：紧接调用即可见
    const snapshot = rt.receiptSnapshot();
    expect(snapshot.get("p1")).toEqual({
      status: "applied",
      count: 2,
      appliedAt: rt.getState("p1")?.appliedAt,
    });
  });

  it("one-shot Undo：Card + Toast 双入口 → undo 只执行一次", () => {
    const rt = createVisualProposalRuntime();
    let calls = 0;
    rt.recordApplied({ proposalId: "p1", count: 1, undo: () => { calls++; } });
    expect(rt.consumeUndo("p1").ok).toBe(true);
    expect(rt.consumeUndo("p1").ok).toBe(false); // 第二次 0-op
    expect(calls).toBe(1);
    expect(rt.getState("p1")?.status).toBe("revoked");
    expect(typeof rt.getState("p1")?.revokedAt).toBe("number");
    // revoked 也在 snapshot（display receipt）；undo 不在
    const snapshot = rt.receiptSnapshot();
    expect(snapshot.get("p1")?.status).toBe("revoked");
    expect("undo" in snapshot.get("p1")!).toBe(false);
  });

  it("undo throw → 保持 applied（绝不误报 revoked），undo 已消费（防重复补偿）", () => {
    const rt = createVisualProposalRuntime();
    let calls = 0;
    rt.recordApplied({ proposalId: "p1", count: 1, undo: () => { calls++; throw new Error("boom"); } });
    const outcome = rt.consumeUndo("p1");
    expect(outcome.ok).toBe(false);
    expect(rt.getState("p1")?.status).toBe("applied");
    expect(rt.consumeUndo("p1").ok).toBe(false);
    expect(calls).toBe(1);
  });

  it("stale 只存在于 runtime：getState 可见，receiptSnapshot 不含", () => {
    const rt = createVisualProposalRuntime();
    rt.markStale("p1");
    expect(rt.getState("p1")?.status).toBe("stale");
    expect(rt.receiptSnapshot().has("p1")).toBe(false);
  });

  it("Conversation isolation：clear() 清空 receipt 能力与 undo closure", () => {
    const rt = createVisualProposalRuntime();
    let calls = 0;
    rt.recordApplied({ proposalId: "pA", count: 1, undo: () => { calls++; } });
    rt.clear();
    expect(rt.getState("pA")).toBeUndefined();
    expect(rt.receiptSnapshot().size).toBe(0);
    expect(rt.consumeUndo("pA").ok).toBe(false);
    expect(calls).toBe(0);
  });

  it("Proposal B 独立 receipt：key = 当前 proposal.id（A applied 不影响 B；不按 sourceProposalId 记录）", () => {
    const rt = createVisualProposalRuntime();
    rt.recordApplied({ proposalId: "pB", count: 1, undo: () => {} });
    expect(rt.getState("pA")).toBeUndefined();
    expect(rt.getState("pB")?.status).toBe("applied");
    rt.markStale("pA");
    expect(rt.getState("pB")?.status).toBe("applied");
  });

  it("remount 语义：状态属于 Runtime（重复读取一致；undo 仍可用直到消费）", () => {
    const rt = createVisualProposalRuntime();
    let calls = 0;
    rt.recordApplied({ proposalId: "p1", count: 3, undo: () => { calls++; } });
    // 模拟 remount 后的第二次渲染读取
    expect(rt.getState("p1")?.status).toBe("applied");
    expect(rt.getState("p1")?.count).toBe(3);
    expect(rt.consumeUndo("p1").ok).toBe(true);
    expect(calls).toBe(1);
    expect(rt.getState("p1")?.status).toBe("revoked");
  });
});

describe("buildConversationPersistenceSignature", () => {
  it("message 字段不变但 visualProposalVersion 变化 → 签名不同（必须重新落盘）", () => {
    const base = {
      id: "conv-1",
      messageCount: 10,
      lastContentLength: 120,
      status: "ready",
      computerVersion: 0,
    };
    const v1 = buildConversationPersistenceSignature({ ...base, visualProposalVersion: 1 });
    const v2 = buildConversationPersistenceSignature({ ...base, visualProposalVersion: 2 });
    expect(v1).not.toBe(v2);
    expect(v2).toContain("|2");
  });

  it("完全一致 → 相同签名", () => {
    const a = buildConversationPersistenceSignature({ id: "c", messageCount: 1, lastContentLength: 5, status: "ready", computerVersion: 0, visualProposalVersion: 3 });
    const b = buildConversationPersistenceSignature({ id: "c", messageCount: 1, lastContentLength: 5, status: "ready", computerVersion: 0, visualProposalVersion: 3 });
    expect(a).toBe(b);
  });
});

describe("sanitizeVisualProposalReceipt（History boundary）", () => {
  it("合法 applied → 投影；revoked 需要 revokedAt >= appliedAt", () => {
    expect(sanitizeVisualProposalReceipt({ status: "applied", count: 2, appliedAt: 100 })).toEqual({ status: "applied", count: 2, appliedAt: 100 });
    expect(sanitizeVisualProposalReceipt({ status: "revoked", count: 2, appliedAt: 100, revokedAt: 200 })).toEqual({ status: "revoked", count: 2, appliedAt: 100, revokedAt: 200 });
  });

  it("非法输入 → undefined（stale / idle / applying / 缺字段 / 时间倒挂 / 非整数）", () => {
    expect(sanitizeVisualProposalReceipt({ status: "stale", count: 1, appliedAt: 1 })).toBeUndefined();
    expect(sanitizeVisualProposalReceipt({ status: "idle" })).toBeUndefined();
    expect(sanitizeVisualProposalReceipt({ status: "applied" })).toBeUndefined();
    expect(sanitizeVisualProposalReceipt({ status: "revoked", count: 1, appliedAt: 200, revokedAt: 100 })).toBeUndefined();
    expect(sanitizeVisualProposalReceipt({ status: "applied", count: 1.5, appliedAt: 1 })).toBeUndefined();
    expect(sanitizeVisualProposalReceipt(null)).toBeUndefined();
    expect(sanitizeVisualProposalReceipt("x")).toBeUndefined();
  });

  it("receipt 投影后不存在任何 executable keys / undo", () => {
    const r = sanitizeVisualProposalReceipt({ status: "applied", count: 2, appliedAt: 100, undo: () => {}, change: { tool: "x" }, reservedIds: ["r"] });
    expect(r).toEqual({ status: "applied", count: 2, appliedAt: 100 });
    expect("undo" in r!).toBe(false);
    expect("change" in r!).toBe(false);
    expect("reservedIds" in r!).toBe(false);
  });
});

describe("V1.5：Selective Apply Receipt（appliedActionIndexes）", () => {
  it("recordApplied 带 indexes → runtime 持有 + snapshot 投影（纯展示整数；无 undo）", () => {
    const rt = createVisualProposalRuntime();
    rt.recordApplied({ proposalId: "p1", count: 2, appliedActionIndexes: [0, 2], undo: () => {} });
    expect(rt.getState("p1")?.appliedActionIndexes).toEqual([0, 2]);
    const snapshot = rt.receiptSnapshot();
    expect(snapshot.get("p1")?.appliedActionIndexes).toEqual([0, 2]);
    // snapshot 里绝对没有 undo / change / tool 信息
    const json = JSON.stringify(snapshot.get("p1"));
    expect(json).not.toContain("undo");
    expect(json).not.toContain("change");
    expect(json).not.toContain("tool");
    expect(json).not.toContain("reserved");
    expect(json).not.toContain("fingerprint");
    expect(json).not.toContain("sourceAttachment");
  });

  it("旧调用（无 indexes）→ appliedActionIndexes undefined（= 当时全部应用）", () => {
    const rt = createVisualProposalRuntime();
    rt.recordApplied({ proposalId: "p1", count: 3, undo: () => {} });
    expect(rt.getState("p1")?.appliedActionIndexes).toBeUndefined();
    expect(rt.receiptSnapshot().get("p1")?.appliedActionIndexes).toBeUndefined();
  });

  it("Undo 后 indexes 保留（描述「当时应用了哪些」；revoked 不丢失投影）", () => {
    const rt = createVisualProposalRuntime();
    rt.recordApplied({ proposalId: "p1", count: 2, appliedActionIndexes: [0, 1], undo: () => {} });
    expect(rt.consumeUndo("p1").ok).toBe(true);
    const snapshot = rt.receiptSnapshot();
    expect(snapshot.get("p1")?.status).toBe("revoked");
    expect(snapshot.get("p1")?.appliedActionIndexes).toEqual([0, 1]);
  });

  it("sanitize：合法 indexes 投影（range checked against actionCount）", () => {
    expect(
      sanitizeVisualProposalReceipt({ status: "applied", count: 2, appliedAt: 100, appliedActionIndexes: [0, 3] }, 4)
    ).toEqual({ status: "applied", count: 2, appliedAt: 100, appliedActionIndexes: [0, 3] });
  });

  it("sanitize：非整数 / 负数 / 越界 / 重复 / count 不一致 / 非数组 → 整体拒绝", () => {
    const base = { status: "applied", count: 2, appliedAt: 100 } as const;
    expect(sanitizeVisualProposalReceipt({ ...base, appliedActionIndexes: [0, 1.5] }, 4)).toBeUndefined();
    expect(sanitizeVisualProposalReceipt({ ...base, appliedActionIndexes: [-1, 0] }, 4)).toBeUndefined();
    expect(sanitizeVisualProposalReceipt({ ...base, appliedActionIndexes: [0, 9] }, 4)).toBeUndefined(); // 越界
    expect(sanitizeVisualProposalReceipt({ ...base, appliedActionIndexes: [0, 0] }, 4)).toBeUndefined(); // 重复
    expect(sanitizeVisualProposalReceipt({ ...base, appliedActionIndexes: [0] }, 4)).toBeUndefined(); // 与 count 不一致
    expect(sanitizeVisualProposalReceipt({ ...base, appliedActionIndexes: "x" }, 4)).toBeUndefined();
    expect(sanitizeVisualProposalReceipt({ ...base, appliedActionIndexes: ["0"] }, 4)).toBeUndefined();
    // 空数组 = 非法（count>0 却什么都没应用）
    expect(sanitizeVisualProposalReceipt({ ...base, appliedActionIndexes: [] }, 4)).toBeUndefined();
  });

  it("sanitize：无 actionCount 参照时仍 bound（0..9999 防御）", () => {
    expect(
      sanitizeVisualProposalReceipt({ status: "applied", count: 1, appliedAt: 1, appliedActionIndexes: [5000] })
    ).toEqual({ status: "applied", count: 1, appliedAt: 1, appliedActionIndexes: [5000] });
    expect(
      sanitizeVisualProposalReceipt({ status: "applied", count: 1, appliedAt: 1, appliedActionIndexes: [10000] })
    ).toBeUndefined();
  });

  it("sanitize：旧 receipt（无 indexes 字段）行为不变", () => {
    expect(sanitizeVisualProposalReceipt({ status: "applied", count: 2, appliedAt: 100 }, 4)).toEqual({
      status: "applied",
      count: 2,
      appliedAt: 100,
    });
  });
});
