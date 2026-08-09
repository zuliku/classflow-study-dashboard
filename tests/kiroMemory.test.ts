import { describe, it, expect, beforeEach } from "vitest";
import { resetKiroDbForTests } from "@/lib/ai/storage/kiroDb";
import {
  normalizeMemoryText,
  sanitizeMemoryContent,
  saveMemory,
  listMemories,
  getMemory,
  updateMemory,
  deleteMemory,
  clearMemories,
} from "@/lib/ai/memory/db";
import { hasExplicitMemoryIntent, isMemoryEligible, isMemoryStale, buildMemoryIndex, searchMemoriesByKeyword } from "@/lib/ai/memory/manager";
import { MAX_MEMORIES } from "@/lib/ai/memory/types";
import { KiroMemory } from "@/lib/ai/memory/types";

const STATE = {
  semester: { id: "2026S1" },
  courses: [{ id: "c1" }, { id: "c2" }],
} as never;

beforeEach(async () => {
  resetKiroDbForTests();
  await clearMemories().catch(() => {});
});

describe("normalizeMemoryText / sanitizeMemoryContent", () => {
  it("归一化：trim + 压缩空白 + 小写", () => {
    expect(normalizeMemoryText("  我一般  晚上  学习  ")).toBe("我一般 晚上 学习");
    expect(normalizeMemoryText("Study At Night")).toBe("study at night");
  });

  it("明显 secret（sk- / blob / storageKey / password / token）被拒绝", () => {
    expect(sanitizeMemoryContent("我的 key 是 sk-abc123xyz，不要外泄")).toBeNull();
    expect(sanitizeMemoryContent("blob:https://x/abc123")).toBeNull();
    expect(sanitizeMemoryContent('storageKey: "abc-123"')).toBeNull();
    expect(sanitizeMemoryContent('password = "hunter2"')).toBeNull();
    expect(sanitizeMemoryContent("token=verylongtokensecret")).toBeNull();
    expect(sanitizeMemoryContent("我一般晚上学习")).toBe("我一般晚上学习");
  });

  it("内容截断到 MAX_MEMORY_CONTENT", () => {
    const long = "x".repeat(700);
    expect(sanitizeMemoryContent(long)!.length).toBe(500);
  });
});

describe("saveMemory", () => {
  it("保存成功：默认 category/scope、自动标题", async () => {
    const r = await saveMemory({ content: "  我一般晚上学习  " });
    expect(r.created).toBe(true);
    expect(r.memory.content).toBe("我一般晚上学习");
    expect(r.memory.category).toBe("other");
    expect(r.memory.scope).toBe("global");
    expect(r.memory.scopeId).toBeUndefined();
    expect(r.memory.title.length).toBeGreaterThan(0);
  });

  it("去重：同 category+scope+scopeId+normalized content → created:false", async () => {
    await saveMemory({ content: "我一般晚上学习" });
    const dup = await saveMemory({ content: "  我一般晚上学习  " });
    expect(dup.created).toBe(false);
    expect(await listMemories()).toHaveLength(1);
  });

  it("不同 scopeId 不算重复", async () => {
    await saveMemory({ content: "老师强调考试", scope: "course", scopeId: "c1" });
    const r = await saveMemory({ content: "老师强调考试", scope: "course", scopeId: "c2" });
    expect(r.created).toBe(true);
  });

  it("敏感内容拒绝：MEMORY_SENSITIVE_CONTENT", async () => {
    const r = await saveMemory({ content: "我的 sk-abc123xyz key" });
    expect(r.created).toBe(false);
    expect(r.code).toBe("MEMORY_SENSITIVE_CONTENT");
    expect(await listMemories()).toHaveLength(0);
  });

  it("数量上限：MAX_MEMORIES 时拒绝且不静默覆盖", async () => {
    for (let i = 0; i < MAX_MEMORIES; i++) {
      await saveMemory({ content: `偏好 ${i}` });
    }
    const r = await saveMemory({ content: "第 51 条" });
    expect(r.created).toBe(false);
    expect(r.code).toBe("MEMORY_LIMIT_REACHED");
    expect((await listMemories()).length).toBe(MAX_MEMORIES);
  });
});

describe("CRUD", () => {
  it("list 按 updatedAt DESC；get / update / delete / clear", async () => {
    await saveMemory({ content: "旧偏好" });
    await new Promise((r) => setTimeout(r, 10));
    const newer = await saveMemory({ content: "新偏好" });
    const list = await listMemories();
    expect(list.map((m) => m.id)).toEqual([newer.memory.id, list.find((m) => m.id !== newer.memory.id)!.id]);

    expect(await getMemory("nope")).toBeNull();
    const m = (await getMemory(newer.memory.id))!;
    expect(m.title).toBeTruthy();

    const up = await updateMemory(newer.memory.id, { scope: "course", scopeId: "c1", title: "新标题" });
    expect(up.ok).toBe(true);
    const after = (await getMemory(newer.memory.id))!;
    expect(after.title).toBe("新标题");
    expect(after.scope).toBe("course");
    expect(after.scopeId).toBe("c1");

    const g = await updateMemory(newer.memory.id, { scope: "global" });
    expect(g.ok).toBe(true);
    expect((await getMemory(newer.memory.id))!.scopeId).toBeUndefined();

    const sensitive = await updateMemory(newer.memory.id, { content: "password = secret123" });
    expect(sensitive.ok).toBe(false);
    expect(sensitive.code).toBe("MEMORY_SENSITIVE_CONTENT");

    const missing = await updateMemory("nope", { title: "x" });
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe("NOT_FOUND");

    await deleteMemory(newer.memory.id);
    expect(await getMemory(newer.memory.id)).toBeNull();

    await clearMemories();
    expect(await listMemories()).toEqual([]);
  });
});

