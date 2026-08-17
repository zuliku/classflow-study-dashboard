import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";
import http from "node:http";

/**
 * Kiro Streaming Hot Path bounded fixture（Streaming UX V4.2 Phase 1 baseline）。
 *
 * Case A：2 Tool + 2000 chars Final Answer
 * Case B：8 Tool + 8000 chars Final Answer
 * Case C：8000 chars 无空行长 paragraph
 * Case D：Markdown-heavy（heading/list/bold/inline code/fenced code/math/citation）
 *
 * 记录（test-only window.__kiroStreamPerf + __kiroPerf，生产零成本）：
 * - worklogRenders / toolRowRenders（按 block id）/ splitterCalls / splitterChars
 * - resizeObserverCalls / scrollTopWrites / longTasks
 * - visible gap 时间戳序列（MutationObserver characterData → performance.now）
 */

const AI_SETTINGS = {
  enabled: true,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  custom: { providerName: "", baseURL: "", model: "" },
};

function sse(lines: string[]): string {
  return lines.map((l) => `data: ${l}`).join("\n\n") + "\n\n";
}

interface SseStage {
  delay?: number;
  events: string[];
  /** 本 stage 即将写入 socket 前调用（记录 marker 时间戳） */
  mark?: () => void;
}

async function startSseServer(plan: (bodyJson: { messages?: unknown[] }) => SseStage[]) {
  const requests: { arrivalTs: number; firstWriteTs: number }[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type, x-request-id, x-experimental-ai-provider, x-ai-session-id",
        "access-control-max-age": "600",
      });
      res.end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let stages: SseStage[];
      try {
        stages = plan(JSON.parse(body || "{}"));
      } catch {
        stages = [];
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "access-control-allow-origin": "*",
      });
      const rec = { arrivalTs: Date.now(), firstWriteTs: 0 };
      requests.push(rec);
      void (async () => {
        for (const stage of stages) {
          if (stage.delay) {
            await new Promise((resolve) => setTimeout(resolve, stage.delay));
          }
          if (stage.mark) stage.mark();
          if (stage.events.length > 0) {
            if (rec.firstWriteTs === 0) rec.firstWriteTs = Date.now();
            res.write(sse(stage.events));
          }
        }
        res.end();
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/sse`,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** 注入 test-only 测量全局（生产路径无该全局 → 零成本） */
async function injectPerf(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __kiroStreamPerf?: object;
      __kiroPerf?: {
        visibleTs: number[];
        longTasks: number;
        longTaskDetails: string[];
        toolVisibleTs: number;
        firstAnswerTs: number;
      };
    };
    w.__kiroStreamPerf = {};
    w.__kiroPerf = {
      visibleTs: [],
      longTasks: 0,
      longTaskDetails: [] as string[],
      toolVisibleTs: 0,
      firstAnswerTs: 0,
    };
    // V4.6：真实 tool 时间点（addToolOutput 链路）记录
    (w as unknown as Record<string, unknown>).__kiroTurnPerf = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          w.__kiroPerf!.longTasks += 1;
          const e = entry as unknown as { duration: number; startTime: number; attribution?: { container?: Element | null }[] };
          const attrs: string[] = [];
          for (const a of e.attribution ?? []) {
            const node = a.container ?? null;
            if (node) attrs.push(`${node.tagName.toLowerCase()}.${String(node.className).slice(0, 40)}`);
          }
          w.__kiroPerf!.longTaskDetails.push(
            `dur=${Math.round(e.duration)}ms start=${Math.round(e.startTime)} ${attrs.join(",")}`
          );
        }
      }).observe({ entryTypes: ["longtask"] });
    } catch {
      /* 不支持 longtask：记 0 */
    }
    let scheduled = false;
    const record = () => {
      scheduled = false;
      w.__kiroPerf!.visibleTs.push(performance.now());
      // V4.3 Case G/H：Tool Row / 首个 Final Answer 出现的浏览器时间戳
      if (!w.__kiroPerf!.toolVisibleTs && document.querySelector('[data-testid="kiro-tool-row"]')) {
        w.__kiroPerf!.toolVisibleTs = performance.now();
      }
      if (!w.__kiroPerf!.firstAnswerTs && document.querySelector('[data-testid="kiro-markdown"]')) {
        w.__kiroPerf!.firstAnswerTs = performance.now();
      }
    };
    try {
      new MutationObserver(() => {
        if (!scheduled) {
          scheduled = true;
          requestAnimationFrame(record);
        }
      }).observe(document.documentElement ?? document, { subtree: true, characterData: true, childList: true });
    } catch {
      /* DOM 尚未就绪：跳过 DOM 时间戳测量 */
    }
  });
}

async function seedAI(page: Page) {
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
}

async function openKiro(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.getByTestId("kiro-composer").getByLabel("Ask Kiro").fill("生成一份长报告");
  await page.getByTestId("kiro-composer").getByLabel("发送").click();
}

/**
 * V4.4.1：验证页面 runtime 的 client throttle 常量确实等于预期值
 *（NEXT_PUBLIC env 需要 dev server 重启/重新构建才生效；不能假设 shell env 生效）。
 * 未设置 KIRO_EXPECTED_CLIENT_THROTTLE_MS 时只记录。
 */
async function verifyClientThrottle(page: Page, testName: string) {
  const runtime = await page.evaluate(
    () => (window as unknown as { __kiroClientThrottleMs?: number }).__kiroClientThrottleMs ?? -1
  );
  const expectedRaw = process.env.KIRO_EXPECTED_CLIENT_THROTTLE_MS;
  console.log(`[PERF][${testName}] runtimeClientThrottleMs=${runtime} expected=${expectedRaw ?? "default"}`);
  if (expectedRaw != null && expectedRaw !== "") {
    expect(runtime).toBe(Number(expectedRaw));
  } else {
    expect([16, 20, 24]).toContain(runtime);
  }
}

function toolInputEvent(callId: string, idx: number) {
  return [
    { type: "tool-input-start", toolCallId: callId, toolName: "search_assignments" },
    { type: "tool-input-delta", toolCallId: callId, inputTextDelta: `{"query":"q${idx}"}` },
    { type: "tool-input-available", toolCallId: callId, toolName: "search_assignments", input: { query: `q${idx}` } },
  ].map((o) => JSON.stringify(o));
}

/** 分块最终回答：每块 chunkSize chars，模拟 provider stream（cadence 可调） */
function finalStages(textId: string, text: string, chunkSize = 80, delay = 12) {
  const stages: SseStage[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    stages.push({
      delay,
      events: [JSON.stringify({ type: "text-delta", id: textId, delta: text.slice(i, i + chunkSize) })],
    });
  }
  stages.push({
    events: [
      JSON.stringify({ type: "text-end", id: textId }),
      JSON.stringify({ type: "finish-step" }),
      JSON.stringify({ type: "finish", finishReason: "stop" }),
    ],
  });
  return stages;
}

function boundaryFinalHead(msgId: string, textId: string) {
  return [
    { type: "start", messageId: msgId },
    { type: "start-step" },
    { type: "tool-input-start", toolCallId: "call_perf_b", toolName: "begin_final_answer" },
    { type: "tool-input-delta", toolCallId: "call_perf_b", inputTextDelta: "{}" },
    { type: "tool-input-available", toolCallId: "call_perf_b", toolName: "begin_final_answer", input: {} },
    { type: "finish-step" },
    { type: "start-step" },
    { type: "text-start", id: textId },
  ].map((o) => JSON.stringify(o));
}

/** tool 链 + boundary + final answer 的 SSE plan */
function agentPlanWithFinal(toolCount: number, finalText: string) {
  const markerRef = { ts: 0 };
  return {
    plan: (bodyJson: { messages?: unknown[] }) => {
      const toolOutputCount = ((bodyJson.messages ?? []) as { role: string; parts?: { type: string; state?: string }[] }[]).reduce(
        (sum, m) =>
          sum +
          (m.role === "assistant"
            ? (m.parts ?? []).filter((p) => p.type.startsWith("tool-") && p.state === "output-available").length
            : 0),
        0
      );
      if (toolOutputCount < toolCount) {
        return [
          { delay: 0, events: [JSON.stringify({ type: "start", messageId: "perf-1" }), JSON.stringify({ type: "start-step" })] },
          { delay: 5, events: toolInputEvent(`call_t${toolOutputCount}`, toolOutputCount) },
          { delay: 5, events: [JSON.stringify({ type: "finish-step" }), JSON.stringify({ type: "finish", finishReason: "tool-calls" })] },
        ];
      }
      markerRef.ts = Date.now();
      return [{ events: boundaryFinalHead("perf-1", "final-perf") }, ...finalStages("final-perf", finalText)];
    },
    markerRef,
  };
}

/** 纯 Final Answer（无 tool，boundary + final 同响应）plan */
function plainPlan(finalText: string, chunkSize = 80, delay = 12) {
  const markerRef = { ts: 0 };
  return {
    plan: () => {
      markerRef.ts = Date.now();
      return [
        { events: boundaryFinalHead("perf-1", "final-perf") },
        ...finalStages("final-perf", finalText, chunkSize, delay),
      ];
    },
    markerRef,
  };
}

const SENTINEL = "SENTINEL_FINAL_END_7f3k";
const FINAL_A = "今天完成了作业检查，结果一切正常。".repeat(133) + SENTINEL; // ~2130 chars
const LONG_NO_NEWLINE = "无空行长段落".repeat(1600) + SENTINEL; // ~9610 chars，无 \n
const MARKDOWN_HEAVY_BASE = [
  "# 报告标题",
  "",
  "## 第一节",
  "",
  "- 列表项一 **加粗** `inline code`",
  "- 列表项二 _斜体_",
  "",
  "1. 第一点",
  "2. 第二点",
  "",
  "> 引用行内容",
  "",
  "```ts",
  "const x: number = 42;",
  "export default x;",
  "```",
  "",
  "行内公式 $E = mc^2$ 与引用 [[source:web-1]]。",
  "",
  "$$",
  "\\int_0^1 x^2 dx",
  "$$",
  "",
  "结束段落。",
].join("\n");
const MARKDOWN_HEAVY = (MARKDOWN_HEAVY_BASE + "\n\n").repeat(6) + SENTINEL;

interface PerfSnapshot {
  worklogRenders: number;
  worklogRendersByPhase: Record<string, number>;
  toolRowRendersTotal: number;
  completedToolRows: number;
  splitterCalls: number;
  splitterChars: number;
  inlineSplitterCalls: number;
  inlineSplitterChars: number;
  resizeObserverCalls: number;
  scrollTopWrites: number;
  longTasks: number;
  p95VisibleGapMs: number;
  settleFullParses: number;
  settleReusedBlocks: number;
  settleCanonicalFallbacks: number;
  settleParsedChars: number;
  settleDurationMs: number;
  toolVisibleTs: number;
  firstAnswerTs: number;
  blockMounts: number;
  blockUnmounts: number;
  blockRenders: number;
  blockPromotions: number;
  promotionParsedChars: number;
}

async function readPerf(page: Page, finalMarkerTs: number): Promise<PerfSnapshot> {
  const r = await page.evaluate(() => {
    const w = window as unknown as {
      __kiroStreamPerf?: Record<string, number | Record<string, number>>;
      __kiroPerf?: {
        visibleTs: number[];
        longTasks: number;
        longTaskDetails: string[];
        toolVisibleTs: number;
        firstAnswerTs: number;
      };
    };
    const s = w.__kiroStreamPerf ?? {};
    return {
      worklogRenders: (s.worklogRenders as number) ?? 0,
      worklogRendersByPhase: (s.worklogRendersByPhase as Record<string, number>) ?? {},
      toolRowRendersTotal: (s.toolRowRendersTotal as number) ?? 0,
      completedToolRows: Object.keys((s.toolRowRenders as Record<string, number>) ?? {}).length,
      splitterCalls: (s.splitterCalls as number) ?? 0,
      splitterChars: (s.splitterChars as number) ?? 0,
      inlineSplitterCalls: (s.inlineSplitterCalls as number) ?? 0,
      inlineSplitterChars: (s.inlineSplitterChars as number) ?? 0,
      resizeObserverCalls: (s.resizeObserverCalls as number) ?? 0,
      scrollTopWrites: (s.scrollTopWrites as number) ?? 0,
      settleFullParses: (s.settleFullParses as number) ?? 0,
      settleReusedBlocks: (s.settleReusedBlocks as number) ?? 0,
      settleCanonicalFallbacks: (s.settleCanonicalFallbacks as number) ?? 0,
      settleParsedChars: (s.settleParsedChars as number) ?? 0,
      settleDurationMs: (s.settleDurationMs as number) ?? 0,
      blockMounts: (s.blockMounts as number) ?? 0,
      blockUnmounts: (s.blockUnmounts as number) ?? 0,
      blockRenders: (s.blockRenders as number) ?? 0,
      blockPromotions: (s.blockPromotions as number) ?? 0,
      promotionParsedChars: (s.promotionParsedChars as number) ?? 0,
      longTasks: w.__kiroPerf?.longTasks ?? 0,
      longTaskDetails: w.__kiroPerf?.longTaskDetails ?? [],
      visibleTs: w.__kiroPerf?.visibleTs ?? [],
      toolVisibleTs: w.__kiroPerf?.toolVisibleTs ?? 0,
      firstAnswerTs: w.__kiroPerf?.firstAnswerTs ?? 0,
    };
  });
  // visibleTs 是 performance.now 域（页面导航起算）→ 转换到 Date.now 域再与 marker 比较
  const offset = await page.evaluate(() => Date.now() - performance.now());
  const after = r.visibleTs
    .map((t) => t + offset)
    .filter((t) => t >= finalMarkerTs - 5);
  const gaps: number[] = [];
  for (let i = 1; i < after.length; i++) gaps.push(after[i] - after[i - 1]);
  gaps.sort((a, b) => a - b);
  const p95 = gaps.length > 0 ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.95))] : 0;
  console.log(`[PERF] visibleTs=${r.visibleTs.length} after=${after.length} gaps=${gaps.length} maxGap=${gaps.length ? gaps[gaps.length - 1] : 0}`);
  if (r.longTaskDetails.length > 0) {
    console.log(`[PERF] longTasks=${r.longTaskDetails.join(" | ")}`);
  }
  return {
    worklogRenders: r.worklogRenders,
    worklogRendersByPhase: r.worklogRendersByPhase,
    toolRowRendersTotal: r.toolRowRendersTotal,
    completedToolRows: r.completedToolRows,
    splitterCalls: r.splitterCalls,
    splitterChars: r.splitterChars,
    inlineSplitterCalls: r.inlineSplitterCalls,
    inlineSplitterChars: r.inlineSplitterChars,
    resizeObserverCalls: r.resizeObserverCalls,
    scrollTopWrites: r.scrollTopWrites,
    longTasks: r.longTasks,
    p95VisibleGapMs: p95,
    settleFullParses: r.settleFullParses,
    settleReusedBlocks: r.settleReusedBlocks,
    settleCanonicalFallbacks: r.settleCanonicalFallbacks,
    settleParsedChars: r.settleParsedChars,
    settleDurationMs: r.settleDurationMs,
    blockMounts: r.blockMounts,
    blockUnmounts: r.blockUnmounts,
    blockRenders: r.blockRenders,
    blockPromotions: r.blockPromotions,
    promotionParsedChars: r.promotionParsedChars,
    toolVisibleTs: r.toolVisibleTs + offset,
    firstAnswerTs: r.firstAnswerTs + offset,
  };
}

