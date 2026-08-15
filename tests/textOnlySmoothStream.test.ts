import { describe, it, expect } from "vitest";
import { TextStreamPart } from "ai";
import { textOnlySmoothStream } from "@/lib/ai/streaming/textOnlySmoothStream";

/**
 * Text-only Smooth Stream（Streaming UX V4.3）：
 * - reasoning：立即透传（不 chunk、不 delay、内容不改写、顺序保持）
 * - text：中文 Intl.Segmenter light shaping（4ms）
 * - tool / lifecycle：立即透传
 */

const SEGMENTER = new Intl.Segmenter("zh", { granularity: "word" });
const DELAY_MS = 4;

type AnyPart = TextStreamPart<Record<string, never>>;

function part<T extends AnyPart["type"]>(type: T, extra?: Record<string, unknown>): AnyPart {
  return { type, ...(extra as object) } as AnyPart;
}

async function runTransform(
  input: AnyPart[],
  delayInMs = DELAY_MS
): Promise<{ out: AnyPart[]; elapsedMs: number }> {
  const transform = textOnlySmoothStream<Record<string, never>>({
    chunking: SEGMENTER,
    delayInMs,
  });
  const ts = transform({ tools: {}, stopStream: () => {} });
  const source = new ReadableStream<AnyPart>({
    start(controller) {
      for (const p of input) controller.enqueue(p);
      controller.close();
    },
  });
  const out: AnyPart[] = [];
  const start = performance.now();
  await source.pipeThrough(ts).pipeTo(
    new WritableStream<AnyPart>({
      write(p) {
        out.push(p);
      },
    })
  );
  return { out, elapsedMs: performance.now() - start };
}

/** Intl.Segmenter("zh", word) 的词数（与 transform 同一切分器） */
function wordCount(text: string): number {
  return Array.from(SEGMENTER.segment(text)).length;
}

describe("textOnlySmoothStream（Phase-aware Streaming V4.3）", () => {
  it("reasoning → Tool：part 顺序完全一致，内容不 chunk 不改写，零人为 delay", async () => {
    const reasoningDeltas: AnyPart[] = Array.from({ length: 200 }, (_, i) =>
      part("reasoning-delta", { id: "r1", text: `推理步骤第${i}步 内容` })
    );
    const input: AnyPart[] = [
      part("reasoning-start", { id: "r1" }),
      ...reasoningDeltas,
      part("reasoning-end", { id: "r1" }),
      part("tool-input-start", {
        id: "call_1",
        toolCallId: "call_1",
        toolName: "search_assignments",
      }),
      part("tool-input-delta", {
        id: "call_1",
        toolCallId: "call_1",
        inputTextDelta: '{"query":"q"}',
      }),
      part("finish-step"),
      part("finish", { finishReason: "stop" }),
    ];
    const { out, elapsedMs } = await runTransform(input);
    // 输出顺序与输入完全一致（200 reasoning delta 原样透传，不做词级切分）
    expect(out.map((p) => p.type)).toEqual(input.map((p) => p.type));
    expect((out[1] as { text: string }).text).toBe("推理步骤第0步 内容");
    expect((out[200] as { text: string }).text).toBe("推理步骤第199步 内容");
    // 200 × 4ms ≈ 800ms 的人为排队必须消失：透传耗时与 reasoning 数量无关
    expect(elapsedMs).toBeLessThan(200);
  });

  it("text delta 仍正常 chunk + 4ms light smoothing", async () => {
    const text = "今天天气很好";
    const words = wordCount(text);
    const input: AnyPart[] = [
      part("text-start", { id: "t1" }),
      part("text-delta", { id: "t1", text }),
      part("text-end", { id: "t1" }),
    ];
    const { out, elapsedMs } = await runTransform(input);
    const types = out.map((p) => p.type);
    expect(types).toEqual(["text-start", ...Array(words).fill("text-delta"), "text-end"]);
    const deltas = out.filter((p) => p.type === "text-delta") as { text: string }[];
    expect(deltas.map((d) => d.text).join("")).toBe(text);
    // words 个 chunk → words-1 次间隔：仍保留 shaping
    expect(elapsedMs).toBeGreaterThanOrEqual((words - 1) * 4);
  });

  it("text 与 reasoning 交错：顺序严格保持（text buffer 先 flush 再透传 reasoning）", async () => {
    const first = "第一段话";
    const second = "第二段话";
    const firstWords = wordCount(first);
    const input: AnyPart[] = [
      part("text-delta", { id: "t1", text: first }),
      part("reasoning-start", { id: "r1" }),
      part("reasoning-delta", { id: "r1", text: "思考过程" }),
      part("reasoning-end", { id: "r1" }),
      part("text-delta", { id: "t1", text: second }),
    ];
    const { out } = await runTransform(input);
    const types = out.map((p) => p.type);
    // 第一段话 chunks 先于 reasoning；reasoning 原样；第二段话 chunks 在后
    expect(types.slice(0, firstWords + 1)).toEqual([
      ...Array(firstWords).fill("text-delta"),
      "reasoning-start",
    ]);
    expect((out[firstWords + 1] as { text: string }).text).toBe("思考过程");
    expect(types.indexOf("text-end")).toBe(-1);
    expect(out[firstWords + 2].type).toBe("reasoning-end");
    expect((out[out.length - 1] as { text: string }).text).toBe("话");
  });

  it("reasoning 内容不丢失：不做 chunk 切分（原文一个 part 原样透传）", async () => {
    const longReasoning = "这是一段很长的推理内容，包含标点符号，以及**多个**特殊构造[[source:doc-1:p12]]";
    const { out } = await runTransform([
      part("reasoning-start", { id: "r9" }),
      part("reasoning-delta", { id: "r9", text: longReasoning }),
      part("reasoning-end", { id: "r9" }),
    ]);
    expect(out).toHaveLength(3);
    expect((out[1] as { text: string }).text).toBe(longReasoning);
  });

  it("finish / error / abort 立即透传（不排队）", async () => {
    const { out, elapsedMs } = await runTransform([
      part("finish-step"),
      part("error", { error: new Error("x") }),
      part("abort", { reason: new Error("stop") }),
      part("finish", { finishReason: "stop" }),
    ]);
    expect(out.map((p) => p.type)).toEqual(["finish-step", "error", "abort", "finish"]);
    expect(elapsedMs).toBeLessThan(50);
  });
});
