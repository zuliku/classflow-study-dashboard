import { describe, it, expect } from "vitest";
import {
  splitKiroStreamingMarkdown,
  splitKiroInlineParagraph,
  KIRO_INLINE_TAIL_MAX_CHARS,
} from "@/lib/ai/streaming/markdownBlocks";

describe("splitKiroStreamingMarkdown", () => {
  it("普通两段：第一段稳定，第二段未闭合 → Active Tail（text 态）", () => {
    const r = splitKiroStreamingMarkdown("第一段内容\n\n第二段开头", true);
    expect(r.stableBlocks).toEqual(["第一段内容"]);
    expect(r.tail).toBe("第二段开头");
    expect(r.tailState).toBe("text");
  });

  it("多段：每个空行边界都稳定一段，尾部保留最后未闭合段落", () => {
    const r = splitKiroStreamingMarkdown("A\n\nB\n\nC 未完", true);
    expect(r.stableBlocks).toEqual(["A", "B"]);
    expect(r.tail).toBe("C 未完");
    expect(r.tailState).toBe("text");
  });

  it("closed fence + 后续文本（无空行边界）→ 整段 tail 保留，text 态（完整 code block 由 pipeline 渲染）", () => {
    const r = splitKiroStreamingMarkdown("```ts\nline1\n\nline2\n```\n未结束", true);
    expect(r.stableBlocks).toEqual([]);
    expect(r.tail).toBe("```ts\nline1\n\nline2\n```\n未结束");
    expect(r.tailState).toBe("text");
  });

  it("open code fence：fence 前已稳定的段落仍稳定；未闭合 fence → fence 态", () => {
    const r = splitKiroStreamingMarkdown("前言\n\n```ts\nline1\n\nline2", true);
    expect(r.stableBlocks).toEqual(["前言"]);
    expect(r.tail).toBe("```ts\nline1\n\nline2");
    expect(r.tailState).toBe("fence");
  });

  it("closed code fence：完整 code block 可稳定；尾部无未闭合块级构造 → text 态", () => {
    const r = splitKiroStreamingMarkdown("```ts\na\n```\n\n后续", true);
    expect(r.stableBlocks).toEqual(["```ts\na\n```"]);
    expect(r.tail).toBe("后续");
    expect(r.tailState).toBe("text");
  });

  it("open $$ display math：未闭合前不 split（含内部空行），tailState=math", () => {
    const r = splitKiroStreamingMarkdown("$$\nE = mc^2\n\n还有公式内容", true);
    expect(r.stableBlocks).toEqual([]);
    expect(r.tail).toBe("$$\nE = mc^2\n\n还有公式内容");
    expect(r.tailState).toBe("math");
  });

  it("closed $$ display math：完整 math block 可稳定；尾部 text 态", () => {
    const r = splitKiroStreamingMarkdown("$$\nE = mc^2\n\n$$\n\n结论", true);
    expect(r.stableBlocks).toEqual(["$$\nE = mc^2\n\n$$"]);
    expect(r.tail).toBe("结论");
    expect(r.tailState).toBe("text");
  });

  it("fence 内的 $$ 不当作 display math", () => {
    const r = splitKiroStreamingMarkdown("```\n$$\nx\n\n$$\n```\n\n后续", true);
    expect(r.stableBlocks).toEqual(["```\n$$\nx\n\n$$\n```"]);
    expect(r.tail).toBe("后续");
    expect(r.tailState).toBe("text");
  });

  it("streaming=false：全部内容升级成 stable，tail 清空", () => {
    const r = splitKiroStreamingMarkdown("第一段\n\n```ts\nopen", false);
    expect(r.stableBlocks).toEqual(["第一段\n\n```ts\nopen"]);
    expect(r.tail).toBe("");
    expect(r.tailState).toBe("text");
  });

  it("空内容 / 无边界：stable 为空，全部进入 tail", () => {
    expect(splitKiroStreamingMarkdown("", true)).toEqual({ stableBlocks: [], tail: "", tailState: "text" });
    const r = splitKiroStreamingMarkdown("只有一段没有空行", true);
    expect(r.stableBlocks).toEqual([]);
    expect(r.tail).toBe("只有一段没有空行");
    expect(r.tailState).toBe("text");
  });

  it("单行不闭合代码 fence（```ts 后直接换行继续）→ fence 态", () => {
    const r = splitKiroStreamingMarkdown("```ts\nconst a = 1;", true);
    expect(r.stableBlocks).toEqual([]);
    expect(r.tail).toBe("```ts\nconst a = 1;");
    expect(r.tailState).toBe("fence");
  });
});

