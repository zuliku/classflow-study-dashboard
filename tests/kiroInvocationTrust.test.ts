import { describe, it, expect } from "vitest";
import { filterKiroToolsForInvocation } from "@/lib/ai/tools/invocationFilter";
import type { ToolSet } from "ai";

function mockToolSet(names: string[]): ToolSet {
  const set: Record<string, unknown> = {};
  for (const n of names) set[n] = { description: n } as unknown;
  return set as ToolSet;
}

const FIXTURE = [
  "search_courses",
  "get_course",
  "propose_study_plan",
  "activate_skill",
  "mcp_search_tools",
  "begin_final_answer",
  "create_assignment",
  "update_assignment",
  "delete_assignment",
  "run_terminal_command",
  "create_text_file",
  "delete_file",
  "mcp_call_tool",
  "apply_change_set",
  "unknown_future_tool",
];

const REMOTE_ALLOW = [
  "search_courses",
  "get_course",
  "propose_study_plan",
  "activate_skill",
  "mcp_search_tools",
  "begin_final_answer",
];

const REMOTE_DENY = [
  "create_assignment",
  "update_assignment",
  "delete_assignment",
  "run_terminal_command",
  "create_text_file",
  "delete_file",
  "mcp_call_tool",
  "apply_change_set",
  "unknown_future_tool",
];

describe("kiroInvocationTrust", () => {
  it("local-user: keeps original ToolSet", () => {
    const tools = mockToolSet(FIXTURE);
    const filtered = filterKiroToolsForInvocation({ tools, origin: "local-user" });
    expect(Object.keys(filtered).sort()).toEqual([...FIXTURE].sort());
    // object identity for local should be original reference (or at least same keys)
    for (const name of FIXTURE) {
      expect(filtered[name]).toBe(tools[name]);
    }
  });

  it("remote-channel: only allowlist exposed", () => {
    const tools = mockToolSet(FIXTURE);
    const filtered = filterKiroToolsForInvocation({ tools, origin: "remote-channel" });
    for (const name of REMOTE_ALLOW) {
      expect(filtered[name], `remote should ALLOW ${name}`).toBeDefined();
    }
    for (const name of REMOTE_DENY) {
      expect(filtered[name], `remote should DENY ${name}`).toBeUndefined();
    }
  });

  it("remote-channel: unknown_future_tool denied (fail closed)", () => {
    const tools = mockToolSet(["search_courses", "unknown_future_tool"]);
    const filtered = filterKiroToolsForInvocation({ tools, origin: "remote-channel" });
    expect(filtered["unknown_future_tool"]).toBeUndefined();
    expect(filtered["search_courses"]).toBeDefined();
  });

  it("remote-channel: filesystem write tools denied", () => {
    const tools = mockToolSet(["create_text_file", "delete_file", "search_courses"]);
    const filtered = filterKiroToolsForInvocation({ tools, origin: "remote-channel" });
    expect(filtered["create_text_file"]).toBeUndefined();
    expect(filtered["delete_file"]).toBeUndefined();
    expect(filtered["search_courses"]).toBeDefined();
  });

  it("remote-channel: terminal and MCP call denied", () => {
    const tools = mockToolSet(["run_terminal_command", "mcp_call_tool", "mcp_search_tools"]);
    const filtered = filterKiroToolsForInvocation({ tools, origin: "remote-channel" });
    expect(filtered["run_terminal_command"]).toBeUndefined();
    expect(filtered["mcp_call_tool"]).toBeUndefined();
    expect(filtered["mcp_search_tools"]).toBeDefined();
  });

  it("remote-channel: apply_change_set denied", () => {
    const tools = mockToolSet(["apply_change_set", "propose_study_plan"]);
    const filtered = filterKiroToolsForInvocation({ tools, origin: "remote-channel" });
    expect(filtered["apply_change_set"]).toBeUndefined();
    expect(filtered["propose_study_plan"]).toBeDefined();
  });
});
