/**
 * DeepSeek 真实 Streaming Perf Harness（Streaming UX V4.4 Real Provider Adaptive Cadence）。
 *
 * 只在设置 DEEPSEEK_TEST_API_KEY 时运行（CI 默认跳过）：
 *   $env:DEEPSEEK_TEST_API_KEY = "sk-..." ; npx vitest run tests/aiDeepSeekStreamingPerf.test.ts
 *
 * 目标（回答 V4.4 验收问题 1-4 / 12）：
 * - R1 direct/default：TTFT / native delta 分布 / final chunk sizes / provider gaps
 * - R2 direct/high：reasoning duration / delta count / last reasoning → first final text
 * - R3 Tool/high：reasoning → progress → tool call；tool result → final（两轮真实 roundtrip）
 * - R4 medium final：800~1200 中文字，delta chars/gap 直方图 → DeepSeek 是 fine 还是 burst stream
 *
 * 每个 Case 对比 Native / Current（V4.3 固定 4ms/word）/ Adaptive（V4.4）三种 server policy，
 * client 不在本 harness 内（可见 cadence 由 E2E 测量）。
 *
 * 安全：只记录结构化 timing（at / type / chars / toolName / finishReason），
 * 绝不记录 reasoning 正文、完整 Final Answer、Prompt 敏感内容、API Key / Authorization。
 */
import { describe, it, expect } from "vitest";
import { streamText, TextStreamPart, StreamTextTransform, ToolSet, tool } from "ai";
import { z } from "zod";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import { resolveReasoningProviderOptions, shouldOmitToolChoice } from "@/lib/ai/reasoning/providerOptions";
import { DEEPSEEK_MODELS } from "@/lib/ai/providers/deepSeek";
import { textOnlySmoothStream } from "@/lib/ai/streaming/textOnlySmoothStream";
import { splitKiroStreamingMarkdown, classifySettleSafety } from "@/lib/ai/streaming/markdownBlocks";
import { POST as chatPOST } from "@/app/api/ai/chat/route";

const KEY = process.env.DEEPSEEK_TEST_API_KEY ?? "";
const describeDeepSeek = KEY ? describe : describe.skip;
const RUN_TIMEOUT = 120_000;

/** 结构化 trace 条目（绝不包含正文） */
interface TraceEntry {
  at: number; // ms since request start
  type: string;
  chars?: number; // delta 长度（text / reasoning 均只记长度）
  toolName?: string;
  finishReason?: string;
}

interface RunSummary {
  trace: TraceEntry[];
  textChars: number;
  reasoningChars: number;
  firstTextAt: number;
  lastTextAt: number;
  toolCalls: string[];
  reasoningStartAt: number;
  reasoningEndAt: number;
  reasoningDeltas: number;
  emittedChunks: number;
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

function summarize(
  trace: TraceEntry[],
  textChars: number,
  reasoningChars: number
): RunSummary {
  const texts = trace.filter((e) => e.type === "text-delta");
  const reasoning = trace.filter((e) => e.type === "reasoning-delta");
  const firstTextAt = texts.length > 0 ? texts[0].at : -1;
  const lastTextAt = texts.length > 0 ? texts[texts.length - 1].at : -1;
  return {
    trace,
    textChars,
    reasoningChars,
    firstTextAt,
    lastTextAt,
    toolCalls: trace.filter((e) => e.type === "tool-input-start").map((e) => e.toolName ?? "?"),
    reasoningStartAt: trace.find((e) => e.type === "reasoning-start")?.at ?? -1,
    reasoningEndAt: trace.find((e) => e.type === "reasoning-end")?.at ?? -1,
    reasoningDeltas: reasoning.length,
    emittedChunks: trace.filter((e) => e.type === "text-delta").length,
  };
}

/** 跑一次真实 stream（可配 transform / reasoning / messages）→ 结构化 trace */
async function runRealStream(opts: {
  prompt?: string;
  messages?: unknown[];
  maxOutputTokens: number;
  transform?: StreamTextTransform<Record<string, never>> | undefined;
  reasoningEffort?: "default" | "high";
  tools?: Record<string, unknown>;
}): Promise<RunSummary> {
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
    messages: (opts.messages ??
      (opts.prompt != null
        ? [{ role: "user", content: opts.prompt }]
        : [{ role: "user", content: "hi" }])) as never,
    tools: (opts.tools as never) ?? undefined,
    maxOutputTokens: opts.maxOutputTokens,
    providerOptions: providerOptions
      ? ({ "classflow-kiro": providerOptions } as Parameters<typeof streamText>[0]["providerOptions"])
      : undefined,
    experimental_transform: opts.transform,
  });
  const t0 = performance.now();
  const trace: TraceEntry[] = [];
  let textChars = 0;
  let reasoningChars = 0;
  for await (const part of result.fullStream) {
    const at = performance.now() - t0;
    if (part.type === "text-delta") {
      textChars += part.text.length;
      trace.push({ at, type: "text-delta", chars: part.text.length });
    } else if (part.type === "reasoning-delta") {
      reasoningChars += part.text.length;
      trace.push({ at, type: "reasoning-delta", chars: part.text.length });
    } else if (
      part.type === "reasoning-start" ||
      part.type === "reasoning-end" ||
      part.type === "text-start" ||
      part.type === "text-end"
    ) {
      trace.push({ at, type: part.type });
    } else if (part.type === "tool-input-start") {
      trace.push({ at, type: "tool-input-start", toolName: part.toolName });
    } else if (part.type === "finish") {
      trace.push({ at, type: "finish", finishReason: part.finishReason });
    } else if (part.type === "finish-step") {
      trace.push({ at, type: "finish-step" });
    }
  }
  return summarize(trace, textChars, reasoningChars);
}

