"use client";

import React from "react";
import { KiroMarkdown } from "@/components/kiro/KiroMarkdown";
import { KiroStreamingTail } from "@/components/kiro/KiroStreamingTail";
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import { splitKiroStreamingMarkdown } from "@/lib/ai/streaming/markdownBlocks";

/**
 * Stable Block：一旦稳定的 Markdown 段完整渲染并缓存（React.memo）。
 * 后续 token 只影响 Active Tail，稳定块不再重复 parse（不再逐 chunk 跑 ReactMarkdown/KaTeX）。
 */
const StableBlock = React.memo(function StableBlock({
  text,
  sources,
  spacing,
}: {
  text: string;
  sources?: KiroSourceMeta[];
  /** 与前一稳定块之间的段间距（模拟正常段落间距，避免 layout 跳变） */
  spacing?: boolean;
}) {
  return (
    <div className={spacing ? "mt-[0.8em]" : undefined}>
      <KiroMarkdown content={text} sources={sources} />
    </div>
  );
});

/**
 * Kiro Streaming Markdown（Worklog V2 Task 4 + Streaming UX V2 Phase 2）：
 * Stable Blocks（完整 Markdown 渲染，React.memo 缓存）
 * + Active Tail（KiroStreamingTail：与最终 Markdown 完全一致的视觉语义）。
 *
 * Tail 规则：
 * - text 态：同一套 KiroMarkdown pipeline（heading / list / bold / code / KaTeX / citation
 *   在 streaming 期间就是最终语义，闭合瞬间不再发生「纯文本 → Markdown」整段重排）
 * - fence / math 态（未闭合块级构造）：稳定几何 fallback 容器（pre / 块 div）
 * - 无 typewriter 动画
 */
export function KiroStreamingMarkdown({
  content,
  streaming,
  sources,
}: {
  content: string;
  streaming: boolean;
  sources?: KiroSourceMeta[];
}) {
  const { stableBlocks, tail, tailState } = React.useMemo(
    () => splitKiroStreamingMarkdown(content, streaming),
    [content, streaming]
  );

  return (
    <div data-testid="kiro-streaming-markdown">
      {stableBlocks.map((block, i) => (
        <StableBlock key={i} text={block} sources={sources} spacing={i > 0} />
      ))}

      {tail.length > 0 && (
        <div className={stableBlocks.length > 0 ? "mt-[0.8em]" : undefined}>
          <KiroStreamingTail text={tail} tailState={tailState} sources={sources} />
        </div>
      )}
    </div>
  );
}