describe("hasExplicitMemoryIntent", () => {
  it("明确「记住」类表达为 true", () => {
    expect(hasExplicitMemoryIntent("记住我一般晚上学习")).toBe(true);
    expect(hasExplicitMemoryIntent("请记住我的偏好是周末写作业")).toBe(true);
    expect(hasExplicitMemoryIntent("以后都优先完成数学作业")).toBe(true);
    expect(hasExplicitMemoryIntent("别忘了周二开会")).toBe(true);
    expect(hasExplicitMemoryIntent("remember to review before exams")).toBe(true);
  });

  it("无明确意图为 false", () => {
    expect(hasExplicitMemoryIntent("帮我安排一下今天的任务")).toBe(false);
    expect(hasExplicitMemoryIntent("")).toBe(false);
  });
});

describe("isMemoryEligible / isMemoryStale / buildMemoryIndex", () => {
  const mem = (over: Partial<KiroMemory>): KiroMemory => ({
    id: "m1", title: "t", content: "c", category: "other", scope: "global", active: true, createdAt: "", updatedAt: "", ...over,
  });

  it("global 恒可用；course 需课程存在；semester 需匹配当前学期", () => {
    expect(isMemoryEligible(mem({ scope: "global" }), STATE)).toBe(true);
    expect(isMemoryEligible(mem({ scope: "course", scopeId: "c1" }), STATE)).toBe(true);
    expect(isMemoryEligible(mem({ scope: "course", scopeId: "gone" }), STATE)).toBe(false);
    expect(isMemoryEligible(mem({ scope: "course" }), STATE)).toBe(false);
    expect(isMemoryEligible(mem({ scope: "semester", scopeId: "2026S1" }), STATE)).toBe(true);
    expect(isMemoryEligible(mem({ scope: "semester", scopeId: "2025S2" }), STATE)).toBe(false);
    expect(isMemoryEligible(mem({ scope: "semester" }), STATE)).toBe(false);
    expect(isMemoryEligible(mem({ scope: "global", active: false }), STATE)).toBe(false);
  });

  it("stale 判定：课程已删 / 学期已过", () => {
    expect(isMemoryStale(mem({ scope: "course", scopeId: "gone" }), STATE)).toBe(true);
    expect(isMemoryStale(mem({ scope: "course", scopeId: "c2" }), STATE)).toBe(false);
    expect(isMemoryStale(mem({ scope: "semester", scopeId: "2025S2" }), STATE)).toBe(true);
    expect(isMemoryStale(mem({ scope: "global" }), STATE)).toBe(false);
  });

  it("buildMemoryIndex：过滤 stale/disabled，不含 content，上限 20", async () => {
    for (let i = 0; i < 22; i++) {
      await saveMemory({ content: `偏好 ${i}`, scope: "global" });
    }
    await saveMemory({ content: "已删课程的偏好", scope: "course", scopeId: "gone" });
    const index = await buildMemoryIndex(STATE);
    expect(index).toHaveLength(20);
    expect(index.every((e) => !("content" in e))).toBe(true);
    expect(index.some((e) => e.title.includes("已删课程"))).toBe(false);
  });
});

describe("searchMemoriesByKeyword", () => {
  const mems: KiroMemory[] = [
    { id: "1", title: "晚上学习", content: "一般 21:00 后效率高", category: "study-habit", scope: "global", active: true, createdAt: "", updatedAt: "" },
    { id: "2", title: "周末安排", content: "作业集中在周末完成", category: "schedule-preference", scope: "course", scopeId: "c1", active: true, createdAt: "", updatedAt: "" },
    { id: "3", title: "数学优先", content: "先做数学作业", category: "priority-preference", scope: "semester", scopeId: "2026S1", tags: ["math"], active: true, createdAt: "", updatedAt: "" },
  ];

  it("query 匹配 title/content/tags（忽略空白与大小写）", () => {
    expect(searchMemoriesByKeyword(mems, { query: " 晚上 " }).map((m) => m.id)).toEqual(["1"]);
    expect(searchMemoriesByKeyword(mems, { query: "math" }).map((m) => m.id)).toEqual(["3"]);
    expect(searchMemoriesByKeyword(mems, { query: "作业" }).map((m) => m.id).sort()).toEqual(["2", "3"]);
  });

  it("category / scope 过滤 + limit", () => {
    expect(searchMemoriesByKeyword(mems, { category: "study-habit" }).map((m) => m.id)).toEqual(["1"]);
    expect(searchMemoriesByKeyword(mems, { scope: "course" }).map((m) => m.id)).toEqual(["2"]);
    expect(searchMemoriesByKeyword(mems, { limit: 2 })).toHaveLength(2);
  });
});
