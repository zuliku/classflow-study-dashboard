import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";
import http from "node:http";

/**
 * Kiro Streaming UX V4.7 / V4.7.1：Monotonic Agent Phase & Tool-Loop Continuity
 *
 * P1：continuation gap 期间 Header 保持「正在执行」（+ spinner），绝不闪「正在整理回答」
 * P2：boundary gap 是唯一出现「正在整理回答」的窗口
 * P3：3 Tool 全程 Header 文案 timeline——「正在整理回答」只出现一次（boundary 后）
 * P4：Tool Row working → done 的 outer DOM identity 保持
 * L1（V4.7.1）：3500ms continuation delay 不提前 settled（3s 时仍 in-flight；到达后正常继续）
 * P5（V4.7.1）：3500ms continuation gap 期间 Header 文案 / Stop / Send / Assistant actions 正确
 *
 * deterministic staged SSE：tool 输出回传后，continuation 响应带人为 gap。
 * V4.7.1：无 arbitrary continuation timeout —— 慢 continuation 期间状态由事件决定。
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
}

interface RequestRec {
  arrivalTs: number;
  toolOutputCount: number;
}

/**
 * startToolLoopServer(toolCount, gapMs, continuationGapMs?, finalAnswerGapMs?)
 * - gapMs：每轮内容（commentary/tool 或 boundary）到达前的延迟 —— 即「上一动作 → 下一内容」的 continuation gap
 * - continuationGapMs：最终轮 boundary 前的延迟（覆盖 gapMs；L1/P5 用于制造长 tool→continuation gap）
 * - finalAnswerGapMs：boundary → final text 的延迟（composing 窗口；默认 = continuationGapMs ?? gapMs）
 */
