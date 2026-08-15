import { ProviderMetadata, StreamTextTransform, TextStreamPart, ToolSet } from "ai";

/**
 * Kiro Text-only Smooth Stream Transform（Streaming UX V4.3 Phase-aware Streaming）。
 *
 * AI SDK 自带 smoothStream 会同时平滑 text 与 reasoning；Kiro 的 reasoning 永远不可见
 * （不渲染到 Worklog / Final Answer / History / Copy），对 reasoning 做 4ms×N 的词级
 * 排队没有任何用户阅读价值，只会人为延迟：
 *   reasoning finished → Tool Call / Final Answer
 * 本 transform 实现「Reasoning native pass-through + Text light smoothing」：
 *
 * - reasoning-start / reasoning-delta / reasoning-end → 立即透传（不 chunk、不 delay）
 * - text-start / text-delta / text-end → 保留现有中文 Intl.Segmenter light shaping（4ms）
 * - tool / step / finish / error / abort 等生命周期 part → 立即透传
 *
 * 与 smoothStream 相同的流契约：
 * - 单个 pending text buffer（type/id 切换或其它 part 到达时先 flush，保持原始顺序）
 * - reasoning 与 text 交错时顺序严格保持（reasoning 到来前 flush text buffer）
 * - reasoning 是 AI SDK 内部真实 stream 的一部分：只是「不人为等待」，绝不 drop / 改写
 *
 * 实现为最小 Text-only smoother（不复用 smoothStream 内部），
 * 因为把同一 TransformStream 拆成双通道会破坏 ordering / backpressure 证明。
 */
export interface TextOnlySmoothStreamOptions {
  /** 词切分器（现有中文 Intl.Segmenter；只作用于 text 部分） */
  chunking: Intl.Segmenter;
  /** 词间间隔 ms（V4.2 baseline 4ms） */
  delayInMs: number;
}

export function textOnlySmoothStream<TOOLS extends ToolSet>({
  chunking,
  delayInMs,
}: TextOnlySmoothStreamOptions): StreamTextTransform<TOOLS> {
  let buffer = "";
  let id = "";
  let type: "text-delta" | undefined;
  let providerMetadata: ProviderMetadata | undefined;

  const detectChunk = (buf: string): string | null => {
    if (buf.length === 0) return null;
    const iterator = chunking.segment(buf)[Symbol.iterator]();
    const first = iterator.next().value as { segment: string } | undefined;
    return first?.segment ?? null;
  };

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const flushBuffer = (
    controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>
  ) => {
    if (buffer.length > 0 && type !== undefined) {
      controller.enqueue({
        type,
        text: buffer,
        id,
        ...(providerMetadata != null ? { providerMetadata } : {}),
      });
      buffer = "";
      providerMetadata = undefined;
    }
  };

  return () =>
    new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      async transform(chunk, controller) {
        // reasoning / tool / step / finish / error / abort：立即透传（先 flush 未完成的 text）
        if (chunk.type !== "text-delta") {
          flushBuffer(controller);
          controller.enqueue(chunk);
          return;
        }
        if ((chunk.type !== type || chunk.id !== id) && buffer.length > 0) {
          flushBuffer(controller);
        }
        buffer += chunk.text;
        id = chunk.id;
        type = chunk.type;
        if (chunk.providerMetadata != null) {
          providerMetadata = chunk.providerMetadata;
        }
        let match: string | null;
        while ((match = detectChunk(buffer)) != null) {
          controller.enqueue({ type, text: match, id });
          buffer = buffer.slice(match.length);
          await sleep(delayInMs);
        }
      },
    });
}
