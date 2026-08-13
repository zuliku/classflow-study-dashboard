import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";
import http from "node:http";

/** Agent 执行反馈 smoke：发送所有权 → 准备 → 回答完成。 */

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

/**
 * 真实分阶段 SSE 服务器（Streaming UX V2 E2E）：
 * Playwright route.fulfill 不支持流式 body，因此起一个本地 http server，
 * 通过 page.route(chat 端点 glob) → route.continue({ url }) 把请求转到它，
 * 按 stage（delay ms）逐事件下发，stream 保持打开，AI SDK 客户端逐事件消费。
 */
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
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("检查一下工作区");
  await composer.getByLabel("发送").click();
  return composer;
}

test("发送后立即接管 UI、锁定本轮上下文，回答到达后解锁", async ({ page }) => {
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let requestCount = 0;
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        JSON.stringify({ type: "start", messageId: "m1" }),
        JSON.stringify({ type: "start-step" }),
        JSON.stringify({ type: "text-start", id: "t1" }),
        JSON.stringify({ type: "text-delta", id: "t1", delta: "这是最近 7 天内的 DDL 情况。" }),
        JSON.stringify({ type: "text-end", id: "t1" }),
        JSON.stringify({ type: "finish-step" }),
        JSON.stringify({ type: "finish", finishReason: "stop" }),
      ]
        .map((l) => `data: ${l}`)
        .join("\n\n") + "\n\n",
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();

  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("查看最近 DDL");
  await composer.getByLabel("发送").click();

  const pending = page.getByTestId("kiro-pending");
  await expect(pending).toContainText("正在准备");
  await expect(pending).toHaveAttribute("aria-live", "polite");
  await expect(composer.getByLabel("停止生成")).toBeVisible();
  await expect(page.getByTestId("kiro-context-bar")).toContainText(
    "本轮上下文已锁定 · 回复完成后可为下一条调整"
  );
  expect(requestCount).toBe(1);
  await expect(page.getByText("正在回复", { exact: true })).toHaveCount(0); // 无重复三点 loading
  // 一个 Assistant Turn 只有一个 Kiro Logo（Progress 承担；空 assistant message 不再渲染）
  await expect(
    page.getByTestId("kiro-conversation").locator('img[src*="kiro-mark"]')
  ).toHaveCount(1);

  releaseResponse();

  // 回答到达 → pending 消退并恢复上下文操作，唯一 Logo 由回答消息承担
  await expect(page.getByTestId("kiro-message").last()).toContainText("DDL 情况", { timeout: 10000 });
  await expect(pending).toHaveCount(0);
  await expect(page.getByText("本轮上下文已锁定 · 回复完成后可为下一条调整")).toHaveCount(0);
  await expect(
    page.getByTestId("kiro-conversation").locator('img[src*="kiro-mark"]')
  ).toHaveCount(1);
});

test("快捷建议双击只提交一次，共享发送所有权立即接管", async ({ page }) => {
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let requestCount = 0;
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        JSON.stringify({ type: "start", messageId: "m-double" }),
        JSON.stringify({ type: "text-start", id: "t-double" }),
        JSON.stringify({ type: "text-delta", id: "t-double", delta: "已接收。" }),
        JSON.stringify({ type: "text-end", id: "t-double" }),
        JSON.stringify({ type: "finish", finishReason: "stop" }),
      ].map((line) => `data: ${line}`).join("\n\n") + "\n\n",
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();

  const suggestion = page.getByRole("button", { name: /帮我规划今天/ });
  await suggestion.evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(page.getByTestId("kiro-pending")).toBeVisible();
  await expect.poll(() => requestCount).toBe(1);
  await expect(page.getByTestId("kiro-user-message")).toHaveCount(1);

  releaseResponse();
  await expect(page.getByTestId("kiro-message").last()).toContainText("已接收", { timeout: 10000 });
});

