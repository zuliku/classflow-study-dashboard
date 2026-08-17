import { expect, Page } from "@playwright/test";
import http from "node:http";
import { test as demoTest } from "./demoFixtures";

/**
 * 学习前瞻（Analytics V2 · Part 3）E2E：
 * 1. Outlook UI：demo 数据（全部缺估时）→ 5 个截止任务 · 5 个缺估时 · 缺估时行文案 + 估算任务
 * 2. Outlook → 让 Kiro 帮我规划：真实调用 canonical get_learning_outlook（Browser 执行）
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

function toolCallSSE(toolCallId: string, toolName: string, input: Record<string, unknown>): string[] {
  return [
    JSON.stringify({ type: "start", messageId: `m-${toolCallId}` }),
    JSON.stringify({ type: "start-step" }),
    JSON.stringify({ type: "tool-input-start", toolCallId, toolName }),
    JSON.stringify({ type: "tool-input-delta", toolCallId, inputTextDelta: JSON.stringify(input) }),
    JSON.stringify({ type: "tool-input-available", toolCallId, toolName, input }),
    JSON.stringify({ type: "finish-step" }),
    JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
  ];
}

function finalSSE(delta: string): string[] {
  return [
    JSON.stringify({ type: "start", messageId: "m-final" }),
    JSON.stringify({ type: "start-step" }),
    JSON.stringify({ type: "text-start", id: "final-1" }),
    JSON.stringify({ type: "text-delta", id: "final-1", delta }),
    JSON.stringify({ type: "text-end", id: "final-1" }),
    JSON.stringify({ type: "finish-step" }),
    JSON.stringify({ type: "finish", finishReason: "stop" }),
  ];
}

interface RecordedRequest {
  toolOutputs: { toolName: string; output: unknown }[];
}

async function startSseServer(plan: (ctx: { toolOutputs: { toolName: string; output: unknown }[] }) => { events: string[] }[]) {
  const recorded: RecordedRequest[] = [];
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
      let bodyJson: { messages?: unknown[] } = {};
      try {
        bodyJson = JSON.parse(body || "{}");
      } catch {
        bodyJson = {};
      }
      const tools: { toolName: string; output: unknown }[] = [];
      for (const m of (bodyJson.messages ?? []) as { role?: string; parts?: { type?: string; name?: string; state?: string; output?: unknown }[] }[]) {
        if (m.role === "assistant") {
          for (const p of m.parts ?? []) {
            if (typeof p.type === "string" && p.type.startsWith("tool-") && p.state === "output-available") {
              const toolName = typeof p.name === "string" ? p.name : p.type.replace(/^tool-/, "");
              tools.push({ toolName, output: p.output });
            }
          }
        }
      }
      recorded.push({ toolOutputs: tools });
      let stages: { events: string[] }[];
      try {
        stages = plan({ toolOutputs: tools });
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
    recorded,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function openAnalytics(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await page.reload();
  await page.getByRole("button", { name: "学习洞察" }).first().click();
  await expect(page.getByRole("heading", { name: "学习洞察" })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1200);
}

demoTest("学习前瞻 UI：demo 全部缺估时 → 5 个截止任务 · 5 个缺估时 · 缺估时行文案", async ({ page }) => {
  await openAnalytics(page);

  const card = page.getByTestId("study-outlook-card");
  await expect(card).toBeVisible({ timeout: 10000 });

  // summary：5 个截止任务（a1..a5 均在 7 天内）；缺估时语义由行级文案承担
  await expect(card.getByText(/5 个截止任务/)).toBeVisible();

  // 缺估时行：文案 + 估算任务弱操作（不做大红色警报）
  await expect(card.getByText("缺少预计耗时，暂无法判断安排是否充足。").first()).toBeVisible();
  await expect(card.getByRole("button", { name: /估算任务/ }).first()).toBeVisible();

  // 排在第一的应是 DDL 最近的任务（a1 明天）
  const rows = card.locator("div.divide-y > div");
  await expect(rows.first()).toContainText("计量经济学大作业（第3章）");

  // 切 14 天 → 仍可用
  await card.getByRole("button", { name: "未来 14 天" }).click();
  await expect(card.getByText(/5 个截止任务/)).toBeVisible();

  // 切 7 天回来
  await card.getByRole("button", { name: "未来 7 天" }).click();
  await expect(card.getByText(/5 个截止任务/)).toBeVisible();
});

demoTest("学习前瞻 → 让 Kiro 帮我规划：canonical get_learning_outlook 由 Browser 真实执行", async ({ page }) => {
  const sse = await startSseServer((ctx) => {
    if (ctx.toolOutputs.length === 0) {
      return [{ events: toolCallSSE("call_outlook", "get_learning_outlook", { horizonDays: 7 }) }];
    }
    return [{ events: finalSSE("已结合学习前瞻完成规划分析。") }];
  });
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await openAnalytics(page);

  const card = page.getByTestId("study-outlook-card");
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.getByRole("button", { name: "让 Kiro 帮我规划" }).click();

  const sidecar = page.getByTestId("kiro-sidecar");
  await expect(sidecar).toBeVisible({ timeout: 10000 });
  await expect(sidecar.getByText("已结合学习前瞻完成规划分析。").first()).toBeVisible({ timeout: 15000 });

  // Browser Tool Output 来自真实 Outlook Engine：demo 数据 → totalDue=5 / missingEstimate=5
  const outlookOutput = sse.recorded
    .flatMap((r) => r.toolOutputs)
    .find((t) => t.toolName === "get_learning_outlook");
  expect(outlookOutput).toBeTruthy();
  const data = outlookOutput!.output as {
    ok: boolean;
    data?: { summary?: { counts?: { totalDue?: number; missingEstimate?: number } }; tasks?: unknown[] };
  };
  expect(data.ok).toBe(true);
  expect(data.data?.summary?.counts?.totalDue).toBe(5);
  expect(data.data?.summary?.counts?.missingEstimate).toBe(5);
  expect(Array.isArray(data.data?.tasks)).toBe(true);
  await sse.close();
});
