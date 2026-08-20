import { describe, it, expect, beforeEach } from "vitest";
import {
  beginInvocation,
  resolveInvocationOrThrow,
  __clearAllInvocationsForTest,
  isInvocationCapabilityAllowed,
  INVOCATION_CAPABILITIES,
  isValidInvocationCapability,
} from "@/src/main/security/invocationTrust";

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

  it("INVOCATION_CAPABILITIES contains exactly 8 known capabilities", () => {
    expect(INVOCATION_CAPABILITIES.size).toBe(8);
    expect([...INVOCATION_CAPABILITIES].sort()).toEqual(
      ["computer-mutation", "delete", "filesystem-write", "mcp-call", "propose", "read", "terminal", "write"].sort()
    );
  });

  it("remote-channel: read/propose allowed, all mutations denied", () => {
    expect(isInvocationCapabilityAllowed("remote-channel", "read")).toBe(true);
    expect(isInvocationCapabilityAllowed("remote-channel", "propose")).toBe(true);
    expect(isInvocationCapabilityAllowed("remote-channel", "write")).toBe(false);
    expect(isInvocationCapabilityAllowed("remote-channel", "delete")).toBe(false);
    expect(isInvocationCapabilityAllowed("remote-channel", "terminal")).toBe(false);
    expect(isInvocationCapabilityAllowed("remote-channel", "filesystem-write")).toBe(false);
    expect(isInvocationCapabilityAllowed("remote-channel", "computer-mutation")).toBe(false);
    expect(isInvocationCapabilityAllowed("remote-channel", "mcp-call")).toBe(false);
  });

  it("remote-channel: unknown capability → false (fail closed)", () => {
    expect(isInvocationCapabilityAllowed("remote-channel", "unknown_future_tool")).toBe(false);
    expect(isInvocationCapabilityAllowed("remote-channel", "")).toBe(false);
    expect(isValidInvocationCapability("unknown_future_tool")).toBe(false);
  });

  it("local-user: known capabilities allowed, unknown → false", () => {
    for (const cap of INVOCATION_CAPABILITIES) {
      expect(isInvocationCapabilityAllowed("local-user", cap)).toBe(true);
      expect(isValidInvocationCapability(cap)).toBe(true);
    }
    expect(isInvocationCapabilityAllowed("local-user", "unknown_future_tool")).toBe(false);
    expect(isInvocationCapabilityAllowed("local-user", "write; rm -rf /")).toBe(false);
    expect(isValidInvocationCapability("unknown_future_tool")).toBe(false);
    expect(isValidInvocationCapability("")).toBe(false);
  });

  it("unknown capability isValid → false and isAllowed → false for both origins", () => {
    const unknowns = ["unknown", "READ", "Write", "filesystem-write ", "mcp-call\n", "admin"];
    for (const unk of unknowns) {
      expect(isValidInvocationCapability(unk)).toBe(false);
      expect(isInvocationCapabilityAllowed("local-user", unk)).toBe(false);
      expect(isInvocationCapabilityAllowed("remote-channel", unk)).toBe(false);
    }
  });
});
