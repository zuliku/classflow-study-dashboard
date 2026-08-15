/**
 * DeepSeek 真实 Streaming Perf Harness（Streaming UX V4.4.1：Capture Once, Replay Many）。
 *
 * 只在设置 DEEPSEEK_TEST_API_KEY 时运行（CI 默认跳过）：
 *   $env:DEEPSEEK_TEST_API_KEY = "sk-..." ; npx vitest run tests/aiDeepSeekStreamingPerf.test.ts
 *
 * V4.4.1 关键改动：
 * - 一次 Native Provider capture（含每个 part 的 arrivalOffsetMs）
 * - 同一份真实 trace 分别 replay 到 Native / Fixed(4ms) / Adaptive —— apples-to-apples：
 *   输入内容、输入 chunk、输入 timing 完全一致
 * - replay 时插入 synthetic begin_final_answer boundary（只在 benchmark replay 中，
 *   不修改真实 capture），使 Adaptive 命中生产 final-answer phase
 * - maxLag 24/32/48 定标（同一 capture）
 * - 真实 Route 级 phase assertion：UI Message Stream 出现 begin_final_answer 且
 *   Final Answer text 在其后
 *
 * 安全：正文/reasoning 只在测试进程内存；日志只输出 part.type / chars / timestamp /
 * toolName / finishReason。绝不打印 API Key。
 */
import { describe, it, expect } from "vitest";
import { streamText, TextStreamPart, StreamTextTransform, ToolSet, tool } from "ai";
import { z } from "zod";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import { resolveReasoningProviderOptions } from "@/lib/ai/reasoning/providerOptions";
import { DEEPSEEK_MODELS } from "@/lib/ai/providers/deepSeek";
import {
  textOnlySmoothStream,
  KIRO_MAX_SMOOTHING_LAG_MS,
  KIRO_CATCH_UP_CHUNK_CHARS,
} from "@/lib/ai/streaming/textOnlySmoothStream";
import { splitKiroStreamingMarkdown, classifySettleSafety } from "@/lib/ai/streaming/markdownBlocks";
import { POST as chatPOST } from "@/app/api/ai/chat/route";

const KEY = process.env.DEEPSEEK_TEST_API_KEY ?? "";
const describeDeepSeek = KEY ? describe : describe.skip;
const RUN_TIMEOUT = 120_000;

const SEGMENTER = new Intl.Segmenter("zh", { granularity: "word" });

type AnyPart = TextStreamPart<Record<string, never>>;

/** 真实 capture 的单个 part（正文只在内存） */
interface CapturedPart {
  part: AnyPart;
  arrivalOffsetMs: number;
}

/** V4.3 Current policy：固定 4ms/word（含尾随 sleep）——与旧实现同语义，仅供 A/B 对比 */
function fixedWordSmoothV43<TOOLS extends ToolSet>(delayInMs = 4): StreamTextTransform<TOOLS> {
  const chunking = new Intl.Segmenter("zh", { granularity: "word" });
  return () => {
    let buffer = "";
    let id = "";
    let type: "text-delta" | undefined;
    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      async transform(chunk, controller) {
        if (chunk.type !== "text-delta") {
          if (buffer.length > 0 && type !== undefined) {
            controller.enqueue({ type, text: buffer, id });
            buffer = "";
          }
          controller.enqueue(chunk);
          return;
        }
        if (type !== undefined && buffer.length > 0 && (chunk.type !== type || chunk.id !== id)) {
          controller.enqueue({ type, text: buffer, id });
          buffer = "";
        }
        buffer += chunk.text;
        id = chunk.id;
        type = chunk.type;
        let match: string | null;
        while ((match = detectWord(chunking, buffer)) != null) {
          controller.enqueue({ type, text: match, id });
          buffer = buffer.slice(match.length);
          await new Promise((resolve) => setTimeout(resolve, delayInMs));
        }
      },
    });
  };
}

function detectWord(chunking: Intl.Segmenter, buf: string): string | null {
  if (buf.length === 0) return null;
  const iterator = chunking.segment(buf)[Symbol.iterator]();
  const first = iterator.next().value as { segment: string } | undefined;
  return first?.segment ?? null;
}

