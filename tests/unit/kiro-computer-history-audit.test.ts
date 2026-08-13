import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { sanitizeConversation } from "@/lib/ai/history/sanitize";
import { KiroChatMessageView } from "@/hooks/useKiroChat";
import { KiroAgentTask } from "@/lib/ai/computer/task";
import {
  appendComputerAuditEntry,
  getRecentComputerAuditEntries,
  clearComputerAuditEntries,
  COMPUTER_AUDIT_MAX_ENTRIES,
  ComputerAuditEntry,
} from "@/lib/ai/computer/audit";
import { KIRO_SANDBOX_DB } from "@/lib/ai/computer/adapters/sandbox";

function makeTask(): KiroAgentTask {
  return {
    id: "task-1",
    conversationId: "conv-1",
    userMessageId: "user-1",
    title: "工作区文件操作",
    status: "completed",
    steps: [],
    toolCallIds: ["call_1"],
    changes: [
      {
        id: "change-1",
        toolCallId: "call_1",
        operation: "create",
        resourceType: "text",
        workspaceId: "research",
        workspaceLabel: "论文研究",
        rootId: "output",
        rootLabel: "输出",
        relativePath: "notes.md",
        displayName: "notes.md",
        size: 42,
        verification: "passed",
        review: {
          kind: "create",
          preview: "secret preview content that must never be persisted",
        },
      },
    ],
    canUndo: true,
    undoUsed: false,
    startedAt: "2026-08-13T10:00:00.000Z",
    completedAt: "2026-08-13T10:01:00.000Z",
  };
}

function makeView(overrides: Partial<KiroChatMessageView> = {}): KiroChatMessageView {
  return {
    id: "msg-1",
    role: "assistant",
    content: "",
    streaming: false,
    canRegenerate: false,
    ...overrides,
  };
}

async function clearAuditDb() {
  await clearComputerAuditEntries();
}

beforeEach(async () => {
  await clearAuditDb();
});

describe("history sanitize — Computer Task 安全边界", () => {
  it("持久化视图只含展示事实；不存 review/beforeText/preview/adapterRef/handle/native path/bytes/token/checkpoint", () => {
    const task = makeTask();
    const record = sanitizeConversation({
      id: "conv-1",
      title: "对话",
      createdAt: "2026-08-13T10:00:00.000Z",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      messages: [
        makeView({ role: "user", content: "帮我生成文件" }),
        makeView({
          computerTask: task,
          historyComputerTask: undefined,
        }),
      ],
      manualRefs: [],
      entryRefs: [],
    });

    const persisted = record.messages[1].computerTask;
    expect(persisted).toBeDefined();
    const serialized = JSON.stringify(persisted);
    // 敏感数据绝不落库
    expect(serialized).not.toContain("preview");
    expect(serialized).not.toContain("before");
    expect(serialized).not.toContain("review");
    expect(serialized).not.toContain("adapterRef");
    expect(serialized).not.toContain("FileSystemDirectoryHandle");
    expect(serialized).not.toContain("native");
    expect(serialized).not.toContain("bytes");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("checkpoint");
    expect(serialized).not.toContain("beforeText");
    expect(serialized).not.toContain("secret preview");
    // 展示事实保留
    expect(persisted?.changes[0].displayName).toBe("notes.md");
    expect(persisted?.changes[0].workspaceLabel).toBe("论文研究");
    expect(persisted?.changes[0].relativePath).toBe("notes.md");
    expect(persisted?.status).toBe("completed");
  });

  it("assistant 消息只有 Computer Task（无文本/actions）也必须保留", () => {
    const record = sanitizeConversation({
      id: "conv-2",
      title: "对话",
      createdAt: "2026-08-13T10:00:00.000Z",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      messages: [
        makeView({ role: "user", content: "生成文档" }),
        makeView({ computerTask: makeTask() }),
      ],
      manualRefs: [],
      entryRefs: [],
    });
    expect(record.messages.length).toBe(2);
  });

  it("running 状态不落库（收尾为 completed）", () => {
    const task = makeTask();
    task.status = "running";
    const record = sanitizeConversation({
      id: "conv-3",
      title: "对话",
      createdAt: "2026-08-13T10:00:00.000Z",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      messages: [makeView({ role: "user", content: "x" }), makeView({ computerTask: task })],
      manualRefs: [],
      entryRefs: [],
    });
    expect(record.messages[1].computerTask?.status).toBe("completed");
  });

  it("restored history task 原样透传（不重建 checkpoint）", () => {
    const record = sanitizeConversation({
      id: "conv-4",
      title: "对话",
      createdAt: "2026-08-13T10:00:00.000Z",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      messages: [
        makeView({ role: "user", content: "x" }),
        makeView({
          historyComputerTask: {
            taskId: "task-hist",
            title: "工作区文件操作",
            status: "undone",
            changes: [
              {
                operation: "modify",
                resourceType: "text",
                displayName: "notes.md",
                workspaceLabel: "论文研究",
                rootLabel: "输出",
                relativePath: "notes.md",
                verification: "passed",
              },
            ],
            startedAt: "2026-08-13T10:00:00.000Z",
          },
        }),
      ],
      manualRefs: [],
      entryRefs: [],
    });
    expect(record.messages[1].computerTask?.taskId).toBe("task-hist");
    expect(record.messages[1].computerTask?.status).toBe("undone");
  });
});

