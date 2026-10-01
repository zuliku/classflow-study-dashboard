/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  APPROVAL_TIMEOUT_MS,
  writePendingApprovalSnapshot,
  readPendingApprovalSnapshot,
  clearPendingApprovalSnapshot,
  reconcileStaleApprovalSnapshot,
  type PendingApprovalSnapshot,
} from "@/lib/ai/computer/pendingApprovalSnapshot";
import { saveConversation, getConversation } from "@/lib/ai/history/db";
import { resetKiroDbForTests } from "@/lib/ai/storage/kiroDb";
import type { KiroConversationRecord } from "@/lib/ai/history/types";

/**
 * S-fix（P0-2）：审批内存落盘 —— 刷新不再卡死。
 * 快照 + 开机对账：快照仍在说明上次死在等待中 → owning 会话补中断说明 → 清快照。
 */
function snapshot(over: Partial<PendingApprovalSnapshot> = {}): PendingApprovalSnapshot {
  return {
    version: 1,
    approvalId: "appr-1",
    conversationId: "conv-1",
    taskId: "task-1",
    toolName: "terminal.execute",
    title: "Kiro 准备运行命令",
    createdAt: Date.now(),
    ...over,
  };
}

function seedConversation(id = "conv-1"): KiroConversationRecord {
  return {
    id,
    title: "测试对话",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    provider: "opencode-go",
    model: "m1",
    messages: [{ id: "u1", role: "user", content: "帮我看看" }],
    manualRefs: [],
    entryRefs: [],
  };
}

beforeEach(async () => {
  clearPendingApprovalSnapshot();
  resetKiroDbForTests();
});

describe("快照读写", () => {
  it("roundtrip：write → read 相等；clear → null", () => {
    // 同一快照对象断言（此前两次 snapshot() 各取一次 Date.now()，跨毫秒即 flaky）
    const s = snapshot();
    writePendingApprovalSnapshot(s);
    expect(readPendingApprovalSnapshot()).toEqual(s);
    clearPendingApprovalSnapshot();
    expect(readPendingApprovalSnapshot()).toBeNull();
  });

  it("损坏 JSON / 错误 shape → null（不抛错）", () => {
    localStorage.setItem("classflow-kiro-pending-approval-v1", "{bad json");
    expect(readPendingApprovalSnapshot()).toBeNull();
    localStorage.setItem("classflow-kiro-pending-approval-v1", JSON.stringify({ version: 1 }));
    expect(readPendingApprovalSnapshot()).toBeNull();
    clearPendingApprovalSnapshot();
  });

  it("APPROVAL_TIMEOUT_MS = 3 分钟（与超时 effect 同源）", () => {
    expect(APPROVAL_TIMEOUT_MS).toBe(3 * 60 * 1000);
  });
});

describe("开机对账", () => {
  it("无快照 → false（无事发生）", async () => {
    await expect(reconcileStaleApprovalSnapshot()).resolves.toBe(false);
  });

  it("有快照 → owning 会话追加中断说明 + 清快照 + true", async () => {
    await saveConversation(seedConversation());
    writePendingApprovalSnapshot(snapshot());
    await expect(reconcileStaleApprovalSnapshot()).resolves.toBe(true);
    const record = await getConversation("conv-1");
    const note = record!.messages[record!.messages.length - 1];
    expect(note.id).toBe("interrupted-appr-1");
    expect(note.role).toBe("assistant");
    expect(note.content).toContain("未能完成");
    expect(note.content).toContain("Kiro 准备运行命令");
    expect(readPendingApprovalSnapshot()).toBeNull();
  });

  it("owning 会话已删 → 仅清快照，不抛错", async () => {
    writePendingApprovalSnapshot(snapshot({ conversationId: "gone" }));
    await expect(reconcileStaleApprovalSnapshot()).resolves.toBe(true);
    expect(readPendingApprovalSnapshot()).toBeNull();
  });

  it("幂等：跑两次只补一条（StrictMode 双挂载安全）", async () => {
    await saveConversation(seedConversation());
    writePendingApprovalSnapshot(snapshot());
    await reconcileStaleApprovalSnapshot();
    // 第二次无快照直接返回；手动再写同一快照模拟重复调用
    writePendingApprovalSnapshot(snapshot());
    await reconcileStaleApprovalSnapshot();
    const record = await getConversation("conv-1");
    const notes = record!.messages.filter((m) => m.id === "interrupted-appr-1");
    expect(notes).toHaveLength(1);
  });

  it("超过超时阈值的快照 → “超时自动取消”文案", async () => {
    await saveConversation(seedConversation());
    writePendingApprovalSnapshot(
      snapshot({ createdAt: Date.now() - APPROVAL_TIMEOUT_MS - 1000 })
    );
    await reconcileStaleApprovalSnapshot();
    const record = await getConversation("conv-1");
    const note = record!.messages[record!.messages.length - 1];
    expect(note.content).toContain("超时自动取消");
  });
});
