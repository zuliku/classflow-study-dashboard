import { expect, Page } from "@playwright/test";
import http from "node:http";
import { test as demoTest } from "./demoFixtures";

/**
 * Analytics → Kiro Action Loop E2E（Analytics V2 · Part 2）：
 * 1. Signal → 问 Kiro：Sidecar 打开，prompt 只带 intent（无 Snapshot JSON / 无 raw events）
 * 2. 本周回顾 → 让 Kiro 深入复盘：真实调用 canonical get_learning_analytics（Browser 执行）
 * 3. 本周回顾 → 规划下周：进入已有 Planning Pipeline（propose_study_plan → Proposal Card）
 *    Apply 前 studyBlocks 无副作用；用户确认后才写入
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

interface RecordedRequest {
  bodyJson: { messages?: unknown[] };
  toolOutputs: { toolName: string; output: unknown }[];
}

interface SsePlanCtx {
  requestIndex: number;
  recorded: RecordedRequest[];
  /** 本次请求中 assistant tool-output-available parts 的工具名（name 缺失时取 type 前缀） */
  toolOutputs: { toolName: string; output: unknown }[];
}

async function startSseServer(plan: (bodyJson: { messages?: unknown[] }, ctx: SsePlanCtx) => SseStage[]) {
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
              // 工具名在部分里是 type 前缀（tool_xxx）；name 字段可能不存在
              const toolName = typeof p.name === "string" ? p.name : p.type.replace(/^tool-/, "");
              tools.push({ toolName, output: p.output });
            }
          }
        }
      }
      const reqRecord: RecordedRequest = { bodyJson, toolOutputs: tools };
      recorded.push(reqRecord);
      let stages: SseStage[];
      try {
        stages = plan(bodyJson, { requestIndex: recorded.length - 1, recorded, toolOutputs: tools });
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
    recorded,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Browser 侧 seed Learning History（raw IndexedDB；coverage 从上上周一开始 → 本周全覆盖 + 上周可对比） */
async function seedLearningHistory(page: Page) {
  await page.addInitScript(() => {
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const localDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const now = new Date();
    const dow = now.getDay() === 0 ? 7 : now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dow - 1));
    monday.setHours(0, 0, 0, 0);
    const DAY = 86400000;
    const atLastWeek = (offsetFromLastMonday: number, hour: number) => {
      const d = new Date(monday.getTime() - offsetFromLastMonday * DAY);
      d.setHours(hour, 0, 0, 0);
      return d.getTime();
    };

    const openDb = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("classflow-learning-history", 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("events")) {
            const store = db.createObjectStore("events", { keyPath: "id" });
            store.createIndex("occurredAt", "occurredAt");
            store.createIndex("localDate", "localDate");
            store.createIndex("type", "type");
            store.createIndex("entityType", "entityType");
            store.createIndex("entityId", "entityId");
            store.createIndex("semesterId", "semesterId");
            store.createIndex("semesterWeek", "semesterWeek");
            store.createIndex("courseId", "courseId");
            store.createIndex("assignmentId", "assignmentId");
            store.createIndex("source", "source");
          }
          if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

    const ev = (patch: Record<string, unknown>) => ({
      schemaVersion: 1,
      timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      semesterId: "sem_e2e",
      semesterNameSnapshot: "E2E学期",
      semesterWeek: 1,
      source: "manual",
      ...patch,
    });

    const focusAt = (id: string, ts: number, minutes: number, courseId: string, courseName: string) =>
      ev({
        id,
        type: "focus.completed",
        entityType: "focus-session",
        entityId: id,
        occurredAt: ts,
        localDate: localDate(new Date(ts)),
        sequence: 1,
        courseId,
        courseNameSnapshot: courseName,
        data: { actualActiveMs: minutes * 60000, startedAt: ts, plannedMinutes: minutes },
      });

    const events = [
      focusAt("prev-f1", atLastWeek(5, 10), 60, "c1", "数据结构与算法"),
      // prev week assignment completed
      ev({
        id: "prev-a1-created",
        type: "assignment.created",
        entityType: "assignment",
        entityId: "prev-a1",
        assignmentId: "prev-a1",
        occurredAt: atLastWeek(6, 9),
        localDate: localDate(new Date(atLastWeek(6, 9))),
        sequence: 2,
        courseId: "c2",
        courseNameSnapshot: "概率论",
        data: { ddl: `${localDate(new Date(atLastWeek(4, 0)))}T23:59:00` },
      }),
      ev({
        id: "prev-a1-completed",
        type: "assignment.completed",
        entityType: "assignment",
        entityId: "prev-a1",
        assignmentId: "prev-a1",
        occurredAt: atLastWeek(4, 15),
        localDate: localDate(new Date(atLastWeek(4, 15))),
        sequence: 3,
        courseId: "c2",
        data: {},
      }),
      focusAt("wk-f1", Date.now() - 30 * 60000, 75, "c1", "数据结构与算法"),
      // this week assignment completed (ddl +5d → onTime)
      ev({
        id: "wk-a1-created",
        type: "assignment.created",
        entityType: "assignment",
        entityId: "wk-a1",
        assignmentId: "wk-a1",
        occurredAt: Date.now() - 2 * 3600000,
        localDate: localDate(now),
        sequence: 4,
        courseId: "c1",
        courseNameSnapshot: "数据结构与算法",
        data: { ddl: `${localDate(new Date(Date.now() + 5 * DAY))}T23:59:00` },
      }),
      ev({
        id: "wk-a1-completed",
        type: "assignment.completed",
        entityType: "assignment",
        entityId: "wk-a1",
        assignmentId: "wk-a1",
        occurredAt: Date.now() - 3600000,
        localDate: localDate(now),
        sequence: 5,
        courseId: "c1",
        data: {},
      }),
    ];

    openDb().then(async (db) => {
      const tx = db.transaction(["events", "meta"], "readwrite");
      const store = tx.objectStore("events");
      for (const e of events) store.put(e);
      tx.objectStore("meta").put({
        key: "coverage",
        value: {
          schemaVersion: 1,
          historyStartedAt: monday.getTime() - 14 * DAY,
          initializedAt: monday.getTime() - 14 * DAY,
          focusBackfillCompleted: true,
          backfilledFocusSessions: 0,
        },
      });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
    });
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
  await page.waitForTimeout(800);
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

demoTest("Signal → 问 Kiro：Sidecar 打开；prompt 只带 intent（无 Snapshot JSON / 无 raw events）", async ({ page }) => {
  const sse = await startSseServer(() => [{ events: finalSSE("已结合你的学习洞察完成分析。") }]);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await seedLearningHistory(page);
  await openAnalytics(page);

  // 本周：focus 75 vs prev 60 → focus-up 信号 → 问 Kiro
  await expect(page.getByText("专注投入增加", { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole("button", { name: "问 Kiro" }).first().click();

  // Sidecar 打开 + 自动发送
  const sidecar = page.getByTestId("kiro-sidecar");
  await expect(sidecar).toBeVisible({ timeout: 10000 });
  const userMsg = sidecar.getByTestId("kiro-user-message");
  await expect(userMsg).toContainText("专注投入变化", { timeout: 10000 });

  // intent 只有 prompt：不含 Snapshot JSON 数字、不含原始事件
  await expect(userMsg).not.toContainText("1h 15m");
  await expect(userMsg).not.toContainText("focus.completed");
  await expect(userMsg).not.toContainText("actualFocusMinutes");

  // 回答到达
  await expect(sidecar.getByText("已结合你的学习洞察完成分析。").first()).toBeVisible({ timeout: 15000 });
  await sse.close();
});

demoTest("本周回顾 → 让 Kiro 深入复盘：canonical get_learning_analytics 由 Browser 真实执行", async ({ page }) => {
  const sse = await startSseServer((bodyJson, ctx) => {
    if (ctx.toolOutputs.length === 0) {
      return [{ events: toolCallSSE("call_analytics", "get_learning_analytics", { preset: "week" }) }];
    }
    return [{ events: finalSSE("复盘完成：本周专注投入较上周同期增加。") }];
  });
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await seedLearningHistory(page);
  await openAnalytics(page);

  await page.getByRole("button", { name: "周回顾" }).click();
  await expect(page.getByTestId("weekly-review-card")).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "让 Kiro 深入复盘" }).click();

  const sidecar = page.getByTestId("kiro-sidecar");
  await expect(sidecar).toBeVisible({ timeout: 10000 });
  await expect(sidecar.getByText("复盘完成：本周专注投入较上周同期增加。").first()).toBeVisible({ timeout: 15000 });

  // Browser Tool Output 来自真实 Analytics Engine：请求回传的 get_learning_analytics output 与 UI 同源
  const analyticsOutput = sse.recorded
    .flatMap((r) => r.toolOutputs)
    .find((t) => t.toolName === "get_learning_analytics");
  expect(analyticsOutput).toBeTruthy();
  const data = analyticsOutput!.output as { ok: boolean; data?: { overview?: { actualFocusMinutes?: number; focusDeltaPercent?: number | null } } };
  expect(data.ok).toBe(true);
  // 与 seeded fixture 一致：75min、对比 +25%（真实 engine 计算，非 mock 编造）
  expect(data.data?.overview?.actualFocusMinutes).toBe(75);
  expect(data.data?.overview?.focusDeltaPercent).toBe(25);
  await sse.close();
});

demoTest("本周回顾 → 规划下周：进入已有 Planning Pipeline；Apply 前 StudyBlock 无副作用", async ({ page }) => {
  // demo 任务均无 estimatedMinutes → 计划器 need=0 不会生成 block；给 a1/a2 补估时
  await page.addInitScript(() => {
    try {
      const raw = localStorage.getItem("classflow-storage-v2");
      if (raw) {
        const data = JSON.parse(raw);
        const state = (data.state ?? data) as { assignments?: { id: string; estimatedMinutes: number | null }[] };
        if (Array.isArray(state.assignments)) {
          state.assignments = state.assignments.map((a) =>
            a.id === "a1" || a.id === "a2" ? { ...a, estimatedMinutes: a.estimatedMinutes ?? 120 } : a
          );
          localStorage.setItem("classflow-storage-v2", JSON.stringify(data));
        }
      }
    } catch {
      /* 忽略 */
    }
  });
  const sse = await startSseServer((bodyJson, ctx) => {
    const index = ctx.requestIndex;
    if (ctx.toolOutputs.length === 0) {
      // request 0：get_learning_analytics
      return [{ events: toolCallSSE("call_1", "get_learning_analytics", { preset: "week" }) }];
    }
    if (ctx.toolOutputs.length === 1) {
      // request 1：get_upcoming_assignments
      return [{ events: toolCallSSE("call_2", "get_upcoming_assignments", { days: 7 }) }];
    }
    if (ctx.toolOutputs.length === 2) {
      // request 2：get_assignment_health
      return [{ events: toolCallSSE("call_3", "get_assignment_health", { assignmentId: "a1" }) }];
    }
    if (ctx.toolOutputs.length === 3) {
      // request 3：propose_study_plan（真实 demo 数据 → 真实 Proposal）
      return [{ events: toolCallSSE("call_4", "propose_study_plan", { assignmentIds: ["a1", "a2"] }) }];
    }
    return [{ events: finalSSE("已为你生成下周学习计划建议。") }];
  });
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await seedLearningHistory(page);
  await openAnalytics(page);

  const studyBlocksBefore = await page.evaluate(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("classflow-storage-v2") ?? "{}") as {
        state?: { studyBlocks?: unknown[] };
      };
      return (stored.state?.studyBlocks ?? []).length;
    } catch {
      return -1;
    }
  });

  await page.getByRole("button", { name: "周回顾" }).click();
  await expect(page.getByTestId("weekly-review-card")).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "规划下周" }).click();

  // Proposal Card 出现（已有 Planning Pipeline）
  const sidecar = page.getByTestId("kiro-sidecar");
  await expect(sidecar).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("study-plan-proposal").first()).toBeVisible({ timeout: 15000 });
  await expect(sidecar.getByText("已为你生成下周学习计划建议。").first()).toBeVisible({ timeout: 15000 });

  // Apply 前：studyBlocks 没有因为 Kiro Proposal 自动增加
  await page.waitForTimeout(500);
  const studyBlocksAfterProposal = await page.evaluate(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("classflow-storage-v2") ?? "{}") as {
        state?: { studyBlocks?: unknown[] };
      };
      return (stored.state?.studyBlocks ?? []).length;
    } catch {
      return -1;
    }
  });
  expect(studyBlocksAfterProposal).toBe(studyBlocksBefore);

  // 用户 Apply 确认后才真正写入（页面存在主/隐藏两个 transcript 副本：只用 visible 卡片）
  const proposalCard = page.getByTestId("study-plan-proposal").filter({ visible: true }).first();
  await proposalCard.getByTestId("study-plan-apply").click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByText(/已创建 \d+ 个学习时段/).first()).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(500);
  const studyBlocksAfterApply = await page.evaluate(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("classflow-storage-v2") ?? "{}") as {
        state?: { studyBlocks?: unknown[] };
      };
      return (stored.state?.studyBlocks ?? []).length;
    } catch {
      return -1;
    }
  });
  expect(studyBlocksAfterApply).toBeGreaterThan(studyBlocksBefore);
  await sse.close();
});
