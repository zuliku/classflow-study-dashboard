/**
 * Visual Action Intake V1.3：历史只读 Proposal 快照 —— sanitize 安全投影 / JSON 持久化 / 消息保留。
 */
import { describe, it, expect } from "vitest";
import { sanitizeConversation, toPersistedVisualProposal } from "@/lib/ai/history/sanitize";
import { VisualActionProposal } from "@/lib/ai/visual/types";
import { KiroChatMessageView } from "@/hooks/useKiroChat";

function makeLiveProposal(over: Partial<VisualActionProposal> = {}): VisualActionProposal {
  return {
    id: "proposal-live-1",
    sourceAttachmentIds: ["img-secret-id", "img-2"],
    summary: "从截图整理出 2 项",
    actions: [
      {
        id: "pa-1",
        change: {
          tool: "create_assignment",
          input: { courseId: "course-1", title: "作业" },
        } as never,
        evidence: { text: "图中显示 8 月 20 日截止" },
        display: { kind: "assignment-create", title: "新建任务：作业", subtitle: "截止 8/20" },
      },
    ],
    pendingItems: [
      {
        id: "pp-1",
        reason: "ambiguous-entity",
        evidence: { text: "无法唯一确定对应课程" },
        description: "图中课程名称与现有课程不完全匹配",
      },
    ],
    previewFingerprint: "fp-secret",
    reservedIds: ["assignment-secret-id"],
    createdAt: 1234567890,
    ...over,
  };
}

const EXECUTABLE_KEYS = ["change", "tool", "input", "courseId", "reservedIds", "previewFingerprint", "sourceAttachmentIds", "sourceProposalId", "pendingItemIds"];

function assertNoExecutableKeys(obj: unknown, path = "root"): void {
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => assertNoExecutableKeys(v, `${path}[${i}]`));
    return;
  }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      expect(EXECUTABLE_KEYS.includes(k), `${path}.${k} 不得出现在历史快照中`).toBe(false);
      assertNoExecutableKeys(v, `${path}.${k}`);
    }
  }
}

describe("toPersistedVisualProposal（安全投影）", () => {
  it("只保留 display 事实；executable keys 全部不存在", () => {
    const snapshot = toPersistedVisualProposal(makeLiveProposal());
    expect(snapshot.id).toBe("proposal-live-1");
    expect(snapshot.summary).toBe("从截图整理出 2 项");
    expect(snapshot.imageCount).toBe(2);
    expect(snapshot.origin).toBe("screenshot");
    expect(snapshot.actions[0]).toEqual({
      kind: "assignment-create",
      title: "新建任务：作业",
      subtitle: "截止 8/20",
      evidence: "图中显示 8 月 20 日截止",
    });
    expect(snapshot.pendingItems[0]).toEqual({
      reason: "ambiguous-entity",
      evidence: "无法唯一确定对应课程",
      description: "图中课程名称与现有课程不完全匹配",
    });
    expect(snapshot.createdAt).toBe(1234567890);
  });

  it("JSON 持久化安全：序列化后逐属性检查无 executable keys（不用敏感字符串全文匹配）", () => {
    const snapshot = toPersistedVisualProposal(makeLiveProposal());
    const record = { id: "m1", visualProposals: [snapshot] };
    const serialized = JSON.stringify(record);
    const parsed = JSON.parse(serialized) as { visualProposals: unknown[] };
    assertNoExecutableKeys(parsed);
    expect(parsed.visualProposals).toHaveLength(1);
  });

  it("独立 hard bounds：超长字段 clamp；actions >8 / pending >8 截断", () => {
    const proposal = makeLiveProposal({
      summary: "s".repeat(200),
      actions: Array.from({ length: 10 }, (_, i) => ({
        id: `pa-${i}`,
        change: {} as never,
        evidence: { text: "e".repeat(300) },
        display: { kind: "assignment-update" as const, title: "t".repeat(300), subtitle: "u".repeat(300) },
      })),
      pendingItems: Array.from({ length: 10 }, (_, i) => ({
        id: `pp-${i}`,
        reason: "missing-information" as const,
        evidence: { text: "e".repeat(300) },
        description: "d".repeat(300),
      })),
    });
    const snapshot = toPersistedVisualProposal(proposal);
    expect(snapshot.summary.length).toBeLessThanOrEqual(80);
    expect(snapshot.actions).toHaveLength(8);
    expect(snapshot.pendingItems).toHaveLength(8);
    for (const a of snapshot.actions) {
      expect(a.title.length).toBeLessThanOrEqual(160);
      expect(a.subtitle?.length ?? 0).toBeLessThanOrEqual(200);
      expect(a.evidence.length).toBeLessThanOrEqual(160);
    }
    for (const p of snapshot.pendingItems) {
      expect(p.evidence.length).toBeLessThanOrEqual(160);
      expect(p.description.length).toBeLessThanOrEqual(160);
    }
  });

  it("clarification lineage 只降级为 display fact：origin=clarification，无 sourceProposalId/pendingItemIds", () => {
    const snapshot = toPersistedVisualProposal(
      makeLiveProposal({
        continuationSource: { sourceProposalId: "proposal-0", pendingItemIds: ["pp-1"] },
      })
    );
    expect(snapshot.origin).toBe("clarification");
    expect("sourceProposalId" in snapshot).toBe(false);
    expect("pendingItemIds" in snapshot).toBe(false);
    assertNoExecutableKeys(snapshot);
  });

  it("sourceAttachmentIds 只转 imageCount（不保存 ID）", () => {
    const snapshot = toPersistedVisualProposal(makeLiveProposal());
    expect(snapshot.imageCount).toBe(2);
    expect("sourceAttachmentIds" in snapshot).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain("img-secret-id");
  });
});

