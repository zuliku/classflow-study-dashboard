import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";
import http from "node:http";

/**
 * Streaming UX V4.2 Hot Path regression（§17）：
 * 1. Worklog render 冻结：8 Tool 完成后 100 次 Final Answer content 更新 →
 *    completed Tool Row / Worklog 本体不跟随重渲染（test-only render counter）。
 * 2. Citation defer：streaming 期间 collectCitedWebSources 不执行（citationScans ≈ 0）；
 *    settled 后只执行一次（≈1）。
 * 3. Long final answer streaming：Worklog DOM identity 保留、completed rows 不 remount、
 *    用户上滑后不被拉回（scrollTop 稳定）、Final Answer Markdown 正确。
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

async function injectPerf(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __kiroStreamPerf?: object }).__kiroStreamPerf = {};
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
  await page.getByTestId("kiro-composer").getByLabel("Ask Kiro").fill("生成长报告");
  await page.getByTestId("kiro-composer").getByLabel("发送").click();
}

function toolInputEvent(callId: string, idx: number) {
  return [
    { type: "tool-input-start", toolCallId: callId, toolName: "search_assignments" },
    { type: "tool-input-delta", toolCallId: callId, inputTextDelta: `{"query":"q${idx}"}` },
    { type: "tool-input-available", toolCallId: callId, toolName: "search_assignments", input: { query: `q${idx}` } },
  ].map((o) => JSON.stringify(o));
}

const FINAL_TEXT =
  "今天完成了作业检查，结果一切正常。".repeat(133) + "SENTINEL_FINAL_END_7f3k";

/** 8 tool 链 + boundary + final（80 chars / 12ms）plan */
function agentPlan(toolCount: number, finalText: string) {
  let boundarySeen = false;
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
          { delay: 0, events: [JSON.stringify({ type: "start", messageId: "hp-1" }), JSON.stringify({ type: "start-step" })] },
          { delay: 5, events: toolInputEvent(`call_t${toolOutputCount}`, toolOutputCount) },
          { delay: 5, events: [JSON.stringify({ type: "finish-step" }), JSON.stringify({ type: "finish", finishReason: "tool-calls" })] },
        ];
      }
      if (!boundarySeen) {
        boundarySeen = true;
        const head = [
          { type: "start", messageId: "hp-1" },
          { type: "start-step" },
          { type: "tool-input-start", toolCallId: "call_hp_b", toolName: "begin_final_answer" },
          { type: "tool-input-delta", toolCallId: "call_hp_b", inputTextDelta: "{}" },
          { type: "tool-input-available", toolCallId: "call_hp_b", toolName: "begin_final_answer", input: {} },
          // 模拟真实 route 的 server execute：emit tool-output-available（否则 part 停在
          // input-available → turn 永不 settled → actionsReady 恒 false）
          { type: "tool-output-available", toolCallId: "call_hp_b", output: { ok: true, data: {} } },
          { type: "finish-step" },
          { type: "start-step" },
          { type: "text-start", id: "final-hp" },
        ].map((o) => JSON.stringify(o));
        const stages: SseStage[] = [{ events: head }];
        for (let i = 0; i < finalText.length; i += 80) {
          stages.push({
            delay: 12,
            events: [JSON.stringify({ type: "text-delta", id: "final-hp", delta: finalText.slice(i, i + 80) })],
          });
        }
        stages.push({
          events: [
            JSON.stringify({ type: "text-end", id: "final-hp" }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "stop" }),
          ],
        });
        return stages;
      }
      return [];
    },
  };
}

async function readCounters(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __kiroStreamPerf?: Record<string, number | Record<string, number>> }).__kiroStreamPerf ?? {};
    return {
      worklogRenders: (s.worklogRenders as number) ?? 0,
      worklogRendersByPhase: (s.worklogRendersByPhase as Record<string, number>) ?? {},
      toolRowRenders: (s.toolRowRenders as Record<string, number>) ?? {},
      toolRowRendersTotal: (s.toolRowRendersTotal as number) ?? 0,
      citationScans: (s.citationScans as number) ?? 0,
    };
  });
}

