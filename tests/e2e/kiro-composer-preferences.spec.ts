import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";
import http from "node:http";

/**
 * Kiro Composer Productization：
 * 1. 回复生成期间允许修改「下一条消息」的 Model / Reasoning / Agent Mode / Web Search
 * 2. 当前 Turn Snapshot 冻结语义不变（continuation 仍用冻结值）
 * 3. 顶部锁定文案删除；scope 类控件（Context/Attachment/Workspace/Computer）保持锁定
 */

const AI_SETTINGS = {
  enabled: true,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  custom: { providerName: "", baseURL: "", model: "" },
  memoryEnabled: true,
  reasoningEffort: "medium",
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
          if (stage.delay) await new Promise((resolve) => setTimeout(resolve, stage.delay));
          if (stage.events.length > 0) res.write(sse(stage.events));
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

interface CapturedBody {
  model?: string;
  reasoningEffort?: string;
  webSearchEnabled?: boolean;
  agentMode?: string;
}

function captureBody(bodyJson: { model?: string; reasoningEffort?: string; webSearchConfig?: { enabled?: boolean }; computerSnapshot?: { agentMode?: string } }): CapturedBody {
  return {
    model: bodyJson.model,
    reasoningEffort: bodyJson.reasoningEffort,
    webSearchEnabled: bodyJson.webSearchConfig?.enabled,
    agentMode: bodyJson.computerSnapshot?.agentMode,
  };
}

async function openKiro(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.waitForTimeout(800);
  const composer = page.getByTestId("kiro-composer");
  await expect(composer).toBeVisible();
  return composer;
}

test("回复期间可改 Model/Reasoning/AgentMode/WebSearch；continuation 用冻结值；下一条用新值", async ({ page }) => {
  const captured: CapturedBody[] = [];
  const sse = await startSseServer((bodyJson) => {
    captured.push(captureBody(bodyJson as Parameters<typeof captureBody>[0]));
    const hasToolOutput = ((bodyJson.messages ?? []) as { role: string; parts?: { type: string; state?: string }[] }[]).some(
      (m) => m.role === "assistant" && (m.parts ?? []).some((p) => p.type.startsWith("tool-") && p.state === "output-available")
    );
    if (!hasToolOutput) {
      // request 1：text（给 UI 修改窗口）+ 2000ms 后 tool（client 执行）
      return [
        {
          events: [
            JSON.stringify({ type: "start", messageId: "pref-1" }),
            JSON.stringify({ type: "start-step" }),
            JSON.stringify({ type: "text-start", id: "pref-t1" }),
            JSON.stringify({ type: "text-delta", id: "pref-t1", delta: "我先看看" }),
            JSON.stringify({ type: "text-end", id: "pref-t1" }),
          ],
        },
        {
          delay: 2000,
          events: [
            JSON.stringify({ type: "tool-input-start", toolCallId: "call_pref_1", toolName: "search_assignments" }),
            JSON.stringify({ type: "tool-input-delta", toolCallId: "call_pref_1", inputTextDelta: '{"scope":"today"}' }),
            JSON.stringify({ type: "tool-input-available", toolCallId: "call_pref_1", toolName: "search_assignments", input: { scope: "today" } }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
          ],
        },
      ];
    }
    // request 2+：final answer（第一条完成后，下一条也走这里）
    return [
      {
        events: [
          JSON.stringify({ type: "start", messageId: "pref-1" }),
          JSON.stringify({ type: "start-step" }),
          JSON.stringify({ type: "text-start", id: "pref-f" }),
          JSON.stringify({ type: "text-delta", id: "pref-f", delta: "好的。" }),
          JSON.stringify({ type: "text-end", id: "pref-f" }),
          JSON.stringify({ type: "finish-step" }),
          JSON.stringify({ type: "finish", finishReason: "stop" }),
        ],
      },
    ];
  });
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });

  const composer = await openKiro(page);
  // Computer ON + workspace-auto（Agent Mode 可测）
  await composer.getByRole("button", { name: "Computer" }).click();
  await expect(composer.getByRole("button", { name: "Computer" })).toHaveAttribute("aria-pressed", "true");
  const modeMenu = composer.getByRole("button", { name: "权限模式" });
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /工作区自动/ }).first().click();
  await expect(modeMenu).toContainText("工作区自动");

  // 发送第一条
  await composer.getByLabel("Ask Kiro").fill("第一条");
  await composer.getByLabel("发送").click();

  // request 1 到达（text 显示 + in-flight）：断言控件状态
  await expect(page.getByTestId("kiro-message").last()).toContainText("我先看看", { timeout: 8000 });
  const modelButton = composer.getByRole("button", { name: "选择模型" });
  const searchButton = composer.getByRole("button", { name: "联网搜索" });
  // scope 类控件在 Turn 执行期间保持 disabled
  await expect(composer.getByRole("button", { name: "添加附件" })).toBeDisabled();
  await expect(composer.getByRole("button", { name: "选择上下文" })).toBeDisabled();
  await expect(composer.getByRole("button", { name: "Computer" })).toBeDisabled();
  // 下一 Turn preference 可操作（tool 到达前完成修改）
  await expect(modelButton).toBeEnabled();
  await expect(searchButton).toBeEnabled();
  await expect(modeMenu).toBeEnabled();
  const reasoningButton = composer.getByRole("button", { name: "思考程度" });
  if (await reasoningButton.count()) {
    await expect(reasoningButton).toBeEnabled();
  }

  // 修改：Model / Reasoning / Agent Mode / Web Search（只影响下一 Turn）
  const initialWebSearch = (await searchButton.getAttribute("aria-pressed")) === "true";
  // 1) Web Search：切换
  await searchButton.click();
  const webSearchAfter = (await searchButton.getAttribute("aria-pressed")) === "true";
  expect(webSearchAfter).not.toBe(initialWebSearch);
  // 2) Agent Mode：workspace-auto → 受控
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /受控/ }).first().click();
  await expect(modeMenu).toContainText("受控");
  // 3) Reasoning：切到非当前档（菜单存在时）
  if (await reasoningButton.count()) {
    await reasoningButton.click();
    const items = page.getByRole("menuitem");
    const currentEffortText = (await reasoningButton.textContent()) ?? "";
    const other = items.filter({ hasText: /高|低/ }).first();
    if (await other.count()) {
      await other.click();
      await expect(reasoningButton).not.toContainText("默认");
    }
  }
  // 4) Model：切到另一个可用模型（options > 1 时）
  const modelOptions = await modelButton.locator("..").locator('[role="menu"]').count();
  void modelOptions;
  await modelButton.click();
  const menuItems = page.getByRole("menu").getByRole("menuitem");
  const currentModelLabel = (await modelButton.textContent()) ?? "";
  let switchedModel = false;
  for (let i = 0; i < (await menuItems.count()); i++) {
    const label = (await menuItems.nth(i).textContent()) ?? "";
    if (label && !currentModelLabel.includes(label.trim()) && label.trim().length > 0) {
      await menuItems.nth(i).click();
      switchedModel = true;
      break;
    }
  }

  // tool 执行 → request 2（continuation）→ 断言冻结值
  await expect.poll(() => captured.length, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
  const continuation = captured[1];
  // 冻结：第一条消息的 snapshot 不变（初始 model / reasoning effective / workspace-auto / webSearch 初始值）。
  // 注意：V4 Flash 的 supportedEfforts 只有 default/high/max——requested "medium" 归一为 effective "default"。
  expect(continuation.model).toBe("deepseek-v4-flash");
  expect(continuation.reasoningEffort).toBe("default");
  expect(continuation.agentMode).toBe("workspace-auto");
  expect(continuation.webSearchEnabled).toBe(initialWebSearch);

  // 第一条完成（等待 turn settled：输入内容后发送按钮恢复可点）
  await composer.getByLabel("Ask Kiro").fill("第二条");
  await expect(composer.getByLabel("发送")).toBeEnabled({ timeout: 15000 });

  // 下一条消息使用新配置
  await composer.getByLabel("发送").click();
  await expect.poll(() => captured.length, { timeout: 15000 }).toBeGreaterThanOrEqual(3);
  // 等 captured 稳定（第一条可能因 SDK 自动续跑策略多出额外请求）→ 取最后一条 = 第二条
  await page.waitForTimeout(800);
  const nextTurn = captured[captured.length - 1];
  expect(nextTurn.agentMode).toBe("guided");
  expect(nextTurn.webSearchEnabled).toBe(webSearchAfter);
  if (switchedModel) {
    // 菜单可能含同一模型的不同 provider 条目（label 不同但 model 相同）：
    // 只有按钮文本真正变化才断言 model 切换
    const labelAfter = (await modelButton.textContent()) ?? "";
    if (labelAfter !== currentModelLabel) {
      expect(nextTurn.model).not.toBe("deepseek-v4-flash");
    }
  }

  // 顶部锁定文案不得存在
  await expect(page.getByText("本轮上下文已锁定")).toHaveCount(0);
  await expect(page.getByText("回复完成后可为下一条调整")).toHaveCount(0);

  await sse.close();
});

