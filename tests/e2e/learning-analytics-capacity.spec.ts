import { expect, Page } from "@playwright/test";
import http from "node:http";
import { test as demoTest } from "./demoFixtures";

/**
 * Capacity-Aware Outlook E2E（Analytics V2 · Part 4）：
 * 1. 容量 UI：A=120 + B=120、共享 180min → 尚需安排 4h · 可安排 3h · 缺口 1h；一个任务容量不足
 * 2. 让 Kiro 帮我规划：get_learning_outlook → propose_study_plan（真实引擎）→ Proposal ≤180min
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

/** 覆盖 demo 状态：A=120 + B=120（明天 23:59）；今天全天 busy + 明天 08:00-18:00 busy → 明天只剩 180min */
async function seedCapacityState(page: Page) {
  await page.addInitScript(() => {
    try {
      const raw = localStorage.getItem("classflow-storage-v2");
      if (!raw) return;
      const data = JSON.parse(raw);
      const state = (data.state ?? data) as Record<string, unknown>;
      const pad2 = (n: number) => String(n).padStart(2, "0");
      const dayStr = (offset: number) => {
        const d = new Date(Date.now() + offset * 86400000);
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      };
      const iso = (offset: number) => `${dayStr(offset)}T23:59:00`;
      const mk = (id: string, title: string) => ({
        id, courseId: "c1", title, description: "", priority: "medium", status: "todo",
        progress: 0, tags: [], ddl: iso(1), estimatedMinutes: 120,
      });
      state.assignments = [mk("a1", "概率论作业"), mk("a2", "英语展示")];
      state.studyBlocks = [];
      state.schedules = [];
      state.calendarMarks = [
        { id: "cm0", date: dayStr(0), type: "exam", title: "全天考试", startTime: "00:00", endTime: "23:59" },
        { id: "cm1", date: dayStr(1), type: "exam", title: "考试", startTime: "08:00", endTime: "18:00" },
      ];
      localStorage.setItem("classflow-storage-v2", JSON.stringify(data));
    } catch {
      /* 忽略 */
    }
  });
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
  await page.waitForTimeout(1500);
}

demoTest("容量 UI：需求 4h / 可安排 3h / 缺口 1h；一个任务容量不足；最早容量缺口条", async ({ page }) => {
  await seedCapacityState(page);
  await openAnalytics(page);

  const card = page.getByTestId("study-outlook-card");
  await expect(card).toBeVisible({ timeout: 10000 });

  // 共享容量事实（不是 raw free 相加）
  await expect(card.getByTestId("outlook-capacity-line")).toContainText("尚需安排 4h");
  await expect(card.getByTestId("outlook-capacity-line")).toContainText("可安排 3h");
  await expect(card.getByTestId("outlook-capacity-line")).toContainText("缺口 1h");

  // 一个任务容量不足（预计仍缺 60min），另一个容量可覆盖
  await expect(card.getByText(/预计仍缺 60min/).first()).toBeVisible();
  await expect(card.getByText(/当前容量可覆盖/).first()).toBeVisible();

  // 最早容量缺口 strip
  const strip = card.getByTestId("outlook-shortfall-strip");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("约缺 1h");
  await expect(strip).toContainText("涉及");

  // 无 missing estimate → 无"未计入容量判断"文案
  await expect(card.getByText(/未计入容量判断/)).toHaveCount(0);
});

demoTest("让 Kiro 帮我规划：get_learning_outlook → propose_study_plan；Proposal 不能超过共享容量 180min", async ({ page }) => {
  await seedCapacityState(page);
  const sse = await startSseServer((ctx) => {
    const n = ctx.toolOutputs.length;
    if (n === 0) {
      return [{ events: toolCallSSE("call_1", "get_learning_outlook", { horizonDays: 7 }) }];
    }
    if (n === 1) {
      // 显式窗口（今天 → 明天）：与 outlook 的容量窗口一致，避免 executor 默认"本周"窗口包含过去日期
      const pad2 = (x: number) => String(x).padStart(2, "0");
      const dayStr = (offset: number) => {
        const d = new Date(Date.now() + offset * 86400000);
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      };
      return [{ events: toolCallSSE("call_2", "propose_study_plan", { assignmentIds: ["a1", "a2"], fromDate: dayStr(0), toDate: dayStr(1) }) }];
    }
    return [{ events: finalSSE("已基于共享容量生成学习计划建议。") }];
  });
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await openAnalytics(page);

  const card = page.getByTestId("study-outlook-card");
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.getByRole("button", { name: "让 Kiro 帮我规划" }).click();

  const sidecar = page.getByTestId("kiro-sidecar");
  await expect(sidecar).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("study-plan-proposal").first()).toBeVisible({ timeout: 15000 });

  // 真实引擎：propose_study_plan 输出总 proposedMinutes ≤ 180（共享容量上限）
  const proposeOutput = sse.recorded
    .flatMap((r) => r.toolOutputs)
    .find((t) => t.toolName === "propose_study_plan");
  expect(proposeOutput).toBeTruthy();
  const data = proposeOutput!.output as {
    ok: boolean;
    data?: { items?: { assignmentId?: string; proposedMinutes?: number }[] };
  };
  expect(data.ok).toBe(true);
  const totalProposed = (data.data?.items ?? []).reduce((s, i) => s + (i.proposedMinutes ?? 0), 0);
  expect(totalProposed).toBeLessThanOrEqual(180);
  expect(totalProposed).toBeGreaterThan(0);
  await sse.close();
});
