import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";
import http from "node:http";

/**
 * Kiro Streaming UX V4.7：Monotonic Agent Phase & Tool-Loop Continuity
 *
 * P1：continuation gap 期间 Header 保持「正在执行」（+ spinner），绝不闪「正在整理回答」
 * P2：boundary gap 是唯一出现「正在整理回答」的窗口
 * P3：3 Tool 全程 Header 文案 timeline——「正在整理回答」只出现一次（boundary 后）
 * P4：Tool Row working → done 的 outer DOM identity 保持
 *
 * deterministic staged SSE：tool 输出回传后，continuation 响应带人为 gap。
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

function startToolLoopServer(toolCount: number, gapMs: number) {
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
      try {
        const parsed = JSON.parse(body || "{}") as { messages?: { role: string; parts?: { type: string; state?: string }[] }[] };
        outputCount = (parsed.messages ?? []).reduce(
          (sum, m) =>
            sum +
            (m.role === "assistant"
              ? (m.parts ?? []).filter((p) => p.type.startsWith("tool-") && p.state === "output-available").length
              : 0),
          0
        );
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
      // 最后一轮：boundary + [gapMs] + final text
      send([
        { delay: gapMs, events: [
          JSON.stringify({ type: "start", messageId: "ph-1" }),
          JSON.stringify({ type: "start-step" }),
          JSON.stringify({ type: "tool-input-start", toolCallId: "call_ph_b", toolName: "begin_final_answer" }),
          JSON.stringify({ type: "tool-input-delta", toolCallId: "call_ph_b", inputTextDelta: "{}" }),
          JSON.stringify({ type: "tool-input-available", toolCallId: "call_ph_b", toolName: "begin_final_answer", input: {} }),
          JSON.stringify({ type: "finish-step" }),
          JSON.stringify({ type: "start-step" }),
        ] },
        { delay: gapMs, events: [
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
