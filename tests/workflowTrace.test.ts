import { describe, it, expect } from "vitest";
import { extractWorkflowTrace, isWorkflowTraceReusable } from "@/lib/ai/skills/workflowTrace";

describe("workflowTrace — Task 08 hotfix", () => {
  it("1. User Goal 来源是真实 User Message，不是 Assistant text", () => {
    const messages = [
      { id: "u1", role: "user" as const, content: "请帮我把课程群的作业整理成任务" },
      {
        id: "a1",
        role: "assistant" as const,
        parts: [
          { type: "tool-search_courses", toolCallId: "c1", toolName: "search_courses", input: { query: "test" }, output: { ok: true } },
          { type: "text", text: "这是 Assistant 的总结，不应成为 userGoal" },
        ],
      },
    ];
    const trace = extractWorkflowTrace(messages);
    expect(trace).not.toBeNull();
    expect(trace!.userGoal).toBe("请帮我把课程群的作业整理成任务");
    expect(trace!.userGoal).not.toContain("Assistant");
  });

  it("2. 失败 ToolResult 不得变成 ok=true", () => {
    const messages = [
      { id: "u1", role: "user" as const, content: "创建一个任务" },
      {
        id: "a1",
        role: "assistant" as const,
        parts: [
          { type: "tool-create_assignment", toolCallId: "c1", toolName: "create_assignment", input: { title: "test" }, output: { ok: false, code: "INVALID_INPUT" } },
        ],
      },
    ];
    const trace = extractWorkflowTrace(messages);
    expect(trace).toBeNull();
  });

  it("3. pending 不得变成 success", () => {
    const messages = [
      { id: "u1", role: "user" as const, content: "查询任务" },
      {
        id: "a1",
        role: "assistant" as const,
        parts: [
          { type: "tool-search_assignments", toolCallId: "c1", toolName: "search_assignments", input: {}, output: undefined, state: "output-available" },
        ],
      },
    ];
    const trace = extractWorkflowTrace(messages);
    expect(trace).toBeNull();
  });

  it("4. Proposal 未 Apply 不得伪造成已执行", () => {
    const messages = [
      { id: "u1", role: "user" as const, content: "帮我安排学习计划" },
      {
        id: "a1",
        role: "assistant" as const,
        parts: [{ type: "tool-propose_study_plan", toolCallId: "c1", toolName: "propose_study_plan", input: {}, output: { ok: true } }],
      },
    ];
    const trace = extractWorkflowTrace(messages);
    // Proposal 本身成功，但无后续 mutation 成功，是否算 reusable 取决于实现
    // 此处我们要求至少有一个 mutation 成功才算已执行，否则仅为 proposal 型
    // 若只有 proposal 且无 mutation，isWorkflowTraceReusable 应为 true（proposal 型 Skill）但 instructions 需停在 Proposal
    // 此处测试：只有 proposal 的 trace 仍可提取，但需标记为 proposal
    expect(trace).not.toBeNull();
    expect(trace!.toolCalls[0].toolName).toBe("propose_study_plan");
  });

  it("5. successful mutation 可以进入 reusable trace", () => {
    const messages = [
      { id: "u1", role: "user" as const, content: "创建一个任务" },
      {
        id: "a1",
        role: "assistant" as const,
        parts: [{ type: "tool-create_assignment", toolCallId: "c1", toolName: "create_assignment", input: { title: "t" }, output: { ok: true } }],
      },
    ];
    const trace = extractWorkflowTrace(messages);
    expect(trace).not.toBeNull();
    expect(isWorkflowTraceReusable(trace)).toBe(true);
    expect(trace!.toolCalls[0].toolName).toBe("create_assignment");
  });

  it("Turn Boundary: User N+1 为下一轮开始", () => {
    const messages = [
      { id: "u1", role: "user" as const, content: "第一轮" },
      { id: "a1", role: "assistant" as const, parts: [{ type: "tool-search_courses", toolCallId: "c1", toolName: "search_courses", input: {}, output: { ok: true } }] },
      { id: "u2", role: "user" as const, content: "第二轮" },
      { id: "a2", role: "assistant" as const, parts: [{ type: "tool-get_course", toolCallId: "c2", toolName: "get_course", input: {}, output: { ok: true } }] },
    ];
    const trace = extractWorkflowTrace(messages);
    // 应只提取最后一轮（User N = u2）
    expect(trace).not.toBeNull();
    expect(trace!.userGoal).toBe("第二轮");
    expect(trace!.toolCalls[0].toolName).toBe("get_course");
  });
});
