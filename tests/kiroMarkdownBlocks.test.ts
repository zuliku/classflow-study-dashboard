import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  splitKiroStreamingMarkdown,
  splitKiroInlineParagraph,
  KIRO_INLINE_TAIL_MAX_CHARS,
  KIRO_INLINE_STREAM_WINDOW,
  createKiroMarkdownScanState,
  advanceKiroMarkdownScan,
  createKiroInlineScanState,
  advanceKiroInlineScan,
  KiroMarkdownScanState,
  KiroInlineScanState,
  classifySettleSafety,
  isFragmentSafeChunk,
} from "@/lib/ai/streaming/markdownBlocks";
import { KiroStreamPerfCounters } from "@/lib/ai/perf/streamPerf";

/** 注入 perf counter（node 环境 globalThis）——增量测试断言「不重扫 stable prefix」 */
beforeEach(() => {
  (globalThis as unknown as { __kiroStreamPerf?: Partial<KiroStreamPerfCounters> }).__kiroStreamPerf = {};
});
afterEach(() => {
  delete (globalThis as unknown as { __kiroStreamPerf?: Partial<KiroStreamPerfCounters> }).__kiroStreamPerf;
});

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

describe("Streaming UX V4.2 incremental block scan（append-only 只扫新增 suffix）", () => {
  function cjkParagraph(length: number): string {
    let s = "";
    const unit = "这是一段没有空行的超长中文回答内容用于验证安全增量切分";
    while (s.length < length) s += unit;
    return s.slice(0, length);
  }

  /** 按 80 chars 切 chunk 模拟 streaming 到达（末尾可能带部分换行边界） */
  function chunksOf(text: string, size = 80): string[] {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += size) out.push(text.slice(0, Math.min(i + size, text.length)));
    return out;
  }

  /** 断言：incremental 结果 === 同 content 的 full split 结果（语义完全一致） */
  function expectIncrementalEqualsFull(content: string) {
    let state = createKiroMarkdownScanState(content.slice(0, 1));
    for (const partial of chunksOf(content).slice(1)) {
      state = advanceKiroMarkdownScan(state, partial);
      const full = splitKiroStreamingMarkdown(partial, true);
      expect(state.stableBlocks).toEqual(full.stableBlocks);
      expect(state.tail).toBe(full.tail);
      const stateTailState = state.inFence ? "fence" : state.inDisplayMath ? "math" : "text";
      expect(stateTailState).toBe(full.tailState);
    }
  }

  it("append 100 → 500 → 2000 → 8000：输出拼接 === source，stable 前缀不重扫", () => {
    const full = cjkParagraph(8000) + "\n\n结尾段落";
    const lens = [100, 500, 2000, 8000, full.length];
    let state = createKiroMarkdownScanState(full.slice(0, lens[0]));
    for (let i = 1; i < lens.length; i++) {
      state = advanceKiroMarkdownScan(state, full.slice(0, lens[i]));
    }
    // 输出拼接严格等于 source（stableBlocks join("\n\n") + tail）
    expect(state.stableBlocks.join("\n\n") + (state.stableBlocks.length > 0 && state.tail ? "\n\n" : "") + state.tail).toBe(full);
    expect(state.tail).toBe("结尾段落");
    // 增量扫描字符量 ≈ 全量一次 + 各 suffix 和（远小于每帧全量重扫的平方级）
    const c = (globalThis as unknown as { __kiroStreamPerf: KiroStreamPerfCounters }).__kiroStreamPerf;
    expect(c.splitterCalls).toBe(5); // 1 次 create（全量）+ 4 次增量 advance（只扫 suffix）
    expect(c.splitterChars).toBeLessThan(full.length * 2);
  });

  it("跨 chunk 构造（fence/math/bold/code/link/citation）：chunk 恰好到达 marker 时不错误 commit，结果与 full 一致", () => {
    const texts = [
      "```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n结束段",
      "$$\nE = mc^2\n\n还有内容\n$$\n\n结论",
      "段落一\n\n段落二 **加粗开始",
      "段落一\n\n段落二 `code 开始",
      "段落一\n\n段落二 [[source:doc-1:p12",
      "段落一\n\n段落二 [查看文档](https://example.com/abc",
      "前言\n\n```s\nline1\n\nline2",
      "$$\n未闭合公式\n\n继续",
      "- 列表项\n- 第二项\n\n- 第三项 未完",
      "## 标题未闭合行",
      "> 引用行未闭合\n\n后续段落",
    ];
    for (const t of texts) expectIncrementalEqualsFull(t);
  });

  it("fence 跨多 chunk 打开与关闭：tailState 全程与 full 一致，fence 内空行不 flush", () => {
    const text = "前言\n\n```s\nline1\n\nline2\n\nline3\n```\n\n结束";
    let state = createKiroMarkdownScanState(text.slice(0, 10));
    const parts = chunksOf(text, 11);
    for (const partial of parts.slice(1)) {
      state = advanceKiroMarkdownScan(state, partial);
      const full = splitKiroStreamingMarkdown(partial, true);
      expect(state.stableBlocks).toEqual(full.stableBlocks);
      expect(state.tail).toBe(full.tail);
    }
  });

  it("非 append-only（retry / regenerate / 缩短 / 替换）→ deterministic full reset", () => {
    const a = cjkParagraph(300) + "\n\n第二段";
    const b = "全新内容" + cjkParagraph(200) + "\n\n替换段";
    let state = createKiroMarkdownScanState(a);
    state = advanceKiroMarkdownScan(state, a + "追加");
    // 替换：不同前缀 → full reset（结果 === 全量）
    const replaced = advanceKiroMarkdownScan(state, b);
    const full = splitKiroStreamingMarkdown(b, true);
    expect(replaced.stableBlocks).toEqual(full.stableBlocks);
    expect(replaced.tail).toBe(full.tail);
    expect(replaced.prefix).toBe(b);
    // 缩短：full reset
    const shortened = advanceKiroMarkdownScan(state, a.slice(0, 100));
    const fullShort = splitKiroStreamingMarkdown(a.slice(0, 100), true);
    expect(shortened.stableBlocks).toEqual(fullShort.stableBlocks);
    expect(shortened.tail).toBe(fullShort.tail);
  });

  it("幂等：相同 content 重复 advance 返回同一状态（React StrictMode 安全）", () => {
    const text = cjkParagraph(2000) + "\n\n尾段";
    const state = createKiroMarkdownScanState(text.slice(0, 100));
    const once = advanceKiroMarkdownScan(state, text);
    const twice = advanceKiroMarkdownScan(once, text);
    expect(twice).toBe(once);
    expect(twice.stableBlocks).toEqual(once.stableBlocks);
  });
});