function startToolLoopServer(toolCount: number, gapMs: number, continuationGapMs?: number, finalAnswerGapMs?: number) {
  const finalContDelay = continuationGapMs ?? gapMs;
  const finalAnswerDelay = finalAnswerGapMs ?? finalContDelay;
  const requests: RequestRec[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let outputCount = 0;
      let boundaryEmitted = false;
      try {
        const parsed = JSON.parse(body || "{}") as {
          messages?: { role: string; parts?: { type: string; state?: string; toolName?: string }[] }[];
        };
        const messages = parsed.messages ?? [];
        // 只统计当前 turn（最后一个 user 之后）已输出的 business tool；boundary 不算
        let lastUserIdx = -1;
        for (let i = 0; i < messages.length; i++) {
          if (messages[i].role === "user") lastUserIdx = i;
        }
        const currentParts = messages.slice(lastUserIdx + 1).flatMap((m) => m.parts ?? []);
        outputCount = currentParts.filter(
          (p) => p.type.startsWith("tool-") && p.state === "output-available" && !p.toolName?.startsWith("begin_")
        ).length;
        boundaryEmitted = currentParts.some((p) => p.type === "tool-begin_final_answer" && p.state === "output-available");
      } catch {
        /* 忽略 */
      }
      requests.push({ arrivalTs: Date.now(), toolOutputCount: outputCount });
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "access-control-allow-origin": "*",
      });
      const send = (stages: SseStage[]) => {
        void (async () => {
          for (const st of stages) {
            if (st.delay) await new Promise((r) => setTimeout(r, st.delay));
            if (st.events.length > 0) res.write(sse(st.events));
          }
          res.end();
        })();
      };
      if (outputCount < toolCount) {
        // 下一轮 progress + tool（带 continuation gap）
        const idx = outputCount + 1;
        send([
          { delay: gapMs, events: [JSON.stringify({ type: "start", messageId: "ph-1" }), JSON.stringify({ type: "start-step" }), JSON.stringify({ type: "text-start", id: `pt${idx}` }), JSON.stringify({ type: "text-delta", id: `pt${idx}`, delta: `第 ${idx} 步检查中` }), JSON.stringify({ type: "text-end", id: `pt${idx}` })] },
          { delay: 0, events: [
            JSON.stringify({ type: "tool-input-start", toolCallId: `call_ph_${idx}`, toolName: "search_assignments" }),
            JSON.stringify({ type: "tool-input-delta", toolCallId: `call_ph_${idx}`, inputTextDelta: '{"scope":"today"}' }),
            JSON.stringify({ type: "tool-input-available", toolCallId: `call_ph_${idx}`, toolName: "search_assignments", input: { scope: "today" } }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
          ] },
        ]);
        return;
      }
      // boundary 单独一回合（真实 Provider 结构：finish tool-calls → client emit → SDK 自动续跑）
      if (!boundaryEmitted) {
        send([
          { delay: finalContDelay, events: [
            JSON.stringify({ type: "start", messageId: "ph-1" }),
            JSON.stringify({ type: "start-step" }),
            JSON.stringify({ type: "tool-input-start", toolCallId: "call_ph_b", toolName: "begin_final_answer" }),
            JSON.stringify({ type: "tool-input-delta", toolCallId: "call_ph_b", inputTextDelta: "{}" }),
            JSON.stringify({ type: "tool-input-available", toolCallId: "call_ph_b", toolName: "begin_final_answer", input: {} }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
          ] },
        ]);
        return;
      }
      // final answer（boundary 已回填）
      send([
        { delay: finalAnswerDelay, events: [
          JSON.stringify({ type: "start", messageId: "ph-1" }),
          JSON.stringify({ type: "start-step" }),
          JSON.stringify({ type: "text-start", id: "ph-f" }),
          JSON.stringify({ type: "text-delta", id: "ph-f", delta: "最终回答完成。" }),
          JSON.stringify({ type: "text-end", id: "ph-f" }),
          JSON.stringify({ type: "finish-step" }),
          JSON.stringify({ type: "finish", finishReason: "stop" }),
        ] },
      ]);
    });
  });
  return new Promise<{ url: string; requests: RequestRec[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}/sse`,
        requests,
        close: async () => {
          server.closeAllConnections();
          await new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}

async function openKiro(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
}

/** Header 文案 MutationObserver（收集 label 文本变化时间线；不记录其它内容） */
async function injectHeaderObserver(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __kiroHeaderTimeline?: { label: string; at: number }[];
      __kiroHeaderObserverRan?: boolean;
      __kiroHeaderObserverFires?: number;
    };
    w.__kiroHeaderTimeline = [];
    w.__kiroHeaderObserverRan = true;
    w.__kiroHeaderObserverFires = 0;
    const record = () => {
      w.__kiroHeaderObserverFires = (w.__kiroHeaderObserverFires ?? 0) + 1;
      const label = document.querySelector('[data-testid="kiro-worklog"] [role="status"]');
      if (!label) return;
      const text = label.textContent ?? "";
      const tl = w.__kiroHeaderTimeline!;
      const last = tl[tl.length - 1];
      if (!last || last.label !== text) {
        tl.push({ label: text, at: performance.now() });
      }
    };
    new MutationObserver(record).observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    // 兜底：rAF 采样（MutationObserver 之外的 label 变化）
    const sample = () => {
      record();
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function headerLabel(page: Page): Promise<string> {
  const el = page.locator('[data-testid="kiro-worklog"] [role="status"]');
  const count = await el.count();
  if (count === 0) return "(no header)";
  return (await el.first().textContent()) ?? "";
}

async function headerHasSpinner(page: Page): Promise<boolean> {
  return (await page.locator('[data-testid="kiro-worklog"] button svg.animate-spin').count()) > 0;
}

/** 测试侧高频采样 Header 文案（直到出现「已完成」或超时）→ 文案变化 timeline */
async function collectHeaderTimeline(page: Page): Promise<string[]> {
  const labels: string[] = [];
  for (let i = 0; i < 400; i++) {
    const label = await headerLabel(page);
    if (labels[labels.length - 1] !== label) labels.push(label);
    if (label.includes("已完成")) break;
    await page.waitForTimeout(25);
  }
  return labels;
}

test("P1: continuation gap（300ms）Header 保持「正在执行」+ spinner；绝不「正在整理回答」", async ({ page }) => {
  const sse = await startToolLoopServer(2, 300);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await openKiro(page);
  await page.getByTestId("kiro-composer").getByLabel("Ask Kiro").fill("检查任务");
  await page.getByTestId("kiro-composer").getByLabel("发送").click();

  // 第一个 tool 完成（✓）→ 等待 continuation 300ms gap → 期间 Header 必须 正在执行 + spinner
  await expect(page.locator('[data-testid="kiro-tool-row"]').first()).toContainText("查找任务", { timeout: 15000 });
  // 等 tool row 变为 done（✓ 状态）
  await page.waitForFunction(
    () => {
      const rows = document.querySelectorAll('[data-testid="kiro-tool-row"]');
      if (rows.length === 0) return false;
      const last = rows[rows.length - 1];
      return last.querySelector("svg")?.getAttribute("class")?.includes("text-success") === true;
    },
    { timeout: 15000 }
  );
  // gap 中段采样（300ms 窗口内）
  await page.waitForTimeout(100);
  const gapLabel = await headerLabel(page);
  const gapSpinner = await headerHasSpinner(page);
  console.log(`[P1] gapLabel=${gapLabel} spinner=${gapSpinner}`);
  expect(gapLabel).toBe("正在执行");
  expect(gapSpinner).toBe(true);

  // 下一 progress 到达 → 仍 正在执行（active trace → 无 spinner）
  await expect(page.locator('[data-testid="kiro-worklog"] [role="status"]')).toContainText("正在执行", { timeout: 15000 });
  await expect(page.getByTestId("kiro-message").last()).toContainText("最终回答完成", { timeout: 60000 });
  await sse.close();
});

test("P2: boundary gap（200ms）是唯一出现「正在整理回答」的窗口；final token 后「已完成 · 2 个步骤」", async ({ page }) => {
  const sse = await startToolLoopServer(2, 200);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await openKiro(page);
  await page.getByTestId("kiro-composer").getByLabel("Ask Kiro").fill("检查任务");
  await page.getByTestId("kiro-composer").getByLabel("发送").click();
  const timeline = await collectHeaderTimeline(page);
  console.log(`[P2] timeline=${JSON.stringify(timeline)}`);
  await expect(page.getByTestId("kiro-message").last()).toContainText("最终回答完成", { timeout: 60000 });
  // 完整 label timeline：正在整理回答 只能出现在最后（boundary → first token 之间）
  const composingCount = timeline.filter((t) => t === "正在整理回答").length;
  expect(composingCount).toBeLessThanOrEqual(1);
  // 单调：正在执行 → 正在整理回答 → 已完成（忽略采样开始前的 "(no header)"）
  const labels = timeline.filter((t) => t !== "(no header)");
  const rank: Record<string, number> = { "正在执行": 0, "正在整理回答": 1, "已完成 · 2 个步骤": 2 };
  for (let i = 1; i < labels.length; i++) {
    expect(rank[labels[i]]).toBeGreaterThanOrEqual(rank[labels[i - 1]]);
  }
  expect(labels[labels.length - 1]).toContain("已完成 · 2 个步骤");
  await sse.close();
});

test("P3: 3 Tool Header 文案 timeline——「正在整理回答」只出现一次（boundary 后）", async ({ page }) => {
  const sse = await startToolLoopServer(3, 60);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await openKiro(page);
  await page.getByTestId("kiro-composer").getByLabel("Ask Kiro").fill("检查任务");
  await page.getByTestId("kiro-composer").getByLabel("发送").click();
  const timeline = await collectHeaderTimeline(page);
  console.log(`[P3] timeline=${JSON.stringify(timeline)}`);
  await expect(page.getByTestId("kiro-message").last()).toContainText("最终回答完成", { timeout: 60000 });
  // 3 个 tool 全程：正在整理回答 只允许出现在最后 boundary 后（≤1 次）
  const composingCount = timeline.filter((t) => t === "正在整理回答").length;
  expect(composingCount).toBeLessThanOrEqual(1);
  // 每完成一个 Tool 不得出现 正在整理回答（在最终 boundary 前只有 正在执行）
  const firstComposing = timeline.findIndex((t) => t === "正在整理回答");
  const lastWorking = timeline.lastIndexOf("正在执行");
  if (firstComposing >= 0) {
    expect(lastWorking).toBeLessThan(firstComposing);
  }
  expect(timeline[timeline.length - 1]).toContain("已完成 · 3 个步骤");
  await sse.close();
});

test("P4: Tool Row working → done 的 outer DOM identity 保持", async ({ page }) => {
  const sse = await startToolLoopServer(1, 50);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await openKiro(page);
  await page.getByTestId("kiro-composer").getByLabel("Ask Kiro").fill("检查任务");
  await page.getByTestId("kiro-composer").getByLabel("发送").click();
  // working 态捕获 row node
  await page.waitForSelector('[data-testid="kiro-tool-row"]', { timeout: 15000 });
  const rowHandle = await page.evaluateHandle(() => document.querySelector('[data-testid="kiro-tool-row"]'));
  await expect(page.getByTestId("kiro-message").last()).toContainText("最终回答完成", { timeout: 60000 });
  // working → done：outer row 保持同一 node
  const connected = await rowHandle.evaluate((el) => (el as Element | null)?.isConnected ?? false);
  const doneIcon = await page.locator('[data-testid="kiro-tool-row"] svg.text-success').count();
  console.log(`[P4] rowConnected=${connected} doneIcons=${doneIcon}`);
  await sse.close();
  expect(connected).toBe(true);
  expect(doneIcon).toBe(1);
});

/** 等待当前 turn 第一个 Tool Row 变 done（✓） */
async function waitForToolDone(page: Page) {
  await expect(page.locator('[data-testid="kiro-tool-row"]').first()).toContainText("查找任务", { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const rows = document.querySelectorAll('[data-testid="kiro-tool-row"]');
      if (rows.length === 0) return false;
      const last = rows[rows.length - 1];
      return last.querySelector("svg")?.getAttribute("class")?.includes("text-success") === true;
    },
    { timeout: 15000 }
  );
}

/**
 * V4.7.2 real-provider 回归：boundary + Final Answer 在同一响应（finish stop）——
 * 真实 DeepSeek 行为。boundary 输出不得 arm awaiting-continuation，否则 turn 永久卡在-flight。
 */
function startBoundarySameResponseServer(toolCount: number, gapMs: number) {
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let outputCount = 0;
      let boundaryEmitted = false;
      try {
        const parsed = JSON.parse(body || "{}") as {
          messages?: { role: string; parts?: { type: string; state?: string; toolName?: string }[] }[];
        };
        const messages = parsed.messages ?? [];
        let lastUserIdx = -1;
        for (let i = 0; i < messages.length; i++) {
          if (messages[i].role === "user") lastUserIdx = i;
        }
        const currentParts = messages.slice(lastUserIdx + 1).flatMap((m) => m.parts ?? []);
        outputCount = currentParts.filter(
          (p) => p.type.startsWith("tool-") && p.state === "output-available" && !p.toolName?.startsWith("begin_")
        ).length;
        boundaryEmitted = currentParts.some((p) => p.type === "tool-begin_final_answer" && p.state === "output-available");
      } catch {
        /* 忽略 */
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "access-control-allow-origin": "*",
      });
      const send = (stages: { delay?: number; events: string[] }[]) => {
        void (async () => {
          for (const st of stages) {
            if (st.delay) await new Promise((r) => setTimeout(r, st.delay));
            if (st.events.length > 0) res.write(sse(st.events));
          }
          res.end();
        })();
      };
      if (outputCount < toolCount) {
        const idx = outputCount + 1;
        send([
          { delay: gapMs, events: [JSON.stringify({ type: "start", messageId: "c2-1" }), JSON.stringify({ type: "start-step" }), JSON.stringify({ type: "text-start", id: `c2t${idx}` }), JSON.stringify({ type: "text-delta", id: `c2t${idx}`, delta: `第 ${idx} 步检查中` }), JSON.stringify({ type: "text-end", id: `c2t${idx}` })] },
          { delay: 0, events: [
            JSON.stringify({ type: "tool-input-start", toolCallId: `c2_call_${idx}`, toolName: "search_assignments" }),
            JSON.stringify({ type: "tool-input-delta", toolCallId: `c2_call_${idx}`, inputTextDelta: '{"scope":"today"}' }),
            JSON.stringify({ type: "tool-input-available", toolCallId: `c2_call_${idx}`, toolName: "search_assignments", input: { scope: "today" } }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
          ] },
        ]);
        return;
      }
      if (!boundaryEmitted) {
        // boundary + Final Answer 同一响应（finish stop）——真实 DeepSeek 行为
        send([
          { delay: gapMs, events: [
            JSON.stringify({ type: "start", messageId: "c2-1" }),
            JSON.stringify({ type: "start-step" }),
            JSON.stringify({ type: "tool-input-start", toolCallId: "c2_b", toolName: "begin_final_answer" }),
            JSON.stringify({ type: "tool-input-delta", toolCallId: "c2_b", inputTextDelta: "{}" }),
            JSON.stringify({ type: "tool-input-available", toolCallId: "c2_b", toolName: "begin_final_answer", input: {} }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "start-step" }),
            JSON.stringify({ type: "text-start", id: "c2-f" }),
            JSON.stringify({ type: "text-delta", id: "c2-f", delta: "最终回答完成。" }),
            JSON.stringify({ type: "text-end", id: "c2-f" }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "stop" }),
          ] },
        ]);
        return;
      }
      send([{ delay: 0, events: [] }]);
    });
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}/sse`,
        close: async () => {
          server.closeAllConnections();
          await new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}

test("C2: boundary + Final 同一响应（finish stop）→ turn 正确 settle，不得卡 awaiting-continuation", async ({ page }) => {
  const sse = await startBoundarySameResponseServer(1, 50);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await openKiro(page);
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("检查任务");
  await composer.getByLabel("发送").click();
  await waitForToolDone(page);
  // 关键断言：boundary+final 同响应（stop）后 turn 必须 settle（Send 回到 idle）
  await expect(page.getByTestId("kiro-message").last()).toContainText("最终回答完成", { timeout: 60000 });
  await expect(composer.getByLabel("发送")).toBeVisible({ timeout: 60000 });
  await expect(composer.getByLabel("停止生成")).toHaveCount(0);
  await composer.getByLabel("Ask Kiro").fill("确认");
  await expect(composer.getByLabel("发送")).toBeEnabled();
  await sse.close();
});

/**
 * P0 Hotfix：Final Answer Boundary 不得跨 User Turn 泄漏。
 * Turn 1 完成 boundary 协议后，Turn 2 新 User 的请求必须重新携带 Business Tools（不能 tools={} / toolChoice none）。
 */
test("P0: 多 Turn Agent——Turn 1 boundary 后，Turn 2 新 User 必须重新获得 Business Tools", async ({ page }) => {
  const sse = await startBoundarySameResponseServer(1, 50);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await openKiro(page);
  const composer = page.getByTestId("kiro-composer");
  const requestBodies: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/ai/chat") && r.method() === "POST") {
      try {
        const j = r.postDataJSON() as Record<string, unknown> | null;
        if (j) requestBodies.push(j);
      } catch {
        /* 忽略 */
      }
    }
  });
  // Turn 1：tool → boundary + final（同一 stop 响应）→ settled
  await composer.getByLabel("Ask Kiro").fill("看看最近任务");
  await composer.getByLabel("发送").click();
  await waitForToolDone(page);
  await expect(page.getByTestId("kiro-message").last()).toContainText("最终回答完成", { timeout: 60000 });
  await expect(composer.getByLabel("发送")).toBeVisible({ timeout: 60000 });
  await expect(composer.getByLabel("停止生成")).toHaveCount(0);
  const afterTurn1 = requestBodies.length;
  expect(afterTurn1).toBeGreaterThan(0);
  // Turn 2：新 User —— 服务器必须重新暴露 Business Tools（finalAnswerStarted=false → tools 非空）
  await composer.getByLabel("Ask Kiro").fill("最近的任务是哪个");
  await composer.getByLabel("发送").click();
  // Turn 2 的 Tool 真实执行（第二个 Tool Row 出现 → Business Tool 重新可用；不是「Tool 调用：xxx」正文模拟）
  await expect(page.locator('[data-testid="kiro-tool-row"]').nth(1)).toContainText("查找任务", { timeout: 60000 });
  await expect(page.getByTestId("kiro-message").last()).toContainText("最终回答完成", { timeout: 60000 });
  await expect(composer.getByLabel("发送")).toBeVisible({ timeout: 60000 });
  await expect(composer.getByLabel("停止生成")).toHaveCount(0);
  // Turn 3：再次新 User —— 每个新 User Turn 都必须重新获得 Business Tools（不只允许多一次）
  await composer.getByLabel("Ask Kiro").fill("再看看未来几天的安排");
  await composer.getByLabel("发送").click();
  await expect(page.locator('[data-testid="kiro-tool-row"]').nth(2)).toContainText("查找任务", { timeout: 60000 });
  await expect(page.getByTestId("kiro-message").last()).toContainText("最终回答完成", { timeout: 60000 });
  await expect(composer.getByLabel("发送")).toBeVisible({ timeout: 60000 });
  await sse.close();
});