describe("splitKiroInlineParagraph（长单段安全增量，Streaming UX V3 Phase 4）", () => {
  function cjkParagraph(length: number): string {
    // 无空行的纯中文长段（最常见场景：CJK 任意字符可切）
    let s = "";
    const unit = "这是一段没有空行的超长中文回答内容用于验证安全增量切分";
    while (s.length < length) s += unit;
    return s.slice(0, length);
  }

  it("短段（≤ max）→ 不切分，全部留在 tail", () => {
    const r = splitKiroInlineParagraph("短回答", 2048);
    expect(r.chunks).toEqual([]);
    expect(r.tail).toBe("短回答");
  });

  it("≥8000 字无空行 CJK 段：stable chunks + tail 拼接还原原文，tail 有明确上界", () => {
    const paragraph = cjkParagraph(8000);
    const r = splitKiroInlineParagraph(paragraph);
    expect(r.chunks.length).toBeGreaterThanOrEqual(3);
    expect(r.tail.length).toBeGreaterThan(0);
    expect(r.tail.length).toBeLessThanOrEqual(KIRO_INLINE_TAIL_MAX_CHARS);
    // 每个 stable chunk 有界（允许构造跨窗的轻微超额；纯文本应严格 ≤ max）
    for (const c of r.chunks) {
      expect(c.length).toBeLessThanOrEqual(KIRO_INLINE_TAIL_MAX_CHARS);
    }
    expect(r.chunks.join("") + r.tail).toBe(paragraph);
  });

  it("长度增长时 chunk 边界确定（前段 chunk 内容不随后续 token 变化）", () => {
    const base = cjkParagraph(5000);
    const r1 = splitKiroInlineParagraph(base);
    const r2 = splitKiroInlineParagraph(base + "继续增长的内容继续增长的内容");
    // 前 len-1 个 chunk 完全一致（已稳定 chunk 不重 parse）
    expect(r2.chunks.slice(0, r1.chunks.length - 1)).toEqual(r1.chunks.slice(0, r1.chunks.length - 1));
  });

  it("不切断 **：**bold** 完整落在同一个 chunk", () => {
    const paragraph = cjkParagraph(2100) + "**重点强调内容**" + cjkParagraph(400);
    const r = splitKiroInlineParagraph(paragraph);
    const joined = r.chunks.join("\u0000");
    // **bold** 不在任何 chunk 边界被切开：构造的起止必须在同一 chunk
    for (const c of r.chunks) {
      const opens = (c.match(/\*\*/g) ?? []).length;
      expect(opens % 2).toBe(0);
    }
    expect(r.chunks.join("") + r.tail).toBe(paragraph);
  });

  it("不切断 `` ` ``：inline code 完整落在同一个 chunk", () => {
    const paragraph = cjkParagraph(2100) + "``const a = 1;`` 与 `b`" + cjkParagraph(300);
    const r = splitKiroInlineParagraph(paragraph);
    for (const c of r.chunks) {
      const ticks = (c.match(/`/g) ?? []).length;
      expect(ticks % 2).toBe(0);
    }
    expect(r.chunks.join("") + r.tail).toBe(paragraph);
  });

  it("不切断 $ 与 $$：行内/独立公式完整落在同一个 chunk", () => {
    const paragraph = cjkParagraph(2100) + "$E=mc^2$ 与 $$\\frac{a}{b}$$" + cjkParagraph(300);
    const r = splitKiroInlineParagraph(paragraph);
    for (const c of r.chunks) {
      const dollars = (c.match(/\$/g) ?? []).length;
      expect(dollars % 2).toBe(0);
    }
    expect(r.chunks.join("") + r.tail).toBe(paragraph);
  });

  it("不切断 link / citation marker", () => {
    const paragraph = cjkParagraph(2100) + "[查看文档](https://example.com/x) 与 [[source:doc-1]]" + cjkParagraph(300);
    const r = splitKiroInlineParagraph(paragraph);
    for (const c of r.chunks) {
      const open = (c.match(/\[/g) ?? []).length;
      const close = (c.match(/\]/g) ?? []).length;
      expect(open).toBe(close);
    }
    expect(r.chunks.join("") + r.tail).toBe(paragraph);
  });

  it("不在 list / heading 行内切（避免假段落 margin）", () => {
    // 无空行的列表段：任何 chunk 边界都不在 marker 行内
    const listParagraph = cjkParagraph(300) + "\n- 第一项内容" + cjkParagraph(1900) + "\n- 第二项内容" + cjkParagraph(500) + "\n## 小结" + cjkParagraph(400);
    const r = splitKiroInlineParagraph(listParagraph);
    for (const c of r.chunks) {
      const lines = c.split("\n");
      // 除首行外，chunk 内部的 marker 行必须完整（行首 marker 不允许成为 chunk 边界）
      for (let i = 1; i < lines.length; i++) {
        expect(lines[i].trimStart()).not.toMatch(/^[-*+]\s/);
      }
    }
    expect(r.chunks.join("") + r.tail).toBe(listParagraph);
  });

  it("Latin 词边界：不在单词中间断开（无空格窗口内不切）", () => {
    const paragraph = "word ".repeat(500) + "needle" + " needle ".repeat(400);
    const r = splitKiroInlineParagraph(paragraph);
    expect(r.chunks.join("") + r.tail).toBe(paragraph);
    // needle 单词完整（词边界空格分隔 → 不会被切开）：包含 needle 的 chunk 必须完整持有它
    const holder = r.chunks.concat(r.tail).find((c) => c.includes("needle"));
    expect(holder).toBeDefined();
    expect(holder === "needle" || /\sneedle\s|^needle\s|\sneedle$/.test(holder!)).toBe(true);
  });

  it("病理情况（全文无安全切点）→ 全部留在 tail（退化但不破坏）", () => {
    const pathological = "**".repeat(5000); // 永不闭合的 bold
    const r = splitKiroInlineParagraph(pathological);
    expect(r.chunks).toEqual([]);
    expect(r.tail).toBe(pathological);
  });
});
