// @vitest-environment node
/**
 * Agent Superpowers（plan / ask）历史 round-trip：
 * - live assistantTurn → sanitize 只持久化规范化展示快照
 * - 恢复 metadata → assistantTurn.plan/question（历史卡片可见）
 * - 旧记录无字段 → 不写、不崩
 */
import { describe, expect, it } from "vitest";
import { buildKiroMessageView, type KiroChatMessageView } from "@/hooks/useKiroChat";
import { sanitizeConversation } from "@/lib/ai/history/sanitize";
import { normalizeAgentPlan } from "@/lib/ai/agent/plan";
import { normalizeUserQuestion } from "@/lib/ai/agent/ask";

const PLAN = normalizeAgentPlan({
  title: "准备作业",
  steps: [
    { id: "a", title: "读要求", status: "completed" },
    { id: "b", title: "整理数据", status: "in_progress" },
  ],
})!;

const QUESTION = normalizeUserQuestion({
  question: "先做哪门课？",
  options: [
    { id: "c1", label: "计量经济学" },
    { id: "c2", label: "市场营销" },
  ],
})!;

function assistantMessage(metadata?: Record<string, unknown>, text = "answer") {
  return {
    id: "m-1",
    role: "assistant" as const,
    parts: text ? [{ type: "text", text }] : [],
    metadata,
  };
}

function view(overrides: Partial<KiroChatMessageView> = {}): KiroChatMessageView {
  return {
    id: "m-1",
    role: "assistant",
    content: "answer",
    streaming: false,
    canRegenerate: false,
    ...overrides,
  } as KiroChatMessageView;
}

function sanitize(messages: KiroChatMessageView[]) {
  return sanitizeConversation({
    id: "c-1",
    title: "t",
    createdAt: "2026-11-05T00:00:00.000Z",
    provider: "opencode-go",
    model: "deepseek-v4.1-flash",
    messages,
    manualRefs: [],
    entryRefs: [],
  });
}

describe("Agent Superpowers history round-trip", () => {
  it("sanitize：只写入规范化后的 plan / question", () => {
    const record = sanitize([
      view({
        assistantTurn: {
          worklog: [],
          answer: "answer",
          answerStreaming: false,
          hasTools: true,
          worklogDone: true,
          phase: "done",
          plan: PLAN,
          question: QUESTION,
        },
      }),
    ]);
    expect(record.messages[0].agentPlan?.title).toBe("准备作业");
    expect(record.messages[0].agentQuestion?.question).toBe("先做哪门课？");
    // 不持久化工具参数 / 内部字段
    expect(JSON.stringify(record.messages[0])).not.toContain("toolCallId");
  });

  it("旧记录无字段 → 不写 plan/question", () => {
    const record = sanitize([view()]);
    expect(record.messages[0].agentPlan).toBeUndefined();
    expect(record.messages[0].agentQuestion).toBeUndefined();
    expect("agentPlan" in record.messages[0]).toBe(false);
    expect("agentQuestion" in record.messages[0]).toBe(false);
  });

  it("只有 plan/question、无正文的 assistant 消息仍保留", () => {
    const record = sanitize([
      view({
        content: "",
        assistantTurn: {
          worklog: [],
          answer: "",
          answerStreaming: false,
          hasTools: true,
          worklogDone: true,
          phase: "done",
          plan: PLAN,
        },
      }),
    ]);
    expect(record.messages).toHaveLength(1);
    expect(record.messages[0].agentPlan?.steps).toHaveLength(2);
  });

  it("恢复 metadata → assistantTurn.plan/question", () => {
    const restored = buildKiroMessageView(
      assistantMessage({ restored: "1", agentPlan: PLAN, agentQuestion: QUESTION }) as never,
      false
    );
    expect(restored.assistantTurn?.plan?.title).toBe("准备作业");
    expect(restored.assistantTurn?.question?.options).toHaveLength(2);
  });

  it("非法 metadata → 不渲染半截卡片", () => {
    const restored = buildKiroMessageView(
      assistantMessage({
        restored: "1",
        agentPlan: { steps: [] },
        agentQuestion: { question: "只有一个选项", options: ["A"] },
      }) as never,
      false
    );
    expect(restored.assistantTurn?.plan).toBeUndefined();
    expect(restored.assistantTurn?.question).toBeUndefined();
  });
});
