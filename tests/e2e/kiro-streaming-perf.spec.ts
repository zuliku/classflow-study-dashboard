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
      void (async () => {
        for (const stage of stages) {
          if (stage.delay) {
            await new Promise((resolve) => setTimeout(resolve, stage.delay));
          }
          if (stage.mark) stage.mark();
          if (stage.events.length > 0) {
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
  prepare?: (page: Page) => Promise<void>
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
  const captured = await page.waitForSelector(captureSelector, { timeout: 30000 });
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