function gapStats(trace: TraceEntry[], typeFilter: string): { p50: number; p95: number; max: number; count: number } {
  const ats = trace.filter((e) => e.type === typeFilter).map((e) => e.at);
  const gaps: number[] = [];
  for (let i = 1; i < ats.length; i++) gaps.push(ats[i] - ats[i - 1]);
  gaps.sort((a, b) => a - b);
  if (gaps.length === 0) return { p50: 0, p95: 0, max: 0, count: 0 };
  const p = (q: number) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))];
  return { p50: p(0.5), p95: p(0.95), max: gaps[gaps.length - 1], count: gaps.length };
}

function logSummary(label: string, r: RunSummary): void {
  const g = gapStats(r.trace, "text-delta");
  const rg = gapStats(r.trace, "reasoning-delta");
  console.log(
    `[R] ${label} textChars=${r.textChars} firstTextAt=${Math.round(r.firstTextAt)} lastTextAt=${Math.round(r.lastTextAt)} ` +
      `textGap p50=${Math.round(g.p50)} p95=${Math.round(g.p95)} max=${Math.round(g.max)} n=${g.count} ` +
      `reasoningChars=${r.reasoningChars} reasoningDeltas=${r.reasoningDeltas} reasoningEndAt=${Math.round(r.reasoningEndAt)} ` +
      `tools=[${r.toolCalls.join(",")}] emittedChunks=${r.emittedChunks}`
  );
}

/** 计算 settle classifier 对真实输出的 fallback 判定（§17：只记次数与触发原因，不记内容） */
function settleSafetyOf(text: string): { canonicalize: boolean; blocks: number; reasons: string[] } {
  const split = splitKiroStreamingMarkdown(text, true);
  const blocks = [...split.stableBlocks];
  if (split.tail.length > 0) blocks.push(split.tail);
  const safety = classifySettleSafety(blocks);
  return { canonicalize: safety.canonicalize, blocks: safety.totalBlocks, reasons: safety.reasons };
}