// ==================== Streaming UX V2：分阶段 SSE 回归 ====================

/**
 * T0 首段文字（provisional，不显示）→ T1 Tool 到达（commit commentary）→
 * T2 Tool output → T3 Final Answer streaming（Worklog 不折叠、cursor 正确）→ T4 完成。
 */
test("Agent 流程：leading text 不先以 Final Answer 显示，Tool 后成为 Worklog commentary（无跨 lane 闪现）", async ({ page }) => {
  const LEADING = "我先检查一下工作区文件";
  let requestCount = 0;

  const sse = await startSseServer((bodyJson) => {
    requestCount += 1;
    const hasToolOutput = ((bodyJson.messages ?? []) as {
      role: string;
      parts?: { type: string; state?: string }[];
    }[]).some(
      (m) =>
        m.role === "assistant" &&
        (m.parts ?? []).some((p) => p.type.startsWith("tool-") && p.state === "output-available")
    );
    if (!hasToolOutput) {
      // 请求 1：leading text（gate 内）→ tool call（client 工具由 onToolCall 执行，返回未知工具错误）
      return [
        {
          events: [
            JSON.stringify({ type: "start", messageId: "mock-agent-1" }),
            JSON.stringify({ type: "start-step" }),
            JSON.stringify({ type: "text-start", id: "lead-text" }),
            JSON.stringify({ type: "text-delta", id: "lead-text", delta: LEADING }),
            JSON.stringify({ type: "text-end", id: "lead-text" }),
          ],
        },
        {
          delay: 60,
          events: [
            JSON.stringify({ type: "tool-input-start", toolCallId: "call_ws", toolName: "inspect_workspace" }),
            JSON.stringify({ type: "tool-input-delta", toolCallId: "call_ws", inputTextDelta: '{"path":"notes.md"}' }),
            JSON.stringify({ type: "tool-input-available", toolCallId: "call_ws", toolName: "inspect_workspace", input: { path: "notes.md" } }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
          ],
        },
      ];
    }
    // 请求 2：Final Answer 分片流式（每片间隔保持 stream 打开，验证 streaming 语义）
    return [
      {
        events: [
          JSON.stringify({ type: "start", messageId: "mock-agent-1" }),
          JSON.stringify({ type: "start-step" }),
          JSON.stringify({ type: "text-start", id: "final-text" }),
        ],
      },
      { delay: 120, events: [JSON.stringify({ type: "text-delta", id: "final-text", delta: "检查完成，notes.md 内容如下：" })] },
      { delay: 150, events: [JSON.stringify({ type: "text-delta", id: "final-text", delta: "\n\n## 摘要" })] },
      { delay: 150, events: [JSON.stringify({ type: "text-delta", id: "final-text", delta: "\n\n一切正常。" })] },
      {
        delay: 80,
        events: [
          JSON.stringify({ type: "text-end", id: "final-text" }),
          JSON.stringify({ type: "finish-step" }),
          JSON.stringify({ type: "finish", finishReason: "stop" }),
        ],
      },
    ];
  });
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));

  await seedAI(page);
  await openKiro(page);
  const msg = page.getByTestId("kiro-message").last();

  // T0：首段文字到达 → provisional 隐藏（绝不进入 Final Answer 通道；pending 保持）
  await expect(page.getByTestId("kiro-pending")).toBeVisible();
  await expect(msg.locator(".kiro-markdown")).toHaveCount(0, { timeout: 5000 });
  await expect(msg.locator(".kiro-markdown").getByText(LEADING)).toHaveCount(0);

  // T1：Tool 到达（gate 内）→ leading 成为 Worklog commentary（仅一次，worklog 字体）
  const worklog = page.getByTestId("kiro-worklog");
  await expect(worklog).toBeVisible({ timeout: 10000 });
  const commentary = worklog.getByText(LEADING, { exact: true });
  await expect(commentary).toHaveCount(1);
  await expect(commentary).toBeVisible();
  // 永远不进入 Final Answer 通道
  await expect(msg.locator(".kiro-markdown").getByText(LEADING)).toHaveCount(0);
  const commentaryFont = await commentary.evaluate((el) => getComputedStyle(el).fontSize);
  expect(parseFloat(commentaryFont)).toBeLessThanOrEqual(12); // 11px worklog 字体，绝非回答字号
  // Worklog 仍展开（tool 进行中 working/composing → 展开；工具循环的假 done 不折叠）
  await expect(worklog.locator('[data-state="open"]').first()).toBeVisible({ timeout: 10000 });
  await expect.poll(() => requestCount).toBe(2); // 客户端确实执行并回传了 tool output → 自动继续

  // T3：Final Answer streaming → cursor 出现；Worklog 在首 token 时不折叠
  const answer = msg.locator(".kiro-markdown").first();
  await expect(answer).toContainText("检查完成", { timeout: 10000 });
  await expect(page.getByTestId("kiro-streaming-cursor")).toBeVisible();
  await expect(commentary).toBeVisible(); // answering 阶段 Worklog 保持展开（无首 token 突变）

  // T4：完成 → Markdown stable（h2 真实渲染）、cursor 消失、Worklog done 后自动折叠
  await expect(msg.locator("h2")).toHaveText("摘要", { timeout: 10000 });
  await expect(page.getByTestId("kiro-streaming-cursor")).toHaveCount(0);
  await expect(page.getByText("已完成 1 个步骤", { exact: true })).toBeVisible();
  await expect(commentary).toBeHidden();
  await expect(msg.getByText("| --- |")).toHaveCount(0);
  await expect(msg.getByText("## 摘要")).toHaveCount(0);

  await sse.close();
});

