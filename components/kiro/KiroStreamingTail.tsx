"use client";

import React from "react";
import { Copy } from "lucide-react";
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
 *
 * V4.3：React.memo——settle 帧 tail 内容不变时不重 parse（zero-stall handoff 的一部分）。
 */
export const KiroStreamingTail = React.memo(function KiroStreamingTail({
  text,
  tailState,
  sources,
  cursor = false,
}: {
  text: string;
  tailState: KiroMarkdownTailState;
  sources?: KiroSourceMeta[];
  /** Streaming UX V5：fence/math fallback 内联 caret */
  cursor?: boolean;
}) {
  if (tailState === "fence") {
    // 与稳定代码块同几何：外层容器 + 头部占位（label + 复制按钮同高），闭合只去掉 marker，
    // 头部由占位翻为可交互（不跳变；占位区 inert 不可聚焦）
    const langLabel = (firstMarkerLang(/^```/, text) || "CODE").toUpperCase();
    return (
      <div
        data-testid="kiro-streaming-code-tail"
        className="my-[0.85em] rounded-xl border border-line bg-alabaster overflow-hidden"
      >
        <div
          aria-hidden="true"
          {...({ inert: "" } as unknown as React.HTMLAttributes<HTMLDivElement>)}
          className="flex items-center justify-between px-3 py-1.5 bg-alabaster border-b border-line"
        >
          <span className="text-[10px] font-bold tracking-wide text-sandrift uppercase bg-white border border-line rounded-md px-1.5 py-0.5">
            {langLabel}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-sandrift">
            <Copy className="w-3 h-3 opacity-0" aria-hidden="true" />
            复制
          </span>
        </div>
        <pre className="m-0 p-4 overflow-x-auto font-mono text-[0.84em] leading-[1.65] text-charcoal whitespace-pre">
          {stripOpenMarker(/^```/, text)}
          {cursor && (
            <span
              data-testid="kiro-streaming-cursor"
              className="kiro-stream-caret"
              aria-hidden="true"
            />
          )}
        </pre>
      </div>
    );
  }
  if (tailState === "math") {
    // 与 KaTeX display 同槽位：定高占位，闭合后公式接管（不塌陷）
    return (
      <div
        data-testid="kiro-streaming-math-tail"
        className="my-[0.95em] mb-[1.05em] min-h-[3rem] overflow-x-auto text-center"
      >
        <span className="font-mono text-[0.9em] text-charcoal whitespace-pre-wrap break-words">
          {stripOpenMarker(/^\$\$/, text)}
          {cursor && (
            <span
              data-testid="kiro-streaming-cursor"
              className="kiro-stream-caret"
              aria-hidden="true"
            />
          )}
        </span>
      </div>
    );
  }
  // P0 流畅度：tail text 走轻量 pipeline（无 highlight/KaTeX），settled 后稳定块切回全量
  return <KiroMarkdown content={text} sources={sources} streaming />;
});

/** 去掉未闭合构造的首行 marker（``` / $$），内容保持原样，避免把 marker 当正文显示 */
function stripOpenMarker(markerRe: RegExp, text: string): string {
  const nl = text.indexOf("\n");
  const first = nl < 0 ? text : text.slice(0, nl);
  if (!markerRe.test(first.trim())) return text;
  return nl < 0 ? "" : text.slice(nl + 1);
}

/** 首行 marker 后的语言标记（```python → python），供占位头部 label 与终态一致 */
function firstMarkerLang(markerRe: RegExp, text: string): string {
  const nl = text.indexOf("\n");
  const first = (nl < 0 ? text : text.slice(0, nl)).trim();
  const m = first.match(markerRe);
  if (!m) return "";
  return first.slice(m[0].length).trim();
}
