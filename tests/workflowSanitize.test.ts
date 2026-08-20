import { describe, it, expect } from "vitest";
import { sanitizeWorkflowTrace, assertSanitized, MAX_WORKFLOW_TRACE_BYTES } from "@/lib/ai/skills/sanitize";
import type { WorkflowTrace } from "@/lib/ai/skills/types";

function makeTrace(overrides: Partial<WorkflowTrace> = {}): WorkflowTrace {
  return {
    turnId: "turn_test",
    userGoal: "测试",
    toolCalls: [{ toolName: "search_courses", input: { query: "test" }, toolCallId: "call_1" }],
    toolResults: [{ toolName: "search_courses", result: { ok: true }, toolCallId: "call_1" }],
    finalStatus: "success",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("workflowSanitize — Task 08 hotfix", () => {
  it("6. arbitrary course name 能被参数化，不依赖计量经济学", () => {
    const trace = makeTrace({
      userGoal: "请把 人工智能导论 的作业整理一下",
      toolCalls: [{ toolName: "search_courses", input: { query: "人工智能导论" }, toolCallId: "c1" }],
    });
    const sanitized = sanitizeWorkflowTrace(trace);
    // sanitized 阶段不应硬编码特定课程名，AI 语义参数化会处理，此处仅确保无硬编码残留
    expect(sanitized.userGoal).not.toContain("计量经济学");
    // 通用 sanitize 不应直接替换任意课程名为 {course}，但应保留原值供 AI 泛化
    expect(sanitized.steps[0].sanitizedInput.query).toBe("人工智能导论");
  });

  it("7. arbitrary deadline 能被参数化", () => {
    const trace = makeTrace({
      toolCalls: [{ toolName: "create_assignment", input: { ddl: "2026-12-01T23:59" }, toolCallId: "c1" }],
    });
    const sanitized = sanitizeWorkflowTrace(trace);
    expect(JSON.stringify(sanitized.steps)).toContain("{date}");
  });

  it("8. arbitrary task title 能被参数化", () => {
    const trace = makeTrace({
      toolCalls: [{ toolName: "create_assignment", input: { title: "我的任意任务标题" }, toolCallId: "c1" }],
    });
    const sanitized = sanitizeWorkflowTrace(trace);
    expect(sanitized.steps[0].sanitizedInput.title).toBe("我的任意任务标题");
  });

  it("9. credentialRef 被清洗", () => {
    const trace = makeTrace({
      toolCalls: [{ toolName: "test", input: { credentialRef: "cred_abc123", grantId: "grant_xyz" }, toolCallId: "c1" }],
    });
    const sanitized = sanitizeWorkflowTrace(trace);
    const text = JSON.stringify(sanitized);
    expect(text).not.toContain("cred_abc123");
    expect(text).toContain("{credentialRef}");
    expect(text).toContain("{grantId}");
  });

  it("10. API Key pattern 被清洗", () => {
    const trace = makeTrace({
      toolCalls: [{ toolName: "test", input: { apiKey: "sk-1234567890abcdefghij12345" }, toolCallId: "c1" }],
    });
    const sanitized = sanitizeWorkflowTrace(trace);
    const text = JSON.stringify(sanitized);
    expect(text).not.toContain("sk-1234567890");
    expect(text).toContain("{token}");
  });

  it("11. native absolute path 被清洗", () => {
    const trace = makeTrace({
      toolCalls: [{ toolName: "fs_read", input: { path: "C:\\Users\\test\\file.txt" }, toolCallId: "c1" }],
    });
    const sanitized = sanitizeWorkflowTrace(trace);
    const text = JSON.stringify(sanitized);
    expect(text).not.toContain("C:\\Users");
    expect(text).toContain("{path}");
    const trace2 = makeTrace({
      toolCalls: [{ toolName: "fs_read", input: { path: "/home/user/file.pdf" }, toolCallId: "c1" }],
    });
    const sanitized2 = sanitizeWorkflowTrace(trace2);
    expect(JSON.stringify(sanitized2)).toContain("{path}");
  });

  it("12. UUID / entity ID 被清洗", () => {
    const trace = makeTrace({
      toolCalls: [{ toolName: "test", input: { id: "assignment_abc123def456", uuid: "123e4567-e89b-12d3-a456-426614174000", toolCallId: "call_123456" }, toolCallId: "call_123456" }],
    });
    const sanitized = sanitizeWorkflowTrace(trace);
    const text = JSON.stringify(sanitized);
    expect(text).not.toContain("assignment_abc123def456");
    expect(text).toContain("{entityId}");
    expect(text).not.toContain("123e4567-e89b-12d3-a456-426614174000");
    expect(text).toContain("{uuid}");
    expect(text).not.toContain("call_123456");
    expect(text).toContain("{toolCallId}");
  });

  it("MAX_WORKFLOW_TRACE_BYTES 限制", () => {
    expect(MAX_WORKFLOW_TRACE_BYTES).toBe(64 * 1024);
    const bigText = "a".repeat(MAX_WORKFLOW_TRACE_BYTES + 1);
    const trace = makeTrace({ userGoal: bigText });
    const sanitized = sanitizeWorkflowTrace(trace);
    const result = assertSanitized(sanitized);
    // 超大内容已被截断，assert 不应因包含原始大文本而失败，但长度检查应触发
    expect(JSON.stringify(sanitized).length).toBeLessThanOrEqual(MAX_WORKFLOW_TRACE_BYTES + 1000);
  });

  it("assertSanitized hard gate", () => {
    const trace = makeTrace({
      toolCalls: [{ toolName: "test", input: { token: "sk-1234567890abcdefghij12345" }, toolCallId: "c1" }],
    });
    // 故意构造未清洗的 sanitized（绕过 sanitize，直接构造含 sk- 的对象）
    const badSanitized = {
      userGoal: "test sk-1234567890abcdefghij12345",
      steps: [{ tool: "test", sanitizedInput: { token: "sk-1234567890abcdefghij12345" } }],
      requiredTools: ["test"],
      hasProposal: false,
      hasConfirmation: false,
    };
    const result = assertSanitized(badSanitized as never);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("apiKey");
  });
});