describe("audit persistence boundary", () => {
  it("510 条只保留 newest 500", async () => {
    for (let i = 0; i < 510; i++) {
      await appendComputerAuditEntry({
        id: `audit-${String(i).padStart(3, "0")}`,
        timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString(),
        taskId: `task-${i}`,
        conversationId: "conv-a",
        toolCallId: `call-${i}`,
        toolName: "patch_text_file",
        capability: "fs.modify",
        decision: "auto",
        outcome: "executed",
        workspaceId: "research",
        workspaceLabel: "论文研究",
        rootId: "output",
        rootLabel: "输出",
        relativePath: "notes.md",
        verification: "passed",
      });
    }
    const recent = await getRecentComputerAuditEntries(COMPUTER_AUDIT_MAX_ENTRIES + 100);
    expect(recent.length).toBe(500);
    // newest 500：audit-010..audit-509
    expect(recent[0].id).toBe("audit-509");
    expect(recent[recent.length - 1].id).toBe("audit-010");
    expect(recent.some((e) => e.id === "audit-009")).toBe(false);
  });

  it("clear 只清 audit（不影响 sandbox 数据）", async () => {
    await appendComputerAuditEntry({
      id: "audit-1",
      timestamp: new Date().toISOString(),
      taskId: "t1",
      conversationId: "c1",
      toolCallId: "call1",
      toolName: "create_text_file",
      capability: "fs.create",
      decision: "auto",
      outcome: "executed",
      workspaceId: "w1",
      workspaceLabel: "工作区",
      relativePath: "a.md",
      verification: "passed",
    });
    await clearComputerAuditEntries();
    expect(await getRecentComputerAuditEntries(10)).toEqual([]);
  });

  it("audit 记录只含 metadata（无 content/bytes/token）", async () => {
    const entry: ComputerAuditEntry = {
      id: "audit-meta",
      timestamp: new Date().toISOString(),
      taskId: "t1",
      conversationId: "c1",
      toolCallId: "call1",
      toolName: "patch_text_file",
      capability: "fs.modify",
      decision: "allow-once",
      outcome: "executed",
      workspaceId: "w1",
      workspaceLabel: "工作区",
      rootId: "r1",
      rootLabel: "根",
      relativePath: "notes.md",
      verification: "passed",
    };
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("content");
    expect(serialized).not.toContain("beforeText");
    expect(serialized).not.toContain("bytes");
    expect(serialized).not.toContain("handle");
    expect(serialized).not.toContain("token");
  });
});
