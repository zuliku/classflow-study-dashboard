import { describe, it, expect } from "vitest";
import {
  matchConversation,
  filterConversations,
  groupThreadsByRecency,
} from "@/lib/ai/history/search";
import type { KiroConversationRecord } from "@/lib/ai/history/types";

function thread(overrides: Partial<KiroConversationRecord> = {}): KiroConversationRecord {
  return {
    id: "t1",
    title: "高数作业讨论",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provider: "opencode-go",
    model: "m",
    messages: [],
    manualRefs: [],
    entryRefs: [],
    ...overrides,
  };
}

describe("历史搜索（标题/摘要/正文）", () => {
  it("标题命中优先，无 excerpt", () => {
    const m = matchConversation(thread(), "高数");
    expect(m?.kind).toBe("title");
    expect(m?.excerpt).toBeUndefined();
  });

  it("标题无命中时搜摘要并给 excerpt", () => {
    const m = matchConversation(
      thread({
        title: "闲聊",
        summary: { version: 1, text: "讨论了 DDL 延期到周五", throughMessageId: "x", updatedAt: "" },
      }),
      "DDL"
    );
    expect(m?.kind).toBe("summary");
    expect(m?.excerpt).toContain("DDL");
  });

  it("摘要无命中时搜正文（用户/助手均可），excerpt 带角色前缀", () => {
    const m = matchConversation(
      thread({
        title: "闲聊",
        messages: [
          { id: "m1", role: "user", content: "帮我看看这个文件怎么了" } as never,
          { id: "m2", role: "assistant", content: "看起来没问题" } as never,
        ],
      }),
      "文件"
    );
    expect(m?.kind).toBe("content");
    expect(m?.excerpt).toContain("你：");
  });

  it("大小写不敏感；空 query 返回 null", () => {
    expect(matchConversation(thread({ title: "Hello World" }), "hello")?.kind).toBe("title");
    expect(matchConversation(thread(), "   ")).toBeNull();
  });

  it("filterConversations 保持原顺序", () => {
    const a = thread({ id: "a", title: "AAA 笔记" });
    const b = thread({ id: "b", title: "BBB 笔记" });
    const out = filterConversations([b, a], "笔记");
    expect(out.map((o) => o.thread.id)).toEqual(["b", "a"]);
  });
});

describe("最近分组（今天/昨天/更早）", () => {
  const day = 86_400_000;
  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString();

  it("按 updatedAt 分组，空组省略", () => {
    const groups = groupThreadsByRecency([
      thread({ id: "old", updatedAt: iso(now - 5 * day) }),
      thread({ id: "today", updatedAt: iso(now) }),
      thread({ id: "yesterday", updatedAt: iso(now - day) }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["今天", "昨天", "更早"]);
    expect(groups[0].items.map((t) => t.id)).toEqual(["today"]);
  });

  it("非法日期进更早，不丢记录", () => {
    const groups = groupThreadsByRecency([thread({ id: "bad", updatedAt: "not-a-date" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("更早");
  });
});