describe("sanitizeConversation（V1.3 消息保留 + 快照落库）", () => {
  const base = {
    id: "conv-1",
    title: "T",
    createdAt: "2026-08-01T10:00:00.000Z",
    provider: "opencode-go",
    model: "kimi-k3",
    manualRefs: [],
    entryRefs: [],
  };

  it("纯 Proposal assistant 消息（content 空 / 无 actions / 无 task）→ 必须保留", () => {
    const m: KiroChatMessageView = {
      id: "m-proposal-only",
      role: "assistant",
      content: "",
      streaming: false,
      canRegenerate: false,
      visualActionProposals: [makeLiveProposal()],
    };
    const rec = sanitizeConversation({ ...base, messages: [m] });
    expect(rec.messages).toHaveLength(1);
    expect(rec.messages[0].id).toBe("m-proposal-only");
    expect(rec.messages[0].visualProposals).toHaveLength(1);
  });

  it("live Proposal → 快照写入 visualProposals；JSON 无 executable keys", () => {
    const m: KiroChatMessageView = {
      id: "m1",
      role: "assistant",
      content: "已整理出以下修改",
      streaming: false,
      canRegenerate: false,
      visualActionProposals: [makeLiveProposal()],
    };
    const rec = sanitizeConversation({ ...base, messages: [m] });
    expect(rec.messages[0].visualProposals).toHaveLength(1);
    assertNoExecutableKeys(JSON.parse(JSON.stringify(rec)));
  });

  it("历史快照透传（restored view → 再持久化不丢失）", () => {
    const snapshot = toPersistedVisualProposal(makeLiveProposal());
    const m: KiroChatMessageView = {
      id: "m2",
      role: "assistant",
      content: "",
      streaming: false,
      canRegenerate: false,
      historyVisualActionProposals: [snapshot],
    };
    const rec = sanitizeConversation({ ...base, messages: [m] });
    expect(rec.messages).toHaveLength(1);
    expect(rec.messages[0].visualProposals?.[0].id).toBe(snapshot.id);
    expect(rec.messages[0].visualProposals?.[0].origin).toBe("screenshot");
  });

  it("无 Proposal 的消息不写 visualProposals 字段", () => {
    const m: KiroChatMessageView = {
      id: "m3",
      role: "assistant",
      content: "普通回复",
      streaming: false,
      canRegenerate: false,
    };
    const rec = sanitizeConversation({ ...base, messages: [m] });
    expect(rec.messages[0].visualProposals).toBeUndefined();
  });

  it("V1.4 applied receipt → 投影 status/count/appliedAt；无 undo/executable keys", () => {
    const m: KiroChatMessageView = {
      id: "m4",
      role: "assistant",
      content: "已整理",
      streaming: false,
      canRegenerate: false,
      visualActionProposals: [makeLiveProposal()],
    };
    const receipts = new Map([["proposal-live-1", { status: "applied" as const, count: 2, appliedAt: 123 }]]);
    const rec = sanitizeConversation({ ...base, messages: [m], visualProposalReceipts: receipts });
    const snapshot = rec.messages[0].visualProposals?.[0];
    expect(snapshot?.receipt).toEqual({ status: "applied", count: 2, appliedAt: 123 });
    assertNoExecutableKeys(JSON.parse(JSON.stringify(rec)));
    expect(JSON.stringify(snapshot?.receipt)).not.toContain("undo");
  });

  it("V1.4 revoked receipt → revokedAt 保留；无 receipt 时不写字段", () => {
    const m: KiroChatMessageView = {
      id: "m5",
      role: "assistant",
      content: "已整理",
      streaming: false,
      canRegenerate: false,
      visualActionProposals: [makeLiveProposal()],
    };
    const receipts = new Map([["proposal-live-1", { status: "revoked" as const, count: 2, appliedAt: 100, revokedAt: 200 }]]);
    const rec = sanitizeConversation({ ...base, messages: [m], visualProposalReceipts: receipts });
    expect(rec.messages[0].visualProposals?.[0].receipt).toEqual({ status: "revoked", count: 2, appliedAt: 100, revokedAt: 200 });
    // 无 receipt（idle/stale 未记录）→ 不写 receipt 字段
    const rec2 = sanitizeConversation({ ...base, messages: [m] });
    expect(rec2.messages[0].visualProposals?.[0].receipt).toBeUndefined();
  });

  it("V1.4 非法 receipt（undo closure 混入 / 错误 status）→ History boundary 丢弃", () => {
    const m: KiroChatMessageView = {
      id: "m6",
      role: "assistant",
      content: "已整理",
      streaming: false,
      canRegenerate: false,
      visualActionProposals: [makeLiveProposal()],
    };
    const receipts = new Map([["proposal-live-1", { status: "stale", count: 2, appliedAt: 123, undo: () => {} }]]);
    const rec = sanitizeConversation({ ...base, messages: [m], visualProposalReceipts: receipts });
    expect(rec.messages[0].visualProposals?.[0].receipt).toBeUndefined();
    const rec2 = sanitizeConversation({ ...base, messages: [m], visualProposalReceipts: new Map([["proposal-live-1", { status: "applied" as const, count: 2, appliedAt: 123, undo: () => {} }]]) });
    const projected = rec2.messages[0].visualProposals?.[0].receipt;
    expect(projected).toEqual({ status: "applied", count: 2, appliedAt: 123 });
    expect("undo" in projected!).toBe(false);
  });
});
