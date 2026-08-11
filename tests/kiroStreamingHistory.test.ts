import { describe, it, expect } from "vitest";
import { sanitizeConversation } from "@/lib/ai/history/sanitize";
import { KiroChatMessageView } from "@/hooks/useKiroChat";

function viewMessage(partial: Partial<KiroChatMessageView> & { role: "user" | "assistant"; content: string }): KiroChatMessageView {
  return { id: "m1", streaming: false, canRegenerate: true, ...partial };
}

function sanitize(messages: KiroChatMessageView[]) {
  return sanitizeConversation({
    id: "c1",
    title: "t",
    createdAt: "2026-08-01T00:00:00.000Z",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    messages,
    manualRefs: [],
    entryRefs: [],
  });
}

describe("sanitizeConversation（Worklog V2 语义）", () => {
  it("测试 1：assistantTurn.worklog 旁白不进入 persisted.content（只存 Final Answer）", () => {
    const rec = sanitize([
      viewMessage({ id: "u1", role: "user", content: "帮我看看" }),
      viewMessage({
        id: "a1",
        role: "assistant",
        content: "最终回答",
        assistantTurn: {
          worklog: [
            { kind: "commentary", id: "c1", text: "我先看看任务", streaming: false, stepIndex: 1 },
            {
              kind: "tool",
              id: "t1",
              toolCallId: "call_1",
              toolName: "search_assignments",
              label: "查找任务",
              status: "done",
              toolKind: "read",
              safeDetails: ["找到 2 个任务"],
              stepIndex: 1,
            },
          ],
          answer: "最终回答",
          answerStreaming: false,
          hasTools: true,
          worklogDone: true,
          phase: "done",
        },
      }),
    ]);
    const persisted = rec.messages.find((m) => m.role === "assistant")!;
    expect(persisted.content).toBe("最终回答");
    expect(persisted.content).not.toContain("我先看看任务");
    expect(JSON.stringify(rec)).not.toContain("我先看看任务");
    expect(JSON.stringify(rec)).not.toContain("找到 2 个任务"); // tool details 也不入库
  });

  it("测试 2：Assistant content 为空但有 Action Card → 消息保留且 actions 保留", () => {
    const rec = sanitize([
      viewMessage({ id: "u1", role: "user", content: "把截止时间改到明天" }),
      viewMessage({
        id: "a1",
        role: "assistant",
        content: "",
        canRegenerate: false,
        actions: [
          {
            toolCallId: "call_1",
            action: {
              tool: "set_assignment_ddl",
              operation: "update",
              canUndo: true,
              title: "统计学作业",
              before: { ddl: "2026-08-10T23:59:00" },
              after: { ddl: "2026-08-11T22:00:00" },
            } as never,
          },
        ],
      }),
    ]);
    const persisted = rec.messages.find((m) => m.role === "assistant");
    expect(persisted).toBeDefined();
    expect(persisted!.actions).toHaveLength(1);
    expect(persisted!.actions![0].title).toBe("统计学作业");
    expect(persisted!.content).toBe("");
  });

  it("测试 2b：assistant 完全空（无 content 无 actions）仍被过滤", () => {
    const rec = sanitize([
      viewMessage({ id: "u1", role: "user", content: "hi" }),
      viewMessage({ id: "a1", role: "assistant", content: "" }),
    ]);
    expect(rec.messages.map((m) => m.role)).toEqual(["user"]);
  });
});
