"use client";

import React from "react";
import { KiroMarkdown } from "@/components/kiro/KiroMarkdown";
import { KiroStreamingTail } from "@/components/kiro/KiroStreamingTail";
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import {
  splitKiroStreamingMarkdown,
  KIRO_INLINE_STREAM_WINDOW,
  createKiroMarkdownScanState,
  advanceKiroMarkdownScan,
  KiroMarkdownScanState,
  createKiroInlineScanState,
  advanceKiroInlineScan,
  KiroInlineScanState,
  classifySettleSafety,
  isFragmentSafeChunk,
} from "@/lib/ai/streaming/markdownBlocks";
import {
  bumpStreamPerf,
  addStreamPerfChars,
  addStreamPerfMillis,
} from "@/lib/ai/perf/streamPerf";

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
 * 长单段的安全 inline chunk（Streaming UX V3 Phase 4 + V4.3 inline-fragment）：
 * 无空行的超长 tail 被切成有界安全 chunk（不切断 inline 构造 / 不在 list·heading·quote
 * 行内切）+ 有界 tail。V4.3 起，scanner 证明安全的 chunk 走 inline-fragment 渲染
 * （不生成 block 级 DOM，多个 fragment 拼接在同一个 <p> 内，无假段落 margin）；
 * 含 block 级构造的 chunk 退回完整 KiroMarkdown（正确性优先）。
 */
const InlineChunkBlock = React.memo(function InlineChunkBlock({
  text,
  sources,
}: {
  text: string;
  sources?: KiroSourceMeta[];
}) {
  const fragmentSafe = React.useMemo(() => isFragmentSafeChunk(text), [text]);
  if (fragmentSafe) {
    return <KiroMarkdown content={text} sources={sources} mode="inline-fragment" />;
  }
  return <KiroMarkdown content={text} sources={sources} />;
});

interface StreamingSplit {
  stableBlocks: string[];
  tail: string;
  tailState: "text" | "fence" | "math";
  /** settled 时是否复用最后 streaming 扫描树（zero-reparse） */
  reuse: boolean;
  /** settled 复用但存在无法证明独立的结构 → 需要低优先级 canonical fallback */
  canonicalPending: boolean;
}