/**
 * L1（V4.7.1）：Tool output 已 addToolOutput → continuation request 人为 delay 3500ms。
 * 关键：3s 处（旧 arbitrary timer 的触发点）不得 settled —— 3.5s 期间 turn 保持 in-flight；
 * continuation 到达后正常继续。证明删除 3s timer 后慢 continuation 不会误结束 Turn。
 */
test("L1: 3500ms continuation delay 不提前 settled；continuation 到达后正常继续", async ({ page }) => {
  const sse = await startToolLoopServer(1, 50, 3500, 50);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await openKiro(page);
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("检查任务");
  await composer.getByLabel("发送").click();
  await waitForToolDone(page);
  // 3.2s（旧 3s timer 触发点之后）—— turn 必须仍 in-flight
  await page.waitForTimeout(3200);
  await expect(composer.getByLabel("停止生成")).toBeVisible({ timeout: 1000 });
  await expect(composer.getByLabel("发送")).toHaveCount(0);
  expect(await headerLabel(page)).toBe("正在执行");
  // continuation 到达（≈+3.5s）→ boundary + final 正常完成 → 真正 settled
  await expect(page.getByTestId("kiro-message").last()).toContainText("最终回答完成", { timeout: 15000 });
  // 输入被清空后 Send 存在但 disabled —— 证明 turn 已 settled（Composer 回到 idle）
  await expect(composer.getByLabel("发送")).toBeVisible({ timeout: 15000 });
  await expect(composer.getByLabel("停止生成")).toHaveCount(0);
  await composer.getByLabel("Ask Kiro").fill("再检查一次");
  await expect(composer.getByLabel("发送")).toBeEnabled();
  await sse.close();
});