describe("Streaming UX V4.2 incremental inline window（长单段，Phase 5）", () => {
  function cjkParagraph(length: number): string {
    let s = "";
    const unit = "这是一段没有空行的超长中文回答内容用于验证安全增量切分";
    while (s.length < length) s += unit;
    return s.slice(0, length);
  }

  it("8000 chars 无空行：增量窗口输出拼接 === source，tail 收敛到流式窗口，chunk 内容稳定", () => {
    const text = cjkParagraph(8000);
    let state = createKiroInlineScanState(text.slice(0, 100));
    const parts: string[] = [];
    for (let i = 100; i < text.length; i += 200) parts.push(text.slice(0, i));
    for (const partial of parts) {
      state = advanceKiroInlineScan(state, partial);
    }
    state = advanceKiroInlineScan(state, text);
    // 输出拼接严格等于 source（chunks + tail 不重不漏）
    expect(state.chunks.join("") + state.tail).toBe(text);
    // tail 收敛到流式窗口（纯文本无未闭合构造 → ≤ KIRO_INLINE_STREAM_WINDOW）
    expect(state.tail.length).toBeLessThanOrEqual(KIRO_INLINE_STREAM_WINDOW);
    // 已切 chunk 内容稳定：任意两个 chunk 拼接 === source 的对应切片
    expect(state.chunks.join("")).toBe(text.slice(0, text.length - state.tail.length));
    // 增量：扫描量 = 全量一次 + 各 suffix 和（不是每帧全量）
    const c = (globalThis as unknown as { __kiroStreamPerf: KiroStreamPerfCounters }).__kiroStreamPerf;
    expect(c.inlineSplitterCalls).toBeGreaterThan(0);
    expect(c.inlineSplitterChars).toBeLessThan(text.length * 3);
  });

  it("跨窗口未闭合构造（** / ` / $ / [link / [[citation）允许 tail 扩大，闭合后收敛", () => {
    const openers = [
      "**加粗开始",
      "`inline code 开始",
      "$E = mc^2 开始",
      "[链接文本开始](https://example.com/xxx",
      "[[source:doc-1:p12",
    ];
    for (const opener of openers) {
      // 构造在窗口边缘打开且长时间不闭合 → 无安全切点 → tail 允许暂时扩大（不切断构造）
      const text = cjkParagraph(1900) + opener + cjkParagraph(1200);
      let state = createKiroInlineScanState(text.slice(0, 100));
      const parts: string[] = [];
      for (let i = 100; i < text.length; i += 150) parts.push(text.slice(0, i));
      for (const partial of parts) {
        state = advanceKiroInlineScan(state, partial);
      }
      state = advanceKiroInlineScan(state, text);
      // 输出拼接严格等于 source
      expect(state.chunks.join("") + state.tail).toBe(text);
      // 构造完整（不跨 chunk 切断；tail 内允许未闭合）
      for (const c of state.chunks) {
        const opens = (c.match(/\*\*/g) ?? []).length;
        expect(opens % 2).toBe(0);
      }
      // 未闭合构造（opener 在 tail 或最后一个 chunk 内，不跨 chunk）
      const joined = state.chunks.join("\u0000") + "\u0000" + state.tail;
      expect(joined.includes("**加粗开始") || joined.includes("`inline code 开始") || joined.includes("$E = mc^2 开始") || joined.includes("[链接文本开始](https://example.com/xxx") || joined.includes("[[source:doc-1:p12")).toBe(true);
    }
  });

  it("缩短 / 替换 → full reset（结果与全量一致）", () => {
    const text = cjkParagraph(4000);
    let state = createKiroInlineScanState(text.slice(0, 100));
    state = advanceKiroInlineScan(state, text);
    const replaced = advanceKiroInlineScan(state, cjkParagraph(3000) + "替换");
    const full = splitKiroInlineParagraph(cjkParagraph(3000) + "替换");
    expect(replaced.chunks).toEqual(full.chunks);
    expect(replaced.tail).toBe(full.tail);
  });

  it("幂等：重复 advance 返回同一状态", () => {
    const text = cjkParagraph(3000);
    const state = createKiroInlineScanState(text.slice(0, 100));
    const once = advanceKiroInlineScan(state, text);
    const twice = advanceKiroInlineScan(once, text);
    expect(twice).toBe(once);
  });
});

