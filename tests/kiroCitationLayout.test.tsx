import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KiroMarkdown } from "@/components/kiro/KiroMarkdown";
import { KiroSourceMeta } from "@/lib/ai/citations/types";

const WEB_SOURCES: KiroSourceMeta[] = [
  { sourceId: "web-1", name: "浙江大学2026年硕士研究生招生简章", source: "web", url: "https://grs.zju.edu.cn/a", domain: "grs.zju.edu.cn" },
  { sourceId: "web-2", name: "农村发展专业硕士项目介绍", source: "web", url: "https://spa.zju.edu.cn/b", domain: "spa.zju.edu.cn" },
];

function render(content: string, sources: KiroSourceMeta[] = WEB_SOURCES): string {
  return renderToStaticMarkup(<KiroMarkdown content={content} sources={sources} />);
}

/** Citation pill 是否已渲染（KiroCitation 输出 data-testid="kiro-citation"） */
const CITATION_TESTID = 'data-testid="kiro-citation"';

/** 取第一个 <p> 块（注意不能匹配 svg <path>） */
function firstParagraph(html: string): string | null {
  const m = /<p[ >]([\s\S]*?)<\/p>/.exec(html);
  return m ? m[1] : null;
}

function countParagraphs(html: string): number {
  return (html.match(/<p[ >]/g) ?? []).length;
}

describe("Kiro Citation Layout Hotfix", () => {
  it("Test 1. 中文句号不能独占 paragraph：正文 + Citation + 。 在同一 <p>", () => {
    const html = render("浙江大学发布了最新招生简章[[source:web-1]]。");
    expect(html).toContain(CITATION_TESTID);
    expect(html).not.toContain("<p>。</p>");
    expect(countParagraphs(html)).toBe(1);
    const p = firstParagraph(html);
    expect(p).not.toBeNull();
    expect(p).toContain(CITATION_TESTID);
    expect(p).toContain("。");
    expect(p).toContain("浙江大学发布了最新招生简章");
  });

  it("Test 2. 列表结构：单个 <li> 内包含正文 + Citation + 。", () => {
    const html = render("* 浙大设有农村发展专业硕士项目[[source:web-1]]。");
    expect((html.match(/<li[ >]/g) ?? []).length).toBe(1);
    expect(html).not.toContain("<p>。</p>");
    const li = /<li[ >]([\s\S]*?)<\/li>/.exec(html);
    expect(li).not.toBeNull();
    expect(li![1]).toContain(CITATION_TESTID);
    expect(li![1]).toContain("浙大设有农村发展专业硕士项目");
    expect(li![1]).toContain("。");
  });

  it("Test 3. inline code 中的 marker 不变成 Citation；正文中的才转换", () => {
    const html = render("代码`[[source:web-1]]`与引用[[source:web-2]]。");
    const citationCount = (html.match(/data-testid="kiro-citation"/g) ?? []).length;
    expect(citationCount).toBe(1);
    expect(html).toContain("[[source:web-1]]"); // code 内按文本显示
  });

  it("Test 4. strong 后的 Citation 保持同一段落（不产生独立 <p>）", () => {
    const html = render("**招生简章**[[source:web-1]]。");
    expect(countParagraphs(html)).toBe(1);
    expect(html).not.toContain("<p>。</p>");
    const p = firstParagraph(html);
    expect(p).toContain(CITATION_TESTID);
    expect(p).toContain("。");
  });
});
