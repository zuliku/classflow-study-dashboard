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
  // V4.1：不再展示「本轮上下文已锁定」常驻文案（turn snapshot 冻结是内部机制）
  await expect(page.getByText("本轮上下文已锁定")).toHaveCount(0);
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
  await expect(page.getByText("本轮上下文已锁定")).toHaveCount(0);
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

// ==================== Streaming UX V3：分阶段 SSE 回归 ====================

/**
 * T0 首段文字（provisional，不显示）→ T1 Tool 到达（commit commentary）→
 * T2 Tool output → T3 begin_final_answer（Final Answer Boundary）→ T4 Final Answer streaming
 * （Worklog 不折叠、cursor 正确）→ T5 完成（Markdown stable、Worklog 自动折叠）。
 * 全程 500ms 级等待也不会改变 text lane（无时间启发，只有协议决定通道）。
 */
test("Agent 流程：leading text 不先以 Final Answer 显示，Tool 后成为 Worklog commentary（无跨 lane 闪现）", async ({ page }) => {
  const LEADING = "我先检查一下工作区文件";
  let requestCount = 0;

  const sse = await startSseServer((bodyJson) => {
    requestCount += 1;
    const hasFinalAnswerBoundary = ((bodyJson.messages ?? []) as {
      role: string;
      parts?: { type: string }[];
    }[]).some(
      (m) =>
        m.role === "assistant" &&
        (m.parts ?? []).some((p) => p.type === "tool-begin_final_answer")
    );
    const hasToolOutput = ((bodyJson.messages ?? []) as {
      role: string;
      parts?: { type: string; state?: string }[];
    }[]).some(
      (m) =>
        m.role === "assistant" &&
        (m.parts ?? []).some((p) => p.type.startsWith("tool-") && p.state === "output-available")
    );
    if (!hasToolOutput) {
      // 请求 1：leading text（歧义窗口内）→ tool call（client 工具由 onToolCall 执行，返回未知工具错误）
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
    if (!hasFinalAnswerBoundary) {
      // 请求 2：Final Answer Boundary 控制信号（client 直接回填 ok:true → 自动续跑）
      return [
        {
          events: [
            JSON.stringify({ type: "start", messageId: "mock-agent-1" }),
            JSON.stringify({ type: "start-step" }),
            JSON.stringify({ type: "tool-input-start", toolCallId: "call_boundary", toolName: "begin_final_answer" }),
            JSON.stringify({ type: "tool-input-delta", toolCallId: "call_boundary", inputTextDelta: "{}" }),
            JSON.stringify({ type: "tool-input-available", toolCallId: "call_boundary", toolName: "begin_final_answer", input: {} }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
          ],
        },
      ];
    }
    // 请求 3：Final Answer 分片流式（每片间隔保持 stream 打开，验证 streaming 语义）
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

  // T0：首段文字到达 → V4：立即作为 Worklog commentary 展示（不等待 Tool；绝不进入 Final Answer）
  const worklog = page.getByTestId("kiro-worklog");
  await expect(worklog).toBeVisible({ timeout: 5000 });
  const commentary = worklog.getByText(LEADING, { exact: true });
  await expect(commentary).toHaveCount(1);
  await expect(commentary).toBeVisible();
  await expect(msg.locator(".kiro-markdown")).toHaveCount(0);

  // T1：Tool 到达 → leading 仍为同一 commentary（仅一次，worklog 字体）；Tool row 出现
  const toolRow = worklog.locator('[data-testid="kiro-tool-row"]');
  await expect(toolRow.first()).toBeVisible({ timeout: 10000 });
  await expect(commentary).toHaveCount(1);
  // 永远不进入 Final Answer 通道
  await expect(msg.locator(".kiro-markdown").getByText(LEADING)).toHaveCount(0);
  const commentaryFont = await commentary.evaluate((el) => getComputedStyle(el).fontSize);
  expect(parseFloat(commentaryFont)).toBeLessThanOrEqual(12); // 11px worklog 字体，绝非回答字号
  // Worklog 保持展开（工具循环的假 done 不折叠：awaiting-tool-result / awaiting-continuation 仍 in-flight）
  await expect(worklog.locator('[data-state="open"]').first()).toBeVisible({ timeout: 10000 });
  await expect.poll(() => requestCount).toBe(3); // tool output 回填 + boundary 回填 → 两次自动续跑

  // T3：Final Answer streaming → cursor 出现；Worklog 在首 token 时不折叠
  const answer = msg.locator(".kiro-markdown").first();
  await expect(answer).toContainText("检查完成", { timeout: 10000 });
  await expect(page.getByTestId("kiro-streaming-cursor")).toBeVisible();
  await expect(commentary).toBeVisible(); // answering 阶段 Worklog 保持展开（无首 token 突变）
  // 整个工具循环 + answering 过程中 Worklog 从未收起再展开（无假 settled bounce）
  await expect(worklog.locator('[data-state="open"]').first()).toBeVisible();

  // T4：完成 → Markdown stable（h2 真实渲染）、cursor 消失、Worklog done 后自动折叠
  await expect(msg.locator("h2")).toHaveText("摘要", { timeout: 10000 });
  await expect(page.getByTestId("kiro-streaming-cursor")).toHaveCount(0);
  await expect(page.getByText("已完成 · 1 个步骤", { exact: true })).toBeVisible();
  await expect(commentary).toBeHidden();
  await expect(msg.getByText("| --- |")).toHaveCount(0);
  await expect(msg.getByText("## 摘要")).toHaveCount(0);

  await sse.close();
});

/**
 * 普通无 Tool 聊天：begin_final_answer → 文字立即以 Final Answer 流式显示（无 Worklog、
 * 无时间猜测）；完成后整段 Markdown 稳定（无 plain→markdown 突变）。
 */
test("普通聊天：begin_final_answer 后首段文字立即以 Final Answer 流式显示（无 Worklog）", async ({ page }) => {
  const sse = await startSseServer((bodyJson) => {
    const hasBoundary = ((bodyJson.messages ?? []) as {
      role: string;
      parts?: { type: string }[];
    }[]).some(
      (m) =>
        m.role === "assistant" &&
        (m.parts ?? []).some((p) => p.type === "tool-begin_final_answer")
    );
    if (!hasBoundary) {
      // 请求 1：begin_final_answer 控制信号
      return [
        {
          events: [
            JSON.stringify({ type: "start", messageId: "mock-plain-1" }),
            JSON.stringify({ type: "start-step" }),
            JSON.stringify({ type: "tool-input-start", toolCallId: "call_plain", toolName: "begin_final_answer" }),
            JSON.stringify({ type: "tool-input-delta", toolCallId: "call_plain", inputTextDelta: "{}" }),
            JSON.stringify({ type: "tool-input-available", toolCallId: "call_plain", toolName: "begin_final_answer", input: {} }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
          ],
        },
      ];
    }
    // 请求 2：Final Answer 分片流式
    return [
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
    ];
  });
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));

  await seedAI(page);
  await openKiro(page);
  const msg = page.getByTestId("kiro-message").last();

  // gate 过期后：仍在 streaming 时文字就以回答样式出现（provisional → answer commit）
  await expect(msg.locator(".kiro-markdown").first()).toContainText("这是普通回答的", { timeout: 5000 });
  // V4：普通聊天（boundary）→ worklog 只含 UI-only milestone；正文仍在 Final Answer
  await expect(page.getByTestId("kiro-worklog-milestone")).toContainText("已完成执行", { timeout: 5000 });

  // 完成后：Markdown 语义稳定（strong / code 真实渲染，无原始符号）
  await expect(msg.locator("strong")).toHaveText("强调", { timeout: 10000 });
  await expect(msg.locator("code").first()).toContainText("code");
  await expect(msg.getByText("**强调**")).toHaveCount(0);
  await expect(page.getByTestId("kiro-streaming-cursor")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);

  await sse.close();
});

// ==================== Streaming UX V4：Progressive Worklog 分阶段 E2E ====================

/**
 * V4 核心验收：操作说明 → Tool → 操作说明 → Tool → 完成 → Final Answer
 * 必须是真实事件逐步出现，不能是最后整批渲染后靠动画伪装。
 *
 * T0: text "我先检查一下工作区结构" → 等待 250ms → 必须已显示在 Worklog（Tool 尚未存在）
 * T1: Tool 1 input（search_assignments，client 真实执行）
 * T2: Tool 1 done（client 执行完成）
 * T3: text "接下来读取最相关的文件" → 等待 250ms → 操作说明 1 + Tool 1 done + 操作说明 2（Tool 2 未出现）
 * T4: Tool 2 working（search_assignments 再次）
 * T5: Tool 2 done
 * T6: begin_final_answer → milestone「已完成执行」出现、answer 仍空
 * T7: Final Answer text streaming
 *
 * 另验证 DOM identity：progress1 / tool1 在 tool2 出现后不 remount（同一节点）。
 */
test("V4：Progressive Worklog 分阶段真实到达（T0 时 progress 已在 Worklog）", async ({ page }) => {
  const P1 = "我先检查一下工作区结构";
  const P2 = "接下来读取最相关的文件";
  let requestCount = 0;

  const sse = await startSseServer((bodyJson) => {
    requestCount += 1;
    const toolOutputCount = ((bodyJson.messages ?? []) as {
      role: string;
      parts?: { type: string; state?: string }[];
    }[]).reduce(
      (sum, m) =>
        sum +
        (m.role === "assistant"
          ? (m.parts ?? []).filter((p) => p.type.startsWith("tool-") && p.state === "output-available").length
          : 0),
      0
    );
    const hasBoundaryOutput = ((bodyJson.messages ?? []) as {
      role: string;
      parts?: { type: string; state?: string }[];
    }[]).some(
      (m) =>
        m.role === "assistant" &&
        (m.parts ?? []).some((p) => p.type === "tool-begin_final_answer" && p.state === "output-available")
    );
    if (toolOutputCount === 0) {
      // 请求 1：T0 progress1（250ms 后才出现 Tool）→ T1 tool1 input
      return [
        {
          events: [
            JSON.stringify({ type: "start", messageId: "v4-1" }),
            JSON.stringify({ type: "start-step" }),
            JSON.stringify({ type: "text-start", id: "p1" }),
            JSON.stringify({ type: "text-delta", id: "p1", delta: P1 }),
            JSON.stringify({ type: "text-end", id: "p1" }),
          ],
        },
        {
          delay: 250,
          events: [
            JSON.stringify({ type: "tool-input-start", toolCallId: "call_v4_a", toolName: "search_assignments" }),
            JSON.stringify({ type: "tool-input-delta", toolCallId: "call_v4_a", inputTextDelta: '{"scope":"today"}' }),
            JSON.stringify({ type: "tool-input-available", toolCallId: "call_v4_a", toolName: "search_assignments", input: { scope: "today" } }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
          ],
        },
      ];
    }
    if (toolOutputCount === 1) {
      // 请求 2：延迟 3000ms 给 T1/T2 断言窗口 → T3 progress2（1500ms 后才出现 Tool 2）→ T4 tool2 input
      return [
        {
          delay: 3000,
          events: [
            JSON.stringify({ type: "start", messageId: "v4-1" }),
            JSON.stringify({ type: "start-step" }),
            JSON.stringify({ type: "text-start", id: "p2" }),
            JSON.stringify({ type: "text-delta", id: "p2", delta: P2 }),
            JSON.stringify({ type: "text-end", id: "p2" }),
          ],
        },
        {
          delay: 1500,
          events: [
            JSON.stringify({ type: "tool-input-start", toolCallId: "call_v4_b", toolName: "search_assignments" }),
            JSON.stringify({ type: "tool-input-delta", toolCallId: "call_v4_b", inputTextDelta: '{"scope":"week"}' }),
            JSON.stringify({ type: "tool-input-available", toolCallId: "call_v4_b", toolName: "search_assignments", input: { scope: "week" } }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
          ],
        },
      ];
    }
    if (!hasBoundaryOutput) {
      // 请求 3：延迟 3000ms 给 T4/T5 断言窗口 → T6 begin_final_answer
      return [
        {
          delay: 3000,
          events: [
            JSON.stringify({ type: "start", messageId: "v4-1" }),
            JSON.stringify({ type: "start-step" }),
            JSON.stringify({ type: "tool-input-start", toolCallId: "call_boundary", toolName: "begin_final_answer" }),
            JSON.stringify({ type: "tool-input-delta", toolCallId: "call_boundary", inputTextDelta: "{}" }),
            JSON.stringify({ type: "tool-input-available", toolCallId: "call_boundary", toolName: "begin_final_answer", input: {} }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
          ],
        },
      ];
    }
    // 请求 4：T7 Final Answer 分片流式
    return [
      {
        events: [
          JSON.stringify({ type: "start", messageId: "v4-1" }),
          JSON.stringify({ type: "start-step" }),
          JSON.stringify({ type: "text-start", id: "final-v4" }),
        ],
      },
      { delay: 80, events: [JSON.stringify({ type: "text-delta", id: "final-v4", delta: "正在整理：" })] },
      { delay: 120, events: [JSON.stringify({ type: "text-delta", id: "final-v4", delta: "已完成检查。" })] },
      {
        delay: 60,
        events: [
          JSON.stringify({ type: "text-end", id: "final-v4" }),
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
  const worklog = page.getByTestId("kiro-worklog");

  // T0：progress1 到达后 250ms 内（Tool 尚未出现）必须已显示在 Worklog
  await expect(worklog).toBeVisible({ timeout: 8000 });
  const progress1 = worklog.getByText(P1, { exact: true });
  await expect(progress1).toBeVisible({ timeout: 8000 });
  // 250ms 等待窗口内 Tool 尚未存在：worklog 里只有 commentary，无 tool row
  await expect(worklog.locator('[data-testid="kiro-tool-row"]')).toHaveCount(0);
  // Final Answer 尚未存在
  await expect(msg.locator(".kiro-markdown")).toHaveCount(0);
  // 记录 progress1 的 DOM 节点（identity 验证用：dataset marker，remount 会丢失）
  await progress1.evaluate((el) => {
    (el as HTMLElement).dataset.v4Marker = "p1";
  });

  // T1+T2：Tool 1 input → client 执行 → done；progress1 仍在（同一 commentary）
  const toolRows = worklog.locator('[data-testid="kiro-tool-row"]');
  // 自动续跑链可能让 tool2 与 tool1 几乎同时到达 → 断言「≥1 且 P1 仍在」
  await expect(toolRows.first()).toBeVisible({ timeout: 10000 });
  await expect(progress1).toHaveCount(1);
  // client read tool 执行完成 → done（无 error 图标）
  await expect(toolRows.first().locator(".lucide-check")).toBeVisible({ timeout: 10000 });
  await toolRows.first().evaluate((el) => { (el as HTMLElement).dataset.v4Marker = "t1"; });

  // T3：progress2 到达（P2 出现窗口内 tool row 尚未达到 2 个）
  const progress2 = worklog.getByText(P2, { exact: true });
  await expect(progress2).toBeVisible({ timeout: 8000 });
  // DOM identity：progress1 / tool1 未 remount（marker 保留 = 同一节点）
  expect(await progress1.evaluate((el) => (el as HTMLElement).dataset.v4Marker)).toBe("p1");
  expect(await toolRows.first().evaluate((el) => (el as HTMLElement).dataset.v4Marker)).toBe("t1");

  // T4+T5：Tool 2 出现（client 自动续跑链可能让 tool2 与 boundary 几乎连续；只断言出现过 2 个 tool）
  await expect(toolRows).toHaveCount(2, { timeout: 10000 });

  // T6：begin_final_answer → milestone 出现（Final Answer 允许与其紧接出现）
  const milestone = worklog.getByTestId("kiro-worklog-milestone");
  await expect(milestone).toContainText("已完成执行", { timeout: 10000 });

  // T7：Final Answer 流式（worklog 保持展开、milestone 与 answer 并存）
  await expect(msg.locator(".kiro-markdown").first()).toContainText("正在整理", { timeout: 10000 });
  await expect(page.getByTestId("kiro-streaming-cursor")).toBeVisible();

  // 收尾：worklog 折叠（settled 后）；summary 显示已完成 · 2 个步骤
  await expect(page.getByText("已完成 · 2 个步骤", { exact: true })).toBeVisible({ timeout: 10000 });

  await sse.close();
});




