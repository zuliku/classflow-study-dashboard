import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KiroMarkdown } from "@/components/kiro/KiroMarkdown";

function render(md: string): string {
  return renderToStaticMarkup(React.createElement(KiroMarkdown, { content: md }));
}

describe("KiroMarkdown", () => {
  it("**bold** → <strong>（不显示原始 **）", () => {
    const html = render("**重要** 内容");
    expect(html).toContain("<strong");
    expect(html).toContain("重要</strong>");
    expect(html).not.toContain("**重要**");
  });

  it("GFM 表格 → 真实 <table>，不显示 | --- |", () => {
    const html = render("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
    expect(html).not.toContain("| ---");
    expect(html).not.toContain("|---|");
  });

  it("heading / list / task list / strikethrough / blockquote / code", () => {
    const html = render(
      "## 标题\n\n- 项目一\n- 项目二\n\n> 引用\n\n`inline`\n\n```ts\nconst x = 1;\n```\n\n~~删除~~"
    );
    expect(html).toContain("<h2");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).toContain("<blockquote");
    expect(html).toContain("<code");
    expect(html).toContain("<pre");
    expect(html).toContain("<del");
    expect(html).not.toContain("## 标题");
    expect(html).not.toContain("~~删除~~");
  });

  it("任务列表（GFM）渲染为 checkbox", () => {
    const html = render("- [x] 已完成\n- [ ] 未完成");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });

  it("安全：不启用 raw HTML，<script> 不执行", () => {
    const html = render("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    // 内容被转义为纯文本，不构成可执行节点
    expect(html).toContain("&lt;script&gt;");
  });

  it("链接：http/https/mailto 可点击且外链安全属性；javascript: 不渲染为链接", () => {
    const html = render("[官网](https://example.com) [邮箱](mailto:a@b.com) [危险](javascript:alert(1))");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="mailto:a@b.com"');
    expect(html).not.toContain('href="javascript:');
  });

  it("流式未闭合语法也能安全渲染（不崩溃）", () => {
    const html = render("| A | B |\n|--|--|\n| 1 |");
    expect(html).toContain("<table");
    expect(() => render("**未闭合\n\n`未闭合")).not.toThrow();
  });

  it("数学：$...$ 行内公式 → KaTeX，不渲染成 code", () => {
    const html = render("需求函数可以写成 $Q_d = f(P)$。");
    expect(html).toContain('class="katex"');
    expect(html).not.toContain("language-");
    expect(html).not.toContain("$Q_d");
    // 下标（MathML <msub> 与 HTML 结构）
    expect(html).toContain("msub");
  });

  it("数学：$$...$$ 独占行 → katex-display（块级）", () => {
    const html = render("$$\nQ_d = a - bP\n$$");
    expect(html).toContain("katex-display");
    expect(html).not.toContain("<pre");
    expect(html).not.toContain("katex-error");
  });

  it("数学：分式 / 上标 / 希腊字母 / 求和真实渲染", () => {
    const html = render("$\\frac{\\Delta Q / Q}{\\Delta P / P}$ 与 $x^2$、$\\varepsilon_d$、$\\sum_{i=1}^{n} x_i$");
    expect(html).toContain("mfrac"); // \frac（MathML/HTML 结构类名）
    expect(html).toContain("msup"); // x^2
    expect(html).toContain("ε"); // \varepsilon
    expect(html).toContain("∑"); // \sum
  });

  it("数学：\\(...\\) 行内 / \\[...\\] display（normalize 转换）", () => {
    const inline = render("\\( Q_d = a-bP \\) 行内");
    expect(inline).toContain('class="katex"');
    expect(inline).not.toContain("katex-display");
    expect(inline).not.toContain("( Q_d");
    const display = render("\\[\nx = y\n\\]");
    expect(display).toContain("katex-display");
  });

  it("数学：段落内联 $$...$$ 被归一化为独立 display block", () => {
    const html = render("线性需求函数：$$Q_d = a - bP$$ 其中 b>0");
    expect(html).toContain("katex-display");
  });

  it("数学：```math 围栏 → KaTeX；普通 ```ts 仍是代码块", () => {
    const math = render("```math\nQ_d = a - bP\n```");
    expect(math).toContain("katex-display");
    const code = render("```ts\nconst x = 1\n```");
    expect(code).toContain("<pre");
    expect(code).not.toContain("katex-display");
  });

  it("数学：非法 / 未完成 LaTeX 不崩溃，退化为可读 source", () => {
    expect(() => render("$Q_d = \\frac{}$")).not.toThrow();
    const html = render("$\\frac{}$");
    // KaTeX throwOnError:false → 输出错误 class（katex-error 或 katex），不抛异常
    expect(html).toContain("katex");
  });

  it("数学：KaTeX trust:false，\\href 不产生可点击危险链接", () => {
    const html = render("$$\\href{javascript:alert(1)}{x}$$");
    expect(html).not.toContain('href="javascript');
    expect(() => render("$$\\href{javascript:alert(1)}{x}$$")).not.toThrow();
  });

  it("流式：未闭合 $ / $$ / 强调不崩溃", () => {
    expect(() => render("价格 $Q_d =")).not.toThrow();
    expect(() => render("$$\nQ_d = a -")).not.toThrow();
    expect(() => render("**需求")).not.toThrow();
    expect(() => render("\\[ x = y")).not.toThrow();
    expect(() => render("\\( Q_d")).not.toThrow();
  });

  it("数学与 inline code 严格区分：inline code 不继承 KaTeX 样式", () => {
    const html = render("`selectedAssignmentId` 与 $Q_d$");
    expect(html).toContain("<code");
    expect(html).toContain("msub");
  });
});
