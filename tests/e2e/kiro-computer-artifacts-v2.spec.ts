import { expect } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Kiro Computer Agent V2 — Part 1 Offline E2E（确定性，不依赖真实 AI）。
 * 拦截 /api/ai/chat：
 * - Turn 1（Workspace Auto）：create_text_file draft.md → Artifact 登记
 * - Turn 2（Workspace Auto）：rename_file draft.md → final.md → fs.move 仍 ask → Approval Dialog
 * 验证：Task Card 重命名事实 / Undo 恢复 draft.md 且 final.md 不存在 / reload 历史 rename facts 无 Undo。
 */

const AI_SETTINGS = {
  enabled: true,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  custom: { providerName: "", baseURL: "", model: "" },
};

const DRAFT_CONTENT = "草稿内容\n第二行";

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
            const entry = req.result as { text?: string; bytes?: ArrayBuffer } | undefined;
            if (!entry) {
              resolve(null);
              return;
            }
            if (entry.text !== undefined) {
              resolve(entry.text);
              return;
            }
            if (entry.bytes) {
              resolve(new TextDecoder().decode(entry.bytes));
              return;
            }
            resolve(null);
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

async function countSandboxEntries(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open("classflow-kiro-sandbox-v1", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db) return 0;
    try {
      return await new Promise<number>((resolve) => {
        const tx = db.transaction("files", "readonly");
        const req = tx.objectStore("files").getAllKeys();
        req.onsuccess = () => {
          const keys = req.result as string[];
          resolve(keys.filter((k) => k.startsWith("sandbox-default\u0000")).length);
        };
        req.onerror = () => resolve(0);
      });
    } finally {
      db.close();
    }
  });
}

test("V2 Artifact：创建 draft.md → rename → 审批 → 重命名事实 → Undo → 历史只读", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("v2-msg-1", "call_create_draft", "create_text_file", {
          path: "draft.md",
          content: DRAFT_CONTENT,
        }),
      });
      return;
    }
    if (requestCount === 2) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: answerStream("v2-msg-1", "已创建 draft.md。"),
      });
      return;
    }
    if (requestCount === 3) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("v2-msg-3", "call_rename_draft", "rename_file", {
          rootId: "root-sandbox",
          path: "draft.md",
          newName: "final.md",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: answerStream("v2-msg-3", "已重命名为 final.md。"),
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

  // ---- Turn 1：Sandbox 引导 + Workspace Auto → create_text_file draft.md ----
  await composer.getByRole("button", { name: "Computer" }).click();
  await expect(composer.getByRole("button", { name: "Computer" })).toHaveAttribute("aria-pressed", "true");
  const modeMenu = composer.getByRole("button", { name: "权限模式" });
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /工作区自动/ }).first().click();
  await expect(modeMenu).toContainText("工作区自动");

  await composer.getByLabel("Ask Kiro").fill("创建 draft.md");
  await composer.getByLabel("发送").click();

  let taskCard = page.locator('[data-testid="kiro-message"]').last().getByTestId("kiro-agent-task-card");
  await expect(taskCard).toBeVisible({ timeout: 15000 });
  await expect(taskCard).toContainText("创建 draft.md");
  expect(await readSandboxText(page, "draft.md")).toBe(DRAFT_CONTENT);

  // ---- Turn 2：rename_file（Workspace Auto 仍 ask）→ Approval Dialog ----
  await composer.getByLabel("Ask Kiro").fill("把 draft.md 重命名为 final.md");
  await composer.getByLabel("发送").click();

  const approval = page.getByTestId("kiro-approval-dialog");
  await expect(approval).toBeVisible({ timeout: 15000 });
  await expect(approval).toContainText("重命名 draft.md → final.md");
  // 未批准前无 IO：draft.md 仍在
  expect(await readSandboxText(page, "draft.md")).toBe(DRAFT_CONTENT);
  expect(await readSandboxText(page, "final.md")).toBeNull();

  await approval.getByTestId("approval-allow-once").click();

  // 同一 Tool Call resume → Task Card 显示重命名事实
  taskCard = page.locator('[data-testid="kiro-message"]').last().getByTestId("kiro-agent-task-card");
  await expect(taskCard).toBeVisible({ timeout: 15000 });
  await expect(taskCard).toContainText("重命名 draft.md → final.md");
  expect(await readSandboxText(page, "final.md")).toBe(DRAFT_CONTENT);
  expect(await readSandboxText(page, "draft.md")).toBeNull();

  // ---- Undo：move-back → draft.md 恢复 + final.md 移除 ----
  await taskCard.getByTestId("kiro-task-undo").click();
  await expect(taskCard).toContainText("已撤销本次更改");
  expect(await readSandboxText(page, "draft.md")).toBe(DRAFT_CONTENT);
  expect(await readSandboxText(page, "final.md")).toBeNull();
  // sandbox 中只有一个文件（无残留）
  expect(await countSandboxEntries(page)).toBe(1);
  // 等待 undo 状态落盘
  await page.waitForTimeout(900);
  // ---- Reload：历史 Task 显示 rename facts 但没有 Undo ----
  await page.reload();
  await page.waitForTimeout(800);
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "最近对话" }).first().click();
  await page.waitForTimeout(600);
  const railDialog = page.getByRole("dialog", { name: "对话" });
  await expect(railDialog).toBeVisible();
  await railDialog.getByRole("button").filter({ hasText: "创建 draft.md" }).first().click();
  await page.waitForTimeout(800);

  const restoredCard = page.locator('[data-testid="kiro-message"]').last().getByTestId("kiro-agent-task-card");
  await expect(restoredCard).toContainText("重命名 draft.md → final.md");
  await expect(restoredCard).toContainText("历史记录（仅展示，不能撤销）");
  await expect(restoredCard.getByTestId("kiro-task-undo")).toHaveCount(0);
});
