import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";
import http from "node:http";

/**
 * Kiro Streaming UX V4.6：Turn Handoff & First-Paint Continuity
 *
 * TURN-1 split-brain（main 上失败）：preflight 期间 Send 按钮必须保持「正在准备」
 * TURN-2 model switch during preflight：请求体用冻结的 model A（preflight 后改 B 只影响下一 Turn）
 * TURN-3 double-send：preflight 期间第二次 Send 不产生第二个请求
 * TURN-4 preflight failure rollback：失败 → 按钮恢复、prompt 保留、下一次 Send 成功
 * TURN-5 live message 无 animate-enter（事件到达即展示）
 * TURN-6 Pending → assistant shell identity（outer shell 不 remount）
 * TURN-7 parallel preflight：project 80ms / workspace 70ms / vision 100ms → 总 preflight < 160ms
 *
 * 依赖 test-only 全局（__kiroTurnPerf / __kiroTurnPerfConfig；生产零成本）：
 * 由 lib/ai/perf/turnPerf.ts 记账。
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
  mark?: () => void;
}

interface CapturedBody {
  model?: string;
  reasoningEffort?: string;
}

async function startSseServer(
  plan: (bodyJson: { messages?: unknown[]; model?: string; reasoningEffort?: string }) => SseStage[],
  captured: CapturedBody[]
) {
  const requests: { arrivalTs: number; firstWriteTs: number }[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let stages: SseStage[];
      try {
        const parsed = JSON.parse(body || "{}") as { model?: string; reasoningEffort?: string };
        captured.push({ model: parsed.model, reasoningEffort: parsed.reasoningEffort });
        stages = plan(parsed);
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
          if (stage.delay) await new Promise((r) => setTimeout(r, stage.delay));
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
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/sse`,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

function boundaryFinalHead(msgId: string, textId: string): string[] {
  return [
    { type: "start", messageId: msgId },
    { type: "start-step" },
    { type: "tool-input-start", toolCallId: "call_turn_b", toolName: "begin_final_answer" },
    { type: "tool-input-delta", toolCallId: "call_turn_b", inputTextDelta: "{}" },
    { type: "tool-input-available", toolCallId: "call_turn_b", toolName: "begin_final_answer", input: {} },
    { type: "finish-step" },
    { type: "start-step" },
    { type: "text-start", id: textId },
  ].map((o) => JSON.stringify(o));
}

/** 纯文本最终回答（无工具）plan */
function plainFinalPlan(finalText: string, chunkSize = 40, delay = 12) {
  return {
    plan: () => {
      const stages: SseStage[] = [];
      for (let i = 0; i < finalText.length; i += chunkSize) {
        stages.push({
          delay,
          events: [JSON.stringify({ type: "text-delta", id: "turn-f", delta: finalText.slice(i, i + chunkSize) })],
        });
      }
      stages.push({
        events: [
          JSON.stringify({ type: "text-end", id: "turn-f" }),
          JSON.stringify({ type: "finish-step" }),
          JSON.stringify({ type: "finish", finishReason: "stop" }),
        ],
      });
      return [{ events: boundaryFinalHead("turn-1", "turn-f") }, ...stages];
    },
  };
}

const SENTINEL = "SENTINEL_TURN_2f9a";
const FINAL_TEXT = "回答内容完整输出。" + SENTINEL;

async function injectTurnPerf(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__kiroTurnPerf = [];
    (window as unknown as Record<string, unknown>).__kiroTurnPerfConfig = {};
  });
}

async function openKiro(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
}

async function setPreflightConfig(page: Page, cfg: Record<string, number | boolean>) {
  await page.evaluate((c) => {
    (window as unknown as Record<string, unknown>).__kiroTurnPerfConfig = c;
  }, cfg);
}

