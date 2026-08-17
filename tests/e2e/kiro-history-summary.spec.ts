import { expect, Page } from "@playwright/test";
import { test } from "@playwright/test";
import http from "node:http";

/**
 * Learning History Part 2 Kiro E2E（轻量 mocked scenario）：
 * 用户宽泛问题 → mock SSE 直接返回 summarize_learning_history tool-call
 * → Browser 异步执行（真实 IndexedDB fixture）→ 续跑 final answer。
 * 证明：历史数据只经只读工具输出；不需要 search_assignments / get_focus_status 猜历史。
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

async function seedHistoryFixture(page: Page) {
  // 页面加载后 LearningHistoryRuntime 已建库（classflow-learning-history v1）→ 直接 put 事件
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("classflow-learning-history", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const now = Date.now();
    const p = (n: number) => String(n).padStart(2, "0");
    const localDate = `${new Date().getFullYear()}-${p(new Date().getMonth() + 1)}-${p(new Date().getDate())}`;
    const base = {
      schemaVersion: 1,
      localDate,
      timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      semesterId: "s",
      semesterNameSnapshot: "测试学期",
      semesterWeek: 1,
      courseId: "c1",
      courseNameSnapshot: "统计学",
    };
    const tx = db.transaction("events", "readwrite");
    const store = tx.objectStore("events");
    store.put({
      ...base,
      id: "e2e-focus-1",
      type: "focus.completed",
      occurredAt: now - 3600000,
      source: "manual",
      entityType: "focus-session",
      entityId: "fs1",
      sequence: 1,
      data: { plannedMinutes: 30, actualActiveMs: 1_800_000, startedAt: now - 3600000, endedAt: now, endReason: "manual", sessionSource: "manual" },
    });
    store.put({
      ...base,
      id: "e2e-assignment-1",
      type: "assignment.completed",
      occurredAt: now - 7200000,
      source: "manual",
      entityType: "assignment",
      entityId: "a1",
      assignmentId: "a1",
      assignmentTitleSnapshot: "统计作业",
      sequence: 2,
      data: { previousStatus: "doing", completionTrigger: "status" },
    });
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  });
}

async function openKiro(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await page.reload();
  await seedHistoryFixture(page);
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  const composer = page.getByTestId("kiro-composer");
  await expect(composer).toBeVisible();
  return composer;
}

test("宽泛历史问题：summarize_learning_history 由 Browser 执行 → Final Answer 使用真实 History 汇总", async ({ page }) => {
  const sse = await startSseServer((bodyJson) => {
    const hasToolOutput = ((bodyJson.messages ?? []) as { role: string; parts?: { type: string; state?: string }[] }[]).some(
      (m) => m.role === "assistant" && (m.parts ?? []).some((p) => p.type.startsWith("tool-") && p.state === "output-available")
    );
    if (!hasToolOutput) {
      return [
        {
          events: [
            JSON.stringify({ type: "start", messageId: "lh-1" }),
            JSON.stringify({ type: "start-step" }),
            JSON.stringify({ type: "tool-input-start", toolCallId: "call_sum", toolName: "summarize_learning_history" }),
            JSON.stringify({ type: "tool-input-delta", toolCallId: "call_sum", inputTextDelta: '{}' }),
            JSON.stringify({ type: "tool-input-available", toolCallId: "call_sum", toolName: "summarize_learning_history", input: {} }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
          ],
        },
      ];
    }
    return [
      {
        events: [
          JSON.stringify({ type: "start", messageId: "lh-1" }),
          JSON.stringify({ type: "start-step" }),
          JSON.stringify({ type: "text-start", id: "lh-f" }),
          JSON.stringify({ type: "text-delta", id: "lh-f", delta: "最近完成 1 项任务，专注 30 分钟。" }),
          JSON.stringify({ type: "text-end", id: "lh-f" }),
          JSON.stringify({ type: "finish-step" }),
          JSON.stringify({ type: "finish", finishReason: "stop" }),
        ],
      },
    ];
  });
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  const composer = await openKiro(page);
  await composer.getByLabel("Ask Kiro").fill("我最近完成了多少任务，专注了多久？");
  await composer.getByLabel("发送").click();
  const msg = page.getByTestId("kiro-message").last();
  await expect(msg.locator(".kiro-markdown").first()).toContainText("最近完成 1 项任务", { timeout: 20000 });
  await sse.close();
});
