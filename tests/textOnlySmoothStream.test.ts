import { describe, it, expect } from "vitest";
import { TextStreamPart } from "ai";
import {
  textOnlySmoothStream,
  TextOnlySmoothStats,
  KIRO_NATIVE_DELTA_CHARS,
  KIRO_MAX_SMOOTHING_LAG_MS,
  KIRO_CATCH_UP_CHUNK_CHARS,
} from "@/lib/ai/streaming/textOnlySmoothStream";

/**
 * Text-only Adaptive Smooth Stream（Streaming UX V4.4）：
 * - reasoning / tool / lifecycle：立即透传（不 chunk、不 delay、内容不改写、顺序保持）
 * - execution（progress）：native 透传（一个 delta 一个 chunk）
 * - final-answer：小 delta native；大 burst bounded shaping（≤ maxLag 人工 lag，超出 catch-up）
 * - 无尾随 sleep；providerMetadata 只附到最后派生 segment；stream close 不丢 buffer
 */

const SEGMENTER = new Intl.Segmenter("zh", { granularity: "word" });
const DELAY_MS = 4;

type AnyPart = TextStreamPart<Record<string, never>>;

interface TransformOptions {
  chunking: Intl.Segmenter;
  delayInMs: number;
  nativeDeltaChars?: number;
  maxSmoothingLagMs?: number;
  catchUpChunkChars?: number;
  runResetGapMs?: number;
  finalAnswerToolName?: string;
}

interface TimedPart {
  part: AnyPart;
  ts: number;
}

async function runTransform(
  opts: Partial<TransformOptions>,
  produce: (push: (p: AnyPart, gapMs?: number) => Promise<void>) => Promise<void>
): Promise<{ out: TimedPart[]; elapsedMs: number; stats: Readonly<TextOnlySmoothStats> | null }> {
  const transform = textOnlySmoothStream<Record<string, never>>({
    chunking: SEGMENTER,
    delayInMs: DELAY_MS,
    ...opts,
  });
  const ts = transform({ tools: {}, stopStream: () => {} });
  const source = new ReadableStream<AnyPart>({
    async start(controller) {
      await produce(async (p, gapMs) => {
        if (gapMs != null && gapMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, gapMs));
        }
        controller.enqueue(p);
      });
      controller.close();
    },
  });
  const out: TimedPart[] = [];
  const start = performance.now();
  await source.pipeThrough(ts).pipeTo(
    new WritableStream<AnyPart>({
      write(p) {
        out.push({ part: p, ts: performance.now() });
      },
    })
  );
  return { out, elapsedMs: performance.now() - start, stats: transform.getStats() };
}

/** 快速构造：立即 push 全部 parts */
function runParts(input: AnyPart[], opts: Partial<TransformOptions> = {}) {
  return runTransform(opts, async (push) => {
    for (const p of input) await push(p);
  });
}

function part<T extends AnyPart["type"]>(type: T, extra?: Record<string, unknown>): AnyPart {
  return { type, ...(extra as object) } as AnyPart;
}

function cjkText(length: number): string {
  const unit = "这是一段没有空行的超长中文内容用于验证自适应切分与有界整形";
  let s = "";
  while (s.length < length) s += unit;
  return s.slice(0, length);
}

const BOUNDARY_TOOL = part("tool-input-start", {
  id: "call_b",
  toolCallId: "call_b",
  toolName: "begin_final_answer",
});

