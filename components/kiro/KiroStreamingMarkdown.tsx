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
  KiroMarkdownTailState,
} from "@/lib/ai/streaming/markdownBlocks";
import {
  bumpStreamPerf,
  addStreamPerfChars,
  addStreamPerfMillis,
} from "@/lib/ai/perf/streamPerf";

/**
 * 长单段的安全 inline chunk（Streaming UX V3 Phase 4 + V4.3 inline-fragment）：
 * 无空行的超长 block 被切成有界安全 chunk（不切断 inline 构造 / 不在 list·heading·quote
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

// ============================================================
// V4.5 Promotion-Stable Markdown DOM
//
// 核心原则：用户已经看到的文字，在它从「正在输出」变成「稳定段落」时，
// 不应该重新生成一遍 DOM。
//
// 模型：Block 是同一个实体（不是 stable/tail 两类实体）。渲染层把
// stableBlocks + tail 统一 derive 为 KiroStreamingRenderBlock[]，
// 每个 block 由同一个 <KiroStreamingBlock /> 组件渲染：
// - key = `${epoch}:${ordinal}`——append-only 时 ordinal 稳定，promotion 不改 key；
//   非 append-only（retry/regenerate/edit/history restore）→ epoch += 1，全部换 key
// - active → stable 只改变内部逻辑状态；text/tailState 未变时 React.memo comparator
//   直接跳过 → promotion = 0 render / 0 parse / 0 DOM replacement
// - 长单段的 incremental inline state（KiroInlineScanState）由 block 自己持有：
//   promotion 后依然是 chunks A/B/C + final tail，而不是 KiroMarkdown(full block)
// - fence/math 未闭合 → fallback 容器；闭合瞬间允许一次 inner semantic swap
//   （fallback → canonical block renderer），outer block 保持同一 node；
//   闭合后再 promotion 不产生第二次 swap
// - settleSafety canonical fallback（loose list / table 等）保持不变：那是必要的
//   最终 canonicalization，与本任务的 streaming block promotion 是两件事
// ============================================================

export interface KiroStreamingRenderBlock {
  /** 逻辑 block 序号（append-only 中 promotion 前后不变） */
  ordinal: number;
  text: string;
  state: "active" | "stable";
  tailState: KiroMarkdownTailState;
}

/**
 * 统一 Streaming Block：active（text 仍在增长）与 stable（text 冻结）用同一组件 /
 * 同一 outer wrapper。promotion 时 comparator 在 text/tailState/sources 未变时跳过
 * render（active→stable 不影响 DOM 输出）。
 */