/**
 * P5（V4.7.1）：3500ms continuation gap 的 UI 行为——
 * 1000 / 2500 / 3200ms 三处：Header 正在执行；turn in-flight（Stop 可见）；
 * Send 不重新可用；最后 Assistant action toolbar（复制/更多）不提前出现。
 */
test("P5: 3500ms continuation gap——Header 正在执行 / Send 不可用 / Assistant actions 不提前出现", async ({ page }) => {
  const sse = await startToolLoopServer(1, 50, 3500, 50);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await openKiro(page);
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("检查任务");
  await composer.getByLabel("发送").click();
  await waitForToolDone(page);
  const lastAssistant = page.locator('[data-testid="kiro-message"]').last();
  let prev = 0;
  for (const at of [1000, 2500, 3200]) {
    await page.waitForTimeout(at - prev);
    prev = at;
    expect(await headerLabel(page)).toBe("正在执行");
    await expect(composer.getByLabel("停止生成")).toBeVisible();
    await expect(composer.getByLabel("发送")).toHaveCount(0);
    await expect(lastAssistant.locator('[aria-label="复制"]')).toHaveCount(0);
    await expect(lastAssistant.locator('[aria-label="消息更多操作"]')).toHaveCount(0);
  }
  // continuation 到达 → 正常完成（boundary gap 保持短窗口，composing 逻辑不变）
  await expect(page.getByTestId("kiro-message").last()).toContainText("最终回答完成", { timeout: 15000 });
  await expect(composer.getByLabel("发送")).toBeVisible({ timeout: 15000 });
  await expect(composer.getByLabel("停止生成")).toHaveCount(0);
  await composer.getByLabel("Ask Kiro").fill("再检查一次");
  await expect(composer.getByLabel("发送")).toBeEnabled();
  await sse.close();
});