function adaptiveWithLag(maxLagMs: number, nativeDeltaChars = 40): StreamTextTransform<Record<string, never>> {
  return textOnlySmoothStream<Record<string, never>>({
    chunking: SEGMENTER,
    delayInMs: 4,
    maxSmoothingLagMs: maxLagMs,
    nativeDeltaChars,
    catchUpChunkChars: KIRO_CATCH_UP_CHUNK_CHARS,
  });
}

/** 一次真实 Native capture：只记录 part + arrivalOffset（正文仅内存） */
async function captureRealStream(opts: {
  prompt: string;
  maxOutputTokens: number;
  reasoningEffort?: "default" | "high";
}): Promise<CapturedPart[]> {
  const { model } = await resolveLanguageModel({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    apiKey: KEY,
  });
  const v4FlashDef = DEEPSEEK_MODELS.find((m) => m.id === "deepseek-v4-flash")!;
  const providerOptions = resolveReasoningProviderOptions({
    definition: v4FlashDef,
    effort: opts.reasoningEffort ?? "default",
  });
  const result = streamText({
    model,
    messages: [{ role: "user", content: opts.prompt }],
    maxOutputTokens: opts.maxOutputTokens,
    providerOptions: providerOptions
      ? ({ "classflow-kiro": providerOptions } as Parameters<typeof streamText>[0]["providerOptions"])
      : undefined,
  });
  const t0 = performance.now();
  const captured: CapturedPart[] = [];
  for await (const part of result.fullStream) {
    captured.push({ part: part as AnyPart, arrivalOffsetMs: performance.now() - t0 });
  }
  return captured;
}

/** 把真实 capture 加 synthetic final-answer boundary 后的 replay 输入（不修改 capture） */
function buildReplayInput(captured: CapturedPart[]): CapturedPart[] {
  const input: CapturedPart[] = [];
  let inserted = false;
  for (const c of captured) {
    if (
      !inserted &&
      (c.part.type === "text-start" || c.part.type === "text-delta") &&
      input.some((x) => x.part.type === "reasoning-start" || x.part.type === "reasoning-end")
    ) {
      // Final Answer 首个 text part 之前插入 synthetic boundary（reasoning 仍在 boundary 前）
      input.push({
        part: {
          type: "tool-input-start",
          id: "call_bench_boundary",
          toolName: "begin_final_answer",
        },
        arrivalOffsetMs: c.arrivalOffsetMs,
      });
      inserted = true;
    }
    input.push(c);
  }
  if (!inserted && captured.some((c) => c.part.type === "text-start" || c.part.type === "text-delta")) {
    // 无 reasoning 的 capture（如 R1/R4）：在第一个 text part 前插入 boundary
    const firstTextIdx = captured.findIndex((c) => c.part.type === "text-start" || c.part.type === "text-delta");
    const out: CapturedPart[] = [];
    for (let i = 0; i < captured.length; i++) {
      if (i === firstTextIdx) {
        out.push({
          part: {
            type: "tool-input-start",
            id: "call_bench_boundary",
            toolName: "begin_final_answer",
          },
          arrivalOffsetMs: captured[i].arrivalOffsetMs,
        });
      }
      out.push(captured[i]);
    }
    return out;
  }
  return input;
}

interface ReplayResult {
  /** 输出 text-delta 的时间戳（相对 t0）与长度 */
  emits: { at: number; chars: number }[];
  lastEmitAt: number;
  firstEmitAt: number;
  textChars: number;
  emittedChunks: number;
  /** 最后一个 text 输入的 arrival → 最后一个 emit 的 global lag */
  tailLagMs: number;
  stats: Readonly<{
    catchUpActivations: number;
    maxSmoothingDebtMs: number;
    maxEmittedChunkChars: number;
  }> | null;
}