async function runCase(
  page: Page,
  caseName: string,
  plan: () => SseStage[],
  markerRef: { ts: number },
  expectText: string,
  firstText: string
) {
  const startedAt = Date.now();
  await openKiro(page);
  const msg = page.getByTestId("kiro-message").last();
  await expect(msg.locator(".kiro-markdown").first()).toContainText(firstText, { timeout: 60000 });
  await expect(msg.locator(".kiro-markdown").first()).toContainText(SENTINEL, { timeout: 60000 });
  const ttfvMs = Date.now() - startedAt;
  console.log(`[PERF][${caseName}] markerTs=${markerRef.ts} now=${Date.now()} markerDelta=${Date.now() - markerRef.ts}`);
  const perf = await readPerf(page, markerRef.ts);
  console.log(
    `[PERF][${caseName}] streamMs=${Date.now() - markerRef.ts} ttfvMs=${ttfvMs} ` +
      JSON.stringify(perf)
  );
  return { case: caseName, streamMs: Date.now() - markerRef.ts, ttfvMs, ...perf };
}

async function setupAgentCase(page: Page, toolCount: number, finalText: string) {
  const ssePlan = agentPlanWithFinal(toolCount, finalText);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  return { sse, markerRef: ssePlan.markerRef };
}

async function setupPlainCase(page: Page, finalText: string) {
  const ssePlan = plainPlan(finalText);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  return { sse, markerRef: ssePlan.markerRef };
}