describeDeepSeek("DeepSeek Real Streaming Perf（DEEPSEEK_TEST_API_KEY 存在时运行）", () => {
  const POLICIES = {
    native: undefined,
    current: fixedWordSmoothV43(4) as StreamTextTransform<Record<string, never>>,
    adaptive: textOnlySmoothStream<Record<string, never>>({
      chunking: new Intl.Segmenter("zh", { granularity: "word" }),
      delayInMs: 4,
    }),
  };

  it("R1 direct/default：Native vs Current vs Adaptive（TTFT / delta 分布 / gaps）", async () => {
    const prompt = "用三点简要说明机会成本。";
    const results: Record<string, RunSummary> = {};
    for (const [name, transform] of Object.entries(POLICIES)) {
      results[name] = await runRealStream({
        prompt,
        maxOutputTokens: 500,
        transform: transform as StreamTextTransform<Record<string, never>> | undefined,
      });
      logSummary(`R1/${name}`, results[name]);
    }
    expect(results.native.textChars).toBeGreaterThan(20);
    expect(results.adaptive.textChars).toBeGreaterThan(20);
    // 模型输出长度随 run 变化（不断言跨 policy 内容一致）；只断言时序特性：
    // Adaptive 完成延迟不差于 Current（人工 backlog 消除）
    expect(results.adaptive.lastTextAt).toBeLessThanOrEqual(results.current.lastTextAt + 500);
    // Adaptive 不产生比 Current 更密集的碎 chunk（有界）
    expect(results.adaptive.emittedChunks).toBeLessThanOrEqual(results.current.emittedChunks + 30);
  }, RUN_TIMEOUT);

  it("R2 direct/high：reasoning duration / delta count / last reasoning → first final text", async () => {
    const prompt = "计算一个简单经济学例子并给最终答案。";
    const results: Record<string, RunSummary> = {};
    for (const [name, transform] of Object.entries(POLICIES)) {
      results[name] = await runRealStream({
        prompt,
        maxOutputTokens: 3000, // high 档 reasoning 可达 ~2000 tokens，预留回答空间
        reasoningEffort: "high",
        transform: transform as StreamTextTransform<Record<string, never>> | undefined,
      });
      logSummary(`R2/${name}`, results[name]);
      // reasoning 可见性验收：无论 policy，reasoning 内容都在（pass-through 不丢）
      expect(results[name].reasoningChars).toBeGreaterThan(0);
    }
    // 验收：reasoning 不因 policy 被人为拉长（三种 policy 都透传 reasoning）——
    // 不同 run 的推理时长本身有模型方差，这里只记录、宽松比较
    for (const [name, r] of Object.entries(results)) {
      const gap = r.firstTextAt - r.reasoningEndAt;
      console.log(`[R] R2/${name} lastReasoningToFirstText=${Math.round(gap)}`);
    }
    expect(results.adaptive.reasoningDeltas).toBeLessThanOrEqual(results.current.reasoningDeltas + 50);
    expect(results.adaptive.reasoningEndAt).toBeLessThanOrEqual(results.current.reasoningEndAt + 2000);
    // final answer 正常产出（不被 transform 吞掉）
    expect(results.adaptive.textChars).toBeGreaterThan(0);
  }, RUN_TIMEOUT);

  it("R3 Tool/high：reasoning → progress → tool call；tool result → final answer（真实两轮）", async () => {
    const getTimeTool = {
      get_current_time: tool({ description: "获取当前本地时间", inputSchema: z.object({}) }),
    };
    const prompt = "现在是几点？必须调用 get_current_time 工具获取时间后再回答";
    // 第一轮：thinking + progress + tool call（execution 阶段 native）
    const r1 = await runRealStream({
      prompt,
      maxOutputTokens: 600,
      reasoningEffort: "high",
      tools: getTimeTool,
      transform: POLICIES.adaptive as StreamTextTransform<Record<string, never>>,
    });
    logSummary("R3/round1/adaptive", r1);
    expect(r1.toolCalls).toContain("get_current_time");
    const lastReasoning = Math.max(
      ...r1.trace.filter((e) => e.type === "reasoning-delta").map((e) => e.at),
      0
    );
    const toolAt = r1.trace.find((e) => e.type === "tool-input-start")?.at ?? -1;
    console.log(`[R] R3 round1 lastReasoning→tool=${Math.round(toolAt - lastReasoning)}`);

    // 第二轮：tool result 回传 → final answer（同 /api/ai/chat 的 client continuation 形状）
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
            toolCallId: "call_r3",
            toolName: "get_current_time",
            input: {},
            output: { now: "2026-08-15 12:00:00" },
          },
        ],
      },
    ];
    const modelMessages = await convertToModelMessages(uiMessages as never);
    const r2 = await runRealStream({
      messages: modelMessages,
      maxOutputTokens: 400,
      tools: {},
      transform: POLICIES.adaptive as StreamTextTransform<Record<string, never>>,
    });
    logSummary("R3/round2/adaptive", r2);
    expect(r2.textChars).toBeGreaterThan(0);
  }, RUN_TIMEOUT);

  it("R4 medium final（约 800~1200 字）：delta chars / gap 分布 → fine or burst", async () => {
    const prompt = "请写一篇约一千字的学习方法论说明，分三点展开，条理清晰。";
    const results: Record<string, RunSummary> = {};
    for (const [name, transform] of Object.entries(POLICIES)) {
      results[name] = await runRealStream({
        prompt,
        maxOutputTokens: 2000,
        transform: transform as StreamTextTransform<Record<string, never>> | undefined,
      });
      logSummary(`R4/${name}`, results[name]);
      // delta 大小直方图（只记长度，不记内容）
      const hist: Record<string, number> = {};
      for (const e of results[name].trace) {
        if (e.type !== "text-delta" || e.chars == null) continue;
        const bucket = e.chars <= 10 ? "1-10" : e.chars <= 40 ? "11-40" : e.chars <= 100 ? "41-100" : e.chars <= 300 ? "101-300" : "301+";
        hist[bucket] = (hist[bucket] ?? 0) + 1;
      }
      console.log(`[R] R4/${name} deltaHist=${JSON.stringify(hist)}`);
    }
    expect(results.native.textChars).toBeGreaterThan(600);
    // 完成延迟按内容长度归一（不同 run 输出长度不同）：每百字符完成时间
    for (const [name, r] of Object.entries(results)) {
      const per100 = r.lastTextAt / (r.textChars / 100);
      console.log(`[R] R4/${name} completionPer100Chars=${Math.round(per100)}ms`);
    }
    // Adaptive 的 burst 有界：最大 server gap 不显著放大（Current 固定 4ms/word 曾出现 ~859ms 积压停顿）
    const natMax = gapStats(results.native.trace, "text-delta").max;
    const adaMax = gapStats(results.adaptive.trace, "text-delta").max;
    const curMax = gapStats(results.current.trace, "text-delta").max;
    console.log(`[R] R4 nativeMaxGap=${Math.round(natMax)} currentMaxGap=${Math.round(curMax)} adaptiveMaxGap=${Math.round(adaMax)}`);
    expect(adaMax).toBeLessThanOrEqual(500);
  }, RUN_TIMEOUT);

  it("Route-level：真实 POST /api/ai/chat → textOnlySmoothStream → UI Message Stream", async () => {
    const body = {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      apiKey: KEY,
      custom: { providerName: "", baseURL: "", model: "" },
      reasoningEffort: "high",
      webSearchConfig: { enabled: false, credentialMode: "server" },
      messages: [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "用一句话说明边际效用，并调用 search_assignments 前先思考。" }],
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
    const t0 = performance.now();
    const trace: TraceEntry[] = [];
    let textChars = 0;
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      // UI Message Stream 单行事件解析（不做正文记录）
      const lines = raw.split("\n");
      raw = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const at = performance.now() - t0;
        try {
          const evt = JSON.parse(line.slice(6)) as { type?: string; delta?: string; toolName?: string };
          if (evt.type === "text-delta" && typeof evt.delta === "string") {
            textChars += evt.delta.length;
            trace.push({ at, type: "text-delta", chars: evt.delta.length });
          } else if (typeof evt.type === "string") {
            trace.push({ at, type: evt.type, toolName: evt.toolName });
          }
        } catch {
          /* 忽略不完整/不可解析行 */
        }
      }
    }
    const g = gapStats(trace, "text-delta");
    const textParts = trace.filter((e) => e.type === "text-delta");
    console.log(
      `[R] route textChars=${textChars} firstTextAt=${Math.round(textParts[0]?.at ?? -1)} ` +
        `lastTextAt=${Math.round(textParts[textParts.length - 1]?.at ?? -1)} ` +
        `textGap p50=${Math.round(g.p50)} p95=${Math.round(g.p95)} max=${Math.round(g.max)} ` +
        `parts=${textParts.length}`
    );
    expect(textChars).toBeGreaterThan(0);
    expect(trace.some((e) => e.type === "reasoning-start")).toBe(true);
  }, RUN_TIMEOUT * 2);

  it("canonical fallback rate（真实输出 settle classifier 判定，§17）", async () => {
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
    // 只记录，不断言具体比例（结论在报告中；若 >25~30% 才进入第二阶段分析）
  }, RUN_TIMEOUT * 3);
});
