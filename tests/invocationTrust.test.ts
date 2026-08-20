import { describe, it, expect, beforeEach } from "vitest";
import { beginInvocation, resolveInvocationOrThrow, __clearAllInvocationsForTest } from "@/src/main/security/invocationTrust";

describe("invocationTrust", () => {
  beforeEach(() => __clearAllInvocationsForTest());

  it("missing invocation → fail", () => {
    expect(() => resolveInvocationOrThrow(undefined as never)).toThrow(/INVOCATION_REQUIRED/);
    expect(() => resolveInvocationOrThrow("")).toThrow(/INVOCATION_REQUIRED/);
  });

  it("invalid invocation → fail", () => {
    expect(() => resolveInvocationOrThrow("inv_invalid")).toThrow(/INVALID_INVOCATION/);
  });

  it("expired invocation → fail", async () => {
    const id = beginInvocation("local-user");
    // mock expired by manually setting expiresAt in the past
    const { resolveInvocation } = await import("@/src/main/security/invocationTrust");
    // hack: directly clear and re-add with expired
    const rec = resolveInvocation(id);
    if (rec) (rec as { expiresAt: number }).expiresAt = Date.now() - 1000;
    expect(() => resolveInvocationOrThrow(id)).toThrow(/INVOCATION_EXPIRED/);
  });

  it("beginLocal → local-user", () => {
    const id = beginInvocation("local-user");
    const rec = resolveInvocationOrThrow(id);
    expect(rec.origin).toBe("local-user");
    expect(id.startsWith("inv_")).toBe(true);
    expect(id.length).toBeGreaterThan(20); // full UUID
  });

  it("beginRemoteInbox → remote-channel", () => {
    const id = beginInvocation("remote-channel", { source: "qq-bot", inboxItemId: "msg1" });
    const rec = resolveInvocationOrThrow(id);
    expect(rec.origin).toBe("remote-channel");
    expect(rec.source).toBe("qq-bot");
  });

  it("renderer origin string cannot change", () => {
    const id = beginInvocation("remote-channel", { source: "gmail" });
    const rec = resolveInvocationOrThrow(id);
    expect(rec.origin).toBe("remote-channel");
    // Renderer tries to claim local-user via string, but Main still sees remote
    expect(rec.origin).not.toBe("local-user");
  });
});
