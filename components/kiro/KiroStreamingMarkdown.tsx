"use client";

import React from "react";
import { KiroMarkdown } from "@/components/kiro/KiroMarkdown";
import { KiroStreamingTail } from "@/components/kiro/KiroStreamingTail";
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import {
  splitKiroStreamingMarkdown,
  splitKiroInlineParagraph,
  KIRO_INLINE_TAIL_MAX_CHARS,
} from "@/lib/ai/streaming/markdownBlocks";

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
 * 长单段的安全增量 chunk（Streaming UX V3 Phase 4）：无空行的超长 tail 会被切成
 * 有界安全 chunk（不切断 inline 构造 / 不在 list·heading·quote 行内切）+ 有界 tail。
 * 每个 chunk 都是完整可渲染的 markdown 片段，用同一个 KiroMarkdown pipeline；
 * chunk 与 chunk、chunk 与 tail 之间没有段落 margin（同一段落视觉连续）。
 */
const InlineChunkBlock = React.memo(function InlineChunkBlock({
  text,
  sources,
}: {
  text: string;
  sources?: KiroSourceMeta[];
}) {
  return <KiroMarkdown content={text} sources={sources} />;
});

/**
 * Kiro Streaming Markdown（Worklog V2 Task 4 + Streaming UX V2 Phase 2 + V3 Phase 4）：
 * Stable Blocks（完整 Markdown 渲染，React.memo 缓存）
 * + Active Tail（KiroStreamingTail：与最终 Markdown 完全一致的视觉语义）。
 *
 * Tail 规则：
 * - text 态：同一套 KiroMarkdown pipeline（heading / list / bold / code / KaTeX / citation
 *   在 streaming 期间就是最终语义，闭合瞬间不再发生「纯文本 → Markdown」整段重排）
 * - 超长单段（> KIRO_INLINE_TAIL_MAX_CHARS）→ splitKiroInlineParagraph 安全切 chunk，
 *   每 token 只有最后一个 chunk + tail 进入 ReactMarkdown，稳定 chunk 被 memo 缓存
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

  const inline = React.useMemo(() => {
    if (!streaming || tailState !== "text") return { chunks: [] as string[], tail };
    if (tail.length <= KIRO_INLINE_TAIL_MAX_CHARS) return { chunks: [] as string[], tail };
    return splitKiroInlineParagraph(tail);
  }, [streaming, tailState, tail]);

  return (
    <div data-testid="kiro-streaming-markdown">
      {stableBlocks.map((block, i) => (
        <StableBlock key={i} text={block} sources={sources} spacing={i > 0} />
      ))}

      {inline.chunks.length > 0 || inline.tail.length > 0 ? (
        <div className={stableBlocks.length > 0 ? "mt-[0.8em]" : undefined}>
          {inline.chunks.map((chunk, i) => (
            <InlineChunkBlock key={i} text={chunk} sources={sources} />
          ))}
          {inline.tail.length > 0 && (
            <KiroStreamingTail text={inline.tail} tailState={tailState} sources={sources} />
          )}
        </div>
      ) : null}
    </div>
  );
}