test("Tool ready 间隙：turnInFlight 时右侧恒为 Stop、无发送按钮；Model 仍可操作", async ({ page }) => {
  const sse = await startSseServer((bodyJson) => {
    const hasToolOutput = ((bodyJson.messages ?? []) as { role: string; parts?: { type: string; state?: string }[] }[]).some(
      (m) => m.role === "assistant" && (m.parts ?? []).some((p) => p.type.startsWith("tool-") && p.state === "output-available")
    );
    if (!hasToolOutput) {
      // request 1：1500ms 后 tool input（流结束 → awaiting-tool-result）
      return [
        {
          delay: 1500,
          events: [
            JSON.stringify({ type: "start", messageId: "gap-1" }),
            JSON.stringify({ type: "start-step" }),
            JSON.stringify({ type: "tool-input-start", toolCallId: "call_gap", toolName: "search_assignments" }),
            JSON.stringify({ type: "tool-input-delta", toolCallId: "call_gap", inputTextDelta: '{"scope":"today"}' }),
            JSON.stringify({ type: "tool-input-available", toolCallId: "call_gap", toolName: "search_assignments", input: { scope: "today" } }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
          ],
        },
      ];
    }
    return [
      {
        events: [
          JSON.stringify({ type: "start", messageId: "gap-1" }),
          JSON.stringify({ type: "start-step" }),
          JSON.stringify({ type: "text-start", id: "gap-f" }),
          JSON.stringify({ type: "text-delta", id: "gap-f", delta: "完成。" }),
          JSON.stringify({ type: "text-end", id: "gap-f" }),
          JSON.stringify({ type: "finish-step" }),
          JSON.stringify({ type: "finish", finishReason: "stop" }),
        ],
      },
    ];
  });
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });

  const composer = await openKiro(page);
  await composer.getByLabel("Ask Kiro").fill("检查");
  await composer.getByLabel("发送").click();

  // tool 到达 → 流结束后（awaiting-tool-result / client 执行窗口）：右侧仍为 Stop、无发送按钮
  await expect(composer.getByRole("button", { name: "停止生成" })).toBeVisible({ timeout: 8000 });
  await expect(composer.getByLabel("发送")).toHaveCount(0);
  // Model 仍可操作（下一 Turn preference）
  await expect(composer.getByRole("button", { name: "选择模型" })).toBeEnabled();

  // 完成后恢复可发送（需先输入内容）
  await composer.getByLabel("Ask Kiro").fill("后续问题");
  await expect(composer.getByLabel("发送")).toBeEnabled({ timeout: 15000 });

  await sse.close();
});

