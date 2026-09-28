import { describe, it, expect } from "vitest";
import { handleMemoryRerank } from "@/app/api/ai/memory-rerank/route";

const post = (body: unknown) =>
  handleMemoryRerank(
    new Request("http://127.0.0.1/api/ai/memory-rerank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

describe("handleMemoryRerank（网关校验；失败一律可降级）", () => {
  it("非法 JSON → 400", async () => {
    const res = await post("{bad json");
    expect(res.status).toBe(400);
  });
  it("缺字段/超限候选 → 400（不触及 LLM）", async () => {
    const missing = await post({ query: "x" });
    expect(missing.status).toBe(400);
    const tooMany = await post({
      invocationId: "inv-1",
      provider: "p",
      model: "m",
      apiKey: "k",
      query: "x",
      candidates: Array.from({ length: 11 }, (_, i) => ({ id: `c${i}`, title: "t", content: "c", category: "other" })),
    });
    expect(tooMany.status).toBe(400);
    const emptyQuery = await post({
      invocationId: "inv-1",
      provider: "p",
      model: "m",
      apiKey: "k",
      query: "  ",
      candidates: [{ id: "c1", title: "t", content: "c", category: "other" }],
    });
    expect(emptyQuery.status).toBe(400);
  });
});
