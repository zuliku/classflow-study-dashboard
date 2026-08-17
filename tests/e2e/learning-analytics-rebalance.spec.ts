import { expect, Page } from "@playwright/test";
import http from "node:http";
import { test as demoTest } from "./demoFixtures";

/**
 * Study Rebalance E2E（Analytics V2 · Part 5）：
 * 1. Outlook 容量缺口 → [优化已有计划] → propose_study_rebalance → Proposal Card
 * 2. 预览 → Timetable ghost（原块弱化 + 目标 ghost）
 * 3. Apply → Confirm → ID 保持、位置变化、History study_block.updated source=kiro
 * 4. Undo → 同一 ID 恢复原位置（source=manual 追加）
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

/**
 * Seed：a1（明天 DDL 120min，明天 08:00–19:00 被考试占用 → 晚间 19:00–21:00 共 120min）；
 * a2（5 天后 DDL）的 Kiro block 明天 19:00–20:00 占住早期容量 → 移到 2 天后可释放缺口 60min。
 */
async function seedRebalanceState(page: Page) {
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
      state.assignments = [
        {
          id: "a1", courseId: "c1", title: "概率论作业", description: "", priority: "medium",
          status: "todo", progress: 0, tags: [], ddl: iso(1), estimatedMinutes: 120,
        },
        {
          id: "a2", courseId: "c2", title: "英语展示", description: "", priority: "medium",
          status: "todo", progress: 0, tags: [], ddl: iso(5), estimatedMinutes: 60,
        },
      ];
      state.studyBlocks = [
        {
          id: "sb1", title: "英语展示", date: dayStr(1), startTime: "19:00", endTime: "20:00",
          assignmentId: "a2", courseId: "c2", source: "kiro",
        },
      ];
      state.schedules = [];
      state.calendarMarks = [
        { id: "cm0", date: dayStr(0), type: "exam", title: "全天考试", startTime: "00:00", endTime: "23:59" },
        { id: "cm1", date: dayStr(1), type: "exam", title: "考试", startTime: "08:00", endTime: "19:00" },
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
  await expect(page.getByRole("heading", { name: "学习洞察" })).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1500);
}

