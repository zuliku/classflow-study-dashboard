import { expect } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Kiro Computer Agent V1 — Part 3 Offline E2E（确定性，不依赖真实 AI）。
 * 拦截 /api/ai/chat，返回 AI SDK-compatible 的 Tool Call stream：
 * - Turn 1（Workspace Auto）：create_text_file notes.md
 * - Turn 2（Guided）：patch_text_file → Approval Dialog → 允许这一次 → 同一 Tool Call resume
 * 验证：Task Card 位于 owning assistant message / verified change / review before-after /
 * Undo 恢复原内容 / reload 后历史 Computer Task 显示但无 Undo。
 */

const AI_SETTINGS = {
  enabled: true,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  custom: { providerName: "", baseURL: "", model: "" },
};

const NOTE_CONTENT = "原始笔记内容\n第二行";
const PATCH_AFTER = "已修改的笔记内容";

function sse(lines: string[]): string {
  return lines.map((l) => `data: ${l}`).join("\n\n") + "\n\n";
}

function toolCallStream(messageId: string, toolCallId: string, toolName: string, input: unknown): string {
  return sse([
    JSON.stringify({ type: "start", messageId }),
    JSON.stringify({ type: "start-step" }),
    JSON.stringify({ type: "tool-input-start", toolCallId, toolName }),
    JSON.stringify({ type: "tool-input-delta", toolCallId, inputTextDelta: JSON.stringify(input) }),
    JSON.stringify({ type: "tool-input-available", toolCallId, toolName, input }),
    JSON.stringify({ type: "finish-step" }),
    JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
  ]);
}

function answerStream(messageId: string, text: string): string {
  return sse([
    JSON.stringify({ type: "start", messageId }),
    JSON.stringify({ type: "start-step" }),
    JSON.stringify({ type: "text-start", id: `t-${messageId}` }),
    JSON.stringify({ type: "text-delta", id: `t-${messageId}`, delta: text }),
    JSON.stringify({ type: "text-end", id: `t-${messageId}` }),
    JSON.stringify({ type: "finish-step" }),
    JSON.stringify({ type: "finish", finishReason: "stop" }),
  ]);
}

