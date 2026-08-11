import { describe, it, expect } from "vitest";
import { splitKiroStreamingMarkdown } from "@/lib/ai/streaming/markdownBlocks";

describe("splitKiroStreamingMarkdown", () => {
  it("普通两段：第一段稳定，第二段未闭合 → Active Tail", () => {
    const r = splitKiroStreamingMarkdown("第一段内容\n\n第二段开头", true);
    expect(r.stableBlocks).toEqual(["第一段内容"]);
    expect(r.tail).toBe("第二段开头");
  });

  it("多段：每个空行边界都稳定一段，尾部保留最后未闭合段落", () => {
    const r = splitKiroStreamingMarkdown("A\n\nB\n\nC 未完", true);
    expect(r.stableBlocks).toEqual(["A", "B"]);
    expect(r.tail).toBe("C 未完");
  });

  it("open code fence：fence 内空行不 split（tail 保留整段）", () => {
    const r = splitKiroStreamingMarkdown("```ts\nline1\n\nline2\n```\n未结束", true);
    expect(r.stableBlocks).toEqual([]);
    expect(r.tail).toBe("```ts\nline1\n\nline2\n```\n未结束");
  });

  it("open code fence：fence 前已稳定的段落仍稳定", () => {
    const r = splitKiroStreamingMarkdown("前言\n\n```ts\nline1\n\nline2", true);
    expect(r.stableBlocks).toEqual(["前言"]);
    expect(r.tail).toBe("```ts\nline1\n\nline2");
  });

  it("closed code fence：完整 code block 可稳定", () => {
    const r = splitKiroStreamingMarkdown("```ts\na\n```\n\n后续", true);
    expect(r.stableBlocks).toEqual(["```ts\na\n```"]);
    expect(r.tail).toBe("后续");
  });

  it("open $$ display math：未闭合前不 split（含内部空行）", () => {
    const r = splitKiroStreamingMarkdown("$$\nE = mc^2\n\n还有公式内容", true);
    expect(r.stableBlocks).toEqual([]);
    expect(r.tail).toBe("$$\nE = mc^2\n\n还有公式内容");
  });

  it("closed $$ display math：完整 math block 可稳定", () => {
    const r = splitKiroStreamingMarkdown("$$\nE = mc^2\n\n$$\n\n结论", true);
    expect(r.stableBlocks).toEqual(["$$\nE = mc^2\n\n$$"]);
    expect(r.tail).toBe("结论");
  });

  it("fence 内的 $$ 不当作 display math", () => {
    const r = splitKiroStreamingMarkdown("```\n$$\nx\n\n$$\n```\n\n后续", true);
    expect(r.stableBlocks).toEqual(["```\n$$\nx\n\n$$\n```"]);
    expect(r.tail).toBe("后续");
  });

  it("streaming=false：全部内容升级成 stable，tail 清空", () => {
    const r = splitKiroStreamingMarkdown("第一段\n\n```ts\nopen", false);
    expect(r.stableBlocks).toEqual(["第一段\n\n```ts\nopen"]);
    expect(r.tail).toBe("");
  });

  it("空内容 / 无边界：stable 为空，全部进入 tail", () => {
    expect(splitKiroStreamingMarkdown("", true)).toEqual({ stableBlocks: [], tail: "" });
    const r = splitKiroStreamingMarkdown("只有一段没有空行", true);
    expect(r.stableBlocks).toEqual([]);
    expect(r.tail).toBe("只有一段没有空行");
  });
});