test("PERF Case A: 2 Tool + 2000 chars Final Answer", async ({ page }) => {
  const { sse, markerRef } = await setupAgentCase(page, 2, FINAL_A);
  const r = await runCase(page, "A", () => [], markerRef, FINAL_A, FINAL_A.slice(0, 30));
  await sse.close();
  expect(r.splitterCalls).toBeGreaterThan(0);
  expect(r.completedToolRows).toBe(2);
});

test("PERF Case B: 8 Tool + 8000 chars Final Answer", async ({ page }) => {
  const final = FINAL_A.repeat(4).slice(0, 8000) + SENTINEL;
  const { sse, markerRef } = await setupAgentCase(page, 8, final);
  const r = await runCase(page, "B", () => [], markerRef, final, final.slice(0, 30));
  await sse.close();
  expect(r.completedToolRows).toBe(8);
});

test("PERF Case C: 8000 chars no-newline paragraph", async ({ page }) => {
  const { sse, markerRef } = await setupPlainCase(page, LONG_NO_NEWLINE);
  const r = await runCase(page, "C", () => [], markerRef, LONG_NO_NEWLINE, LONG_NO_NEWLINE.slice(0, 30));
  await sse.close();
  expect(r.inlineSplitterCalls).toBeGreaterThan(0);
});

// ---- cadence 形态（Phase 8 证据）----
// E：burst provider（300 chars / 120ms 间歇）≈ 无 server smooth 的原生大 chunk；
// F：fine 5ms（40 chars）≈ 移除 server 12ms 排队后的小 chunk 高频形态。
// 两者都经 client 24ms throttle。决策：如果 E 的 p95 gap 明显超 60ms → 保留 light
// server shaping；如果 F 与 baseline（12ms/80）无差 → 移除 12ms 排队不损失体验。

test("PERF Case E: burst provider 300 chars / 120ms（原生大 chunk 形态）", async ({ page }) => {
  const ssePlan = plainPlan(LONG_NO_NEWLINE, 300, 120);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  const r = await runCase(page, "E", () => [], ssePlan.markerRef, LONG_NO_NEWLINE, LONG_NO_NEWLINE.slice(0, 30));
  await sse.close();
  expect(r.splitterCalls).toBeGreaterThan(0);
});

test("PERF Case F: fine 5ms / 40 chars（移除 12ms 排队的密集小 chunk 形态）", async ({ page }) => {
  const ssePlan = plainPlan(LONG_NO_NEWLINE, 40, 5);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  const r = await runCase(page, "F", () => [], ssePlan.markerRef, LONG_NO_NEWLINE, LONG_NO_NEWLINE.slice(0, 30));
  await sse.close();
  expect(r.splitterCalls).toBeGreaterThan(0);
});

test("PERF Case D: markdown-heavy", async ({ page }) => {
  const { sse, markerRef } = await setupPlainCase(page, MARKDOWN_HEAVY);
  const r = await runCase(page, "D", () => [], markerRef, MARKDOWN_HEAVY, "报告标题");
  await sse.close();
  expect(r.splitterCalls).toBeGreaterThan(0);
});

// ============================================================
// V4.3 Case G / H：Phase-aware Streaming（reasoning 不人为延迟）
//
// 测量：mock SSE 发出最后 reasoning 事件 → 浏览器 Tool Row / 首个 Final Answer 可见。
// mock 直连 client（bypass server transform），因此这里验证的是端到端时序不受
// reasoning 数量影响（reasoning → tool / answer 的 server 侧零 delay 由
// tests/textOnlySmoothStream.test.ts 单测证明）。
// ============================================================

const REASONING_DELTAS = 200;

function reasoningStages(messageId: string, reasoningId: string): SseStage[] {
  const stages: SseStage[] = [
    { delay: 0, events: [JSON.stringify({ type: "start", messageId }), JSON.stringify({ type: "start-step" })] },
    { delay: 0, events: [JSON.stringify({ type: "reasoning-start", id: reasoningId })] },
  ];
  for (let i = 0; i < REASONING_DELTAS; i++) {
    stages.push({
      delay: 1,
      events: [JSON.stringify({ type: "reasoning-delta", id: reasoningId, delta: `推理内容第${i}步：分析数据源与约束条件，逐步推导结论。` })],
    });
  }
  return stages;
}

