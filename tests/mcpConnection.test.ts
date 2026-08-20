import { describe, it, expect } from "vitest";
import { McpConnection } from "@/src/main/mcp/connection";
import type { McpConnectionConfig } from "@/src/main/mcp/types";

describe("mcpConnection", () => {
  it("connect → discover Tools", async () => {
    const config: McpConnectionConfig = { id: "test", name: "Test", endpoint: "https://example.com/mcp", enabled: true };
    const conn = new McpConnection(config);
    // Mock client
    (conn as unknown as { client: { listTools: () => Promise<{ tools: unknown[] }>; listResources: () => Promise<never>; listPrompts: () => Promise<never>; getServerVersion: () => unknown; getInstructions: () => unknown } }).client = {
      listTools: async () => ({ tools: [{ name: "test_tool", description: "test" }] }),
      listResources: async () => { throw new Error("unsupported"); },
      listPrompts: async () => { throw new Error("unsupported"); },
      getServerVersion: () => ({ name: "test", version: "1.0" }),
      getInstructions: () => "",
    } as never;
    (conn as unknown as { state: string }).state = "connected";
    await (conn as unknown as { discover: () => Promise<void> }).discover();
    expect(conn.tools.length).toBe(1);
    expect(conn.tools[0].name).toBe("test_tool");
  });

  it("Resources discovery", async () => {
    const config: McpConnectionConfig = { id: "test", name: "Test", endpoint: "https://example.com/mcp", enabled: true };
    const conn = new McpConnection(config);
    (conn as unknown as { client: unknown }).client = {
      listTools: async () => ({ tools: [] }),
      listResources: async () => ({ resources: [{ uri: "file:///test", name: "test" }] }),
      listPrompts: async () => ({ prompts: [] }),
      getServerVersion: () => ({}),
      getInstructions: () => "",
    } as never;
    (conn as unknown as { state: string }).state = "connected";
    await (conn as unknown as { discover: () => Promise<void> }).discover();
    expect(conn.resources.length).toBe(1);
  });

  it("Prompts discovery", async () => {
    const config: McpConnectionConfig = { id: "test", name: "Test", endpoint: "https://example.com/mcp", enabled: true };
    const conn = new McpConnection(config);
    (conn as unknown as { client: unknown }).client = {
      listTools: async () => ({ tools: [] }),
      listResources: async () => ({ resources: [] }),
      listPrompts: async () => ({ prompts: [{ name: "test_prompt" }] }),
      getServerVersion: () => ({}),
      getInstructions: () => "",
    } as never;
    (conn as unknown as { state: string }).state = "connected";
    await (conn as unknown as { discover: () => Promise<void> }).discover();
    expect(conn.prompts.length).toBe(1);
  });

  it("unsupported capability", async () => {
    const config: McpConnectionConfig = { id: "test", name: "Test", endpoint: "https://example.com/mcp", enabled: true };
    const conn = new McpConnection(config);
    (conn as unknown as { client: unknown }).client = {
      listTools: async () => { throw Object.assign(new Error("Method not found"), { code: -32601 }); },
      listResources: async () => { throw Object.assign(new Error("Method not found"), { code: -32601 }); },
      listPrompts: async () => { throw Object.assign(new Error("Method not found"), { code: -32601 }); },
      getServerVersion: () => ({}),
      getInstructions: () => "",
    } as never;
    (conn as unknown as { state: string }).state = "connected";
    await (conn as unknown as { discover: () => Promise<void> }).discover();
    expect(conn.tools.length).toBe(0);
  });
});