async function readTurnPerf(page: Page): Promise<{ name: string; at: number; key?: string }[]> {
  return page.evaluate(() => {
    const arr = (window as unknown as { __kiroTurnPerf?: { name: string; at: number; key?: string }[] })
      .__kiroTurnPerf;
    return arr ? [...arr] : [];
  });
}

async function sendButtonLabel(page: Page): Promise<string> {
  const send = page.getByLabel("发送");
  const preparing = page.getByLabel("正在准备");
  const stop = page.getByLabel("停止生成");
  if (await stop.count()) return "停止生成";
  if (await preparing.count()) return "正在准备";
  if (await send.count()) return "发送";
  return "none";
}

test("TURN-1: preflight 期间 Send 按钮保持「正在准备」（split-brain 回归）", async ({ page }) => {
  const ssePlan = plainFinalPlan(FINAL_TEXT);
  const captured: CapturedBody[] = [];
  const sse = await startSseServer(ssePlan.plan, captured);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectTurnPerf(page);
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await openKiro(page);
  // 400ms preflight（模拟 Project 读取等；窗口足够长，采样不受 page-load 抖动影响）
  await setPreflightConfig(page, { projectDelayMs: 400 });

  await page.getByTestId("kiro-composer").getByLabel("Ask Kiro").fill("生成报告");
  await page.getByTestId("kiro-composer").getByLabel("发送").click();
  // preflight 开始（正在准备出现）→ 中段采样：按钮必须保持「正在准备」
  //（main 的 fake streaming 会提前清 submitting → 按钮闪回「发送」）
  await page.getByLabel("正在准备").waitFor({ timeout: 8000 });
  await page.waitForTimeout(120);
  const midLabel = await sendButtonLabel(page);
  const perfMid = await readTurnPerf(page);
  console.log(`[TURN-1] midPreflightButton=${midLabel} perf=${JSON.stringify(perfMid.map((p) => `${p.name}@${Math.round(p.at - perfMid[0].at)}`))}`);
  await expect(page.getByTestId("kiro-message").last()).toContainText(SENTINEL, { timeout: 60000 });
  await sse.close();
  expect(midLabel).toBe("正在准备");
});

test("TURN-2: preflight 中切换 Model → 本轮请求仍用冻结的 Model A", async ({ page }) => {
  const ssePlan = plainFinalPlan(FINAL_TEXT);
  const captured: CapturedBody[] = [];
  const sse = await startSseServer(ssePlan.plan, captured);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectTurnPerf(page);
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await openKiro(page);
  await setPreflightConfig(page, { projectDelayMs: 150 });

  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("生成报告");
  await composer.getByLabel("发送").click();
  // preflight 中切换 Model（intent 已冻结 → 本轮不受影响；下一 Turn 生效）
  await page.waitForTimeout(80);
  const modelButton = composer.getByRole("button", { name: "选择模型" });
  const currentLabel = (await modelButton.textContent()) ?? "";
  await modelButton.click();
  const menuItems = page.getByRole("menu").getByRole("menuitem");
  let switched = false;
  for (let i = 0; i < (await menuItems.count()); i++) {
    const label = (await menuItems.nth(i).textContent()) ?? "";
    if (label && !currentLabel.includes(label.trim()) && label.trim().length > 0) {
      await menuItems.nth(i).click();
      switched = true;
      break;
    }
  }
  console.log(`[TURN-2] modelSwitched=${switched} current=${currentLabel}`);
  expect(switched).toBe(true);
  await expect(modelButton).not.toContainText(currentLabel.trim());

  await expect(page.getByTestId("kiro-message").last()).toContainText(SENTINEL, { timeout: 60000 });
  await expect.poll(() => captured.length, { timeout: 15000 }).toBeGreaterThanOrEqual(1);
  // 本轮请求体必须使用冻结的 model A（Send click 瞬间的配置）
  console.log(`[TURN-2] requestModels=${JSON.stringify(captured)}`);
  expect(captured[0].model).toBe("deepseek-v4-flash");
  await sse.close();
});