describe("Streaming UX V4.3 settleSafety classifier（safe-reuse vs canonicalize）", () => {
  it("普通回答（标题 / 段落 / 单块列表 / 代码 / 引用）→ safe-reuse", () => {
    const blocks = [
      "# 报告标题",
      "第一段内容",
      "- 列表项一\n- 列表项二",
      "```ts\nconst x = 42;\n```",
      "> 单块引用",
      "尾段",
    ];
    const r = classifySettleSafety(blocks);
    expect(r.canonicalize).toBe(false);
    expect(r.safeBlocks).toBe(blocks.length);
    expect(r.totalBlocks).toBe(blocks.length);
  });

  it("fence / display math（自包含）永不 canonicalize（fence 内含 | 也不触发）", () => {
    const r = classifySettleSafety(["```ts\nconst x = a | b;\n```", "$$\nE = mc^2\n$$", "普通段"]);
    expect(r.canonicalize).toBe(false);
  });

  it("loose list（列表块后接列表 marker）→ canonicalize", () => {
    const r = classifySettleSafety(["- 第一项", "- 第二项"]);
    expect(r.canonicalize).toBe(true);
    expect(r.safeBlocks).toBe(0);
  });

  it("列表项缩进续行（≥2 空格）→ canonicalize", () => {
    const r = classifySettleSafety(["- 第一项", "  续行内容"]);
    expect(r.canonicalize).toBe(true);
  });

  it("blockquote 跨空行合并（> a / > b）→ canonicalize", () => {
    const r = classifySettleSafety(["> 引用一", "> 引用二"]);
    expect(r.canonicalize).toBe(true);
  });

  it("段落续行（prose 后接 1-3 空格缩进行）→ canonicalize", () => {
    const r = classifySettleSafety(["普通段落文字", "  缩进续行"]);
    expect(r.canonicalize).toBe(true);
  });

  it("pipe table → canonicalize（正确性优先）", () => {
    const r = classifySettleSafety(["| 列 A | 列 B |", "|---|---|", "| 1 | 2 |"]);
    expect(r.canonicalize).toBe(true);
  });

  it("hr / setext / 单块嵌套结构 → safe", () => {
    expect(classifySettleSafety(["---"]).canonicalize).toBe(false);
    expect(classifySettleSafety(["标题行", "==="]).canonicalize).toBe(false);
    expect(classifySettleSafety(["- 父项\n  - 子项"]).canonicalize).toBe(false);
  });

  it("列表后接普通段落 / 引用后接列表：不同结构不误伤 → safe", () => {
    expect(classifySettleSafety(["- 列表项", "普通段落"]).canonicalize).toBe(false);
    expect(classifySettleSafety(["- 列表项", "> 引用"]).canonicalize).toBe(false);
    expect(classifySettleSafety(["> 引用", "- 列表"]).canonicalize).toBe(false);
  });

  it("tail 作为末块参与 adjacency（stable list + tail marker → canonicalize）", () => {
    const r = classifySettleSafety(["- 稳定列表项", "- 尾部列表项"]);
    expect(r.canonicalize).toBe(true);
  });

  it("空 blocks → 无 canonicalize", () => {
    expect(classifySettleSafety([])).toEqual({ canonicalize: false, safeBlocks: 0, totalBlocks: 0 });
  });
});

