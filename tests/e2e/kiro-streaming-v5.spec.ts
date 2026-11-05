import { expect, Page } from "@playwright/test";
import http from "node:http";
import { test } from "./demoFixtures";

/**
 * Kiro Streaming UX V5：
 * - reasoning-only live turn 显示「正在思考」；
 * - Final Answer 开始后 Worklog 自动收起（focus）；
 * - text tail 的内联 caret 出现在真实文本末尾，settle 后消失。
 *
 * 使用真实 HTTP SSE server（route.continue），确保阶段之间有真实时间间隔；
 * route.fulfill 一次性到达无法验证 live 状态。
 */

const AI_SETTINGS = {
  enabled: true,
  provider: "deepseek",
  model: "deepseek-flash",
  custom: { providerName: "", baseURL: "", model: "" },
};

interface SseStage {
  delay?: number;
  /** 测试可控 gate：resolve 后才继续写下一批事件（用于“用户上滑”稳定窗口） */
  waitFor?: Promise<void>;
  events: string[];
}

function sse(lines: string[]): string {
  return lines.map((line) => `data: ${line}`).join("\n\n") + "\n\n";
}

async function startSseServer(stages: SseStage[]) {
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
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "access-control-allow-origin": "*",
      });
      void (async () => {
        for (const stage of stages) {
          if (stage.waitFor) {
            await stage.waitFor;
          }
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
  await page.addInitScript((settings) => {
    localStorage.setItem(
      "classflow-ai-settings-v1",
      JSON.stringify({ version: 0, state: settings })
    );
    sessionStorage.setItem("classflow-ai-key:deepseek", "sk-test-key");
  }, AI_SETTINGS);
}

async function openKiro(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("帮我分析并给出结论");
  await composer.getByLabel("发送").click();
}

const STAGES: SseStage[] = [
  {
    events: [
      JSON.stringify({ type: "start", messageId: "v5-m1" }),
      JSON.stringify({ type: "start-step" }),
      JSON.stringify({ type: "reasoning-start", id: "v5-r1" }),
    ],
  },
  {
    delay: 40,
    events: [
      JSON.stringify({
        type: "reasoning-delta",
        id: "v5-r1",
        delta: "先确认用户目标，再分析约束与可选路径。",
      }),
    ],
  },
  {
    delay: 120,
    events: [JSON.stringify({ type: "reasoning-end", id: "v5-r1" })],
  },
  {
    delay: 120,
    events: [
      JSON.stringify({ type: "text-start", id: "v5-c1" }),
      JSON.stringify({ type: "text-delta", id: "v5-c1", delta: "我先整理一下思路。" }),
      JSON.stringify({ type: "text-end", id: "v5-c1" }),
    ],
  },
  {
    delay: 120,
    events: [
      JSON.stringify({ type: "tool-input-start", toolCallId: "v5-final", toolName: "begin_final_answer" }),
      JSON.stringify({ type: "tool-input-delta", toolCallId: "v5-final", inputTextDelta: "{}" }),
      JSON.stringify({
        type: "tool-input-available",
        toolCallId: "v5-final",
        toolName: "begin_final_answer",
        input: {},
      }),
      JSON.stringify({
        type: "tool-output-available",
        toolCallId: "v5-final",
        output: { ok: true, data: {} },
      }),
      JSON.stringify({ type: "finish-step" }),
    ],
  },
  {
    delay: 120,
    events: [
      JSON.stringify({ type: "start-step" }),
      JSON.stringify({ type: "text-start", id: "v5-a1" }),
    ],
  },
  {
    delay: 250,
    events: [
      JSON.stringify({ type: "text-delta", id: "v5-a1", delta: "最终答案是" }),
    ],
  },
  {
    delay: 350,
    events: [
      JSON.stringify({ type: "text-delta", id: "v5-a1", delta: "先完成高优先级任务，再留出缓冲时间。" }),
    ],
  },
  {
    delay: 350,
    events: [
      JSON.stringify({ type: "text-end", id: "v5-a1" }),
      JSON.stringify({ type: "finish-step" }),
      JSON.stringify({ type: "finish", finishReason: "stop" }),
    ],
  },
];

test("Streaming V5：用户上滑后新内容提示（scroll intent）", async ({ page }) => {
  const chunks = Array.from(
    { length: 80 },
    (_, i) =>
      `第 ${i + 1} 段：这是一段用于验证滚动阅读稳定性的长回答内容，包含更多文字以确保内容超过视口高度。`
  );
  let releasePause!: () => void;
  const pause = new Promise<void>((resolve) => {
    releasePause = resolve;
  });
  const stages: SseStage[] = [
    {
      events: [
        JSON.stringify({ type: "start", messageId: "v5-scroll" }),
        JSON.stringify({ type: "start-step" }),
        JSON.stringify({ type: "text-start", id: "v5-scroll-a" }),
        JSON.stringify({ type: "text-delta", id: "v5-scroll-a", delta: chunks[0] }),
      ],
    },
    ...chunks.slice(1, 60).map((chunk) => ({
      delay: 90,
      events: [JSON.stringify({ type: "text-delta", id: "v5-scroll-a", delta: chunk })],
    })),
    // 测试可控暂停：用户上滑 + 断言完成后再放行剩余 chunk，避免时间竞争
    { waitFor: pause, events: [] },
    ...chunks.slice(60).map((chunk) => ({
      delay: 90,
      events: [JSON.stringify({ type: "text-delta", id: "v5-scroll-a", delta: chunk })],
    })),
    {
      delay: 120,
      events: [
        JSON.stringify({ type: "text-end", id: "v5-scroll-a" }),
        JSON.stringify({ type: "finish-step" }),
        JSON.stringify({ type: "finish", finishReason: "stop" }),
      ],
    },
  ];
  const server = await startSseServer(stages);
  try {
    await page.route("**/api/ai/chat", (route) => route.continue({ url: server.url }));
    await seedAI(page);
    await openKiro(page);

    const message = page.getByTestId("kiro-message").last();
    await expect(message).toContainText("第 60 段", { timeout: 20000 });
    // 确保内容确实超过视口（回到底部按钮阈值 160px）
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const scroller = document.querySelector(
              '[data-testid="kiro-conversation"] > div'
            ) as HTMLElement | null;
            return scroller ? scroller.scrollHeight - scroller.clientHeight : 0;
          }),
        { timeout: 5000 }
      )
      .toBeGreaterThan(240);
    // SSE 暂停窗口内真实滚轮上滑：停止跟随（避免与内容增长/延迟 promotion 同帧竞争）
    await page.waitForTimeout(700);
    const scroller = page.locator('[data-testid="kiro-conversation"] > div').first();
    await scroller.hover({ position: { x: 400, y: 280 } });
    await page.mouse.wheel(0, -2000);
    await expect(page.getByRole("button", { name: "回到底部" })).toBeVisible({ timeout: 5000 });

    // 放行剩余 chunk：新内容到达但用户仍在上方 → 出现“有新内容”提示
    releasePause();
    const jump = page.getByRole("button", { name: "有新内容，回到底部" });
    await expect(jump).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("kiro-scroll-new-indicator")).toBeVisible();

    await jump.click();
    await expect(page.getByTestId("kiro-scroll-new-indicator")).toHaveCount(0, { timeout: 5000 });
    await expect(message).toContainText("第 80 段", { timeout: 10000 });
  } finally {
    releasePause();
    await server.close();
  }
});