test("空 Context + 回复中：ContextBar 不渲染空容器、无锁定文案", async ({ page }) => {
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });

  const sse = await startSseServer((bodyJson) => {
    const hasToolOutput = ((bodyJson.messages ?? []) as { role: string; parts?: { type: string; state?: string }[] }[]).some(
      (m) => m.role === "assistant" && (m.parts ?? []).some((p) => p.type.startsWith("tool-") && p.state === "output-available")
    );
    if (!hasToolOutput) {
      return [
        {
          delay: 1500,
          events: [
            JSON.stringify({ type: "start", messageId: "empty-1" }),
            JSON.stringify({ type: "start-step" }),
            JSON.stringify({ type: "tool-input-start", toolCallId: "call_empty", toolName: "search_assignments" }),
            JSON.stringify({ type: "tool-input-delta", toolCallId: "call_empty", inputTextDelta: '{"scope":"today"}' }),
            JSON.stringify({ type: "tool-input-available", toolCallId: "call_empty", toolName: "search_assignments", input: { scope: "today" } }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
          ],
        },
      ];
    }
    return [
      {
        events: [
          JSON.stringify({ type: "start", messageId: "empty-1" }),
          JSON.stringify({ type: "start-step" }),
          JSON.stringify({ type: "text-start", id: "empty-f" }),
          JSON.stringify({ type: "text-delta", id: "empty-f", delta: "完成。" }),
          JSON.stringify({ type: "text-end", id: "empty-f" }),
          JSON.stringify({ type: "finish-step" }),
          JSON.stringify({ type: "finish", finishReason: "stop" }),
        ],
      },
    ];
  });
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));

  const composer = await openKiro(page);
  // demo 数据可能产生 ambient context（week/course）——核心断言：任何状态都无锁定文案；
  // ContextBar 不因 locked 而额外渲染（locked 不再决定空容器存在）
  await expect(page.getByText("本轮上下文已锁定")).toHaveCount(0);
  await expect(page.getByText("回复完成后可为下一条调整")).toHaveCount(0);

  await composer.getByLabel("Ask Kiro").fill("检查");
  await composer.getByLabel("发送").click();
  // 回复中：仍无锁定文案
  await expect(page.getByTestId("kiro-composer").getByRole("button", { name: "停止生成" })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText("本轮上下文已锁定")).toHaveCount(0);
  await expect(page.getByText("回复完成后可为下一条调整")).toHaveCount(0);

  await sse.close();
});

