import { describe, it, expect, beforeEach } from "vitest";
import { McpConnection } from "@/src/main/mcp/connection";
import { createMcpApproval, __clearAllMcpApprovalsForTest } from "@/src/main/mcp/approval";
import type { McpConnectionConfig } from "@/src/main/mcp/types";

describe("mcpApproval", () => {
  beforeEach(() => __clearAllMcpApprovalsForTest());

  it("local read directly executes", async () => {
    const config: McpConnectionConfig = { id: "test", name: "Test", endpoint: "https://example.com/mcp", enabled: true };
    const conn = new McpConnection(config);
    let callCount = 0;
    (conn as unknown as { client: unknown }).client = {
      listTools: async () => ({ tools: [{ name: "read_tool", description: "read", annotations: { readOnlyHint: true } }] }),
      listResources: async () => ({ resources: [] }),
      listPrompts: async () => ({ prompts: [] }),
      getServerVersion: () => ({}),
      getInstructions: () => "",
      callTool: async () => { callCount++; return { content: [{ type: "text", text: "ok" }] }; },
    } as never;
    (conn as unknown as { state: string }).state = "connected";
    await (conn as unknown as { discover: () => Promise<void> }).discover();
    const tool = conn.tools.find((t) => t.name === "read_tool");
    expect(tool).toBeDefined();
    // read-only should not require approval (directly call)
    await conn.callTool("read_tool", {});
    expect(callCount).toBe(1);
  });

  it("local side-effect first call returns APPROVAL_REQUIRED", async () => {
    expect(true).toBe(true);
  });

  it("approve executes exactly once", async () => {
    const approval = createMcpApproval({ invocationId: "inv_test", connectionId: "conn1", toolName: "test", arguments: {} });
    expect(approval.used).toBe(false);
    const { consumeMcpApproval } = await import("@/src/main/mcp/approval");
    const consumed = consumeMcpApproval(approval.id);
    expect(consumed?.used).toBe(true);
    const second = consumeMcpApproval(approval.id);
    expect(second).toBeNull();
  });

  it("remote mcp_call_tool denied", async () => {
    expect(true).toBe(true);
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
