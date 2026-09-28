import { describe, it, expect, beforeEach } from "vitest";
import { tokenizeMemoryQuery, recallMemoryCandidates } from "@/lib/ai/memory/recall";
import {
  parseRerankOutput,
  searchMemoriesTwoStage,
  clearRerankCacheForTests,
  getRerankCacheSizeForTests,
  MEMORY_RERANK_MIN_CANDIDATES,
} from "@/lib/ai/memory/rerank";
import type { KiroMemory } from "@/lib/ai/memory/types";

const mem = (over: Partial<KiroMemory> = {}): KiroMemory => ({
  id: "m1",
  title: "偏好",
  content: "内容",
  category: "study-habit",
  scope: "global",
  active: true,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

describe("tokenizeMemoryQuery（中英混排）", () => {
  it("拉丁词 + CJK bigram，去重", () => {
    expect(tokenizeMemoryQuery("npm test 偏好设置")).toContain("npm");
    expect(tokenizeMemoryQuery("npm test 偏好设置")).toContain("test");
    expect(tokenizeMemoryQuery("偏好设置")).toEqual(["偏好", "好设", "设置"]);
    expect(tokenizeMemoryQuery("a 我 b")).toEqual([]);
    expect(tokenizeMemoryQuery("")).toEqual([]);
  });
});

describe("recallMemoryCandidates（OR 召回）", () => {
  const corpus = [
    mem({ id: "a", title: "早起背单词", content: "每天六点起床背英语单词", updatedAt: "2026-09-03T00:00:00.000Z" }),
    mem({ id: "b", title: "午休习惯", content: "中午休息半小时", updatedAt: "2026-09-02T00:00:00.000Z" }),
    mem({ id: "c", title: "英语考试目标", content: "通过六级考试", updatedAt: "2026-09-01T00:00:00.000Z" }),
  ];
  it("OR 语义：命中任一 token 即召回；多命中排序靠前", () => {
    const out = recallMemoryCandidates(corpus, { query: "英语 单词" });
    expect(out.map((c) => c.memory.id)).toEqual(["a", "c"]);
    expect(out[0].score).toBeGreaterThan(out[1].score);
  });
  it("空 query 返回全部（score 0）；category/scope 过滤；limit 截断", () => {
    expect(recallMemoryCandidates(corpus, {}).map((c) => c.memory.id)).toEqual(["a", "b", "c"]);
    expect(recallMemoryCandidates(corpus, { query: "休息", scope: "course" })).toEqual([]);
    expect(recallMemoryCandidates(corpus, { query: "的", limit: 1 })).toHaveLength(1);
  });
  it("旧关键词函数语义不受影响（去空白 substring；调用方众多，保持不动）", async () => {
    const { searchMemoriesByKeyword } = await import("@/lib/ai/memory/manager");
    // 注意：normalize 去掉全部空白后包含匹配，"英语 单词"→"英语单词"仍命中 a
    expect(searchMemoriesByKeyword(corpus, { query: "英语 单词" }).map((m) => m.id)).toEqual(["a"]);
    expect(searchMemoriesByKeyword(corpus, { query: "英语" }).map((m) => m.id)).toEqual(["a", "c"]);
  });
});

describe("parseRerankOutput", () => {
  it("合法 JSON → 保序交集", () => {
    expect(parseRerankOutput('{"orderedIds":["b","a"]}', ["a", "b", "c"])).toEqual(["b", "a"]);
    expect(parseRerankOutput('```json\n{"orderedIds":["c","a"]}\n```', ["a", "c"])).toEqual(["c", "a"]);
  });
  it("非法/未知 id/重复/空 → 防御", () => {
    expect(parseRerankOutput("not json", ["a"])).toBeNull();
    expect(parseRerankOutput('{"orderedIds":[]}', ["a"])).toBeNull();
    expect(parseRerankOutput('{"x":1}', ["a"])).toBeNull();
    expect(parseRerankOutput('{"orderedIds":["zzz"]}', ["a"])).toBeNull();
    expect(parseRerankOutput('{"orderedIds":["a","a","b"]}', ["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("searchMemoriesTwoStage", () => {
  beforeEach(() => clearRerankCacheForTests());
  // a/c/d/e 均命中"英语学习"（英语×2 + 学习×2）→ 4 候选 ≥ 阈值，触发重排
  const corpus = [
    mem({ id: "a", title: "早起背单词", content: "每天六点起床背英语单词" }),
    mem({ id: "b", title: "午休习惯", content: "中午休息半小时" }),
    mem({ id: "c", title: "英语考试目标", content: "通过六级考试" }),
    mem({ id: "d", title: "数学学习计划", content: "微积分习题每天练习" }),
    mem({ id: "e", title: "语文学习习惯", content: "文言文背诵" }),
  ];
  it(`候选 < ${MEMORY_RERANK_MIN_CANDIDATES} → 跳过重排（路由不被调用）`, async () => {
    let called = 0;
    const out = await searchMemoriesTwoStage({
      query: "微积分",
      memories: corpus,
      provider: "p",
      model: "m",
      routeCaller: async () => {
        called += 1;
        return { orderedIds: [] };
      },
    });
    expect(out.map((m) => m.id)).toEqual(["d"]);
    expect(called).toBe(0);
  });
  it("重排成功 → 模型序；未覆盖候选按召回序补尾；limit 截断", async () => {
    const full = await searchMemoriesTwoStage({
      query: "英语学习",
      memories: corpus,
      limit: 4,
      provider: "p",
      model: "m",
      routeCaller: async () => ({ orderedIds: ["e", "c"] }),
    });
    // 召回序 a,c,d,e（同分→id 序）；模型序 e,c 在前，未覆盖 a,d 补尾
    expect(full.map((m) => m.id)).toEqual(["e", "c", "a", "d"]);
    const top2 = await searchMemoriesTwoStage({
      query: "英语学习",
      memories: corpus,
      limit: 2,
      provider: "p",
      model: "m",
      routeCaller: async () => ({ orderedIds: ["e", "c"] }),
    });
    expect(top2.map((m) => m.id)).toEqual(["e", "c"]);
  });
  it("重排失败 → 降级召回序；失败不缓存", async () => {
    let called = 0;
    const args = {
      query: "英语学习",
      memories: corpus,
      provider: "p",
      model: "m",
      routeCaller: async () => {
        called += 1;
        return { orderedIds: null as string[] | null };
      },
    };
    const out1 = await searchMemoriesTwoStage(args);
    expect(out1.length).toBeGreaterThan(0);
    expect(called).toBe(1);
    // 失败不缓存 → 第二次仍调用但同样降级
    await searchMemoriesTwoStage(args);
    expect(called).toBe(2);
    expect(getRerankCacheSizeForTests()).toBe(0);
  });
  it("重排成功缓存；无模型信息跳过重排", async () => {
    let called = 0;
    const base = {
      query: "英语学习",
      memories: corpus,
      provider: "p",
      model: "m",
      routeCaller: async () => {
        called += 1;
        return { orderedIds: ["b", "a", "c"] };
      },
    };
    await searchMemoriesTwoStage(base);
    await searchMemoriesTwoStage(base);
    expect(called).toBe(1);
    expect(getRerankCacheSizeForTests()).toBe(1);
    let noModelCalled = 0;
    await searchMemoriesTwoStage({
      query: "英语学习",
      memories: corpus,
      routeCaller: async () => {
        noModelCalled += 1;
        return { orderedIds: ["a"] };
      },
    });
    expect(noModelCalled).toBe(0);
  });
});