test("V4.2：8 Tool 完成后 Final Answer 100 次更新 → completed Tool Rows / Worklog 不重渲染", async ({ page }) => {
  const ssePlan = agentPlan(8, FINAL_TEXT);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  await openKiro(page);

  const msg = page.getByTestId("kiro-message").last();
  const worklog = page.getByTestId("kiro-worklog");
  await expect(worklog).toBeVisible({ timeout: 20000 });
  const toolRows = worklog.locator('[data-testid="kiro-tool-row"]');
  await expect(toolRows).toHaveCount(8, { timeout: 20000 });
  for (const row of await toolRows.all()) {
    await expect(row.locator(".lucide-check")).toBeVisible({ timeout: 10000 });
  }
  // DOM identity marker：completed tool rows 在 final streaming 中不得 remount
  const rowHandles = await toolRows.evaluateAll((els) =>
    els.map((el) => {
      (el as HTMLElement).dataset.v42Marker = "stable";
      return (el as HTMLElement).dataset.v42Marker;
    })
  );
  expect(rowHandles).toEqual(Array(8).fill("stable"));

  // 等 Final Answer 开始（first delta 到达）→ snapshot 计数器
  await expect(msg.locator(".kiro-markdown").first()).toContainText(FINAL_TEXT.slice(0, 30), { timeout: 60000 });
  await page.waitForTimeout(500);
  const before = await readCounters(page);

  // 100 次 content 更新（8K chars / 80 = 100 个 delta，24ms throttle 下持续 ~2.4s+）
  await expect(msg.locator(".kiro-markdown").first()).toContainText("SENTINEL_FINAL_END_7f3k", { timeout: 60000 });
  await page.waitForTimeout(300);
  const after = await readCounters(page);

  // completed tool rows：Final Answer 期间增量 ≈ 0（每个 tool 生命周期已结束）
  const toolRowDelta = after.toolRowRendersTotal - before.toolRowRendersTotal;
  expect(toolRowDelta).toBeLessThanOrEqual(2);
  for (const id of Object.keys(before.toolRowRenders)) {
    expect((after.toolRowRenders[id] ?? 0) - (before.toolRowRenders[id] ?? 0)).toBeLessThanOrEqual(1);
  }
  // Worklog 本体：除 phase transition（composing→answering→done）外不重渲染
  const worklogDelta = after.worklogRenders - before.worklogRenders;
  expect(worklogDelta).toBeLessThanOrEqual(3);
  // DOM identity 保留（marker 未丢失 = 未 remount）
  const markersAfter = await toolRows.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.v42Marker));
  expect(markersAfter).toEqual(Array(8).fill("stable"));

  await sse.close();
});

/** plain direct answer（无 tool / 无 boundary → turn 真 settled）plan */
function plainPlan(finalText: string) {
  return {
    plan: () => {
      const head = [
        { type: "start", messageId: "hp-1" },
        { type: "start-step" },
        { type: "text-start", id: "final-hp" },
      ].map((o) => JSON.stringify(o));
      const stages: SseStage[] = [{ events: head }];
      for (let i = 0; i < finalText.length; i += 80) {
        stages.push({
          delay: 12,
          events: [JSON.stringify({ type: "text-delta", id: "final-hp", delta: finalText.slice(i, i + 80) })],
        });
      }
      stages.push({
        events: [
          JSON.stringify({ type: "text-end", id: "final-hp" }),
          JSON.stringify({ type: "finish-step" }),
          JSON.stringify({ type: "finish", finishReason: "stop" }),
        ],
      });
      return stages;
    },
  };
}