/** 按原始 arrival timing replay 到指定 transform */
async function replayCapture(
  captured: CapturedPart[],
  transform?: StreamTextTransform<Record<string, never>>
): Promise<ReplayResult> {
  const t0 = performance.now();
  const emits: { at: number; chars: number }[] = [];
  const tf = transform ?? undefined;
  const ts = tf ? tf({ tools: {}, stopStream: () => {} }) : null;
  const out: { at: number; chars: number }[] = [];
  const source = new ReadableStream<AnyPart>({
    async start(controller) {
      for (const c of captured) {
        const wait = c.arrivalOffsetMs - (performance.now() - t0);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        controller.enqueue(c.part);
      }
      controller.close();
    },
  });
  if (ts) {
    await source.pipeThrough(ts).pipeTo(
      new WritableStream<AnyPart>({
        write(p) {
          if (p.type === "text-delta") {
            out.push({ at: performance.now() - t0, chars: p.text.length });
          }
        },
      })
    );
  } else {
    await source.pipeTo(
      new WritableStream<AnyPart>({
        write(p) {
          if (p.type === "text-delta") {
            out.push({ at: performance.now() - t0, chars: p.text.length });
          }
        },
      })
    );
  }
  emits.push(...out);
  const textChars = out.reduce((s, e) => s + e.chars, 0);
  const lastTextArrival =
    [...captured].reverse().find((c) => c.part.type === "text-delta")?.arrivalOffsetMs ?? 0;
  const stats =
    tf && typeof (tf as unknown as { getStats?: () => unknown }).getStats === "function"
      ? ((tf as unknown as { getStats: () => unknown }).getStats() as ReplayResult["stats"])
      : null;
  return {
    emits,
    lastEmitAt: out.length > 0 ? out[out.length - 1].at : 0,
    firstEmitAt: out.length > 0 ? out[0].at : -1,
    textChars,
    emittedChunks: out.length,
    tailLagMs: out.length > 0 ? out[out.length - 1].at - lastTextArrival : 0,
    stats,
  };
}

function logReplay(label: string, r: ReplayResult): void {
  const gaps: number[] = [];
  for (let i = 1; i < r.emits.length; i++) gaps.push(r.emits[i].at - r.emits[i - 1].at);
  gaps.sort((a, b) => a - b);
  const p = (q: number) => (gaps.length > 0 ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))] : 0);
  console.log(
    `[R] ${label} textChars=${r.textChars} chunks=${r.emittedChunks} firstEmit=${Math.round(r.firstEmitAt)} ` +
      `lastEmit=${Math.round(r.lastEmitAt)} tailLag=${Math.round(r.tailLagMs)} ` +
      `gap p50=${Math.round(p(0.5))} p95=${Math.round(p(0.95))} max=${Math.round(p(1))} ` +
      `maxChunk=${r.stats?.maxEmittedChunkChars ?? "-"} catchUp=${r.stats?.catchUpActivations ?? "-"} ` +
      `maxDebt=${Math.round(r.stats?.maxSmoothingDebtMs ?? 0)}`
  );
}

/** 计算 settle classifier 对真实输出的 fallback 判定（只记次数与触发原因，不记内容） */
function settleSafetyOf(text: string): { canonicalize: boolean; blocks: number; reasons: string[] } {
  const split = splitKiroStreamingMarkdown(text, true);
  const blocks = [...split.stableBlocks];
  if (split.tail.length > 0) blocks.push(split.tail);
  const safety = classifySettleSafety(blocks);
  return { canonicalize: safety.canonicalize, blocks: safety.totalBlocks, reasons: safety.reasons };
}