/**
 * Kiro Streaming Markdown（Worklog V2 Task 4 + Streaming UX V2 Phase 2 + V3 Phase 4 + V4.2 + V4.3）：
 * Stable Blocks（完整 Markdown 渲染，React.memo 缓存）
 * + Active Tail（KiroStreamingTail：与最终 Markdown 完全一致的视觉语义）。
 *
 * V4.2 Hot Path：streaming 时用 Incremental Markdown Scan State（lib/ai/streaming/markdownBlocks）——
 * append-only 内容只扫描新增 suffix，stable prefix 永不重扫（block scanner + 长单段 inline 窗口）。
 * - render 内写 ref = 官方「缓存昂贵计算结果」模式；advance 幂等（StrictMode 安全）
 * - 非 append-only（retry / regenerate / edit / history restore）→ deterministic full reset
 *
 * V4.3 Zero-stall Settle Handoff：streaming=false 时不再全量重 render——
 * - 最后 stream 内容 === 最终内容 且 classifySettleSafety 判定全部 safe → 复用 streaming
 *   DOM（同一 key / 同一 subtree / React.memo），settle 帧只 Seal（tail 已是最终语义，
 *   text 态走同一 pipeline；fence/math 只在异常截断时保持 fallback 容器）。
 * - 存在 canonicalize 结构（loose list / 跨块 quote / pipe table 等）→ 两阶段 handoff：
 *   Phase 1 保留 streaming DOM（用户立即看到回答完成），Phase 2 用 startTransition
 *   低优先级做完整 KiroMarkdown canonical render（正确性优先）。
 * - 全新 mount（history restore / 页面刷新 / 未经历 streaming）→ 完整 canonical render。
 *
 * Tail 规则：
 * - text 态：同一套 KiroMarkdown pipeline（heading / list / bold / code / KaTeX / citation
 *   在 streaming 期间就是最终语义，闭合瞬间不再发生「纯文本 → Markdown」整段重排）
 * - 超长单段（> KIRO_INLINE_TAIL_MAX_CHARS）→ 增量 inline 窗口切安全 chunk，
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
  const blockScanRef = React.useRef<KiroMarkdownScanState | null>(null);
  const inlineScanRef = React.useRef<KiroInlineScanState | null>(null);
  // 两阶段 handoff：settled 且需要 canonical fallback 时置 true → 渲染完整 KiroMarkdown
  const [canonicalRender, setCanonicalRender] = React.useState(false);
  // settle 决策只统计一次（StrictMode 双跑防护）
  const settleReportedRef = React.useRef(false);
  const settleCharsReportedRef = React.useRef(false);
  const canonicalReportedRef = React.useRef(false);

  const split = React.useMemo<StreamingSplit>(() => {
    if (streaming) {
      settleReportedRef.current = false;
      settleCharsReportedRef.current = false;
      const prev = blockScanRef.current;
      const next = prev ? advanceKiroMarkdownScan(prev, content) : createKiroMarkdownScanState(content);
      blockScanRef.current = next;
      return {
        stableBlocks: next.stableBlocks,
        tail: next.tail,
        tailState: next.inFence ? "fence" : next.inDisplayMath ? "math" : "text",
        reuse: false,
        canonicalPending: false,
      };
    }

    // settled：复用最后 streaming 扫描树（zero-reparse）。
    // 注意：最后一个 text-delta 与 text-end 常在同一批次到达 → settle 帧的 content 比
    // 最后 streaming 帧多出最后一段 suffix。append-only 时先增量推进一次（幂等，只扫
    // 新增 suffix），再复用 → stable block / chunk 的 key 与 DOM identity 全部保持。
    const scan = blockScanRef.current;
    if (scan && content.length > 0 && content.startsWith(scan.prefix)) {
      const next = advanceKiroMarkdownScan(scan, content);
      blockScanRef.current = next;
      const blocks = [...next.stableBlocks];
      if (next.tail.length > 0) blocks.push(next.tail);
      const safety = classifySettleSafety(blocks);
      const tailState: StreamingSplit["tailState"] = next.inFence
        ? "fence"
        : next.inDisplayMath
          ? "math"
          : "text";
      if (!settleReportedRef.current) {
        settleReportedRef.current = true;
        bumpStreamPerf("settleTransitions");
        for (let i = 0; i < next.stableBlocks.length; i++) bumpStreamPerf("settleReusedBlocks");
        // settle 帧实际重 parse 的字符量在 inline memo 记录（= 最后 mutable window，
        // 不是 block-scan tail——长单段时 tail 是整个 paragraph）
      }
      return {
        stableBlocks: next.stableBlocks,
        tail: next.tail,
        tailState,
        reuse: true,
        canonicalPending: safety.canonicalize,
      };
    }
    // 全新 mount / 非 append-only 变更：完整 canonical render
    if (!settleReportedRef.current) {
      settleReportedRef.current = true;
      bumpStreamPerf("settleTransitions");
      bumpStreamPerf("settleFullParses");
      addStreamPerfChars("settleParsedChars", content.length);
    }
    blockScanRef.current = null;
    inlineScanRef.current = null;
    return {
      stableBlocks: content.length > 0 ? [content] : [],
      tail: "",
      tailState: "text",
      reuse: false,
      canonicalPending: false,
    };
  }, [content, streaming]);

  // Phase 2：需要 canonical fallback 时，settle 帧（streaming DOM + cursor 消失）提交后
  // 再低优先级完整渲染（startTransition，不用人为 setTimeout / rAF chain）
  const needsCanonical = !streaming && split.canonicalPending && !canonicalRender;
  React.useEffect(() => {
    if (needsCanonical && !canonicalReportedRef.current) {
      canonicalReportedRef.current = true;
      React.startTransition(() => {
        setCanonicalRender(true);
        bumpStreamPerf("settleCanonicalFallbacks");
      });
    } else if (canonicalRender && (streaming || !split.canonicalPending)) {
      setCanonicalRender(false);
      canonicalReportedRef.current = false;
    }
  }, [needsCanonical, canonicalRender, streaming, split.canonicalPending]);

  const inline = React.useMemo(() => {
    const { tail, tailState, reuse } = split;
    if (!streaming && !reuse) {
      // 全新 canonical：全文在 stableBlocks，inline 不渲染
      inlineScanRef.current = null;
      return { chunks: [] as string[], tail, reuse: false };
    }
    if (tailState !== "text") {
      // fence / math 态：稳定几何 fallback 容器（异常截断时不 re-parse）
      inlineScanRef.current = null;
      return { chunks: [] as string[], tail, reuse };
    }
    if (tail.length <= KIRO_INLINE_STREAM_WINDOW) {
      if (!streaming && reuse && !settleCharsReportedRef.current) {
        settleCharsReportedRef.current = true;
        // settle 帧 re-parse 成本 = KiroStreamingTail 的最后 mutable tail（历史已 memo）
        addStreamPerfChars("settleParsedChars", tail.length);
      }
      inlineScanRef.current = null;
      return { chunks: [] as string[], tail, reuse };
    }
    const prev = inlineScanRef.current;
    if (prev && tail.startsWith(prev.prefix)) {
      // settle reuse / 继续增量：最后 stream 帧的 inline 窗口可能差最后一小段 suffix，
      // append-only 推进（幂等），零重扫历史 chunk → 直接复用
      const nextAdv = advanceKiroInlineScan(prev, tail);
      inlineScanRef.current = nextAdv;
      if (!streaming && reuse && !settleCharsReportedRef.current) {
        settleCharsReportedRef.current = true;
        // settle 帧 re-parse 成本 = 最后 inline 窗口（稳定 chunk 全部 memo 命中）
        addStreamPerfChars("settleParsedChars", nextAdv.tail.length);
      }
      return { chunks: nextAdv.chunks, tail: nextAdv.tail, reuse: true };
    }
    const next = prev ? advanceKiroInlineScan(prev, tail) : createKiroInlineScanState(tail);
    inlineScanRef.current = next;
    return { chunks: next.chunks, tail: next.tail, reuse };
  }, [streaming, split]);

  // fragment paragraph：所有 chunk + tail 都被 scanner 证明为纯 inline → 拼接进同一个 <p>
  //（任何一块含 block 级构造 → 整体退回 block 模式，避免 p 内嵌 div 的非法 DOM）
  const fragmentSafeInline = React.useMemo(
    () =>
      inline.chunks.length > 0 &&
      inline.chunks.every(isFragmentSafeChunk) &&
      isFragmentSafeChunk(inline.tail),
    [inline]
  );

  if (canonicalRender) {
    // Phase 2 canonical fallback：完整 document render（正确性优先；允许一次重 parse）
    return (
      <div data-testid="kiro-streaming-markdown">
        <SettleCanonicalRenderer content={content} sources={sources} />
      </div>
    );
  }

  return (
    <div data-testid="kiro-streaming-markdown">
      {split.stableBlocks.map((block, i) => (
        <StableBlock key={i} text={block} sources={sources} spacing={i > 0} />
      ))}

      {inline.chunks.length > 0 || inline.tail.length > 0 ? (
        <div className={split.stableBlocks.length > 0 ? "mt-[0.8em]" : undefined}>
          {fragmentSafeInline ? (
            <div
              className="kiro-markdown text-charcoal"
              style={{ fontSize: "var(--kiro-output-font-size)", lineHeight: 1.74 }}
            >
              <p className="mb-0" data-testid="kiro-inline-fragment-paragraph">
                {inline.chunks.map((chunk, i) => (
                  <InlineChunkBlock key={i} text={chunk} sources={sources} />
                ))}
                {inline.tail.length > 0 && (
                  <InlineChunkBlock text={inline.tail} sources={sources} />
                )}
              </p>
            </div>
          ) : (
            <>
              {inline.chunks.map((chunk, i) => (
                <InlineChunkBlock key={i} text={chunk} sources={sources} />
              ))}
              {inline.tail.length > 0 && (
                <KiroStreamingTail text={inline.tail} tailState={split.tailState} sources={sources} />
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Phase 2 canonical 渲染的耗时测量（test-only；settleDurationMs）：
 * 生产环境无 __kiroStreamPerf 全局 → bump 全部零成本。
 */
const SettleCanonicalRenderer = React.memo(function SettleCanonicalRenderer({
  content,
  sources,
}: {
  content: string;
  sources?: KiroSourceMeta[];
}) {
  const startRef = React.useRef(0);
  startRef.current = performance.now();
  React.useLayoutEffect(() => {
    addStreamPerfMillis("settleDurationMs", performance.now() - startRef.current);
  });
  React.useEffect(() => {
    // canonical fallback 实际 parse 字符量 = 全文（与 settleFullParses 互补）
    addStreamPerfChars("settleParsedChars", content.length);
  }, [content]);
  return <KiroMarkdown content={content} sources={sources} />;
});
