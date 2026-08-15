import { ProviderMetadata, StreamTextTransform, TextStreamPart, ToolSet } from "ai";

/**
 * Kiro Text-only Adaptive Smooth Stream Transform（Streaming UX V4.4 Real Provider Adaptive Cadence）。
 *
 * V4.3 基线（保持不变）：
 * - reasoning：native pass-through（Kiro 不渲染 reasoning，不人为慢放）
 * - text：text-only smoothing（lifecycle / tool 立即透传，顺序严格保持）
 * - client 24ms throttle 仍是唯一 render 合并层
 *
 * V4.4 新增语义：
 * 1. Phase-aware cadence：
 *    - execution（begin_final_answer 之前的 Agent progress/commentary）→ native 透传
 *      （一个 delta 一个 chunk，不切词、不 sleep——progress 快而干脆，client 24ms 已合并更新）
 *    - final-answer（tool-input-start 命中 finalAnswerToolName 之后）→ adaptive bounded shaping
 * 2. Bounded smoothing debt（防人工 backlog）：
 *    - 小 delta（≤ nativeDeltaChars）→ native pass-through，不二次慢放
 *    - 大 burst → 词级 shaping 但人工 lag 不超过 maxSmoothingLagMs，超出即 catch-up
 *      （增大 chunk 到 catchUpChunkChars、取消 delay）
 *    - debt = max(0, debt + actualSleep - pipelineIdle)：只有「真正 idle 的时间」
 *      才偿还 smoothing debt——idle 以 lastTransformCompletedAt 为基准（transform
 *      调用结束 → 下一次 text 到达），绝不用 transform start-to-start 当作 Provider
 *      间隔（TransformStream backpressure 会推迟下一次 invocation，自己的 sleep 会
 *      伪装成 Provider idle）。pipelineIdle ≥ runResetGapMs → 新 run，debt 归零。
 *    - V4.4.1：sleep 按真实 wall-clock 计（performance.now 前后差），debt/maxDebt
 *      反映真实人工延迟，而不是请求的 timer 参数（Node/Browser scheduler 可能
 *      4ms → 实际 6/8/15ms）
 * 3. 无尾随 sleep：最后一个 segment 发出后不 sleep，lifecycle / tool / text-end 立即继续
 * 4. Provider metadata 保真：拆段时 metadata 只附到该 delta 派生的最后一个 segment
 *    （AI SDK 客户端 upsertTextContentPart 是 last-wins 合并契约，语义等价不重复；
 *     delta 无 metadata 时不复制陈旧 metadata）
 *
 * 不引入任何新 timer 架构（无 setInterval / 全局队列 / rAF / typewriter）。
 * 实现为最小 Text-only smoother：把同一 TransformStream 拆双通道会破坏 ordering/backpressure 证明。
 *
 * 注意：pipelineIdle 可能仍包含下游 backpressure 贡献的空闲，绝不把它命名为/解释为
 * Provider arrival interval——真实 Provider arrival timing 只在 benchmark source 侧记录。
 */

/** 单个 delta 不超过该字符数 → final-answer 阶段也 native pass-through */
export const KIRO_NATIVE_DELTA_CHARS = 40;
/**
 * 人工 smoothing 最大滞后预算（V4.4.1 定标结论：48 → 24）。
 * 真实 DeepSeek replay（同一 capture 跑 24/32/48）完成延迟 spread 仅 5ms——
 * 细流下 shaping 基本不触发，maxLag 只影响 burst 头部 pacing 窗口；
 * 24ms = 恰好一个 client throttle 帧，burst 保护（catch-up 128-char chunking）不变，
 * 人工延迟最小。synthetic 3-burst invariant 在 24 下同样成立（见 unit tests）。
 */
export const KIRO_MAX_SMOOTHING_LAG_MS = 24;
/** catch-up 模式的大块字符数（frame-friendly，避免一次 300~1000 字一坨跳出） */
export const KIRO_CATCH_UP_CHUNK_CHARS = 128;
/** Provider 停顿超过该间隔视为新 run（debt 归零） */
export const KIRO_RUN_RESET_GAP_MS = 150;

export interface TextOnlySmoothStreamOptions {
  /** 词切分器（现有中文 Intl.Segmenter；只作用于 final-answer shaping） */
  chunking: Intl.Segmenter;
  /** final-answer 阶段词间 shaping 间隔 ms（V4.2 baseline 4ms） */
  delayInMs: number;
  /** 小 delta native 阈值（默认 40 chars） */
  nativeDeltaChars?: number;
  /** 人工 smoothing 最大滞后预算（默认 48ms） */
  maxSmoothingLagMs?: number;
  /** catch-up 大块字符数（默认 128） */
  catchUpChunkChars?: number;
  /** Provider 停顿 → 新 run 的间隔（默认 150ms） */
  runResetGapMs?: number;
  /** Final Answer boundary tool name（tool-input-start 命中后切换 final-answer phase） */
  finalAnswerToolName?: string;
}