/**
 * 普通无 Tool 聊天：leading 文字在歧义窗口（~100ms）后以回答样式流式出现，
 * 绝不落入 Worklog；完成后整段 Markdown 稳定（无 plain→markdown 突变）。
 */
test("普通聊天：无 Tool 时首段文字 gate 后立即以 Final Answer 流式显示（无 Worklog）", async ({ page }) => {
  const sse = await startSseServer(() => [
    {
      events: [
        JSON.stringify({ type: "start", messageId: "mock-plain-1" }),
        JSON.stringify({ type: "start-step" }),
        JSON.stringify({ type: "text-start", id: "plain-text" }),
      ],
    },
    { delay: 80, events: [JSON.stringify({ type: "text-delta", id: "plain-text", delta: "这是普通回答的" })] },
    { delay: 120, events: [JSON.stringify({ type: "text-delta", id: "plain-text", delta: "第一段，" })] },
    { delay: 150, events: [JSON.stringify({ type: "text-delta", id: "plain-text", delta: "**强调** 与 `code`。" })] },
    {
      delay: 80,
      events: [
        JSON.stringify({ type: "text-end", id: "plain-text" }),
        JSON.stringify({ type: "finish-step" }),
        JSON.stringify({ type: "finish", finishReason: "stop" }),
      ],
    },
  ]);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));

  await seedAI(page);
  await openKiro(page);
  const msg = page.getByTestId("kiro-message").last();

  // gate 过期后：仍在 streaming 时文字就以回答样式出现（provisional → answer commit）
  await expect(msg.locator(".kiro-markdown").first()).toContainText("这是普通回答的", { timeout: 5000 });
  // 绝不进入 Worklog
  await expect(page.getByTestId("kiro-worklog")).toHaveCount(0);

  // 完成后：Markdown 语义稳定（strong / code 真实渲染，无原始符号）
  await expect(msg.locator("strong")).toHaveText("强调", { timeout: 10000 });
  await expect(msg.locator("code").first()).toContainText("code");
  await expect(msg.getByText("**强调**")).toHaveCount(0);
  await expect(page.getByTestId("kiro-streaming-cursor")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);

  await sse.close();
});