async function readSandboxText(page: import("@playwright/test").Page, path: string): Promise<string | null> {
  return page.evaluate(
    async (p) => {
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const req = indexedDB.open("classflow-kiro-sandbox-v1", 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (!db) return null;
      try {
        return await new Promise<string | null>((resolve) => {
          const tx = db.transaction("files", "readonly");
          const store = tx.objectStore("files");
          const req = store.get(`sandbox-default\u0000${p}`);
          req.onsuccess = () => {
            const entry = req.result as { text?: string } | undefined;
            resolve(entry && entry.text !== undefined ? entry.text : null);
          };
          req.onerror = () => resolve(null);
        });
      } finally {
        db.close();
      }
    },
    path
  );
}

test("Computer Agent V1：创建 → 审批修改 → 审查 → 撤销 → 历史只读", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    // 1: Turn1 create tool call; 2: Turn1 final answer; 3: Turn2 patch tool call; 4: Turn2 final answer
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("mock-msg-1", "call_create_1", "create_text_file", {
          path: "notes.md",
          content: NOTE_CONTENT,
        }),
      });
      return;
    }
    if (requestCount === 2) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: answerStream("mock-msg-1", "已创建 notes.md，内容已写入工作区。"),
      });
      return;
    }
    if (requestCount === 3) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("mock-msg-3", "call_patch_1", "patch_text_file", {
          path: "notes.md",
          edits: [{ oldText: NOTE_CONTENT, newText: PATCH_AFTER }],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: answerStream("mock-msg-3", "已修改 notes.md。"),
    });
  });

  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.waitForTimeout(800);

  const composer = page.getByTestId("kiro-composer");
  await expect(composer).toBeVisible();

  // ---- Turn 1：Sandbox 引导 + Workspace Auto → 创建文件 ----
  const computerToggle = composer.getByRole("button", { name: "Computer" });
  await computerToggle.click();
  await expect(computerToggle).toHaveAttribute("aria-pressed", "true");

  const modeMenu = composer.getByRole("button", { name: "权限模式" });
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /工作区自动/ }).first().click();
  await expect(modeMenu).toContainText("工作区自动");

  await composer.getByLabel("Ask Kiro").fill("帮我创建 notes.md");
  await composer.getByLabel("发送").click();

  // Task Card 位于 owning assistant message 内（不是全局 footer）
  const assistantMsg = page.locator('[data-testid="kiro-message"]').last();
  const taskCard = assistantMsg.getByTestId("kiro-agent-task-card");
  await expect(taskCard).toBeVisible({ timeout: 15000 });
  await expect(taskCard).toContainText("已完成 1 项文件更改");
  await expect(taskCard).toContainText("notes.md");
  await expect(composer.getByLabel("Ask Kiro")).toBeVisible();
  await expect(taskCard).toContainText("已完成 1 项文件更改");
  await expect(taskCard).toContainText("notes.md");
  await expect(composer.getByLabel("Ask Kiro")).toBeVisible();

  // 文件真实写入 Sandbox
  expect(await readSandboxText(page, "notes.md")).toBe(NOTE_CONTENT);

  // ---- Turn 2：切 Guided → patch → Approval Dialog → 允许这一次 ----
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /受控/ }).first().click();
  await expect(modeMenu).toContainText("受控");

  await composer.getByLabel("Ask Kiro").fill("把 notes.md 改成新内容");
  await composer.getByLabel("发送").click();

  // Approval：ask 暂停（无 Tool Output），文件不变
  const approval = page.getByTestId("kiro-approval-dialog");
  await expect(approval).toBeVisible({ timeout: 15000 });
  await expect(approval).toContainText("修改文件 notes.md");
  await expect(approval).toContainText("Kiro Sandbox");
  expect(await readSandboxText(page, "notes.md")).toBe(NOTE_CONTENT);

  await approval.getByTestId("approval-allow-once").click();

  // 同一 Tool Call 继续 → Task completed（verified change）
  const taskCard2 = page.locator('[data-testid="kiro-message"]').last().getByTestId("kiro-agent-task-card");
  await expect(taskCard2).toBeVisible({ timeout: 15000 });
  await expect(taskCard2).toContainText("已完成 1 项文件更改");
  expect(await readSandboxText(page, "notes.md")).toBe(PATCH_AFTER);

  // ---- Change Review：真实 before/after ----
  await taskCard2.getByTestId("kiro-task-review").click();
  const review = page.getByTestId("kiro-change-review-dialog");
  await expect(review).toBeVisible();
  await expect(review).toContainText("修改前");
  await expect(review).toContainText(NOTE_CONTENT);
  await expect(review).toContainText("修改后");
  await expect(review).toContainText(PATCH_AFTER);
  await review.getByRole("button", { name: "关闭" }).click();
  await expect(review).toHaveCount(0);

  // ---- Undo：恢复原内容 + verified ----
  await taskCard2.getByTestId("kiro-task-undo").click();
  await expect(taskCard2).toContainText("已撤销本次更改");
  expect(await readSandboxText(page, "notes.md")).toBe(NOTE_CONTENT);
  // 等待 undo 状态落盘（Provider save debounce 300ms + computerVersion signal）
  await page.waitForTimeout(900);

  // ---- Reload：历史 Computer Task 显示但无 Undo ----
  await page.reload();
  await page.waitForTimeout(800);
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "最近对话" }).first().click();
  await page.waitForTimeout(600);
  const railDialog = page.getByRole("dialog", { name: "对话" });
  await expect(railDialog).toBeVisible();
  await railDialog.getByRole("button").filter({ hasText: "帮我创建" }).first().click();
  await page.waitForTimeout(800);

  const restoredCard = page.locator('[data-testid="kiro-message"]').last().getByTestId("kiro-agent-task-card");
  await expect(restoredCard).toContainText("历史记录（仅展示，不能撤销）");
  await expect(restoredCard.getByTestId("kiro-task-undo")).toHaveCount(0);
  await expect(restoredCard.getByTestId("kiro-task-review")).toHaveCount(0);
});

// ==================== V4：Computer Agent 共用 Progressive Worklog（staged） ====================

import http from "node:http";

async function startSseServer(plan: (bodyJson: { messages?: unknown[] }) => { delay?: number; events: string[] }[]) {
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
      let stages: { delay?: number; events: string[] }[];
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
  return { url: `http://127.0.0.1:${port}/sse`, close: async () => { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); } };
}

/**
 * Computer 模式 staged：commentary → Computer tool（真实执行）→ commentary →
 * 第二个 Computer tool → boundary milestone → Final Answer。
 * 验证 Computer Agent 与普通 Kiro 共用同一 Progressive Worklog。
 */
