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
});