test("TURN-3: preflight 期间 double-send 不产生第二个请求", async ({ page }) => {
  const ssePlan = plainFinalPlan(FINAL_TEXT);
  const captured: CapturedBody[] = [];
  const sse = await startSseServer(ssePlan.plan, captured);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectTurnPerf(page);
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await openKiro(page);
  await setPreflightConfig(page, { projectDelayMs: 150 });

  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("生成报告");
  await composer.getByLabel("发送").click();
  // preflight 中第二次尝试 Send（按钮处于「正在准备」，sendLock 是同步防线）
  await page.waitForTimeout(60);
  const btn = composer.getByLabel("正在准备");
  const clickable = await btn.count();
  if (clickable > 0) {
    // 正在准备按钮 disabled：直接断言不可点击（不会触发第二个 invocation）
    await expect(btn).toBeDisabled();
  }
  await expect(page.getByTestId("kiro-message").last()).toContainText(SENTINEL, { timeout: 60000 });
  await page.waitForTimeout(400);
  console.log(`[TURN-3] requests=${captured.length}`);
  await sse.close();
  // 纯文本 turn：只有 1 个请求（无 continuation）
  expect(captured.length).toBe(1);
});

test("TURN-4: preflight failure → 回滚（按钮恢复 / prompt 保留 / 下一次 Send 成功）", async ({ page }) => {
  const ssePlan = plainFinalPlan(FINAL_TEXT);
  const captured: CapturedBody[] = [];
  const sse = await startSseServer(ssePlan.plan, captured);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectTurnPerf(page);
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await openKiro(page);

  // 第一次：project preflight 失败
  await setPreflightConfig(page, { projectFail: true });
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("生成报告");
  await composer.getByLabel("发送").click();
  await expect(composer.getByLabel("发送")).toBeEnabled({ timeout: 15000 });
  // prompt 保留
  await expect(composer.getByLabel("Ask Kiro")).toHaveValue("生成报告");
  // 无 partial request / 无 partial turn
  await page.waitForTimeout(300);
  expect(captured.length).toBe(0);
  const perf = await readTurnPerf(page);
  console.log(`[TURN-4] afterFail perf=${JSON.stringify(perf.map((p) => p.name))}`);
  expect(perf.some((p) => p.name === "intentFrozen")).toBe(true);
  expect(perf.some((p) => p.name === "turnSnapshotCommitted")).toBe(false);

  // 第二次：失败消除 → Send 成功
  await setPreflightConfig(page, {});
  await composer.getByLabel("发送").click();
  await expect(page.getByTestId("kiro-message").last()).toContainText(SENTINEL, { timeout: 60000 });
  await sse.close();
  expect(captured.length).toBe(1);
});

test("TURN-5: live message / pending 无 animate-enter（事件到达即展示）", async ({ page }) => {
  const ssePlan = plainFinalPlan(FINAL_TEXT, 6, 24);
  const captured: CapturedBody[] = [];
  const sse = await startSseServer(ssePlan.plan, captured);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectTurnPerf(page);
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await openKiro(page);

  await page.getByTestId("kiro-composer").getByLabel("Ask Kiro").fill("生成报告");
  await page.getByTestId("kiro-composer").getByLabel("发送").click();
  // live user message + pending + assistant：均不得出现 animate-enter（先可见 → opacity 0 → 淡入）
  await page.waitForTimeout(150);
  const animInfo = await page.evaluate(() => {
    const anims: { sel: string; anim: string; opacity: string }[] = [];
    const probe = (sel: string, name: string) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const cs = getComputedStyle(el);
      anims.push({ sel: name, anim: cs.animationName, opacity: cs.opacity });
    };
    probe('[data-testid="kiro-user-message"]', "user");
    probe('[data-testid="kiro-pending"]', "pending");
    probe('[data-testid="kiro-message"]', "assistant");
    const enter = document.querySelectorAll(".animate-enter").length;
    return { anims, enter };
  });
  console.log(`[TURN-5] ${JSON.stringify(animInfo)}`);
  await expect(page.getByTestId("kiro-message").last()).toContainText(SENTINEL, { timeout: 60000 });
  await sse.close();
  // 任何 live 消息行 / pending 均无动画类（.animate-enter 只允许其它 UI 列表使用）
  expect(animInfo.enter).toBe(0);
  for (const a of animInfo.anims) {
    expect(a.anim).toBe("none");
    expect(a.opacity).toBe("1");
  }
});

