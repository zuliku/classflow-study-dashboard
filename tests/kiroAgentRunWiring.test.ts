// @vitest-environment node
/**
 * P4 接线守卫（源码断言）：Inline Approval ownership / orphan fallback / 性能边界 /
 * Worklog canonical timeline 契约。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

describe("P4 Approval ownership 接线", () => {
  const surface = read("components/kiro/KiroChatSurface.tsx");
  const conversation = read("components/kiro/KiroConversation.tsx");

  it("ChatSurface 用真实 taskId 计算 owning message；只订阅一次 Desktop Session", () => {
    expect(surface).toContain("findApprovalOwnerMessageId(chat.messages, pendingApproval?.taskId)");
    expect(surface).toContain("useDesktopSessionStore((s) => s.state === \"paused\")");
    // 历史 row 不订阅 Desktop Session Store（只在 Surface 订阅一次）
    expect(conversation).not.toContain("useDesktopSessionStore");
  });

  it("orphan fallback：未匹配时才把 request 交给 Dialog", () => {
    expect(surface).toContain("request={approvalOwnerMessageId ? null : pendingApproval}");
    // Inline binding 只注入 owning row
    expect(conversation).toContain("m.id === approvalOwnerMessageId ? approvalBinding : undefined");
    // binding 引用稳定（approval 不变 → 不新建对象）
    expect(conversation).toContain("React.useMemo(");
  });

  it("live run 只标记最后一条 assistant 行（历史 row props 稳定 → memo 命中）", () => {
    expect(conversation).toContain("runLive={idx === lastAssistantIndex && turnInFlight}");
  });

  it("Conversation 不再渲染 KiroAgentTaskCard（Result 收敛到 Agent Run Result）", () => {
    expect(conversation).not.toContain("KiroAgentTaskCard");
    expect(read("components/kiro/KiroMessage.tsx")).toContain("KiroAgentRunResult");
  });
});

describe("P4 性能边界：Worklog canonical timeline + memo 契约", () => {
  const worklog = read("components/kiro/KiroWorklog.tsx");
  const message = read("components/kiro/KiroMessage.tsx");

  it("Timeline comparator / tool row memo / perf counters 保留", () => {
    expect(worklog).toContain("worklogEquals");
    expect(worklog).toContain("toolBlockEquals");
    expect(worklog).toContain("worklogTimelinePropsEqual");
    expect(worklog).toContain("bumpStreamPerf");
    expect(worklog).toContain("KiroToolRow");
  });

  it("raw reasoning 绝不渲染：只有 reasoningSummary 占位", () => {
    expect(worklog).toContain("reasoningSummary");
    expect(worklog).not.toContain("reasoningText");
    expect(worklog).not.toContain("chain-of-thought");
  });

  it("KiroMessage：Agent Run 在 Final Answer 前、Result 在 Final Answer 后", () => {
    const runIndex = message.indexOf("<KiroAgentRun");
    const answerIndex = message.indexOf("<KiroStreamingMarkdown");
    const resultIndex = message.indexOf("<KiroAgentRunResult");
    expect(runIndex).toBeGreaterThan(-1);
    expect(answerIndex).toBeGreaterThan(-1);
    expect(resultIndex).toBeGreaterThan(-1);
    expect(runIndex).toBeLessThan(answerIndex);
    expect(answerIndex).toBeLessThan(resultIndex);
  });

  it("Agent Run 不包裹 Final Answer（execution 与 answer 是不同 lane）", () => {
    const run = read("components/kiro/run/KiroAgentRun.tsx");
    expect(run).not.toContain("children");
    expect(run).not.toContain("KiroStreamingMarkdown");
  });
});

describe("P4 不修改既有 Runtime / 协议（守卫）", () => {
  it("begin_final_answer lane contract 未修改", () => {
    const live = read("lib/ai/presentation/liveTurnPresentation.ts");
    expect(live).toContain("isKiroFinalAnswerToolName");
    expect(live).toContain("finalAnswerPartIndex");
  });

  it("Approval Runtime 契约未修改（timeout / one-shot / bulk API 保留）", () => {
    const chat = read("hooks/useKiroChat.ts");
    expect(chat).toContain("APPROVAL_TIMEOUT_MS = 3 * 60 * 1000");
    expect(chat).toContain("resolveBulkApproval: handleBulkApprovalDecision");
    expect(chat).toContain("oneShotApprovalsRef.current.push");
    expect(chat).toContain("fingerprint");
  });
});