describe("textOnlySmoothStream V4.4（Adaptive Cadence & Bounded Smoothing）", () => {
  it("1. reasoning ×200 → Tool：part 顺序一致、内容不改写、零人为 delay", async () => {
    const reasoningDeltas: AnyPart[] = Array.from({ length: 200 }, (_, i) =>
      part("reasoning-delta", { id: "r1", text: `推理步骤第${i}步 内容` })
    );
    const input: AnyPart[] = [
      part("reasoning-start", { id: "r1" }),
      ...reasoningDeltas,
      part("reasoning-end", { id: "r1" }),
      part("tool-input-start", { id: "c1", toolCallId: "c1", toolName: "search_assignments" }),
      part("finish-step"),
      part("finish", { finishReason: "stop" }),
    ];
    const { out, elapsedMs } = await runParts(input);
    expect(out.map((t) => t.part.type)).toEqual(input.map((p) => p.type));
    expect((out[1].part as { text: string }).text).toBe("推理步骤第0步 内容");
    expect((out[200].part as { text: string }).text).toBe("推理步骤第199步 内容");
    // 200 × 4ms ≈ 800ms 人为排队必须消失
    expect(elapsedMs).toBeLessThan(200);
  });

  it("2. 小 delta：native 单 chunk，无尾随 sleep（随后 lifecycle 立即通过）", async () => {
    const { out } = await runParts([
      part("text-start", { id: "t1" }),
      part("text-delta", { id: "t1", text: "今天天气很好" }),
      part("tool-input-start", { id: "c2", toolCallId: "c2", toolName: "search_assignments" }),
    ]);
    const types = out.map((t) => t.part.type);
    expect(types).toEqual(["text-start", "text-delta", "tool-input-start"]);
    expect((out[1].part as { text: string }).text).toBe("今天天气很好");
    // 小 delta 不拆词（1 个 chunk）→ 无 sleep → tool 与 text 之间无人工间隙
    const textTs = out[1].ts;
    const toolTs = out[2].ts;
    expect(toolTs - textTs).toBeLessThan(2);
  });

  it("3. 细流（小 delta 持续到达）：人工 lag 不累计（全部 native）", async () => {
    const { stats, elapsedMs } = await runTransform({}, async (push) => {
      await push(part("text-start", { id: "t3" }));
      for (let i = 0; i < 50; i++) {
        await push(part("text-delta", { id: "t3", text: cjkText(10) }), 5);
      }
      await push(part("text-end", { id: "t3" }));
    });
    // 50 个 10-char delta 全部 ≤ nativeDeltaChars → 不切词不 sleep
    expect(stats?.emittedTextChunks).toBe(50);
    expect(stats?.emittedTextChars).toBe(500);
    expect(stats?.maxSmoothingDebtMs ?? 0).toBeLessThan(10);
    // 真实耗时 ≈ producer 节奏（50 × 5ms）+ 首 delta 冷启动；transform 没有附加人工 lag
    //（固定 4ms/word 旧行为会给 500 chars ≈ 500×4ms = 2s 额外排队）
    expect(elapsedMs).toBeLessThan(1000);
  });

  it("4. 1000-char burst：自适应 chunk + 总人工 lag ≤ 预算（catch-up 生效）", async () => {
    const burst = cjkText(1000);
    const { out, elapsedMs, stats } = await runParts([
      BOUNDARY_TOOL,
      part("text-delta", { id: "t4", text: burst }),
    ]);
    const deltas = out.filter((t) => t.part.type === "text-delta");
    // 拼接还原原文
    expect((deltas.map((t) => (t.part as { text: string }).text).join(""))).toBe(burst);
    // 分块（≥2），且不是逐词 1000 个（有界）
    expect(deltas.length).toBeGreaterThanOrEqual(2);
    expect(deltas.length).toBeLessThan(300);
    // 总人工 lag ≤ maxSmoothingLagMs + 容忍（旧行为：1000 词 × 4ms ≈ 4s）
    expect(elapsedMs).toBeLessThanOrEqual(KIRO_MAX_SMOOTHING_LAG_MS + 150);
    // catch-up 大块 ≤ 128 chars（frame-friendly，不一次灌入剩余全部）
    expect(stats?.maxEmittedChunkChars ?? 0).toBeLessThanOrEqual(KIRO_CATCH_UP_CHUNK_CHARS);
    expect(stats?.catchUpActivations ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("5. burst 后 Tool：Tool 到达 ≤ maxLag + 容忍（不等人工 queue）", async () => {
    const burst = cjkText(1000);
    const { out, stats } = await runParts([
      BOUNDARY_TOOL,
      part("text-delta", { id: "t5", text: burst }),
      part("tool-input-start", { id: "c5", toolCallId: "c5", toolName: "search_assignments" }),
    ]);
    const firstDeltaTs = out[0].ts;
    const toolPart = out.find((t) => t.part.type === "tool-input-start");
    expect(toolPart).toBeDefined();
    expect(toolPart!.ts - firstDeltaTs).toBeLessThanOrEqual(KIRO_MAX_SMOOTHING_LAG_MS + 50);
    // 无尾随 sleep：最后 text 与 Tool 之间没有多余 4ms 等待
    const lastText = [...out].reverse().find((t) => t.part.type === "text-delta")!;
    expect(toolPart!.ts - lastText.ts).toBeLessThan(2);
    expect(stats?.toolFlushDelayMs ?? 0).toBeLessThan(5);
  });

  it("6. progress（execution）native → boundary → final-answer shaping 正确切换", async () => {
    const progress = cjkText(300); // 大 progress 也必须 native（不切词不 sleep）
    const finalBurst = cjkText(300);
    const { out, stats } = await runParts([
      part("text-start", { id: "t6" }),
      part("text-delta", { id: "t6", text: progress }),
      BOUNDARY_TOOL,
      part("text-delta", { id: "t6", text: "结论。" }),
      part("text-delta", { id: "t6", text: finalBurst }),
    ]);
    const texts = out.filter((t) => t.part.type === "text-delta");
    // execution：300-char progress 一次透传（1 chunk，不 sleep）
    expect((texts[0].part as { text: string }).text).toBe(progress);
    // 小结论 native 单 chunk
    expect((texts[1].part as { text: string }).text).toBe("结论。");
    // finalBurst 300 chars > 40 → 被 shaping/catch-up 切分为 ≥2 chunk
    expect(texts.length).toBeGreaterThanOrEqual(4);
    const burstChunks = texts.slice(2).map((t) => (t.part as { text: string }).text);
    expect(burstChunks.join("")).toBe(finalBurst);
    expect(burstChunks.length).toBeGreaterThanOrEqual(2);
    // progress 文本 transform 内等待 ≈ 0
    expect(stats?.progressTextDelayMs ?? 0).toBeLessThan(5);
  });

  it("6b. 未出现 boundary tool（纯 execution）→ 所有 text 保持 native", async () => {
    const { stats } = await runParts([
      part("text-delta", { id: "t6b", text: cjkText(500) }),
    ]);
    expect(stats?.emittedTextChunks).toBe(1);
    expect(stats?.catchUpActivations ?? 0).toBe(0);
  });

  it("7. providerMetadata 保真：只附到最后派生 segment；后续无 meta delta 不复制陈旧 meta", async () => {
    const meta = { provider: { usage: { tokens: 42 } } };
    const burst = cjkText(200);
    const { out } = await runParts([
      BOUNDARY_TOOL,
      part("text-delta", { id: "t7", text: burst, providerMetadata: meta }),
      part("text-delta", { id: "t7", text: "后续没有元数据的内容内容内容内容内容内容内容内容内容内容内容" }),
    ]);
    const deltas = out.filter((t) => t.part.type === "text-delta") as {
      part: { text: string; providerMetadata?: unknown };
    }[];
    // burst 被切分为 ≥2 段：meta 只出现在最后一段
    expect(deltas.length).toBeGreaterThanOrEqual(2);
    const withMeta = deltas.filter((d) => d.part.providerMetadata !== undefined);
    expect(withMeta.length).toBe(1);
    expect(withMeta[0].part.providerMetadata).toEqual(meta);
    // 最后一段（meta 所在）是 burst 的末尾
    expect(withMeta[0].part.text).toBe(burst.slice(burst.length - withMeta[0].part.text.length));
    // 后续无 meta delta 的派生段不带陈旧 meta
    const after = deltas.slice(deltas.length - 1)[0];
    expect(after.part.providerMetadata).toBeUndefined();
  });

  it("8. text → reasoning → text 交错：顺序严格保持（text buffer 先 flush 再透传 reasoning）", async () => {
    const { out } = await runParts([
      part("text-delta", { id: "t8", text: "第一段话" }),
      part("reasoning-start", { id: "r8" }),
      part("reasoning-delta", { id: "r8", text: "思考过程" }),
      part("reasoning-end", { id: "r8" }),
      part("text-delta", { id: "t8", text: "第二段话" }),
    ]);
    const types = out.map((t) => t.part.type);
    expect(types.indexOf("reasoning-start")).toBe(1);
    expect(types.indexOf("reasoning-delta")).toBe(2);
    expect(types.indexOf("reasoning-end")).toBe(3);
    expect((out[4].part as { text: string }).text).toBe("第二段话");
    expect(out.every((t) => t.part.type !== "text-end")).toBe(true);
  });

  it("9. finish / error / abort 立即透传（不排队）", async () => {
    const { out, elapsedMs } = await runParts([
      part("finish-step"),
      part("error", { error: new Error("x") }),
      part("abort", { reason: new Error("stop") }),
      part("finish", { finishReason: "stop" }),
    ]);
    expect(out.map((t) => t.part.type)).toEqual(["finish-step", "error", "abort", "finish"]);
    expect(elapsedMs).toBeLessThan(50);
  });

  it("10. stream close：残留 buffer 不丢失（无 text-end 直接关闭也完整发出）", async () => {
    const burst = cjkText(500);
    const { out } = await runParts([BOUNDARY_TOOL, part("text-delta", { id: "t10", text: burst })]);
    const deltas = out.filter((t) => t.part.type === "text-delta");
    expect(deltas.map((t) => (t.part as { text: string }).text).join("")).toBe(burst);
  });

  it("11. debt 跨 burst 累计：连续快速大 delta → 后续 catch-up；长停顿 → 新 run 恢复 shaping", async () => {
    const burstA = cjkText(300);
    const burstB = cjkText(300);
    const { stats, elapsedMs } = await runTransform({}, async (push) => {
      await push(BOUNDARY_TOOL);
      await push(part("text-delta", { id: "t11", text: burstA })); // 首 burst：完整 shaping 预算
      await push(part("text-delta", { id: "t11", text: burstB }), 10); // 10ms 后：debt 高 → catch-up
      await push(part("text-end", { id: "t11" }), 250); // 长停顿 → 新 run
    });
    // 总人工 lag 有界（两次 burst，第二次几乎无 shaping）
    expect(elapsedMs).toBeLessThan(KIRO_MAX_SMOOTHING_LAG_MS * 2 + 300);
    expect(stats?.catchUpActivations ?? 0).toBeGreaterThanOrEqual(1);
    // actual-timer 记账：最后一个 sleep 可能轻微越过预算（4ms 请求实际 6-15ms）
    expect(stats?.maxSmoothingDebtMs ?? 0).toBeLessThanOrEqual(KIRO_MAX_SMOOTHING_LAG_MS + 15);
  });

  it("12. execution 阶段 lifecycle 最高优先级：progress 最后字符 → Tool 紧密衔接", async () => {
    const { out, stats } = await runParts([
      part("text-delta", { id: "t12", text: "我先检查相关文件。" }),
      part("tool-input-start", { id: "c12", toolCallId: "c12", toolName: "search_assignments" }),
    ]);
    const textTs = out[0].ts;
    const toolTs = out[1].ts;
    expect(toolTs - textTs).toBeLessThan(2);
    expect(stats?.progressTextDelayMs ?? 0).toBeLessThan(5);
    expect(stats?.toolFlushDelayMs ?? 0).toBeLessThan(5);
  });

  // ============================================================
  // V4.4.1：Global Lag 回归（backpressure 污染 debt accounting）
  //
  // 关键指标：Provider/source enqueue 时间戳 → downstream emit 时间戳 的独立 lag，
  // 不依赖 transform 内部 debt stats（stats 本身可能算错）。
  // 目标 invariant：人工 smoothing backlog 不能随 queued burst 数量线性增长。
  // ============================================================

  /** 输出中累计长度首次达到 target 的 emit 时间戳（delta 边界定位） */
  function boundaryEmitTs(out: TimedPart[], targetLen: number): number {
    let cum = 0;
    for (const t of out) {
      if (t.part.type !== "text-delta") continue;
      cum += (t.part as { text: string }).text.length;
      if (cum >= targetLen) return t.ts;
    }
    return -1;
  }

  it("V4.4.1-1 连续 queued 3-burst：global lag 必须 bounded（不随 burst 数量线性增长）", async () => {
    const burstA = cjkText(300);
    const burstB = cjkText(300);
    const burstC = cjkText(300);
    const sourceEnqueues: number[] = [];
    const { out } = await runTransform({}, async (push) => {
      await push(BOUNDARY_TOOL);
      await push(part("text-delta", { id: "tq", text: burstA }));
      sourceEnqueues.push(performance.now());
      await push(part("text-delta", { id: "tq", text: burstB }));
      sourceEnqueues.push(performance.now());
      await push(part("text-delta", { id: "tq", text: burstC }));
      sourceEnqueues.push(performance.now());
    });
    // 从 source timestamp（绝对域）独立计算 lag（不读 stats）
    const lagA = boundaryEmitTs(out, 300) - sourceEnqueues[0];
    const lagB = boundaryEmitTs(out, 600) - sourceEnqueues[1];
    const lagC = boundaryEmitTs(out, 900) - sourceEnqueues[2];
    console.log(`[V4.4.1] 3-burst lagA=${Math.round(lagA)} lagB=${Math.round(lagB)} lagC=${Math.round(lagC)}`);
    // 内容完整
    expect(out.filter((t) => t.part.type === "text-delta").map((t) => (t.part as { text: string }).text).join("")).toBe(
      burstA + burstB + burstC
    );
    // 首 burst 允许 ≤ maxLag 的 shaping（含 actual-timer 误差）
    expect(lagA).toBeLessThanOrEqual(KIRO_MAX_SMOOTHING_LAG_MS + 60);
    // 后续 burst 不得再叠加完整 shaping（bug 行为：B/C 各再 +≈maxLag 线性增长）
    expect(lagB - lagA).toBeLessThan(30);
    expect(lagC - lagB).toBeLessThan(30);
    expect(lagC).toBeLessThanOrEqual(KIRO_MAX_SMOOTHING_LAG_MS + 90);
  });

  it("V4.4.1-2 连续 queued 10-burst（3000 chars）：global lag bounded，文本完全一致", async () => {
    const bursts = Array.from({ length: 10 }, () => cjkText(300));
    const total = bursts.join("");
    let firstEnqueue = 0;
    const { out } = await runTransform({}, async (push) => {
      await push(BOUNDARY_TOOL);
      firstEnqueue = performance.now();
      for (const b of bursts) {
        await push(part("text-delta", { id: "tq10", text: b }));
      }
    });
    const deltas = out.filter((t) => t.part.type === "text-delta");
    expect(deltas.map((t) => (t.part as { text: string }).text).join("")).toBe(total);
    const lastEmit = deltas[deltas.length - 1].ts;
    const globalArtificialLagMs = lastEmit - firstEnqueue;
    console.log(`[V4.4.1] 10-burst globalLag=${Math.round(globalArtificialLagMs)}ms`);
    // 目标修复后：不能接近 10 × 48ms = 480ms（线性 backlog）；允许 scheduler/stream 误差
    expect(globalArtificialLagMs).toBeLessThan(250);
  });

  it("V4.4.1-3 长停顿（真实 idle）才能重置 debt：burst → 200ms idle → burst 恢复完整预算", async () => {
    const burstA = cjkText(300);
    const burstB = cjkText(300);
    const sourceEnqueues: number[] = [];
    const { out, stats } = await runTransform({}, async (push) => {
      await push(BOUNDARY_TOOL);
      await push(part("text-delta", { id: "tq3", text: burstA }));
      sourceEnqueues.push(performance.now());
      await push(part("text-delta", { id: "tq3", text: burstB }), 200); // 真实 idle 200ms
      sourceEnqueues.push(performance.now());
    });
    const lagA = boundaryEmitTs(out, 300) - sourceEnqueues[0];
    const lagB = boundaryEmitTs(out, 600) - sourceEnqueues[1];
    console.log(`[V4.4.1] idle-reset lagA=${Math.round(lagA)} lagB=${Math.round(lagB)}`);
    // idle 200ms ≥ runResetGapMs → B 重新获得完整 shaping 预算（lag 从 B 自身 arrival 起算 ≈ ≤ maxLag）
    expect(lagA).toBeLessThanOrEqual(KIRO_MAX_SMOOTHING_LAG_MS + 60);
    expect(lagB).toBeLessThanOrEqual(KIRO_MAX_SMOOTHING_LAG_MS + 60);
    expect(stats?.maxSmoothingDebtMs ?? 0).toBeLessThanOrEqual(KIRO_MAX_SMOOTHING_LAG_MS + 15);
  });

  it("V4.4.1-4 maxLag=24 定标：queued 3-burst 的 global lag invariant 同样成立（更少人为延迟）", async () => {
    const burstA = cjkText(300);
    const burstB = cjkText(300);
    const burstC = cjkText(300);
    const sourceEnqueues: number[] = [];
    const { out } = await runTransform({ maxSmoothingLagMs: 24 }, async (push) => {
      await push(BOUNDARY_TOOL);
      await push(part("text-delta", { id: "tq24", text: burstA }));
      sourceEnqueues.push(performance.now());
      await push(part("text-delta", { id: "tq24", text: burstB }));
      sourceEnqueues.push(performance.now());
      await push(part("text-delta", { id: "tq24", text: burstC }));
      sourceEnqueues.push(performance.now());
    });
    const lagA = boundaryEmitTs(out, 300) - sourceEnqueues[0];
    const lagB = boundaryEmitTs(out, 600) - sourceEnqueues[1];
    const lagC = boundaryEmitTs(out, 900) - sourceEnqueues[2];
    console.log(`[V4.4.1] maxLag24 lagA=${Math.round(lagA)} lagB=${Math.round(lagB)} lagC=${Math.round(lagC)}`);
    expect(lagA).toBeLessThanOrEqual(24 + 60);
    expect(lagB - lagA).toBeLessThan(30);
    expect(lagC - lagB).toBeLessThan(30);
    expect(lagC).toBeLessThanOrEqual(24 + 90);
  });
});