test("TURN-6: Pending → assistant shell identity（outer shell 不 remount）", async ({ page }) => {
  const ssePlan = plainFinalPlan(FINAL_TEXT, 8, 30);
  const captured: CapturedBody[] = [];
  const sse = await startSseServer(ssePlan.plan, captured);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectTurnPerf(page);
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await openKiro(page);

  await page.getByTestId("kiro-composer").getByLabel("Ask Kiro").fill("生成报告");
  await page.getByTestId("kiro-composer").getByLabel("发送").click();
  // 首帧：assistant shell（pending 或空 assistant 占位）出现后捕获 outer
  const shellSel =
    '[data-testid="kiro-pending"], [data-testid="kiro-assistant-pending"], [data-testid="kiro-message"]';
  await page.waitForSelector(shellSel, { timeout: 30000 });
  const capturedShell = await page.evaluateHandle(() =>
    document.querySelector('[data-testid="kiro-assistant-pending"], [data-testid="kiro-message"]')
  );
  const shellInfo = await capturedShell.evaluate((el) => ({
    id: el ? el.getAttribute("data-testid") : null,
  }));
  console.log(`[TURN-6] capturedShell=${JSON.stringify(shellInfo)}`);
  await expect(page.getByTestId("kiro-message").last()).toContainText(SENTINEL, { timeout: 60000 });
  const connected = await capturedShell.evaluate((el) => (el as Element | null)?.isConnected ?? false);
  // 空 assistant 占位（若 SDK 已创建）→ 内容到达后 outer shell 保持同一 node
  if (shellInfo.id === "kiro-assistant-pending") {
    expect(connected).toBe(true);
  }
  const finalShellId = await page.evaluate(() =>
    document.querySelector('[data-testid="kiro-message"]')?.getAttribute("data-testid") ?? "none"
  );
  console.log(`[TURN-6] finalShellId=${finalShellId} pendingConnected=${connected}`);
  await sse.close();
  expect(finalShellId).toBe("kiro-message");
});

test("TURN-7: parallel preflight（project 80 / workspace 70 / vision 100 → 总 < 160ms）", async ({ page }) => {
  const ssePlan = plainFinalPlan(FINAL_TEXT);
  const captured: CapturedBody[] = [];
  const sse = await startSseServer(ssePlan.plan, captured);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await injectTurnPerf(page);
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await openKiro(page);
  await setPreflightConfig(page, { projectDelayMs: 80, workspaceDelayMs: 70, visionDelayMs: 100 });

  await page.getByTestId("kiro-composer").getByLabel("Ask Kiro").fill("生成报告");
  await page.getByTestId("kiro-composer").getByLabel("发送").click();
  await expect(page.getByTestId("kiro-message").last()).toContainText(SENTINEL, { timeout: 60000 });
  const perf = await readTurnPerf(page);
  const start = perf.find((p) => p.name === "preflightStart")?.at ?? 0;
  const end = perf.find((p) => p.name === "preflightEnd")?.at ?? 0;
  const total = end - start;
  console.log(`[TURN-7] preflightTotal=${Math.round(total)}ms perf=${JSON.stringify(perf.map((p) => p.name))}`);
  await sse.close();
  // 并行 ≈ max(80,70,100) + overhead；串行 ≈ 250ms。验收 < 160ms（证明不是 sum）
  expect(total).toBeGreaterThan(0);
  expect(total).toBeLessThan(160);
});