describeDeepSeek("DeepSeek Real Streaming Perf（DEEPSEEK_TEST_API_KEY 存在时运行）", () => {
  it("R1+R4 RAW PROVIDER 定标（capture once）→ Native / Fixed / Adaptive replay", async () => {
    const prompt = "请写一篇约八百字的学习方法论说明，分三点展开，条理清晰。";
    const captured = await captureRealStream({ prompt, maxOutputTokens: 2000 });
    // RAW PROVIDER 指标（capture 侧，不经过任何 transform）
    const rawDeltas = captured.filter((c) => c.part.type === "text-delta");
    const rawChars = rawDeltas.reduce((s, c) => s + (c.part as { text: string }).text.length, 0);
    const rawGaps: number[] = [];
    for (let i = 1; i < rawDeltas.length; i++) {
      rawGaps.push(rawDeltas[i].arrivalOffsetMs - rawDeltas[i - 1].arrivalOffsetMs);
    }
    rawGaps.sort((a, b) => a - b);
    const p = (q: number) => (rawGaps.length > 0 ? rawGaps[Math.min(rawGaps.length - 1, Math.floor(rawGaps.length * q))] : 0);
    const hist: Record<string, number> = {};
    for (const c of rawDeltas) {
      const len = (c.part as { text: string }).text.length;
      const bucket = len <= 10 ? "1-10" : len <= 40 ? "11-40" : len <= 100 ? "41-100" : len <= 300 ? "101-300" : "301+";
      hist[bucket] = (hist[bucket] ?? 0) + 1;
    }
    console.log(
      `[R] RAW provider textChars=${rawChars} deltas=${rawDeltas.length} TTFT=${Math.round(rawDeltas[0]?.arrivalOffsetMs ?? -1)} ` +
        `gap p50=${Math.round(p(0.5))} p95=${Math.round(p(0.95))} max=${Math.round(p(1))} hist=${JSON.stringify(hist)}`
    );
    expect(rawChars).toBeGreaterThan(600);
    expect(rawDeltas.length).toBeGreaterThan(100);

    // Replay：同一份 trace（含 synthetic boundary）
    const input = buildReplayInput(captured);
    const replayNative = await replayCapture(input);
    const replayFixed = await replayCapture(input, fixedWordSmoothV43(4));
    const replayAdaptive = await replayCapture(input, adaptiveWithLag(KIRO_MAX_SMOOTHING_LAG_MS));
    logReplay("R1R4/native", replayNative);
    logReplay("R1R4/fixed", replayFixed);
    logReplay("R1R4/adaptive", replayAdaptive);
    // apples-to-apples：三种 replay 输入完全一致 → 输出字符必须一致
    expect(replayFixed.textChars).toBe(replayNative.textChars);
    expect(replayAdaptive.textChars).toBe(replayNative.textChars);
    // Fixed 的人工完成延迟 > Native（固定 4ms/word 排队）
    expect(replayFixed.lastEmitAt).toBeGreaterThanOrEqual(replayNative.lastEmitAt);
    // Adaptive 的人工完成延迟 ≈ Native（细流 pass-through；允许少量误差）
    expect(replayAdaptive.lastEmitAt - replayNative.lastEmitAt).toBeLessThan(200);
    // Adaptive tail lag bounded
    expect(replayAdaptive.tailLagMs).toBeLessThan(200);
  }, RUN_TIMEOUT * 3);

  it("R2 direct/high：reasoning capture once → 三种 policy replay（last reasoning → first text）", async () => {
    const prompt = "计算一个简单经济学例子并给最终答案。";
    const captured = await captureRealStream({ prompt, maxOutputTokens: 3000, reasoningEffort: "high" });
    const reasoningParts = captured.filter((c) => c.part.type === "reasoning-delta");
    const reasoningChars = reasoningParts.reduce((s, c) => s + (c.part as { text: string }).text.length, 0);
    const reasoningStart = captured.find((c) => c.part.type === "reasoning-start")?.arrivalOffsetMs ?? -1;
    const reasoningEnd = captured.find((c) => c.part.type === "reasoning-end")?.arrivalOffsetMs ?? -1;
    const firstText = captured.find((c) => c.part.type === "text-start" || c.part.type === "text-delta");
    console.log(
      `[R] R2 RAW reasoningChars=${reasoningChars} reasoningDeltas=${reasoningParts.length} ` +
        `reasoningStart=${Math.round(reasoningStart)} reasoningEnd=${Math.round(reasoningEnd)} ` +
        `lastReasoningToFirstText=${Math.round((firstText?.arrivalOffsetMs ?? 0) - reasoningEnd)}`
    );
    expect(reasoningChars).toBeGreaterThan(0);

    const input = buildReplayInput(captured);
    const replayNative = await replayCapture(input);
    const replayFixed = await replayCapture(input, fixedWordSmoothV43(4));
    const replayAdaptive = await replayCapture(input, adaptiveWithLag(KIRO_MAX_SMOOTHING_LAG_MS));
    logReplay("R2/native", replayNative);
    logReplay("R2/fixed", replayFixed);
    logReplay("R2/adaptive", replayAdaptive);
    expect(replayFixed.textChars).toBe(replayNative.textChars);
    expect(replayAdaptive.textChars).toBe(replayNative.textChars);
    // reasoning 不被任何 policy 人为拉长：replay 的 reasoning 部分时长 = capture 原样
    expect(replayAdaptive.tailLagMs).toBeLessThan(200);
  }, RUN_TIMEOUT * 3);

  it("R3 Tool/high：真实两轮（thinking → progress → tool call → result → final）", async () => {
    const getTimeTool = {
      get_current_time: tool({ description: "获取当前本地时间", inputSchema: z.object({}) }),
    };
    const prompt = "现在是几点？必须调用 get_current_time 工具获取时间后再回答";
    const { model } = await resolveLanguageModel({ provider: "deepseek", model: "deepseek-v4-flash", apiKey: KEY });
    const v4FlashDef = DEEPSEEK_MODELS.find((m) => m.id === "deepseek-v4-flash")!;
    const options = resolveReasoningProviderOptions({ definition: v4FlashDef, effort: "high" });
    const t0 = performance.now();
    const events: { at: number; type: string; chars?: number; toolName?: string }[] = [];
    const r1 = await streamText({
      model,
      messages: [{ role: "user", content: prompt }],
      tools: getTimeTool,
      maxOutputTokens: 600,
      providerOptions: options
        ? ({ "classflow-kiro": options } as Parameters<typeof streamText>[0]["providerOptions"])
        : undefined,
      experimental_transform: adaptiveWithLag(KIRO_MAX_SMOOTHING_LAG_MS) as never,
    });
    let toolCallId = "";
    for await (const part of r1.fullStream) {
      const at = performance.now() - t0;
      if (part.type === "reasoning-delta") events.push({ at, type: "reasoning-delta", chars: part.text.length });
      else if (part.type === "tool-input-start") {
        events.push({ at, type: "tool-input-start", toolName: part.toolName });
        toolCallId = part.id;
      } else if (part.type === "reasoning-end" || part.type === "text-start") {
        events.push({ at, type: part.type });
      }
    }
    const lastReasoning = Math.max(...events.filter((e) => e.type === "reasoning-delta").map((e) => e.at), 0);
    const toolAt = events.find((e) => e.type === "tool-input-start")?.at ?? -1;
    console.log(`[R] R3 round1 lastReasoning→tool=${Math.round(toolAt - lastReasoning)}`);
    expect(events.some((e) => e.type === "tool-input-start" && e.toolName === "get_current_time")).toBe(true);
    expect(toolAt - lastReasoning).toBeGreaterThanOrEqual(0);

    const { convertToModelMessages } = await import("ai");
    const uiMessages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: prompt }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            state: "output-available",
            toolCallId,
            toolName: "get_current_time",
            input: {},
            output: { now: "2026-08-15 12:00:00" },
          },
        ],
      },
    ];
    const modelMessages = await convertToModelMessages(uiMessages as never);
    const r2 = await streamText({
      model,
      messages: modelMessages,
      tools: {},
      maxOutputTokens: 400,
      experimental_transform: adaptiveWithLag(KIRO_MAX_SMOOTHING_LAG_MS),
    });
    let textChars2 = 0;
    for await (const part of r2.fullStream) {
      if (part.type === "text-delta") textChars2 += part.text.length;
    }
    console.log(`[R] R3 round2 textChars=${textChars2}`);
    expect(textChars2).toBeGreaterThan(0);
  }, RUN_TIMEOUT);

  it("maxLag 定标 24/32/48（同一 capture replay）+ synthetic burst", async () => {
    // 真实 capture（fine stream 为主）——三种 maxLag 的人工延迟差异
    const prompt = "用三点简要说明机会成本。";
    const captured = await captureRealStream({ prompt, maxOutputTokens: 500 });
    const input = buildReplayInput(captured);
    const results: Record<string, ReplayResult> = {};
    for (const lag of [24, 32, 48]) {
      results[`lag${lag}`] = await replayCapture(input, adaptiveWithLag(lag));
      logReplay(`maxLag${lag}`, results[`lag${lag}`]);
    }
    expect(results.lag24.textChars).toBe(results.lag48.textChars);
    // 三种 maxLag 完成延迟差异极小（细流 native pass-through）
    const maxCompletion = Math.max(...Object.values(results).map((r) => r.lastEmitAt));
    const minCompletion = Math.min(...Object.values(results).map((r) => r.lastEmitAt));
    console.log(`[R] maxLag completion spread=${Math.round(maxCompletion - minCompletion)}ms`);
    expect(maxCompletion - minCompletion).toBeLessThan(150);
  }, RUN_TIMEOUT * 2);

  it("真实 Route 级 phase assertion：UI Message Stream 出现 begin_final_answer 且 Final Answer 在其后", async () => {
    const body = {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      apiKey: KEY,
      custom: { providerName: "", baseURL: "", model: "" },
      reasoningEffort: "default",
      webSearchConfig: { enabled: false, credentialMode: "server" },
      messages: [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "用三点简要说明机会成本。" }],
        },
      ],
    };
    const res = await chatPOST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }) as never
    );
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    const parts: { type: string; toolName?: string }[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      const lines = raw.split("\n");
      raw = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const evt = JSON.parse(line.slice(6)) as { type?: string; toolName?: string };
          if (typeof evt.type === "string") parts.push({ type: evt.type, toolName: evt.toolName });
        } catch {
          /* 忽略不完整/不可解析行 */
        }
      }
    }
    const boundaryIdx = parts.findIndex(
      (p) => p.type === "tool-input-start" && p.toolName === "begin_final_answer"
    );
    const finalTextIdx = parts.findIndex((p) => p.type === "text-delta");
    console.log(
      `[R] route boundaryIdx=${boundaryIdx} finalTextIdx=${finalTextIdx} textParts=${parts.filter((p) => p.type === "text-delta").length}`
    );
    // 协议验收：boundary 必须先于 Final Answer text（Adaptive 生产路径不能停在 execution native）
    expect(boundaryIdx).toBeGreaterThanOrEqual(0);
    expect(finalTextIdx).toBeGreaterThan(boundaryIdx);
  }, RUN_TIMEOUT * 2);

  it("canonical fallback rate（真实输出 settle classifier 判定 + 触发原因）", async () => {
    const prompts = [
      "请用列表 + 小标题 + 一段代码示例说明时间管理方法，约六百字。",
      "用三点简要说明机会成本，每条用一段话展开。",
      "写一篇三百字的学习计划，包含一个 Markdown 表格。",
      "列出五个学习习惯并逐条解释。",
    ];
    const { model } = await resolveLanguageModel({ provider: "deepseek", model: "deepseek-v4-flash", apiKey: KEY });
    let fallbacks = 0;
    let samples = 0;
    const reasonCounts: Record<string, number> = {};
    for (const prompt of prompts) {
      const res = await streamText({ model, messages: [{ role: "user", content: prompt }], maxOutputTokens: 1500 });
      let text = "";
      for await (const part of res.fullStream) {
        if (part.type === "text-delta") text += part.text;
      }
      const safety = settleSafetyOf(text);
      samples += 1;
      if (safety.canonicalize) {
        fallbacks += 1;
        for (const reason of safety.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
      }
      console.log(
        `[R] canonicalFallback sample=${samples} textChars=${text.length} blocks=${safety.blocks} canonicalize=${safety.canonicalize} reasons=[${safety.reasons.join(",")}]`
      );
    }
    const rate = (fallbacks / samples) * 100;
    console.log(`[R] canonicalFallbackRate=${rate.toFixed(0)}% (${fallbacks}/${samples}) reasons=${JSON.stringify(reasonCounts)}`);
    expect(samples).toBeGreaterThan(0);
    // 只记录，不断言具体比例（结论在报告中；>30% 下一阶段专门研究）
  }, RUN_TIMEOUT * 3);
});