const KiroStreamingBlock = React.memo(
  function KiroStreamingBlock({
    block,
    sources,
    streaming,
    epoch,
  }: {
    block: KiroStreamingRenderBlock;
    sources?: KiroSourceMeta[];
    streaming: boolean;
    epoch: number;
  }) {
    bumpStreamPerf("blockRenders");
    React.useEffect(() => {
      bumpStreamPerf("blockMounts");
      return () => {
        bumpStreamPerf("blockUnmounts");
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const spacing = block.ordinal > 0;
    const isLongText = block.tailState === "text" && block.text.length > KIRO_INLINE_STREAM_WINDOW;

    // V4.5：incremental inline state 属于 block 自己——promotion 后 chunks/tail 冻结保留，
    // 不再回到 KiroMarkdown(full block) 重新 parse。
    const inlineScanRef = React.useRef<KiroInlineScanState | null>(null);
    const settleRecordedRef = React.useRef(false);
    const inline = React.useMemo(() => {
      if (!isLongText) {
        inlineScanRef.current = null;
        return { chunks: [] as string[], tail: block.text };
      }
      const prev = inlineScanRef.current;
      const next =
        prev && block.text.startsWith(prev.prefix)
          ? advanceKiroInlineScan(prev, block.text)
          : createKiroInlineScanState(block.text);
      inlineScanRef.current = next;
      // settle 帧（streaming=false）且 text 真正增长：re-parse 成本 = 最后 mutable window
      if (!streaming && !settleRecordedRef.current && next !== prev) {
        settleRecordedRef.current = true;
        addStreamPerfChars("settleParsedChars", next.tail.length);
      }
      return { chunks: next.chunks, tail: next.tail };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [block.text, isLongText, streaming]);

    const fragmentSafe =
      inline.chunks.length > 0 &&
      inline.chunks.every(isFragmentSafeChunk) &&
      isFragmentSafeChunk(inline.tail);

    let inner: React.ReactNode;
    if (block.tailState === "fence") {
      // 未闭合 fence：稳定几何 fallback（outer 不变；闭合瞬间 inner 允许一次替换）
      inner = <KiroStreamingTail text={block.text} tailState="fence" sources={sources} />;
    } else if (block.tailState === "math") {
      inner = <KiroStreamingTail text={block.text} tailState="math" sources={sources} />;
    } else if (fragmentSafe) {
      inner = (
        <div
          className="kiro-markdown text-charcoal"
          style={{ fontSize: "var(--kiro-output-font-size)", lineHeight: 1.74 }}
        >
          <p className="mb-0" data-testid="kiro-inline-fragment-paragraph">
            {inline.chunks.map((chunk, i) => (
              <InlineChunkBlock key={i} text={chunk} sources={sources} />
            ))}
            {inline.tail.length > 0 && <InlineChunkBlock text={inline.tail} sources={sources} />}
          </p>
        </div>
      );
    } else {
      inner = <KiroMarkdown content={block.text} sources={sources} />;
    }

    return (
      <div
        className={spacing ? "mt-[0.8em]" : undefined}
        data-kiro-stream-block-id={`${block.ordinal}`}
        data-kiro-stream-epoch={`${epoch}`}
      >
        {inner}
      </div>
    );
  },
  (prev, next) => {
    // text / tailState / sources 未变 → DOM 输出一致：
    // state active→stable（promotion）与 streaming true→false（settle）都直接跳过
    if (prev.block.text !== next.block.text) return false;
    if (prev.block.tailState !== next.block.tailState) return false;
    if (prev.sources !== next.sources) return false;
    return true;
  }
);

interface StreamingSplit {
  stableBlocks: string[];
  tail: string;
  tailState: KiroMarkdownTailState;
  /** settled 时是否复用最后 streaming 扫描树（zero-reparse） */
  reuse: boolean;
  /** settled 复用但存在无法证明独立的结构 → 需要低优先级 canonical fallback */
  canonicalPending: boolean;
}

/**
 * Kiro Streaming Markdown（Worklog V2 Task 4 + Streaming UX V2 Phase 2 + V3 Phase 4 + V4.2 +
 * V4.3 + V4.4 + V4.5）：所有 block（stable + active tail）由统一 KiroStreamingBlock 渲染，
 * promotion 保持同一 DOM node / 同一 inline chunk representation。
 *
 * V4.2 Hot Path：streaming 时用 Incremental Markdown Scan State（lib/ai/streaming/markdownBlocks）——
 * append-only 内容只扫描新增 suffix，stable prefix 永不重扫（block scanner + 长单段 inline 窗口）。
 *
 * V4.3 Zero-stall Settle Handoff：streaming=false 时不再全量重 render——
 * 复用最后 streaming 扫描树；settleSafety 判定的 canonicalize 结构走两阶段 handoff
 * （Phase 1 保留 streaming DOM，Phase 2 startTransition 低优先级完整 render）。
 *
 * V4.5 Promotion-Stable：active → stable 的 blank-line promotion 是 render no-op
 * （memo comparator 跳过）；长单段 inline state 随 block 冻结；fence/math 只允许
 * 闭合瞬间一次 inner semantic swap。
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
  // 两阶段 handoff：settled 且需要 canonical fallback 时置 true → 渲染完整 KiroMarkdown
  const [canonicalRender, setCanonicalRender] = React.useState(false);
  // settle 决策只统计一次（StrictMode 双跑防护）
  const settleReportedRef = React.useRef(false);
  const canonicalReportedRef = React.useRef(false);
  // V4.5：render epoch（非 append-only reset 时 +1，block key 全部改变）
  const renderEpochRef = React.useRef(0);
  const lastPrefixRef = React.useRef<string | null>(null);
  const prevBlocksRef = React.useRef<{ epoch: number; blocks: KiroStreamingRenderBlock[] } | null>(null);

  const split = React.useMemo<StreamingSplit>(() => {
    if (streaming) {
      settleReportedRef.current = false;
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
      // V4.5：settle 时最终内容已定——最后一行（partial marker 曾被延迟）必须纳入
      // fence/math 评估（闭合的最终 fence/math 在 settle 正确切换为 text 态）
      let inFence = next.inFence;
      let inDisplayMath = next.inDisplayMath;
      const finalLine = next.tailLastLine.trim();
      if (finalLine.startsWith("```")) {
        inFence = !inFence;
      } else if (finalLine.startsWith("$$")) {
        inDisplayMath = !inDisplayMath;
      }
      const tailState: StreamingSplit["tailState"] = inFence ? "fence" : inDisplayMath ? "math" : "text";
      if (!settleReportedRef.current) {
        settleReportedRef.current = true;
        bumpStreamPerf("settleTransitions");
        for (let i = 0; i < next.stableBlocks.length; i++) bumpStreamPerf("settleReusedBlocks");
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

  // V4.5：derive render blocks（stableBlocks + tail → 统一 block 列表）+ epoch / promotion 检测
  const blocks = React.useMemo<KiroStreamingRenderBlock[]>(() => {
    // 非 append-only（retry / regenerate / edit / history restore）→ render epoch +1
    if (lastPrefixRef.current != null && !content.startsWith(lastPrefixRef.current)) {
      renderEpochRef.current += 1;
    }
    lastPrefixRef.current = content;
    const epoch = renderEpochRef.current;

    const stable: KiroStreamingRenderBlock[] = split.stableBlocks.map((text, i) => ({
      ordinal: i,
      text,
      state: "stable",
      tailState: "text",
    }));
    const tail: KiroStreamingRenderBlock[] =
      split.tail.length > 0
        ? [
            {
              ordinal: split.stableBlocks.length,
              text: split.tail,
              // settle-reuse：tail 已是最终内容 → stable；streaming 中 → active
              state: streaming ? "active" : "stable",
              tailState: split.tailState,
            },
          ]
        : [];
    const next = [...stable, ...tail];

    // promotion 检测（同 epoch 内 active → stable；正常应为 memo skip = 0 render）
    const prev = prevBlocksRef.current;
    if (prev && prev.epoch === epoch) {
      for (const b of next) {
        const prevBlock = prev.blocks.find((p) => p.ordinal === b.ordinal && p.state === "active");
        if (prevBlock && b.state === "stable") {
          bumpStreamPerf("blockPromotions");
          // promotion 帧实际重 parse 字符量：
          // - text/tailState 未变 → comparator 跳过 → 0
          // - 变化（段落末段与空行同 chunk 到达）→ 至多一次最终渲染；长单段走
          //   incremental inline advance（chunks memo 命中），re-parse ≤ 最后 mutable
          //   window（≤ 2×window 保守上界），绝不重新 KiroMarkdown(full block)
          if (prevBlock.text !== b.text || prevBlock.tailState !== b.tailState) {
            addStreamPerfChars(
              "promotionParsedChars",
              Math.min(b.text.length, KIRO_INLINE_STREAM_WINDOW * 2)
            );
          }
        }
      }
    }
    prevBlocksRef.current = { epoch, blocks: next };
    return next;
  }, [split, content, streaming]);

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
      {blocks.map((b) => (
        <KiroStreamingBlock
          key={`${renderEpochRef.current}:${b.ordinal}`}
          block={b}
          sources={sources}
          streaming={streaming}
          epoch={renderEpochRef.current}
        />
      ))}
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