describe("Streaming UX V4.3 isFragmentSafeChunk（inline-fragment 严格输入边界）", () => {
  it("纯 inline 内容 → safe", () => {
    expect(isFragmentSafeChunk("普通文字")).toBe(true);
    expect(isFragmentSafeChunk("**加粗** 与 `code` 与 $E=mc^2$ 与 [链接](https://a.b)")).toBe(true);
    expect(isFragmentSafeChunk("引用标记 [[source:doc-1:p12]] 正常")).toBe(true);
  });

  it("block 级构造 → unsafe", () => {
    expect(isFragmentSafeChunk("# 标题")).toBe(false);
    expect(isFragmentSafeChunk("## 二级标题 内容")).toBe(false);
    expect(isFragmentSafeChunk("- 列表项")).toBe(false);
    expect(isFragmentSafeChunk("1. 有序项")).toBe(false);
    expect(isFragmentSafeChunk("> 引用")).toBe(false);
    expect(isFragmentSafeChunk("```\ncode")).toBe(false);
    expect(isFragmentSafeChunk("$$\n公式")).toBe(false);
    expect(isFragmentSafeChunk("---")).toBe(false);
    expect(isFragmentSafeChunk("a | b")).toBe(false);
    expect(isFragmentSafeChunk("文本\n")).toBe(false);
  });
});