/** Case G：reasoning × 200 → Tool Call（search_assignments）→ 续跑 final answer */
function reasoningToolPlan(finalText: string) {
  const markerRef = { lastReasoningTs: 0 };
  return {
    plan: (bodyJson: { messages?: unknown[] }) => {
      const toolOutputCount = ((bodyJson.messages ?? []) as { role: string; parts?: { type: string; state?: string }[] }[]).reduce(
        (sum, m) =>
          sum +
          (m.role === "assistant"
            ? (m.parts ?? []).filter((p) => p.type.startsWith("tool-") && p.state === "output-available").length
            : 0),
        0
      );
      if (toolOutputCount === 0) {
        return [
          ...reasoningStages("perf-g", "r_g"),
          { delay: 0, mark: () => { markerRef.lastReasoningTs = Date.now(); }, events: [JSON.stringify({ type: "reasoning-end", id: "r_g" })] },
          { delay: 0, events: toolInputEvent("call_g0", 0) },
          { delay: 5, events: [JSON.stringify({ type: "finish-step" }), JSON.stringify({ type: "finish", finishReason: "tool-calls" })] },
        ];
      }
      return [{ events: boundaryFinalHead("perf-g", "final-g") }, ...finalStages("final-g", finalText)];
    },
    markerRef,
  };
}

/** Case H：reasoning × 200 → begin_final_answer boundary → Final Answer */
function reasoningFinalPlan(finalText: string) {
  const markerRef = { lastReasoningTs: 0 };
  return {
    plan: (bodyJson: { messages?: unknown[] }) => {
      const toolOutputCount = ((bodyJson.messages ?? []) as { role: string; parts?: { type: string; state?: string }[] }[]).reduce(
        (sum, m) =>
          sum +
          (m.role === "assistant"
            ? (m.parts ?? []).filter((p) => p.type.startsWith("tool-") && p.state === "output-available").length
            : 0),
        0
      );
      if (toolOutputCount === 0) {
        return [
          ...reasoningStages("perf-h", "r_h"),
          { delay: 0, mark: () => { markerRef.lastReasoningTs = Date.now(); }, events: [JSON.stringify({ type: "reasoning-end", id: "r_h" })] },
          { delay: 0, events: toolInputEvent("call_h0", 0) },
          { delay: 5, events: [JSON.stringify({ type: "finish-step" }), JSON.stringify({ type: "finish", finishReason: "tool-calls" })] },
        ];
      }
      return [{ events: boundaryFinalHead("perf-h", "final-h") }, ...finalStages("final-h", finalText)];
    },
    markerRef,
  };
}

/** 等待 Final Answer settle（app 内 test-only counter：streaming=false 帧已渲染并提交） */
async function waitAnswerSettled(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __kiroStreamPerf?: { settleTransitions?: number } }).__kiroStreamPerf
              ?.settleTransitions ?? 0
        ),
      { timeout: 30000 }
    )
    .toBeGreaterThan(0);
}

async function runReasoningCase(
  page: Page,
  caseName: string,
  plan: () => SseStage[],
  markerRef: { lastReasoningTs: number },
  expectText: string,
  firstText: string
) {
  const startedAt = Date.now();
  await openKiro(page);
  const msg = page.getByTestId("kiro-message").last();
  await expect(msg.locator(".kiro-markdown").first()).toContainText(firstText, { timeout: 60000 });
  await expect(msg.locator(".kiro-markdown").first()).toContainText(SENTINEL, { timeout: 60000 });
  await waitAnswerSettled(page);
  const perf = await readPerf(page, markerRef.lastReasoningTs);
  const reasoningToToolVisibleMs = perf.toolVisibleTs > 0 ? perf.toolVisibleTs - markerRef.lastReasoningTs : -1;
  const reasoningToAnswerVisibleMs = perf.firstAnswerTs > 0 ? perf.firstAnswerTs - markerRef.lastReasoningTs : -1;
  console.log(
    `[PERF][${caseName}] markerTs=${markerRef.lastReasoningTs} ttfvMs=${Date.now() - startedAt} ` +
      `reasoningToToolVisibleMs=${reasoningToToolVisibleMs} reasoningToAnswerVisibleMs=${reasoningToAnswerVisibleMs} ` +
      JSON.stringify(perf)
  );
  return { case: caseName, reasoningToToolVisibleMs, reasoningToAnswerVisibleMs, ...perf };
}

test("PERF Case G: reasoning ×200 → Tool（不随 reasoning 数量线性延迟；reasoning 不可见）", async ({ page }) => {
  const final = "分析完成，总结如下。" + SENTINEL;
  const ssePlan = reasoningToolPlan(final);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  const r = await runReasoningCase(page, "G", () => [], ssePlan.markerRef, final, "分析完成");
  await sse.close();
  // 200 × 4ms ≈ 800ms 的人为排队已消除：Tool 应在 reasoning 结束后很快出现
  expect(r.reasoningToToolVisibleMs).toBeGreaterThan(0);
  expect(r.reasoningToToolVisibleMs).toBeLessThan(800);
  // reasoning 内容永远不可见（Worklog / Final Answer 都不出现）
  await expect(page.getByText("推理内容第")).toHaveCount(0);
});

test("PERF Case H: reasoning ×200 → Final Answer（首字出现不受 reasoning 数量影响）", async ({ page }) => {
  const final = "最终结论：任务全部完成，无遗留问题。" + SENTINEL;
  const ssePlan = reasoningFinalPlan(final);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  const r = await runReasoningCase(page, "H", () => [], ssePlan.markerRef, final, "最终结论");
  await sse.close();
  expect(r.reasoningToAnswerVisibleMs).toBeGreaterThan(0);
  // 旧行为 = 200 reasoning chunks × 4ms ≈ 800ms 人为排队；现在应显著低于该上界
  expect(r.reasoningToAnswerVisibleMs).toBeLessThan(1200);
  await expect(page.getByText("推理内容第")).toHaveCount(0);
});

// ============================================================
// V4.3 Settle 用例（S1-S6）：Zero-stall Settle Handoff
//
// 流式中捕获稳定 DOM 节点引用 → settle 后验证 DOM identity 保留（safe-reuse）
// 或 canonical fallback（S6）。counters：settleFullParses / settleReusedBlocks /
// settleCanonicalFallbacks / settleParsedChars。
// ============================================================

const S2_HEADING = "# 报告标题\n\n第一段内容。\n\n## 二级标题\n\n第二段内容。\n\n尾段内容。\n\n" + SENTINEL;
const S3_FENCE = "前言段落。\n\n```ts\nconst x = 42;\nconst y = x * 2;\n```\n\n结束段落。\n\n" + SENTINEL;
const S4_MATH = "# 公式\n\n$$\nE = mc^2\n\n$$\n\n正文段落。\n\n" + SENTINEL;
// S5 引用 doc-1（上传的文本附件 sourceId），pill 才可解析（KiroCitation 无 sources 返回 null）
const S5_CITATION = "正文包含引用 [[source:doc-1]] 的说明。\n\n第二段内容。\n\n" + SENTINEL;
const S6_LOOSE_LIST = "前言。\n\n- 列表项一\n\n- 列表项二\n\n- 列表项三\n\n尾段。\n\n" + SENTINEL;