test("Streaming V5：思考状态、回答聚焦自动收起、内联 caret", async ({ page }) => {
  const server = await startSseServer(STAGES);
  try {
    await page.route("**/api/ai/chat", (route) => route.continue({ url: server.url }));
    await seedAI(page);
    await openKiro(page);

    // 1) reasoning-only：Header 显示「正在思考」（不是通用「正在准备 / 正在执行」）
    const header = page.getByTestId("kiro-agent-run-header");
    await expect(header).toBeVisible({ timeout: 10000 });
    await expect(header).toContainText("正在思考");

    // 2) 进入回答 lane：Header 自动收起，Worklog commentary 退出
    const headerToggle = page.getByTestId("kiro-agent-run-header").getByRole("button").first();
    await expect(headerToggle).toHaveAttribute("aria-expanded", "false", { timeout: 10000 });
    await expect(page.getByTestId("kiro-worklog")).not.toContainText("我先整理一下思路。", {
      timeout: 3000,
    });

    // 3) final answer streaming：caret 在真实文本末尾的 block 上
    const answer = page.getByTestId("kiro-message").last().getByTestId("kiro-streaming-markdown");
    await expect(answer).toContainText("最终答案是", { timeout: 10000 });
    await expect(page.getByTestId("kiro-agent-run-header")).toContainText("正在回答");
    await expect(page.locator("[data-kiro-stream-cursor]")).toHaveCount(1);
    await expect(page.getByTestId("kiro-streaming-markdown").locator(".kiro-markdown").last()).toContainText(
      "先完成高优先级任务"
    );

    // 4) settle：caret 消失，完整回答保留
    await expect(page.locator("[data-kiro-stream-cursor]")).toHaveCount(0);
    await expect(answer).toContainText("先完成高优先级任务，再留出缓冲时间。");
  } finally {
    await server.close();
  }
});