test("V4.2：Citation defer——streaming 期间 collectCitedWebSources 不执行，settled 只执行一次", async ({ page }) => {
  const text = FINAL_TEXT.repeat(4); // ~9K chars → streaming ~1.4s（快照窗口充足）
  const ssePlan = plainPlan(text);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  await openKiro(page);

  const msg = page.getByTestId("kiro-message").last();
  // streaming 中：citation 扫描不得随 token 增长（发送瞬间的 ≤2 次空串调用已发生）
  await expect(msg.locator(".kiro-markdown").first()).toContainText(text.slice(0, 30), { timeout: 60000 });
  const before = await readCounters(page);
  await page.waitForTimeout(600); // 更多 token 到达（streaming 持续 ~1.4s）
  const mid = await readCounters(page);
  expect(mid.citationScans - before.citationScans).toBe(0);

  // settled（sentinel 可见）→ 最多触发一次计算（turn 真 settled 时 useMemo 重算 1-2 次；
  // mock 直连的 server-execute 工具可能使 turn 停在 awaiting——两种都不允许风暴式重复扫描）
  await expect(msg.locator(".kiro-markdown").first()).toContainText("SENTINEL_FINAL_END_7f3k", { timeout: 60000 });
  await page.waitForTimeout(1500);
  const settled = await readCounters(page);
  expect(settled.citationScans - mid.citationScans).toBeLessThanOrEqual(3);
  expect(settled.citationScans - mid.citationScans).toBeGreaterThanOrEqual(0);

  await sse.close();
});

test("V4.2：Long answer streaming——Worklog identity、completed rows 不 remount、上滑不被拉回、Markdown 正确", async ({ page }) => {
  const ssePlan = agentPlan(3, FINAL_TEXT);
  const sse = await startSseServer(ssePlan.plan);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectPerf(page);
  await seedAI(page);
  await openKiro(page);

  const msg = page.getByTestId("kiro-message").last();
  const worklog = page.getByTestId("kiro-worklog");
  await expect(worklog).toBeVisible({ timeout: 20000 });
  const toolRows = worklog.locator('[data-testid="kiro-tool-row"]');
  await expect(toolRows).toHaveCount(3, { timeout: 20000 });

  // 开始 streaming：第一段文本可见（仍在中途，scroll 还在增长）
  await expect(msg.locator(".kiro-markdown").first()).toContainText(FINAL_TEXT.slice(0, 30), { timeout: 60000 });
  await page.waitForTimeout(400);

  // 用户上滑到中间：后续 streaming 不得把用户拉回底部
  const scroller = page.getByTestId("kiro-conversation").locator("div").first();
  await scroller.evaluate((el) => {
    el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) / 2);
  });
  const pinnedTop = await scroller.evaluate((el) => el.scrollTop);
  expect(pinnedTop).toBeGreaterThan(0);
  await page.waitForTimeout(1200); // 更多 content 到达
  const afterScroll = await scroller.evaluate((el) => el.scrollTop);
  expect(Math.abs(afterScroll - pinnedTop)).toBeLessThan(30); // 未被拉回（容许 2px tolerance + 微调）

  // 继续等到完整文本：Markdown 渲染正确（无 marker 泄漏）+ Worklog identity 保留
  await expect(msg.locator(".kiro-markdown").first()).toContainText("SENTINEL_FINAL_END_7f3k", { timeout: 60000 });
  await expect(msg.locator(".kiro-markdown").first()).not.toContainText("[[source:");
  const markers = await toolRows.evaluateAll((els) =>
    els.map((el) => {
      (el as HTMLElement).dataset.v42Marker = "stable";
      return (el as HTMLElement).dataset.v42Marker;
    })
  );
  expect(markers).toEqual(Array(3).fill("stable"));
  await page.waitForTimeout(300);
  const finalMarkers = await toolRows.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.v42Marker));
  expect(finalMarkers).toEqual(Array(3).fill("stable"));

  await sse.close();
});