async function runSettleCase(
  page: Page,
  caseName: string,
  plan: () => SseStage[],
  markerRef: { ts: number },
  expectText: string,
  firstText: string,
  captureSelector: string,
  prepare?: (page: Page) => Promise<void>,
  capture?: (page: Page) => Promise<import("@playwright/test").JSHandle>
) {
  const startedAt = Date.now();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  if (prepare) await prepare(page);
  await page.getByTestId("kiro-composer").getByLabel("Ask Kiro").fill("生成一份长报告");
  await page.getByTestId("kiro-composer").getByLabel("发送").click();
  const msg = page.getByTestId("kiro-message").last();
  // 1) 流式中：稳定节点出现后捕获 DOM 引用
  const captured = capture
    ? await capture(page)
    : await page.waitForSelector(captureSelector, { timeout: 30000 });
  // 2) 等完整正文 + settle（settleTransitions > 0 = streaming=false 帧已渲染）
  await expect(msg.locator(".kiro-markdown").first()).toContainText(firstText, { timeout: 60000 });
  await expect(msg).toContainText(SENTINEL, { timeout: 60000 });
  await waitAnswerSettled(page);
  // 3) DOM identity 验证（settle 后节点是否仍连接）
  const connected = await captured.evaluate((el) => (el as Element | null)?.isConnected ?? false);
  console.log(`[PERF][${caseName}] settleConnected=${connected} streamMs=${Date.now() - markerRef.ts} ttfvMs=${Date.now() - startedAt}`);
  return { case: caseName, settleConnected: connected, captured };
}

test("PERF Case S1: 8K 无空行段落 → settle 零 reparse（fragment p DOM identity 保留）", async ({ page }) => {
  const ssePlan = plainPlan(LONG_NO_NEWLINE);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  const r = await runSettleCase(page, "S1", () => [], ssePlan.markerRef, LONG_NO_NEWLINE, LONG_NO_NEWLINE.slice(0, 30), '[data-testid="kiro-inline-fragment-paragraph"]');
  const perf = await readPerf(page, ssePlan.markerRef.ts);
  console.log(`[PERF][S1] ` + JSON.stringify(perf));
  await sse.close();
  expect(r.settleConnected).toBe(true);
  expect(perf.settleFullParses).toBe(0);
  // settle 帧不能重新 parse 完整 8000+ chars（memo 复用 → 0）
  expect(perf.settleParsedChars).toBeLessThan(1000);
  expect(perf.inlineSplitterCalls).toBeGreaterThan(0);
});

test("PERF Case S2: heading + paragraphs → safe-reuse（stable block DOM identity 保留）", async ({ page }) => {
  const ssePlan = plainPlan(S2_HEADING, 24, 24);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  const r = await runSettleCase(page, "S2", () => [], ssePlan.markerRef, S2_HEADING, "报告标题", '[data-testid="kiro-streaming-markdown"] h1');
  const perf = await readPerf(page, ssePlan.markerRef.ts);
  console.log(`[PERF][S2] ` + JSON.stringify(perf));
  await sse.close();
  expect(r.settleConnected).toBe(true);
  expect(perf.settleFullParses).toBe(0);
  expect(perf.settleReusedBlocks).toBeGreaterThanOrEqual(2);
});

test("PERF Case S3: fenced code + paragraph → 仅 tail finalize，stable pre 不重 render", async ({ page }) => {
  const ssePlan = plainPlan(S3_FENCE, 24, 24);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  const r = await runSettleCase(page, "S3", () => [], ssePlan.markerRef, S3_FENCE, "前言段落", '[data-testid="kiro-streaming-markdown"] .kiro-markdown pre');
  const perf = await readPerf(page, ssePlan.markerRef.ts);
  console.log(`[PERF][S3] ` + JSON.stringify(perf));
  await sse.close();
  expect(r.settleConnected).toBe(true);
  expect(perf.settleFullParses).toBe(0);
  expect(perf.settleParsedChars).toBeLessThan(1000);
});

test("PERF Case S4: KaTeX → stable math 不重新 KaTeX render", async ({ page }) => {
  const ssePlan = plainPlan(S4_MATH, 24, 24);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  const r = await runSettleCase(page, "S4", () => [], ssePlan.markerRef, S4_MATH, "公式", '[data-testid="kiro-streaming-markdown"] .katex');
  const perf = await readPerf(page, ssePlan.markerRef.ts);
  console.log(`[PERF][S4] ` + JSON.stringify(perf));
  await sse.close();
  expect(r.settleConnected).toBe(true);
  expect(perf.settleFullParses).toBe(0);
});

test("PERF Case S5: citation → stable citation pill DOM identity 保留", async ({ page }) => {
  const { buildMinimalPdf } = require("../fixtures/files");
  const ssePlan = plainPlan(S5_CITATION, 24, 24);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  const r = await runSettleCase(
    page,
    "S5",
    () => [],
    ssePlan.markerRef,
    S5_CITATION,
    "正文包含引用",
    '[data-testid="kiro-streaming-markdown"] [data-testid="kiro-citation"]',
    async (p) => {
      // 上传 PDF 附件 → buildTurnSnapshot 注册 doc-1 source → citation pill 可解析
      const chooserPromise = p.waitForEvent("filechooser");
      await p.getByTestId("kiro-composer").getByLabel("添加附件").click();
      await p.getByRole("menuitem", { name: "上传文件" }).click();
      const chooser = await chooserPromise;
      await chooser.setFiles({
        name: "讲义.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(buildMinimalPdf("讲义正文内容")),
      });
      await expect(p.getByTestId("kiro-attachment-chip")).toContainText("PDF", { timeout: 15000 });
    },
    async (p) => {
      // 等第一个 stable block flush（出现第二个 kiro-markdown 稳定块）后再捕获其 citation，
      // 避免捕获到仍属于 Active Tail 的 citation（tail flush 时会被替换）
      await p.waitForFunction(
        () =>
          document.querySelectorAll(
            '[data-testid="kiro-streaming-markdown"] [data-testid="kiro-markdown"]'
          ).length >= 2,
        { timeout: 30000 }
      );
      return p.evaluateHandle(() => {
        const md = document.querySelectorAll(
          '[data-testid="kiro-streaming-markdown"] [data-testid="kiro-markdown"]'
        );
        return md[0]?.querySelector('[data-testid="kiro-citation"]') ?? null;
      });
    }
  );
  const perf = await readPerf(page, ssePlan.markerRef.ts);
  console.log(`[PERF][S5] ` + JSON.stringify(perf));
  await sse.close();
  expect(r.settleConnected).toBe(true);
  expect(perf.settleFullParses).toBe(0);
});

