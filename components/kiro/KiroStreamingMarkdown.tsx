"use client";

import React from "react";
import { KiroMarkdown } from "@/components/kiro/KiroMarkdown";
import { KiroCitation } from "@/components/kiro/KiroCitation";
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import { splitCitationSegments } from "@/lib/ai/citations/parser";
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
 * Kiro Streaming Markdown（Worklog V2 Task 4）：
 * Stable Blocks（完整 Markdown 渲染，React.memo 缓存）
 * + Active Tail（轻量纯文本，完全绕开 Markdown pipeline）。
 *
 * Tail 规则：
 * - 只做 white-space / 换行 + 现有字体大小 + line-height 1.74 + text-charcoal
 * - 未完成 Markdown（** ` ### $$ 等）直接按文本显示，等 block stable 后才升级完整 Markdown
 * - 仅当 citation marker 已完整闭合时允许显示 KiroCitation（复用 splitCitationSegments）
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
  const { stableBlocks, tail } = React.useMemo(
    () => splitKiroStreamingMarkdown(content, streaming),
    [content, streaming]
  );
  const tailSegments = tail.length > 0 ? splitCitationSegments(tail) : [];

  return (
    <div data-testid="kiro-streaming-markdown">
      {stableBlocks.map((block, i) => (
        <StableBlock key={i} text={block} sources={sources} spacing={i > 0} />
      ))}

      {tailSegments.length > 0 && (
        <div
          className={[
            "whitespace-pre-wrap break-words text-charcoal",
            stableBlocks.length > 0 ? "mt-[0.8em]" : undefined,
          ]
            .filter(Boolean)
            .join(" ")}
          style={{ fontSize: "var(--kiro-output-font-size)", lineHeight: 1.74 }}
        >
          {tailSegments.map((seg, i) =>
            seg.type === "citation" ? (
              <KiroCitation key={i} citation={seg.citation} sources={sources} />
            ) : (
              <span key={i}>{seg.text}</span>
            )
          )}
        </div>
      )}
    </div>
  );
}
