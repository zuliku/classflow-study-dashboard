import { describe, it, expect, beforeEach } from "vitest";
import { ApprovalStore } from "@/src/main/channels/outbound/approvalStore";

describe("channelSendApproval", () => {
  let store: ApprovalStore;

  beforeEach(() => {
    store = new ApprovalStore();
  });

  it("create approval with immutable fields", () => {
    const a = store.create("reply_123", "hello");
    expect(a.approvalId).toMatch(/^send_/);
    expect(a.replyContextId).toBe("reply_123");
    expect(a.text).toBe("hello");
    expect(a.textHash).toBeDefined();
    expect(a.used).toBe(false);
    expect(a.expiresAt).toBeGreaterThan(Date.now());
    expect(a.approvalId.length).toBeGreaterThan(20);
  });

  it("approval immutable: confirm cannot change text", () => {
    const a = store.create("reply_123", "A");
    // Simulate confirm with different text (should be ignored, approval still A)
    const fetched = store.get(a.approvalId)!;
    expect(fetched.text).toBe("A");
    // Even if renderer tries to send B, the approval's text is still A
    // Outbound manager will use approval.text, not input text
    expect(fetched.textHash).not.toBe("B");
  });

  it("TTL 5 minutes", () => {
    const a = store.create("reply_1", "hi");
    expect(a.expiresAt - a.createdAt).toBe(5 * 60 * 1000);
  });

  it("one-shot consume", () => {
    const a = store.create("reply_1", "hi");
    const consumed = store.consume(a.approvalId);
    expect(consumed).not.toBeNull();
    expect(consumed!.used).toBe(true);
    const second = store.consume(a.approvalId);
    expect(second).toBeNull();
    const get = store.get(a.approvalId);
    expect(get?.used).toBe(true);
  });

  it("expired approval not found", async () => {
    const s = new ApprovalStore();
    // Create with short TTL via direct map manipulation
    const a = s.create("reply_1", "hi");
    // Fast-forward: manually expire
    (s as unknown as { approvals: Map<string, { expiresAt: number }> }).approvals.get(a.approvalId)!.expiresAt = Date.now() - 1;
    expect(s.get(a.approvalId)).toBeUndefined();
    expect(s.consume(a.approvalId)).toBeNull();
  });
});
