import { describe, it, expect, beforeEach } from "vitest";
import { McpConnection } from "@/src/main/mcp/connection";
import { createMcpApproval, __clearAllMcpApprovalsForTest, getMcpApproval, consumeMcpApproval } from "@/src/main/mcp/approval";
import { classifyMcpToolRisk, requiresMcpToolConfirmation, isMcpToolAllowedForOrigin } from "@/src/main/mcp/permissions";
import type { McpConnectionConfig } from "@/src/main/mcp/types";

function makeConnected(connId = "test", toolDefs: { name: string; annotations?: Record<string, boolean> }[] = []): { conn: McpConnection; getCallCount: () => number } {
  const config: McpConnectionConfig = { id: connId, name: "Test", endpoint: "https://example.com/mcp", enabled: true };
  const conn = new McpConnection(config);
  let callCount = 0;
  (conn as unknown as { client: unknown }).client = {
    listTools: async () => ({ tools: toolDefs.map((t) => ({ name: t.name, description: t.name, annotations: t.annotations })) }),
    listResources: async () => ({ resources: [] }),
    listPrompts: async () => ({ prompts: [] }),
    getServerVersion: () => ({}),
    getInstructions: () => "",
    callTool: async () => { callCount++; return { content: [{ type: "text", text: "ok" }] }; },
  } as never;
  (conn as unknown as { state: string }).state = "connected";
  return { conn, getCallCount: () => callCount };
}

describe("mcpApproval", () => {
  beforeEach(() => __clearAllMcpApprovalsForTest());

  it("local read directly executes", async () => {
    const { conn, getCallCount } = makeConnected("test", [{ name: "read_tool", annotations: { readOnlyHint: true } }]);
    await (conn as unknown as { discover: () => Promise<void> }).discover();
    const tool = conn.tools.find((t) => t.name === "read_tool");
    expect(tool).toBeDefined();
    // read-only should not require approval (directly call)
    await conn.callTool("read_tool", {});
    expect(getCallCount()).toBe(1);
  });

  it("local side-effect first call returns APPROVAL_REQUIRED without calling tool", async () => {
    const { conn, getCallCount } = makeConnected("test", [{ name: "write_tool", annotations: { destructiveHint: true } }]);
    await (conn as unknown as { discover: () => Promise<void> }).discover();
    const tool = conn.tools.find((t) => t.name === "write_tool")!;
    const risk = classifyMcpToolRisk(tool as never);
    expect(risk).toBe("destructive");
    expect(requiresMcpToolConfirmation(risk)).toBe(true);
    expect(isMcpToolAllowedForOrigin(risk, "local-user").allowed).toBe(true);

    // Simulate IPC: first call without approval should create approval and not call tool
    let approvalId: string | null = null;
    let approvalErr: unknown = null;
    try {
      if (requiresMcpToolConfirmation(risk)) {
        const approval = createMcpApproval({ invocationId: "inv_local", connectionId: "test", toolName: "write_tool", arguments: { a: 1 } });
        approvalId = approval.id;
        throw new Error(JSON.stringify({ code: "APPROVAL_REQUIRED", message: "Approval required", approvalRequestId: approval.id }));
      }
      await conn.callTool("write_tool", {});
    } catch (e) {
      approvalErr = e;
    }
    expect((approvalErr as Error).message).toContain("APPROVAL_REQUIRED");
    expect(approvalId).not.toBeNull();
    expect(getCallCount()).toBe(0);
    const rec = getMcpApproval(approvalId!);
    expect(rec).toBeDefined();
    expect(rec?.used).toBe(false);
  });

  it("approve executes exactly once and reuse denied", async () => {
    const { conn, getCallCount } = makeConnected("test", [{ name: "write_tool", annotations: { destructiveHint: true } }]);
    await (conn as unknown as { discover: () => Promise<void> }).discover();
    const approval = createMcpApproval({ invocationId: "inv_local", connectionId: "test", toolName: "write_tool", arguments: { x: 1 } });
    expect(approval.used).toBe(false);

    // First consume: should succeed and then call tool once
    const consumed = consumeMcpApproval(approval.id);
    expect(consumed?.used).toBe(true);
    if (consumed) {
      await conn.callTool(consumed.toolName, consumed.arguments);
    }
    expect(getCallCount()).toBe(1);

    // Reuse same approval: should be denied (null) and not call again
    const second = consumeMcpApproval(approval.id);
    expect(second).toBeNull();
    // callCount stays 1 even if someone tries to reuse
    expect(getCallCount()).toBe(1);

    // Expired or missing approval also denied
    const missing = consumeMcpApproval("mcp_approval_missing");
    expect(missing).toBeNull();
  });

  it("remote mcp_call_tool denied without calling tool", async () => {
    const { conn, getCallCount } = makeConnected("test", [
      { name: "read_tool", annotations: { readOnlyHint: true } },
      { name: "write_tool", annotations: { destructiveHint: true } },
    ]);
    await (conn as unknown as { discover: () => Promise<void> }).discover();

    for (const toolName of ["read_tool", "write_tool"]) {
      const tool = conn.tools.find((t) => t.name === toolName)!;
      const risk = classifyMcpToolRisk(tool as never);
      const allowed = isMcpToolAllowedForOrigin(risk, "remote-channel");
      if (risk === "read-only") {
        expect(allowed.allowed).toBe(true);
      } else {
        expect(allowed.allowed).toBe(false);
      }
    }
    // Remote side-effect: IPC would throw PERMISSION_DENIED_REMOTE without calling tool
    const writeTool = conn.tools.find((t) => t.name === "write_tool")!;
    const risk = classifyMcpToolRisk(writeTool as never);
    const check = isMcpToolAllowedForOrigin(risk, "remote-channel");
    expect(check.allowed).toBe(false);
    expect(getCallCount()).toBe(0);

    // Even read-only remote cannot call mcp_call_tool via invocation gate (remote mcp-call denied)
    // Simulate invocation gate: isInvocationCapabilityAllowed for mcp-call is false for remote
    const { isInvocationCapabilityAllowed } = await import("@/src/main/security/invocationTrust");
    expect(isInvocationCapabilityAllowed("remote-channel", "mcp-call")).toBe(false);
    expect(isInvocationCapabilityAllowed("remote-channel", "read")).toBe(true);
    expect(getCallCount()).toBe(0);
  });

  it("result untrusted", async () => {
    const config: McpConnectionConfig = { id: "test", name: "Test", endpoint: "https://example.com/mcp", enabled: true };
    const conn = new McpConnection(config);
    (conn as unknown as { client: unknown }).client = {
      listTools: async () => ({ tools: [{ name: "test" }] }),
      listResources: async () => ({ resources: [] }),
      listPrompts: async () => ({ prompts: [] }),
      getServerVersion: () => ({}),
      getInstructions: () => "",
      callTool: async () => ({ content: [{ type: "text", text: "evil" }] }),
    } as never;
    (conn as unknown as { state: string }).state = "connected";
    await (conn as unknown as { discover: () => Promise<void> }).discover();
    const res = await conn.callTool("test", {}) as { _untrusted?: boolean };
    expect(res._untrusted).toBe(true);
  });
});
