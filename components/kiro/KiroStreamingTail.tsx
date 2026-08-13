"use client";

import React from "react";
import { KiroMarkdown } from "@/components/kiro/KiroMarkdown";
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import { KiroMarkdownTailState } from "@/lib/ai/streaming/markdownBlocks";

/**
 * Active Tail 的 Markdown 语义渲染（Streaming UX V2 Phase 2）。
 *
 * 核心原则：Stable Blocks 与 Active Tail 使用同一套视觉语义，避免
 * 「流式纯文本 → 完成后 Markdown 突变」的整段重排：
 * - "text"：tail 走与最终渲染完全一致的 KiroMarkdown pipeline（ReactMarkdown +
 *   remark-gfm + remark-math + remarkKiroCitation + KaTeX），未闭合的 inline
 *   构造（** $ [[source:…）由 parser 安全退化为可读文本。
 * - "fence"：tail 含未闭合 ``` → 使用与稳定 code block 完全相同的容器类
 *   （bg/border/圆角/等宽/行高）渲染，闭合瞬间只去掉 fence marker，几何不跳。
 * - "math"：tail 含未闭合 $$ → 使用与 katex-display 相近的块容器
 *   （margin / overflow-x）渲染原文，闭合后由 KaTeX 接管，几何相近。
 */
export function KiroStreamingTail({
  text,
  tailState,
  sources,
}: {
  text: string;
  tailState: KiroMarkdownTailState;
  sources?: KiroSourceMeta[];
}) {
  if (tailState === "fence") {
    return (
      <pre
        data-testid="kiro-streaming-code-tail"
        className="my-[0.85em] overflow-x-auto rounded-xl bg-alabaster border border-line px-4 py-3.5 text-charcoal whitespace-pre font-mono text-[0.84em] leading-[1.65]"
      >
        {stripOpenMarker(/^```/, text)}
      </pre>
    );
  }
  if (tailState === "math") {
    return (
      <div
        data-testid="kiro-streaming-math-tail"
        className="my-[0.95em] mb-[1.05em] overflow-x-auto text-center"
      >
        <span className="font-mono text-[0.9em] text-charcoal whitespace-pre-wrap break-words">
          {stripOpenMarker(/^\$\$/, text)}
        </span>
      </div>
    );
  }
  return <KiroMarkdown content={text} sources={sources} />;
}

/** 去掉未闭合构造的首行 marker（``` / $$），内容保持原样，避免把 marker 当正文显示 */
function stripOpenMarker(markerRe: RegExp, text: string): string {
  const nl = text.indexOf("\n");
  const first = nl < 0 ? text : text.slice(0, nl);
  if (!markerRe.test(first.trim())) return text;
  return nl < 0 ? "" : text.slice(nl + 1);
}
