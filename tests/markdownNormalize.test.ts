import { describe, it, expect } from "vitest";
import { normalizeMathDelimiters } from "@/lib/ai/markdown";

describe("normalizeMathDelimiters", () => {
  it("普通文本原样保留", () => {
    expect(normalizeMathDelimiters("价格是 $5 和 $10。")).toBe("价格是 $5 和 $10。");
    expect(normalizeMathDelimiters("## 标题\n\n正文")).toBe("## 标题\n\n正文");
  });

  it("段落内联 $$...$$ → 提升为独立 display block", () => {
    const out = normalizeMathDelimiters("线性需求函数：$$Q_d = a - bP$$ 其中 b>0");
    expect(out).toContain("\n\n$$\nQ_d = a - bP\n$$\n\n");
    expect(out).toContain("线性需求函数：");
  });

  it("独占整行的 $$...$$ 不动（remark-math 原生 display）", () => {
    const src = "$$\nQ_d = a - bP\n$$";
    expect(normalizeMathDelimiters(src)).toBe(src);
  });

  it("同一行 \\[...\\] → display；同一行 \\(...\\) → $...$ 行内（remark-math 不原生支持）", () => {
    const out = normalizeMathDelimiters("由 \\[x = y\\] 可得");
    expect(out).toContain("$$\nx = y\n$$");
    expect(out).toContain("由");
    const inline = normalizeMathDelimiters("\\(Q_d = f(P)\\) 行内");
    expect(inline).toBe("$Q_d = f(P)$ 行内");
  });

  it("跨行 \\(...\\) / \\[...\\] → 折叠为 display block", () => {
    const out = normalizeMathDelimiters("推导\n\\( Q_d =\nf(P) \\)\n完成");
    expect(out).toContain("$$\nQ_d =\nf(P)\n$$");
    expect(out).not.toContain("\\(");
    const out2 = normalizeMathDelimiters("推导\n\\[\nx = y\n\\]\n完成");
    expect(out2).toContain("$$\nx = y\n$$");
  });

  it("未闭合跨行 delimiter：原样保留，不丢内容（流式安全）", () => {
    const src = "推导\n\\( Q_d =\nf(P)\n";
    expect(normalizeMathDelimiters(src)).toBe(src);
    expect(normalizeMathDelimiters("\\[ x = y")).toBe("\\[ x = y");
  });

  it("fenced code block 内部一律不动（含 $$ / \\( / \\[）", () => {
    const src = "```ts\nconst s = \"$$x = y$$\";\n\\(a\\)\n```";
    expect(normalizeMathDelimiters(src)).toBe(src);
    const src2 = "```math\nQ_d = a - bP\n```";
    expect(normalizeMathDelimiters(src2)).toBe(src2);
  });

  it("行内 code 中的 delimiter 不转换", () => {
    const src = "使用 `$$x = y$$` 作为示例";
    expect(normalizeMathDelimiters(src)).toBe(src);
  });

  it("转义 delimiter（\\$、\\\\(）不转换", () => {
    expect(normalizeMathDelimiters("成本 \\$5 美元")).toBe("成本 \\$5 美元");
    expect(normalizeMathDelimiters("写作 \\\\(x\\\\)")).toBe("写作 \\\\(x\\\\)");
  });

  it("普通美元金额与无配对 $ 不动", () => {
    expect(normalizeMathDelimiters("售价 3$ 起，成本 2$")).toBe("售价 3$ 起，成本 2$");
  });
});