test("V4 Computer：commentary 立即显示 → Computer 工具逐个渐进 → milestone → Final Answer", async ({ page }) => {
  const P1 = "我先查看目录结构";
  const P2 = "接下来检查可用信息";
  const sse = await startSseServer((bodyJson) => {
    const toolOutputCount = ((bodyJson.messages ?? []) as { role: string; parts?: { type: string; state?: string }[] }[]).reduce(
      (sum, m) => sum + (m.role === "assistant" ? (m.parts ?? []).filter((p) => p.type.startsWith("tool-") && p.state === "output-available").length : 0),
      0
    );
    const hasBoundaryOutput = ((bodyJson.messages ?? []) as { role: string; parts?: { type: string; state?: string }[] }[]).some(
      (m) => m.role === "assistant" && (m.parts ?? []).some((p) => p.type === "tool-begin_final_answer" && p.state === "output-available")
    );
    if (toolOutputCount === 0) {
      return [
        {
          events: [
            JSON.stringify({ type: "start", messageId: "v4c-1" }),
            JSON.stringify({ type: "start-step" }),
            JSON.stringify({ type: "text-start", id: "c1" }),
            JSON.stringify({ type: "text-delta", id: "c1", delta: P1 }),
            JSON.stringify({ type: "text-end", id: "c1" }),
          ],
        },
        {
          delay: 300,
          events: [
            JSON.stringify({ type: "tool-input-start", toolCallId: "call_c_list", toolName: "list_directory" }),
            JSON.stringify({ type: "tool-input-delta", toolCallId: "call_c_list", inputTextDelta: '{"rootId":"root-sandbox","path":"."}' }),
            JSON.stringify({ type: "tool-input-available", toolCallId: "call_c_list", toolName: "list_directory", input: { rootId: "root-sandbox", path: "." } }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
          ],
        },
      ];
    }
    if (toolOutputCount === 1) {
      return [
        {
          delay: 3000,
          events: [
            JSON.stringify({ type: "start", messageId: "v4c-1" }),
            JSON.stringify({ type: "start-step" }),
            JSON.stringify({ type: "text-start", id: "c2" }),
            JSON.stringify({ type: "text-delta", id: "c2", delta: P2 }),
            JSON.stringify({ type: "text-end", id: "c2" }),
          ],
        },
        {
          delay: 800,
          events: [
            JSON.stringify({ type: "tool-input-start", toolCallId: "call_c_roots", toolName: "list_workspace_roots" }),
            JSON.stringify({ type: "tool-input-delta", toolCallId: "call_c_roots", inputTextDelta: "{}" }),
            JSON.stringify({ type: "tool-input-available", toolCallId: "call_c_roots", toolName: "list_workspace_roots", input: {} }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
          ],
        },
      ];
    }
    if (!hasBoundaryOutput) {
      return [
        {
          delay: 6000,
          events: [
            JSON.stringify({ type: "start", messageId: "v4c-1" }),
            JSON.stringify({ type: "start-step" }),
            JSON.stringify({ type: "tool-input-start", toolCallId: "call_c_b", toolName: "begin_final_answer" }),
            JSON.stringify({ type: "tool-input-delta", toolCallId: "call_c_b", inputTextDelta: "{}" }),
            JSON.stringify({ type: "tool-input-available", toolCallId: "call_c_b", toolName: "begin_final_answer", input: {} }),
            JSON.stringify({ type: "finish-step" }),
            JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
          ],
        },
      ];
    }
    return [
      {
        events: [
          JSON.stringify({ type: "start", messageId: "v4c-1" }),
          JSON.stringify({ type: "start-step" }),
          JSON.stringify({ type: "text-start", id: "final-c" }),
          JSON.stringify({ type: "text-delta", id: "final-c", delta: "目录检查完成。" }),
          JSON.stringify({ type: "text-end", id: "final-c" }),
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
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.waitForTimeout(800);
  const composer = page.getByTestId("kiro-composer");
  await expect(composer).toBeVisible();
  await composer.getByRole("button", { name: "Computer" }).click();
  await expect(composer.getByRole("button", { name: "Computer" })).toHaveAttribute("aria-pressed", "true");
  const modeMenu = composer.getByRole("button", { name: "权限模式" });
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /工作区自动/ }).first().click();

  await composer.getByLabel("Ask Kiro").fill("查看工作区目录");
  await composer.getByLabel("发送").click();

  const worklog = page.getByTestId("kiro-worklog");
  // T0：commentary 立即显示（Computer Tool 尚未出现）
  await expect(worklog).toBeVisible({ timeout: 8000 });
  const progress1 = worklog.getByText(P1, { exact: true });
  await expect(progress1).toBeVisible({ timeout: 8000 });
  await expect(worklog.locator('[data-testid="kiro-tool-row"]')).toHaveCount(0);
  // T1：Computer tool（list_directory）出现并完成
  const toolRows = worklog.locator('[data-testid="kiro-tool-row"]');
  await expect(toolRows.first()).toBeVisible({ timeout: 10000 });
  await expect(toolRows.first().locator(".lucide-check")).toBeVisible({ timeout: 10000 });
  // T3：progress2 到达
  const progress2 = worklog.getByText(P2, { exact: true });
  await expect(progress2).toBeVisible({ timeout: 8000 });
  // milestone + Final Answer
  await expect(worklog.getByTestId("kiro-worklog-milestone")).toContainText("已完成执行", { timeout: 10000 });
  await expect(page.getByTestId("kiro-message").last()).toContainText("目录检查完成", { timeout: 10000 });

  await sse.close();
});
