import { describe, it, expect } from "vitest";
import { extractWorkflowTraceForTurn } from "@/lib/ai/skills/workflowTrace";

describe("workflowTurnSelection", () => {
  it("Assistant A → Turn A, Assistant B → Turn B", () => {
    const messages = [
      { id: "u1", role: "user" as const, content: "第一轮" },
      { id: "a1", role: "assistant" as const, parts: [{ type: "tool-search_courses", toolCallId: "c1", toolName: "search_courses", input: {}, output: { ok: true } }] },
      { id: "u2", role: "user" as const, content: "第二轮" },
      { id: "a2", role: "assistant" as const, parts: [{ type: "tool-get_course", toolCallId: "c2", toolName: "get_course", input: {}, output: { ok: true } }] },
    ];
    const traceA = extractWorkflowTraceForTurn(messages, { assistantMessageId: "a1" });
    const traceB = extractWorkflowTraceForTurn(messages, { assistantMessageId: "a2" });
    expect(traceA?.userGoal).toBe("第一轮");
    expect(traceB?.userGoal).toBe("第二轮");
    expect(traceA?.toolCalls[0].toolName).toBe("search_courses");
    expect(traceB?.toolCalls[0].toolName).toBe("get_course");
  });

  it("read_material not mutation", async () => {
    const { KIRO_MUTATING_TOOL_NAMES } = await import("@/lib/ai/tools/mutating");
    expect((KIRO_MUTATING_TOOL_NAMES as string[]).includes("read_material")).toBe(false);
    expect((KIRO_MUTATING_TOOL_NAMES as string[]).includes("activate_skill")).toBe(false);
    expect((KIRO_MUTATING_TOOL_NAMES as string[]).includes("mcp_search_tools")).toBe(false);
  });
});
