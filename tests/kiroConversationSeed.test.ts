import { describe, it, expect } from "vitest";
import { buildConversationSeed, ensureConversationSeed, ConversationSeedHolder } from "@/lib/ai/history/conversationSeed";

/**
 * Task 7A 回归边界：Chat Surface 使用的 send 必须具备 Conversation lifecycle。
 * 回归根因：KiroChatSurface 从 Runtime Context 拿到 raw send，绕过 sendWithTurn
 * → 首条消息永远不创建 conversationId → persistCurrent 不落盘 → 新会话后旧对话“消失”。
 * 本测试验证生命周期播种逻辑（Provider 唯一数据入口依赖的 seam）。
 */

const NOW = () => new Date("2026-08-10T12:00:00Z");

function makeHolder(id: string | null = null): ConversationSeedHolder {
  return { id, title: null, createdAt: null };
}

describe("ensureConversationSeed / buildConversationSeed", () => {
  it("用户首次 send：创建 conversationId + title + createdAt（不再为 null）", () => {
    const holder = makeHolder();
    const created = ensureConversationSeed(holder, "帮我拆解这个任务", { now: NOW, randomId: () => "conv-1" });
    expect(created).toBe(true);
    expect(holder.id).toBe("conv-1");
    expect(holder.title).toBe("帮我拆解这个任务");
    expect(holder.createdAt).toBe("2026-08-10T12:00:00.000Z");
  });

  it("同一会话再次 send：不重建 conversationId（幂等）", () => {
    const holder = makeHolder("conv-existing");
    const created = ensureConversationSeed(holder, "继续", { now: NOW, randomId: () => "conv-new" });
    expect(created).toBe(false);
    expect(holder.id).toBe("conv-existing");
    expect(holder.title).toBeNull(); // 已有会话不改标题
  });

  it("第二个 conversation 获得不同 ID（New Chat 后不继承旧 ID）", () => {
    const a = makeHolder();
    ensureConversationSeed(a, "对话 A", { now: NOW, randomId: () => "conv-a" });
    // New Chat → 全新 holder（provider 侧清空 conversationIdRef）
    const b = makeHolder();
    ensureConversationSeed(b, "对话 B", { now: NOW, randomId: () => "conv-b" });
    expect(a.id).toBe("conv-a");
    expect(b.id).toBe("conv-b");
    expect(a.id).not.toBe(b.id);
  });

  it("title 由首条消息自动生成（buildAutoTitle 截断语义）", () => {
    const seed = buildConversationSeed("这个任务需要拆解成多个可以并行推进的步骤并且估算每一步的耗时以及风险", {
      now: NOW,
      randomId: () => "conv-x",
    });
    expect(seed.title.length).toBe(32); // 30 字 + 省略号（……）
    expect(seed.title.endsWith("……")).toBe(true);
    expect(seed.id).toBe("conv-x");
    expect(seed.createdAt).toBe("2026-08-10T12:00:00.000Z");
  });

  it("缺省 deps：真实时间 + 随机 UUID（不为空）", () => {
    const holder = makeHolder();
    ensureConversationSeed(holder, "测试");
    expect(holder.id).toBeTruthy();
    expect(holder.title).toBe("测试");
    expect(holder.createdAt).toBeTruthy();
  });
});