test("PERF Case S6: loose list → canonicalize（两阶段 handoff；最终 DOM 与全文 parse 一致）", async ({ page }) => {
  const ssePlan = plainPlan(S6_LOOSE_LIST, 24, 24);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  const r = await runSettleCase(page, "S6", () => [], ssePlan.markerRef, S6_LOOSE_LIST, "前言", '[data-testid="kiro-streaming-markdown"] ul');
  // Phase 2 canonical fallback：完整渲染一棵 loose list（streaming 的两棵独立 ul 被替换）
  const msg = page.getByTestId("kiro-message").last();
  await expect(msg.locator('[data-testid="kiro-streaming-markdown"] ul')).toHaveCount(1, { timeout: 15000 });
  await expect(msg.locator('[data-testid="kiro-streaming-markdown"] ul')).toContainText("列表项一");
  await expect(msg.locator('[data-testid="kiro-streaming-markdown"] ul')).toContainText("列表项三");
  // 流式树节点已被 canonical 树替换（identity 检查必须在 phase-2 提交后执行）
  const replaced = await r.captured.evaluate((el) => (el as Element | null)?.isConnected ?? false);
  const perf = await readPerf(page, ssePlan.markerRef.ts);
  console.log(`[PERF][S6] settleConnected=${r.settleConnected} canonicalReplaced=${!replaced} ` + JSON.stringify(perf));
  await sse.close();
  expect(perf.settleCanonicalFallbacks).toBe(1);
  expect(perf.settleFullParses).toBe(0);
  // 流式树节点已被 canonical 树替换（非 safe-reuse）
  expect(replaced).toBe(false);
});

test("PERF Frame: first-frame + tool-chain 分解（V4.5 只 profile 不优化）", async ({ page }) => {
  // 2 Tool + 短 Final（同 Case A 形态）
  const final = "今天完成了作业检查，结果一切正常。" + SENTINEL;
  const ssePlan = agentPlanWithFinal(2, final);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.getByTestId("kiro-composer").getByLabel("Ask Kiro").fill("生成一份长报告");
  const sendClickTs = Date.now();
  await page.getByTestId("kiro-composer").getByLabel("发送").click();
  const msg = page.getByTestId("kiro-message").last();
  await expect(msg).toContainText(SENTINEL, { timeout: 60000 });
  await waitAnswerSettled(page);
  const perf = await readPerf(page, sendClickTs);
  const reqs = sse.requests;
  const offset = await page.evaluate(() => Date.now() - performance.now());
  const firstAnswerDate = perf.firstAnswerTs;
  // V4.6：真实 tool 时间点（__kiroTurnPerf；不记录 tool 内容）
  const turnPerfEntries = await page.evaluate(() => {
    const arr = (window as unknown as { __kiroTurnPerf?: { name: string; at: number }[] }).__kiroTurnPerf;
    return arr ? arr.map((e) => ({ ...e, at: e.at + (Date.now() - performance.now()) })) : [];
  });
  const firstToolReceived = turnPerfEntries.find((e) => e.name === "toolCallReceived");
  const firstToolComplete = turnPerfEntries.find((e) => e.name === "toolExecutionComplete");
  const firstAddToolOutput = turnPerfEntries.find((e) => e.name === "addToolOutput");
  const lastContinuationReq = reqs[reqs.length - 1];
  const breakdown = {
    // sendPreflightMs：Send click → 第一个请求到达（client preflight / SDK send）
    sendPreflightMs: reqs[0] ? reqs[0].arrivalTs - sendClickTs : -1,
    // networkTTFTMs：请求到达 → 第一个 SSE part 写出（mock 侧 ≈ 0）
    networkTTFTMs: reqs[0] ? reqs[0].firstWriteTs - reqs[0].arrivalTs : -1,
    // firstPartToPaintMs：第一个 SSE part → 首个可见 DOM 更新（Tool Row）
    firstPartToPaintMs: reqs[0] ? perf.toolVisibleTs - reqs[0].firstWriteTs : -1,
    // toolExecutionMs：Tool Call received → 执行完成（真实 Tool 执行时间）
    toolExecutionMs:
      firstToolReceived && firstToolComplete ? firstToolComplete.at - firstToolReceived.at : -1,
    // addToolOutput → continuation HTTP request arrival（真实 addToolOutput 时间点）
    addToolOutputToContinuationRequestMs:
      firstAddToolOutput && lastContinuationReq ? lastContinuationReq.arrivalTs - firstAddToolOutput.at : -1,
    // continuationNetworkWaitMs：continuation 到达 → 首个 SSE part 写出
    continuationNetworkWaitMs: lastContinuationReq
      ? lastContinuationReq.firstWriteTs - lastContinuationReq.arrivalTs
      : -1,
    // continuationPartToPaintMs：continuation 首 part → 首个 Final Answer 可见
    continuationPartToPaintMs: lastContinuationReq
      ? firstAnswerDate - lastContinuationReq.firstWriteTs
      : -1,
    requests: reqs.length,
  };
  console.log(`[PERF][FRAME] sendClick=${sendClickTs} ` + JSON.stringify(breakdown));
  await sse.close();
  // 只 profile：验证链路完整（不做延迟断言；时间域换算允许 ±50ms 抖动）
  expect(breakdown.requests).toBeGreaterThanOrEqual(2);
  expect(breakdown.sendPreflightMs).toBeGreaterThanOrEqual(0);
  expect(breakdown.toolExecutionMs).toBeGreaterThanOrEqual(0);
  expect(breakdown.addToolOutputToContinuationRequestMs).toBeGreaterThan(-50);
});

