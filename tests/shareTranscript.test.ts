import { describe, it, expect } from "vitest";
import {
  stripMarkdownToPlainText,
  buildTranscriptText,
  TRANSCRIPT_FAST_PATH_CHARS,
} from "@/lib/ai/share";

const msg = (role: "user" | "assistant", content: string) =>
  ({ id: `${role}-1`, role, content } as never);

describe("stripMarkdownToPlainText（transcript 快路径）", () => {
  it("去标记留原文：围栏/行内代码/链接/标题/加粗/表格", () => {
    expect(stripMarkdownToPlainText("```js\nconst a = 1;\n```")).toBe("const a = 1;");
    expect(stripMarkdownToPlainText("用 `useMemo` 包裹")).toBe("用 useMemo 包裹");
    expect(stripMarkdownToPlainText("看[文档](https://x)吧")).toBe("看文档吧");
    expect(stripMarkdownToPlainText("## 标题\n- a\n1. b\n> 引用")).toBe("标题\na\nb\n引用");
    expect(stripMarkdownToPlainText("**重要**和*斜体*")).toBe("重要和斜体");
    expect(stripMarkdownToPlainText("| a | b |\n| c | d |")).toContain("a");
    expect(stripMarkdownToPlainText("| a | b |\n| c | d |")).not.toContain("|");
  });

  it("纯文本原样通过", () => {
    expect(stripMarkdownToPlainText("你好，今天事项")).toBe("你好，今天事项");
  });
});

describe("buildTranscriptText 快路径分支", () => {
  it("小会话走渲染器路径（node 无 document → 原文透传）", () => {
    const out = buildTranscriptText([msg("user", "## 标题")]);
    expect(out).toContain("## 标题");
  });

  it("超限走字符串脱壳（去标记）", () => {
    const big = `## 大标题\n\n${"正文段落。".repeat(20000)}`;
    expect(big.length).toBeGreaterThan(TRANSCRIPT_FAST_PATH_CHARS);
    const out = buildTranscriptText([msg("assistant", big)]);
    expect(out).toContain("Kiro：");
    expect(out).not.toContain("## 大标题");
    expect(out).toContain("大标题");
  });
});