export type TextOnlySmoothPhase = "execution" | "final-answer";

/** test-only transform 统计（production 零成本：只记账，不外发） */
export interface TextOnlySmoothStats {
  providerTextDeltas: number;
  providerTextChars: number;
  emittedTextChunks: number;
  emittedTextChars: number;
  maxSmoothingDebtMs: number;
  avgSmoothingDebtMs: number;
  catchUpActivations: number;
  /** execution（progress）文本从进入 transform 到发出的累计等待 ms（应 ≈ 0） */
  progressTextDelayMs: number;
  /** lifecycle part（tool/finish/abort/error…）到达 → 发出的累计等待 ms（应 ≈ 0） */
  toolFlushDelayMs: number;
  maxEmittedChunkChars: number;
}

export interface TextOnlySmoothStreamTransform<TOOLS extends ToolSet>
  extends StreamTextTransform<TOOLS> {
  /** 最近一次 transform 实例的统计（test-only） */
  getStats(): Readonly<TextOnlySmoothStats> | null;
}

export function textOnlySmoothStream<TOOLS extends ToolSet>({
  chunking,
  delayInMs,
  nativeDeltaChars = KIRO_NATIVE_DELTA_CHARS,
  maxSmoothingLagMs = KIRO_MAX_SMOOTHING_LAG_MS,
  catchUpChunkChars = KIRO_CATCH_UP_CHUNK_CHARS,
  runResetGapMs = KIRO_RUN_RESET_GAP_MS,
  finalAnswerToolName = "begin_final_answer",
}: TextOnlySmoothStreamOptions): TextOnlySmoothStreamTransform<TOOLS> {
  let latestStats: Readonly<TextOnlySmoothStats> | null = null;

  const streamTransform = ((_streamOptions: {
    tools: TOOLS;
    stopStream: () => void;
  }) => {
    let buffer = "";
    let id = "";
    let type: "text-delta" | undefined;
    let providerMetadata: ProviderMetadata | undefined;
    let phase: TextOnlySmoothPhase = "execution";
    /** 上一次 transform 调用处理完成时刻（debt 偿还的 idle 基准；不是 Provider arrival） */
    let lastTransformCompletedAt = 0;
    let smoothingDebtMs = 0;

    const stats: TextOnlySmoothStats = {
      providerTextDeltas: 0,
      providerTextChars: 0,
      emittedTextChunks: 0,
      emittedTextChars: 0,
      maxSmoothingDebtMs: 0,
      avgSmoothingDebtMs: 0,
      catchUpActivations: 0,
      progressTextDelayMs: 0,
      toolFlushDelayMs: 0,
      maxEmittedChunkChars: 0,
    };
    let debtSamples = 0;
    latestStats = stats;

    const detectChunk = (buf: string): string | null => {
      if (buf.length === 0) return null;
      const iterator = chunking.segment(buf)[Symbol.iterator]();
      const first = iterator.next().value as { segment: string } | undefined;
      return first?.segment ?? null;
    };

    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const emit = (
      controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>,
      text: string,
      attachMeta: boolean
    ) => {
      controller.enqueue({
        type: "text-delta",
        text,
        id,
        ...(attachMeta && providerMetadata != null ? { providerMetadata } : {}),
      });
      stats.emittedTextChunks += 1;
      stats.emittedTextChars += text.length;
      if (text.length > stats.maxEmittedChunkChars) stats.maxEmittedChunkChars = text.length;
    };

    /** 残余 buffer 作为单个 part 立即发出（id 切换、lifecycle、stream close） */
    const flushBuffer = (
      controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>
    ) => {
      if (buffer.length > 0 && type !== undefined) {
        emit(controller, buffer, true);
        buffer = "";
        providerMetadata = undefined;
      }
    };

    /** 每 delta 入场：只有真实 pipeline idle 才偿还 debt；长 idle → 新 run 归零 */
    const accountDebt = (pipelineIdleMs: number) => {
      if (pipelineIdleMs > runResetGapMs) {
        smoothingDebtMs = 0;
      } else {
        smoothingDebtMs = Math.max(0, smoothingDebtMs - pipelineIdleMs);
      }
      debtSamples += 1;
      stats.avgSmoothingDebtMs =
        (stats.avgSmoothingDebtMs * (debtSamples - 1) + smoothingDebtMs) / debtSamples;
      if (smoothingDebtMs > stats.maxSmoothingDebtMs) stats.maxSmoothingDebtMs = smoothingDebtMs;
    };

    /** debt 增加后立即更新 max（不依赖下一次 accountDebt） */
    const addDebt = (ms: number) => {
      smoothingDebtMs += ms;
      if (smoothingDebtMs > stats.maxSmoothingDebtMs) stats.maxSmoothingDebtMs = smoothingDebtMs;
    };

    /**
     * final-answer 自适应 shaping：词级 4ms 只花在真实时间预算内（spent 按 actual
     * wall-clock 累计）；预算耗尽 → catch-up 大块无 delay。无尾随 sleep。
     */
    const emitShaped = async (
      controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>
    ) => {
      const budgetMs = Math.max(0, maxSmoothingLagMs - smoothingDebtMs);
      let spentMs = 0;
      while (buffer.length > 0) {
        const match = detectChunk(buffer);
        if (match == null) break; // 防御：不可切残余留给下一 delta（metadata 随之保留）
        const rest = buffer.slice(match.length);
        const isLast = rest.length === 0;
        if (spentMs >= budgetMs) {
          // catch-up：frame-friendly 大块，不 sleep
          stats.catchUpActivations += 1;
          const chunkLen = Math.min(catchUpChunkChars, buffer.length);
          const chunk = buffer.slice(0, chunkLen);
          const chunkIsLast = chunkLen === buffer.length;
          buffer = buffer.slice(chunkLen);
          emit(controller, chunk, chunkIsLast);
          if (chunkIsLast) providerMetadata = undefined;
        } else {
          buffer = rest;
          emit(controller, match, isLast);
          if (isLast) {
            providerMetadata = undefined;
          } else {
            const delay = Math.min(delayInMs, budgetMs - spentMs);
            if (delay > 0) {
              // V4.4.1：测量真实 sleep 时长（scheduler 可能 4ms → 6/8/15ms）
              const started = performance.now();
              await sleep(delay);
              const actual = performance.now() - started;
              spentMs += actual;
              addDebt(actual);
            }
          }
        }
      }
    };

    /** native 透传：整个 buffer 一个 chunk，不切词不 sleep */
    const emitNative = (controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>) => {
      if (buffer.length === 0) return;
      emit(controller, buffer, true);
      buffer = "";
      providerMetadata = undefined;
    };

    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      async transform(chunk, controller) {
        const now = performance.now();
        if (chunk.type !== "text-delta") {
          const t0 = now;
          // reasoning / tool / step / finish / error / abort：先 flush 未完成 text（同步），立即透传
          flushBuffer(controller);
          if (chunk.type === "tool-input-start") {
            if (chunk.toolName === finalAnswerToolName) phase = "final-answer";
          }
          controller.enqueue(chunk);
          stats.toolFlushDelayMs += performance.now() - t0;
          lastTransformCompletedAt = performance.now();
          return;
        }
        // ---- text-delta ----
        // V4.4.1：idle 基准 = 上次 transform 处理完成 → 本次真正开始（TransformStream
        // backpressure 会推迟 invocation，绝不用 start-to-start 当 Provider 间隔；
        // 自己的 sleep 不进入 idle，debt 只能被真实空闲偿还）
        const pipelineIdleMs =
          lastTransformCompletedAt > 0 ? now - lastTransformCompletedAt : 0;
        stats.providerTextDeltas += 1;
        stats.providerTextChars += chunk.text.length;
        accountDebt(pipelineIdleMs);

        if (buffer.length > 0 && chunk.id !== id) {
          flushBuffer(controller);
        }
        buffer += chunk.text;
        id = chunk.id;
        type = chunk.type;
        if (chunk.providerMetadata != null) {
          providerMetadata = chunk.providerMetadata;
        }

        if (phase === "execution") {
          // progress：native（一个 delta 一个 chunk；client 24ms 已合并 React 更新）
          const t0 = now;
          emitNative(controller);
          stats.progressTextDelayMs += performance.now() - t0;
          lastTransformCompletedAt = performance.now();
          return;
        }
        if (buffer.length <= nativeDeltaChars) {
          // 细流：不二次慢放
          emitNative(controller);
          lastTransformCompletedAt = performance.now();
          return;
        }
        await emitShaped(controller);
        lastTransformCompletedAt = performance.now();
      },
      flush(controller) {
        // stream close：残留 buffer 不丢失
        flushBuffer(controller);
      },
    });
  }) as unknown as TextOnlySmoothStreamTransform<TOOLS>;

  streamTransform.getStats = () => latestStats;
  return streamTransform;
}