test("PERF Throttle: runtime client throttle constant 与预期一致（V4.4.1 A/B 校验）", async ({ page }) => {
  await injectPerf(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await verifyClientThrottle(page, "THROTTLE");
});

// ============================================================
// V4.5 Promotion-Stable Markdown DOM
//
// 核心 invariant：Active Tail → Stable Block 的 promotion 不得 remount /
// 重新 parse 已经展示的正文。P1 证明普通段落 remount；P2 证明 8K 段落
// promotion 后不允许再次 KiroMarkdown(full 8000)。
// ============================================================

function cjkText(length: number): string {
  const unit = "这是一段没有空行的超长中文内容用于验证自适应切分与有界整形";
  let s = "";
  while (s.length < length) s += unit;
  return s.slice(0, length);
}

const P1_PARAGRAPH = "这是第一段正在流式输出的文字，这段内容会持续一段时间，直到遇到空行才结束。";
const P1_TEXT = P1_PARAGRAPH + "\n\n这是第二段。" + SENTINEL;

/** 8K 长段 + 空行 + 第二段（promotion 时刻 = blank line 所在的 chunk 写入） */
const P2_PARAGRAPH = cjkText(8000);
const P2_TEXT = P2_PARAGRAPH + "\n\n第二段开始。" + SENTINEL;

/**
 * promotion fixture plan：blank line 所在的 chunk 写入时打 promotion 时间戳 marker。
 * blankCharIndex = 第一段长度（\n\n 的起点）。extraMarkers 可追加其他关键帧 marker。
 */
function promotionPlan(
  finalText: string,
  chunkSize: number,
  delay: number,
  blankCharIndex: number,
  extraMarkers?: { at: number; name: string }[]
) {
  const markerRef: Record<string, number> & { promotionTs: number } = { promotionTs: 0 };
  for (const m of extraMarkers ?? []) markerRef[m.name] = 0;
  return {
    plan: () => {
      const stages: SseStage[] = [];
      let written = 0;
      for (let i = 0; i < finalText.length; i += chunkSize) {
        const chunk = finalText.slice(i, i + chunkSize);
        const marks: (() => void)[] = [];
        if (markerRef.promotionTs === 0 && written < blankCharIndex && written + chunk.length >= blankCharIndex) {
          marks.push(() => {
            markerRef.promotionTs = Date.now();
          });
        }
        for (const m of extraMarkers ?? []) {
          if (markerRef[m.name] === 0 && written < m.at && written + chunk.length >= m.at) {
            marks.push(() => {
              markerRef[m.name] = Date.now();
            });
          }
        }
        stages.push({
          delay,
          events: [JSON.stringify({ type: "text-delta", id: "p-final", delta: chunk })],
          ...(marks.length > 0 ? { mark: () => marks.forEach((fn) => fn()) } : {}),
        });
        written += chunk.length;
      }
      stages.push({
        events: [
          JSON.stringify({ type: "text-end", id: "p-final" }),
          JSON.stringify({ type: "finish-step" }),
          JSON.stringify({ type: "finish", finishReason: "stop" }),
        ],
      });
      return [{ events: boundaryFinalHead("perf-p", "p-final") }, ...stages];
    },
    markerRef,
  };
}

/** promotion 窗口（blank line 写入 → +600ms）内的 >50ms Long Task 过滤 */
async function promotionWindowLongTasks(page: Page, promotionTs: number): Promise<string[]> {
  const offset = await page.evaluate(() => Date.now() - performance.now());
  const perfTs = promotionTs - offset;
  return page.evaluate(({ start, end }) => {
    const w = window as unknown as { __kiroPerf?: { longTaskDetails?: string[] } };
    const out: string[] = [];
    for (const line of w.__kiroPerf?.longTaskDetails ?? []) {
      const m = /dur=(\d+)ms start=(\d+)/.exec(line);
      if (m && Number(m[2]) >= start && Number(m[2]) <= end) out.push(line);
    }
    return out;
  }, { start: perfTs - 100, end: perfTs + 600 });
}

test("PERF Case P1: 普通段落 promotion → DOM identity 保持（不 remount）", async ({ page }) => {
  const ssePlan = promotionPlan(P1_TEXT, 6, 30, P1_PARAGRAPH.length);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.getByTestId("kiro-composer").getByLabel("Ask Kiro").fill("生成报告");
  await page.getByTestId("kiro-composer").getByLabel("发送").click();

  // 流式 active 阶段（第一段尚未完整输出）捕获段落 DOM node
  await page.waitForFunction(
    (headLen) => {
      const el = document.querySelector('[data-testid="kiro-streaming-markdown"] .kiro-markdown');
      if (!el) return false;
      const t = el.textContent ?? "";
      return t.length >= 10 && t.length < headLen;
    },
    P1_PARAGRAPH.length,
    { timeout: 30000 }
  );
  const captured = await page.evaluateHandle(() =>
    document.querySelector('[data-testid="kiro-streaming-markdown"] .kiro-markdown')
  );

  // 等完整正文 + settle（promotion 必然已发生）
  const msg = page.getByTestId("kiro-message").last();
  await expect(msg).toContainText(SENTINEL, { timeout: 60000 });
  await waitAnswerSettled(page);
  const connected = await captured.evaluate((el) => (el as Element | null)?.isConnected ?? false);
  const perf = await readPerf(page, ssePlan.markerRef.promotionTs);
  console.log(`[PERF][P1] promotionConnected=${connected} promotionTs=${ssePlan.markerRef.promotionTs} ` + JSON.stringify(perf));
  await sse.close();
  // V4.5 invariant：active 段落 promotion 后必须是同一个 DOM node
  expect(connected).toBe(true);
  // promotion 的 re-parse 至多一次最终渲染（段落末段与空行同 chunk 到达），
  // 有界于该 block 长度；绝不随 promotion 数量线性累积全文
  expect(perf.promotionParsedChars).toBeLessThanOrEqual(P1_PARAGRAPH.length);
});

test("PERF Case P2: 8K 段落 promotion → 不重新 parse 全文（outer DOM 保持）", async ({ page }) => {
  const ssePlan = promotionPlan(P2_TEXT, 80, 12, P2_PARAGRAPH.length);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.getByTestId("kiro-composer").getByLabel("Ask Kiro").fill("生成报告");
  await page.getByTestId("kiro-composer").getByLabel("发送").click();

  // 流式 active 阶段：fragment paragraph（inline chunks 已形成）出现后捕获
  await page.waitForSelector('[data-testid="kiro-inline-fragment-paragraph"]', { timeout: 30000 });
  const captured = await page.evaluateHandle(() =>
    document.querySelector('[data-testid="kiro-inline-fragment-paragraph"]')
  );
  // 等 8K 段落接近完成（还剩 ~100 chars）再快照 counters——把测量窗口收紧到
  // promotion + 第二段 + settle 帧，避免把 streaming 的 RO/scroll 计入
  await page.waitForFunction(
    (minLen) => {
      const el = document.querySelector('[data-testid="kiro-inline-fragment-paragraph"]');
      return el && (el.textContent?.length ?? 0) >= minLen;
    },
    P2_PARAGRAPH.length - 100,
    { timeout: 30000 }
  );
  const beforePromotion = await page.evaluate(() => {
    const w = window as unknown as { __kiroStreamPerf?: Record<string, number> };
    const s = w.__kiroStreamPerf ?? {};
    return {
      ro: (s.resizeObserverCalls as number) ?? 0,
      scroll: (s.scrollTopWrites as number) ?? 0,
    };
  });

  const msg = page.getByTestId("kiro-message").last();
  await expect(msg).toContainText(SENTINEL, { timeout: 60000 });
  await waitAnswerSettled(page);
  const connected = await captured.evaluate((el) => (el as Element | null)?.isConnected ?? false);
  const perf = await readPerf(page, ssePlan.markerRef.promotionTs);
  const promotionLongTasks = await promotionWindowLongTasks(page, ssePlan.markerRef.promotionTs);
  const afterPromotion = await page.evaluate(() => {
    const w = window as unknown as { __kiroStreamPerf?: Record<string, number> };
    const s = w.__kiroStreamPerf ?? {};
    return {
      ro: (s.resizeObserverCalls as number) ?? 0,
      scroll: (s.scrollTopWrites as number) ?? 0,
    };
  });
  console.log(
    `[PERF][P2] promotionConnected=${connected} roDelta=${afterPromotion.ro - beforePromotion.ro} ` +
      `scrollDelta=${afterPromotion.scroll - beforePromotion.scroll} promotionLongTasks=${JSON.stringify(promotionLongTasks)} ` +
      JSON.stringify(perf)
  );
  await sse.close();
  // outer DOM identity（fragment paragraph 不因 promotion 重建）
  expect(connected).toBe(true);
  // promotion 帧不得重新 parse 8000 chars（目标 ≈ 0 或最后 mutable window）
  expect(perf.promotionParsedChars).toBeLessThan(1000);
  // promotion 窗口不得出现新的 >50ms Long Task
  expect(promotionLongTasks).toHaveLength(0);
  // promotion 不产生明显 layout 突变（RO/scroll 增量有界）
  expect(afterPromotion.ro - beforePromotion.ro).toBeLessThan(8);
  expect(afterPromotion.scroll - beforePromotion.scroll).toBeLessThan(8);
});

/** P3-P6 共用：打开 Kiro → 流式 → 按条件捕获 outer block → 等完整正文 → 验证 identity */
async function runPromotionIdentityCase(
  page: Page,
  caseName: string,
  ssePlan: { markerRef: Record<string, number> & { promotionTs: number }; plan: (b: { messages?: unknown[] }) => SseStage[] },
  expectText: string,
  captureWait: () => Promise<import("@playwright/test").JSHandle>
) {
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.getByTestId("kiro-composer").getByLabel("Ask Kiro").fill("生成报告");
  await page.getByTestId("kiro-composer").getByLabel("发送").click();
  const captured = await captureWait();
  const msg = page.getByTestId("kiro-message").last();
  await expect(msg).toContainText(expectText, { timeout: 60000 });
  await waitAnswerSettled(page);
  const connected = await captured.evaluate((el) => (el as Element | null)?.isConnected ?? false);
  const perf = await readPerf(page, ssePlan.markerRef.promotionTs);
  console.log(`[PERF][${caseName}] outerConnected=${connected} promotionTs=${ssePlan.markerRef.promotionTs} ` + JSON.stringify(perf));
  await sse.close();
  return { connected, perf };
}

test("PERF Case P3: 256-char inline threshold 跨越 → outer block identity 保持（inner swap 仅测量）", async ({ page }) => {
  const paragraph = cjkText(300);
  const ssePlan = promotionPlan(
    paragraph + "\n\n第二段。" + SENTINEL,
    6,
    24,
    paragraph.length,
    [{ at: 256, name: "thresholdTs" }]
  );
  const { connected, perf } = await runPromotionIdentityCase(page, "P3", ssePlan, SENTINEL, async () => {
    // 跨越阈值前捕获 outer block（文本 230~250）
    await page.waitForFunction(
      (range: number[]) => {
        const el = document.querySelector("[data-kiro-stream-block-id]");
        const len = el?.textContent?.length ?? 0;
        return len >= range[0] && len <= range[1];
      },
      [230, 250] as number[],
      { timeout: 30000 }
    );
    return page.evaluateHandle(() => document.querySelector("[data-kiro-stream-block-id]"));
  });
  // 阈值跨越窗口的 >50ms Long Task（256-char 结构切换是否产生长任务）
  const thresholdTasks = await promotionWindowLongTasks(page, ssePlan.markerRef.thresholdTs);
  console.log(`[PERF][P3] thresholdLongTasks=${JSON.stringify(thresholdTasks)}`);
  expect(connected).toBe(true);
  expect(thresholdTasks).toHaveLength(0);
});

test("PERF Case P4: 普通 tight list promotion → outer block identity 保持", async ({ page }) => {
  const listBlock = "- 列表项一\n- 列表项二";
  const ssePlan = promotionPlan(listBlock + "\n\n结束段落。" + SENTINEL, 4, 24, listBlock.length);
  const { connected, perf } = await runPromotionIdentityCase(page, "P4", ssePlan, SENTINEL, async () => {
    await page.waitForFunction(
      (minLen) => {
        const el = document.querySelector("[data-kiro-stream-block-id]");
        return el && (el.textContent?.length ?? 0) >= minLen;
      },
      10,
      { timeout: 30000 }
    );
    return page.evaluateHandle(() => document.querySelector("[data-kiro-stream-block-id]"));
  });
  expect(connected).toBe(true);
  // 最终 correctness：列表与 KiroMarkdown 一致（两项在同一 ul）
  await expect(page.getByTestId("kiro-message").last().locator('[data-testid="kiro-streaming-markdown"] ul li')).toHaveCount(2);
});

test("PERF Case P5: fence 闭合 + promotion → outer 保持，inner 只允许一次语义替换", async ({ page }) => {
  const fenceBlock = "```ts\nconst x = 1;\n```";
  const ssePlan = promotionPlan(fenceBlock + "\n\n结束段落。" + SENTINEL, 4, 24, fenceBlock.length);
  const { connected, perf } = await runPromotionIdentityCase(page, "P5", ssePlan, SENTINEL, async () => {
    // fence 未闭合（fallback code-tail）时捕获其 outer block
    await page.waitForSelector('[data-testid="kiro-streaming-code-tail"]', { timeout: 30000 });
    return page.evaluateHandle(() =>
      document.querySelector('[data-testid="kiro-streaming-code-tail"]')?.closest("[data-kiro-stream-block-id]") ?? null
    );
  });
  expect(connected).toBe(true);
  // 闭合后正式 code block 正常渲染（inner semantic transition 完成）
  await expect(page.getByTestId("kiro-message").last().locator('[data-testid="kiro-streaming-markdown"] pre code')).toContainText("const x = 1;");
  // 闭合 + promotion 不产生 block remount：2 个真实 block（fence + 尾段）× StrictMode 双挂载 = 4；
  // 若有 remount 会超过 4
  expect(perf.blockMounts).toBeLessThanOrEqual(4);
});

test("PERF Case P6: math 闭合 + promotion → outer 保持，inner 只允许一次语义替换", async ({ page }) => {
  const mathBlock = "$$\nE = mc^2\n$$";
  const ssePlan = promotionPlan(mathBlock + "\n\n结束段落。" + SENTINEL, 4, 24, mathBlock.length);
  const { connected, perf } = await runPromotionIdentityCase(page, "P6", ssePlan, SENTINEL, async () => {
    await page.waitForSelector('[data-testid="kiro-streaming-math-tail"]', { timeout: 30000 });
    return page.evaluateHandle(() =>
      document.querySelector('[data-testid="kiro-streaming-math-tail"]')?.closest("[data-kiro-stream-block-id]") ?? null
    );
  });
  expect(connected).toBe(true);
  // 闭合后 KaTeX 正式渲染
  await expect(page.getByTestId("kiro-message").last().locator('[data-testid="kiro-streaming-markdown"] .katex').first()).toBeVisible();
  // 2 个真实 block（math + 尾段）× StrictMode 双挂载 = 4；remount 会超过
  expect(perf.blockMounts).toBeLessThanOrEqual(4);
});

test("PERF Case P8: canonical loose list 不被 promotion identity 阻止", async ({ page }) => {
  const ssePlan = plainPlan(S6_LOOSE_LIST, 24, 24);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.getByTestId("kiro-composer").getByLabel("Ask Kiro").fill("生成报告");
  await page.getByTestId("kiro-composer").getByLabel("发送").click();
  const msg = page.getByTestId("kiro-message").last();
  await expect(msg).toContainText(SENTINEL, { timeout: 60000 });
  await waitAnswerSettled(page);
  await expect(msg.locator('[data-testid="kiro-streaming-markdown"] ul')).toHaveCount(1, { timeout: 15000 });
  const perf = await readPerf(page, ssePlan.markerRef.ts);
  console.log(`[PERF][P8] ` + JSON.stringify(perf));
  await sse.close();
  // 流式 block promotion 正常发生（每个列表项 block active→stable）
  expect(perf.blockPromotions).toBeGreaterThanOrEqual(1);
  // canonical fallback 仍触发（不被 promotion identity 阻止）
  expect(perf.settleCanonicalFallbacks).toBe(1);
});