demoTest("Outlook → 优化已有计划 → Rebalance Proposal → 预览 Ghost → Apply（ID 保持）→ Undo（恢复）", async ({ page }) => {
  await seedRebalanceState(page);
  const sse = await startSseServer((ctx) => {
    const n = ctx.toolOutputs.length;
    if (n === 0) {
      return [{ events: toolCallSSE("call_1", "get_learning_outlook", { horizonDays: 7 }) }];
    }
    if (n === 1) {
      return [{ events: toolCallSSE("call_2", "propose_study_rebalance", { horizonDays: 7 }) }];
    }
    return [{ events: finalSSE("已生成学习计划调整建议。") }];
  });
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await openAnalytics(page);

  const card = page.getByTestId("study-outlook-card");
  await expect(card).toBeVisible({ timeout: 10000 });

  // 容量缺口存在 → [优化已有计划] 出现
  const handoff = card.getByTestId("outlook-rebalance-handoff");
  await expect(handoff).toBeVisible();
  await handoff.click();

  const sidecar = page.getByTestId("kiro-sidecar");
  await expect(sidecar).toBeVisible({ timeout: 10000 });

  // Rebalance Proposal Card（真实引擎：after_deadline 不会出现——a2 block 在 DDL 前；是 capacity_relief）
  const proposalCard = page.getByTestId("study-rebalance-proposal").filter({ visible: true }).first();
  await expect(proposalCard).toBeVisible({ timeout: 15000 });
  await expect(proposalCard).toContainText("学习计划调整建议");
  await expect(proposalCard).toContainText("英语展示");

  // 记录原始 block 位置（Apply 前 StudyBlock 不变）
  const beforeBlock = await page.evaluate(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("classflow-storage-v2") ?? "{}") as {
        state?: { studyBlocks?: { id: string; date: string; startTime: string }[] };
      };
      return (stored.state?.studyBlocks ?? []).find((b) => b.id === "sb1");
    } catch {
      return null;
    }
  });
  expect(beforeBlock?.date).toBeTruthy();

  // 预览 → Timetable ghost（原块弱化 + 目标 ghost）；0 Store mutation
  await proposalCard.getByRole("button", { name: "预览调整" }).click();
  // 原块在本周（弱化 opacity 0.35）
  await expect(page.getByTestId("timeline-study-block").first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("timeline-study-block").first()).toHaveCSS("opacity", "0.35");
  // 目标在下周（move 必须严格晚于 shortfall deadline）→ 切到下一周看 ghost
  await page.getByLabel("下一周").first().click();
  await expect(page.getByTestId("timeline-rebalance-ghost").first()).toBeVisible({ timeout: 10000 });
  const afterPreviewBlock = await page.evaluate(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("classflow-storage-v2") ?? "{}") as {
        state?: { studyBlocks?: { id: string; date: string }[] };
      };
      return (stored.state?.studyBlocks ?? []).find((b) => b.id === "sb1");
    } catch {
      return null;
    }
  });
  expect(afterPreviewBlock?.date).toBe(beforeBlock?.date); // preview 不写 Store

  // 回洞察 → Apply → Confirm
  await page.getByRole("button", { name: "学习洞察" }).first().click();
  await page.waitForTimeout(800);
  const cardAgain = page.getByTestId("study-rebalance-proposal").filter({ visible: true }).first();
  await expect(cardAgain).toBeVisible({ timeout: 10000 });
  await cardAgain.getByTestId("study-rebalance-apply").click();
  await page.getByTestId("confirm-dialog-confirm").click();

  // Apply 后：同一 ID、位置变化、未写入新 block
  await expect(page.getByText(/已调整 1 个学习时段/).first()).toBeVisible({ timeout: 10000 });
  const afterApply = await page.evaluate(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("classflow-storage-v2") ?? "{}") as {
        state?: { studyBlocks?: { id: string; date: string; startTime: string }[] };
      };
      return (stored.state?.studyBlocks ?? []).find((b) => b.id === "sb1");
    } catch {
      return null;
    }
  });
  expect(afterApply).toBeTruthy();
  expect(afterApply!.date).not.toBe(beforeBlock!.date);
  const blockCount = await page.evaluate(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("classflow-storage-v2") ?? "{}") as {
        state?: { studyBlocks?: unknown[] };
      };
      return (stored.state?.studyBlocks ?? []).length;
    } catch {
      return -1;
    }
  });
  expect(blockCount).toBe(1);

  // History：study_block.updated source=kiro（由浏览器真实引擎写入 IndexedDB）
  const updatedKiro = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("classflow-learning-history", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const out: { source: string; entityId: string }[] = [];
    await new Promise<void>((resolve) => {
      const tx = db.transaction("events", "readonly");
      const req = tx.objectStore("events").getAll();
      req.onsuccess = () => {
        for (const e of (req.result as { type: string; source: string; entityId: string }[]) ?? []) {
          if (e.type === "study_block.updated") out.push({ source: e.source, entityId: e.entityId });
        }
        resolve();
      };
      req.onerror = () => resolve();
    });
    db.close();
    return out;
  });
  expect(updatedKiro.some((e) => e.source === "kiro" && e.entityId === "sb1")).toBe(true);

  // Undo（toast 撤销）→ 同一 ID 恢复原位置
  await page.getByRole("button", { name: "撤销" }).first().click();
  await page.waitForTimeout(800);
  const afterUndo = await page.evaluate(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("classflow-storage-v2") ?? "{}") as {
        state?: { studyBlocks?: { id: string; date: string; startTime: string }[] };
      };
      return (stored.state?.studyBlocks ?? []).find((b) => b.id === "sb1");
    } catch {
      return null;
    }
  });
  expect(afterUndo?.date).toBe(beforeBlock!.date);
  expect(afterUndo?.startTime).toBe(beforeBlock!.startTime);
  await sse.close();
});
