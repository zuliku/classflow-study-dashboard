import { expect } from "@playwright/test";
import { test } from "./demoFixtures";
import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";

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

const IR_V1 = {
  title: "研究方案",
  blocks: [
    { type: "heading", level: 1, text: "引言" },
    { type: "paragraph", text: "版本一" },
  ],
};

const IR_V2 = {
  title: "研究方案",
  blocks: [
    { type: "heading", level: 1, text: "引言" },
    { type: "paragraph", text: "版本二" },
  ],
};

async function readArtifactRevision(page: import("@playwright/test").Page): Promise<{ artifactId: string; revision: number } | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open("classflow-kiro-artifacts-v1", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db) return null;
    try {
      return await new Promise<{ artifactId: string; revision: number } | null>((resolve) => {
        const tx = db.transaction("artifacts", "readonly");
        const req = tx.objectStore("artifacts").getAll();
        req.onsuccess = () => {
          const list = (req.result ?? []) as { id: string; revision: number; relativePath: string }[];
          const plan = list.find((a) => a.relativePath === "plan.md");
          resolve(plan ? { artifactId: plan.id, revision: plan.revision } : null);
        };
        req.onerror = () => resolve(null);
      });
    } finally {
      db.close();
    }
  });
}

async function readArtifactSource(page: import("@playwright/test").Page, artifactId: string): Promise<{ revision: number; title: string } | null> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open("classflow-kiro-artifacts-v1", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db) return null;
    try {
      return await new Promise<{ revision: number; title: string } | null>((resolve) => {
        const tx = db.transaction("sources", "readonly");
        const store = tx.objectStore("sources");
        let req: IDBRequest;
        try {
          req = store.get(String(id ?? ""));
        } catch (err) {
          resolve(null);
          return;
        }
        req.onsuccess = () => {
          const rec = req.result as { revision?: number; document?: { title?: string } } | undefined;
          resolve(rec ? { revision: rec.revision ?? 0, title: rec.document?.title ?? "" } : null);
        };
        req.onerror = () => resolve(null);
      });
    } finally {
      db.close();
    }
  }, artifactId);
}

test("V2 Part 2：create_document → update_document（自动允许）→ 修改 plan.md · v2 → Undo 精确恢复 → 历史只读", async ({ page }) => {
  let requestCount = 0;
  let artifactId = "";
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("p2-msg-1", "call_create_plan", "create_document", {
          path: "plan.md",
          document: IR_V1,
        }),
      });
      return;
    }
    if (requestCount === 2) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: answerStream("p2-msg-1", "已创建 plan.md。"),
      });
      return;
    }
    if (requestCount === 3) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("p2-msg-3", "call_update_plan", "update_document", {
          artifactId,
          expectedRevision: 1,
          document: IR_V2,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: answerStream("p2-msg-3", "已更新 plan.md。"),
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

  // ---- Turn 1：create_document plan.md（IR_V1）----
  await composer.getByRole("button", { name: "Computer" }).click();
  await expect(composer.getByRole("button", { name: "Computer" })).toHaveAttribute("aria-pressed", "true");
  const modeMenu = composer.getByRole("button", { name: "权限模式" });
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /工作区自动/ }).first().click();
  await expect(modeMenu).toContainText("工作区自动");

  await composer.getByLabel("Ask Kiro").fill("创建 plan.md 文档");
  await composer.getByLabel("发送").click();

  let taskCard = page.locator('[data-testid="kiro-message"]').last().getByTestId("kiro-agent-task-card");
  await expect(taskCard).toBeVisible({ timeout: 15000 });
  await expect(taskCard).toContainText("创建 plan.md");

  // 从 Artifact DB 读取生成的 artifactId + revision 1
  const artifactInfo = await readArtifactRevision(page);
  expect(artifactInfo).not.toBeNull();
  expect(artifactInfo?.revision).toBe(1);
  artifactId = artifactInfo?.artifactId ?? "";
  expect(artifactId).not.toBe("");

  // ---- Turn 2：update_document（Workspace Auto document.modify=allow → 无 Approval）----
  await composer.getByLabel("Ask Kiro").fill("把 plan.md 更新为版本二");
  await composer.getByLabel("发送").click();

  await expect(page.getByTestId("kiro-approval-dialog")).toHaveCount(0, { timeout: 3000 });
  taskCard = page.locator('[data-testid="kiro-message"]').last().getByTestId("kiro-agent-task-card");
  await expect(taskCard).toBeVisible({ timeout: 15000 });
  await expect(taskCard).toContainText("修改 plan.md · v2");

  // Sandbox 文件 = v2 内容
  const planText = await readSandboxText(page, "plan.md");
  expect(planText).not.toBeNull();
  expect(planText).toContain("版本二");

  // Artifact metadata + Source IR 都是 v2
  const after = await readArtifactRevision(page);
  expect(after?.revision).toBe(2);
  const sourceAfter = await readArtifactSource(page, artifactId);
  expect(sourceAfter?.revision).toBe(2);
  expect(sourceAfter?.title).toBe("研究方案");

  // ---- Undo：exact v1 + revision 1 + Source IR v1 ----
  await taskCard.getByTestId("kiro-task-undo").click();
  await expect(taskCard).toContainText("已撤销本次更改");
  const undoneText = await readSandboxText(page, "plan.md");
  expect(undoneText).not.toBeNull();
  expect(undoneText).toContain("版本一");
  expect(undoneText).not.toContain("版本二");
  expect((await readArtifactRevision(page))?.revision).toBe(1);
  expect((await readArtifactSource(page, artifactId))?.revision).toBe(1);
  await page.waitForTimeout(900);

  // ---- Reload：历史 Task 显示 v2 事实但无 Undo ----
  await page.reload();
  await page.waitForTimeout(800);
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "最近对话" }).first().click();
  await page.waitForTimeout(600);
  const railDialog = page.getByRole("dialog", { name: "对话" });
  await expect(railDialog).toBeVisible();
  await railDialog.getByRole("button").filter({ hasText: "创建 plan.md" }).first().click();
  await page.waitForTimeout(800);

  const restoredCard = page.locator('[data-testid="kiro-message"]').last().getByTestId("kiro-agent-task-card");
  await expect(restoredCard).toContainText("修改 plan.md · v2");
  await expect(restoredCard).toContainText("历史记录（仅展示，不能撤销）");
  await expect(restoredCard.getByTestId("kiro-task-undo")).toHaveCount(0);
});

async function deleteSandboxFile(page: import("@playwright/test").Page, path: string): Promise<void> {
  await page.evaluate(async (p) => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open("classflow-kiro-sandbox-v1", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db) return;
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction("files", "readwrite");
        tx.objectStore("files").delete(`sandbox-default\u0000${p}`);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    } finally {
      db.close();
    }
  }, path);
}

test("V2 Part 3：Artifact Preview / Download / Recent / Ask Kiro 使用安全逻辑上下文", async ({ page }) => {
  let requestCount = 0;
  let lastRequestBody: Record<string, unknown> | null = null;
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (requestCount >= 3) lastRequestBody = body;
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("p3-msg-1", "call_create_research", "create_document", {
          rootId: "root-sandbox",
          path: "research.md",
          document: {
            title: "研究方案",
            blocks: [
              { type: "heading", level: 1, text: "研究背景" },
              { type: "paragraph", text: "这是 Artifact UX 测试正文。" },
            ],
          },
        }),
      });
      return;
    }
    if (requestCount === 2) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: answerStream("p3-msg-1", "已创建 research.md。"),
      });
      return;
    }
    if (requestCount === 3) {
      // 模型通过正常 Computer 工具重读正文（Artifact Context 只有 metadata）
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("p3-msg-3", "call_read_research", "read_text", {
          rootId: "root-sandbox",
          path: "research.md",
        }),
      });
      return;
    }
    if (requestCount === 4) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: answerStream("p3-msg-3", "research.md 包含研究背景与测试正文。"),
      });
      return;
    }
    if (requestCount === 5) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("p3-msg-5", "call_create_temp", "create_text_file", {
          rootId: "root-sandbox",
          path: "temp.md",
          content: "temporary",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: answerStream("p3-msg-5", "已创建 temp.md。"),
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
  await composer.getByRole("button", { name: "Computer" }).click();
  await expect(composer.getByRole("button", { name: "Computer" })).toHaveAttribute("aria-pressed", "true");
  const modeMenu = composer.getByRole("button", { name: "权限模式" });
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /工作区自动/ }).first().click();

  // ---- Turn 1：create_document research.md ----
  await composer.getByLabel("Ask Kiro").fill("创建 research.md");
  await composer.getByLabel("发送").click();
  const taskCard = page.locator('[data-testid="kiro-message"]').last().getByTestId("kiro-agent-task-card");
  await expect(taskCard).toBeVisible({ timeout: 15000 });
  await expect(taskCard).toContainText("创建 research.md");

  // ---- Preview：渲染 + 源码 ----
  await taskCard.getByRole("button", { name: "预览 research.md" }).click();
  const previewDialog = page.getByTestId("kiro-artifact-preview-dialog");
  await expect(previewDialog).toBeVisible();
  await expect(previewDialog).toContainText("research.md");
  await expect(previewDialog).toContainText("研究背景");
  await expect(previewDialog).toContainText("Artifact UX 测试正文");
  await previewDialog.getByRole("button", { name: "源码" }).click();
  await expect(previewDialog).toContainText("# 研究背景");
  await previewDialog.getByRole("button", { name: "关闭" }).click();
  await expect(previewDialog).toHaveCount(0);

  // ---- Download：suggestedFilename === research.md ----
  const downloadPromise = page.waitForEvent("download");
  await taskCard.getByRole("button", { name: "下载 research.md" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("research.md");

  // ---- Recent 12 ----
  await page.getByRole("button", { name: "最近文件" }).click();
  const recentPanel = page.getByRole("dialog", { name: "最近文件" });
  await expect(recentPanel).toBeVisible();
  await expect(recentPanel).toContainText("research.md");
  await expect(recentPanel).toContainText("Markdown");
  const rows = recentPanel.locator('[data-testid="kiro-recent-artifact-row"]');
  expect(await rows.count()).toBeLessThanOrEqual(12);

  // ---- Ask Kiro：手动 Context（不自动发送）----
  await recentPanel.getByRole("button", { name: /Ask Kiro research.md/ }).click();
  await expect(recentPanel).toHaveCount(0);
  await expect(page.getByTestId("kiro-context-bar")).toContainText("文件 · research.md");
  expect(requestCount).toBe(2); // 没有产生模型请求

  // ---- 发送：捕获请求 body 断言安全 Context ----
  await composer.getByLabel("Ask Kiro").fill("总结这个文件");
  await composer.getByLabel("发送").click();
  await expect(page.locator('[data-testid="kiro-message"]').last()).toContainText("研究背景", { timeout: 15000 });
  expect(requestCount).toBe(4);

  const refs = ((lastRequestBody as Record<string, unknown> | null)?.contextRefs ?? []) as Record<string, unknown>[];
  const artifactRef = refs.find((r) => r.kind === "artifact");
  expect(artifactRef).toEqual({
    kind: "artifact",
    id: expect.any(String),
    label: "文件 · research.md",
    workspaceId: expect.any(String),
    rootId: "root-sandbox",
    relativePath: "research.md",
    type: "markdown",
    revision: 1,
  });
  const serializedRefs = JSON.stringify(refs);
  for (const forbidden of ["adapterRef", "sandbox-default", "nativePath", "absolutePath", "bytes", "Artifact UX 测试正文"]) {
    expect(serializedRefs).not.toContain(forbidden);
  }

  // ---- Stale record：删文件 → missing → 移除记录 ----
  await deleteSandboxFile(page, "research.md");
  await page.getByRole("button", { name: "最近文件" }).click();
  const recentPanel2 = page.getByRole("dialog", { name: "最近文件" });
  await expect(recentPanel2).toBeVisible();
  await expect(recentPanel2).toContainText("文件不存在");
  const removeBtn = recentPanel2.getByRole("button", { name: /移除记录 research.md/ });
  await expect(removeBtn).toBeVisible();
  await removeBtn.click();
  await expect(page.locator('[data-testid="kiro-recent-artifact-row"]').filter({ hasText: "research.md" })).toHaveCount(0);
  // Artifact metadata + Source 已删（filesystem 未再改动）
  const artifactsAfterStale = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open("classflow-kiro-artifacts-v1", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db) return "no-db";
    try {
      return await new Promise<string>((resolve) => {
        const tx = db.transaction("artifacts", "readonly");
        const req = tx.objectStore("artifacts").getAll();
        req.onsuccess = () => resolve(JSON.stringify((req.result ?? []).map((a: { relativePath?: string }) => a.relativePath)));
        req.onerror = () => resolve("err");
      });
    } finally {
      db.close();
    }
  });
  expect(artifactsAfterStale).not.toContain("research.md");

  // ---- Ghost Artifact：create → Undo 后 Registry 无残留 ----
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await composer.getByLabel("Ask Kiro").fill("创建 temp.md");
  await composer.getByLabel("发送").click();
  const tempTaskCard = page.locator('[data-testid="kiro-message"]').last().getByTestId("kiro-agent-task-card");
  await expect(tempTaskCard).toBeVisible({ timeout: 15000 });
  await expect(tempTaskCard).toContainText("创建 temp.md");
  await tempTaskCard.getByTestId("kiro-task-undo").click();
  await expect(tempTaskCard).toContainText("已撤销本次更改");
  const artifactsAfterUndo = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open("classflow-kiro-artifacts-v1", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db) return "no-db";
    try {
      return await new Promise<string>((resolve) => {
        const tx = db.transaction("artifacts", "readonly");
        const req = tx.objectStore("artifacts").getAll();
        req.onsuccess = () => resolve(JSON.stringify((req.result ?? []).map((a: { relativePath?: string }) => a.relativePath)));
        req.onerror = () => resolve("err");
      });
    } finally {
      db.close();
    }
  });
  expect(artifactsAfterUndo).not.toContain("temp.md");
});

// ==================== V2.1：真实浏览器下载完整性（P0） ====================

/** 用户真实失败场景的课表 DOCX IR（4 列表格；V2.2 扁平 Draft 形式） */
const SCHEDULE_IR = {
  title: "本周课表（第1周）",
  stylePreset: "business-report",
  blocks: [
    {
      type: "table",
      header: ["星期", "课程", "时间", "地点"],
      rows: [
        ["周一", "数据结构与算法", "08:00–09:40", "计算机楼 102"],
        ["周二", "概率论与数理统计", "10:00–11:40", "教三 305"],
      ],
    },
  ],
} as const;

/** 浏览器侧读取 Sandbox IndexedDB 的二进制指纹（测试辅助；不进生产代码） */
async function readSandboxBinaryFingerprint(
  page: import("@playwright/test").Page,
  filePath: string
): Promise<{ size: number; sha256: string } | null> {
  return page.evaluate(
    async (p) => {
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const req = indexedDB.open("classflow-kiro-sandbox-v1", 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (!db) return null;
      try {
        return await new Promise<{ size: number; sha256: string } | null>((resolve) => {
          const tx = db.transaction("files", "readonly");
          const store = tx.objectStore("files");
          const req = store.get(`sandbox-default\u0000${p}`);
          req.onsuccess = async () => {
            const entry = req.result as { bytes?: ArrayBuffer } | undefined;
            if (!entry || !entry.bytes) {
              resolve(null);
              return;
            }
            const view = new Uint8Array(entry.bytes);
            const digest = await crypto.subtle.digest("SHA-256", view);
            const hex = Array.from(new Uint8Array(digest))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("");
            resolve({ size: view.byteLength, sha256: hex });
          };
          req.onerror = () => resolve(null);
        });
      } finally {
        db.close();
      }
    },
    filePath
  );
}

/** Node 侧 SHA-256（下载文件指纹） */
function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

test("V2.1：DOCX 浏览器下载 byte-for-byte 完整性（下载文件 = Sandbox bytes，且通过 DOCX 验证）", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("v21-msg-1", "call_create_schedule", "create_document", {
          path: "本周课表（第1周）.docx",
          document: SCHEDULE_IR,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: answerStream("v21-msg-1", "已生成课表 Word 文档。"),
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
  await composer.getByRole("button", { name: "Computer" }).click();
  await expect(composer.getByRole("button", { name: "Computer" })).toHaveAttribute("aria-pressed", "true");
  const modeMenu = composer.getByRole("button", { name: "权限模式" });
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /工作区自动/ }).first().click();
  await expect(modeMenu).toContainText("工作区自动");

  // ---- create_document(.docx)：verified + Artifact 登记 ----
  await composer.getByLabel("Ask Kiro").fill("生成课表 Word");
  await composer.getByLabel("发送").click();
  const taskCard = page.locator('[data-testid="kiro-message"]').last().getByTestId("kiro-agent-task-card");
  await expect(taskCard).toBeVisible({ timeout: 15000 });
  await expect(taskCard).toContainText("本周课表（第1周）.docx");

  // 下载前：Sandbox live bytes 指纹（浏览器侧 SHA-256）
  const sandboxFp = await readSandboxBinaryFingerprint(page, "本周课表（第1周）.docx");
  expect(sandboxFp).not.toBeNull();
  expect(sandboxFp!.size).toBeGreaterThan(0);

  // ---- 真实浏览器下载：读取磁盘上的下载文件 ----
  const downloadPromise = page.waitForEvent("download");
  await taskCard.getByRole("button", { name: "下载 本周课表（第1周）.docx" }).click();
  const download = await downloadPromise;
  // 展示层文件名清理（扩展名前无多余空格）
  expect(download.suggestedFilename()).toBe("本周课表（第1周）.docx");
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const downloaded = await fsp.readFile(downloadPath!);
  expect(downloaded.byteLength).toBeGreaterThan(0);

  // ---- byte-for-byte 一致性：size + SHA-256 ----
  expect(downloaded.byteLength).toBe(sandboxFp!.size);
  expect(sha256Hex(downloaded)).toBe(sandboxFp!.sha256);

  // ---- 下载文件本身通过 DOCX 校验（package + round-trip）----
  const { verifyDocxBytes, verifyRenderedDocx } = await import("@/lib/ai/computer/documents/verify");
  const { normalizeDocumentDraft } = await import("@/lib/ai/computer/documents/authoring/normalize");
  const downloadedBytes = new Uint8Array(downloaded);
  // PK ZIP signature
  expect(downloadedBytes[0]).toBe(0x50);
  expect(downloadedBytes[1]).toBe(0x4b);
  expect(await verifyDocxBytes(downloadedBytes)).toBe(true);
  // round-trip 对比 canonical Source IR（Draft → normalize → renderer）
  expect(await verifyRenderedDocx(downloadedBytes, normalizeDocumentDraft(SCHEDULE_IR as never))).toBe(true);

  // ---- Optional：LibreOffice compatibility smoke（环境无 soffice 则 SKIPPED）----
  let soffice = false;
  try {
    execFileSync("soffice", ["--version"], { stdio: "ignore" });
    soffice = true;
  } catch {
    soffice = false;
  }
  if (soffice) {
    const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), "kiro-docx-smoke-"));
    execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", outDir, downloadPath!], {
      stdio: "ignore",
      timeout: 60_000,
    });
    const pdf = await fsp.readdir(outDir);
    expect(pdf.some((f) => f.endsWith(".pdf"))).toBe(true);
  } else {
    console.log("SKIPPED: soffice not found — LibreOffice compatibility smoke skipped");
  }
});

// ==================== V2.2：Agent Flow Regression（Draft 单次成功 + 语义标签） ====================

test("V2.2 Agent Flow：get_week_schedule → create_document（Draft table，一次成功）→ begin_final_answer", async ({ page }) => {
  const seenCreateDocumentParts: { toolCallId?: string; state?: string }[] = [];
  const seenCreateDocumentCallIds = new Set<string>();
  let requestCount = 0;
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    const body = route.request().postDataJSON() as {
      messages?: { parts?: { type?: string; toolCallId?: string; state?: string; input?: unknown }[] }[];
    };
    for (const m of body?.messages ?? []) {
      for (const p of m.parts ?? []) {
        if (p.type === "tool-create_document") {
          // 同一 part 会随 continuation 请求反复出现 → 按 toolCallId 去重计调用次数
          if (p.toolCallId && !seenCreateDocumentCallIds.has(p.toolCallId)) {
            seenCreateDocumentCallIds.add(p.toolCallId);
            seenCreateDocumentParts.push({ toolCallId: p.toolCallId, state: p.state });
          }
        }
      }
    }
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("af-msg-1", "call_ws", "get_week_schedule", {}),
      });
      return;
    }
    if (requestCount === 2) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("af-msg-1", "call_doc", "create_document", {
          path: "课表.docx",
          document: {
            title: "本周课表",
            stylePreset: "business-report",
            blocks: [
              { type: "table", header: ["星期", "课程", "时间", "地点"], rows: [["周一", "数据结构与算法", "08:00–09:40", "计算机楼 102"]] },
            ],
          },
        }),
      });
      return;
    }
    if (requestCount === 3) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("af-msg-1", "call_fa", "begin_final_answer", {}),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: answerStream("af-msg-1", "已生成课表 Word 文档。"),
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
  await composer.getByRole("button", { name: "Computer" }).click();
  await expect(composer.getByRole("button", { name: "Computer" })).toHaveAttribute("aria-pressed", "true");
  const modeMenu = composer.getByRole("button", { name: "权限模式" });
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /工作区自动/ }).first().click();

  await composer.getByLabel("Ask Kiro").fill("帮我生成本周课表 Word");
  await composer.getByLabel("发送").click();

  const taskCard = page.locator('[data-testid="kiro-message"]').last().getByTestId("kiro-agent-task-card");
  await expect(taskCard).toBeVisible({ timeout: 15000 });
  await expect(taskCard).toContainText("创建 课表.docx");

  // create_document 只被模型调用一次（无失败重试链）
  expect(seenCreateDocumentParts.length).toBe(1);
  // 且该 part 是成功态（output-available，不是 output-error）
  expect(seenCreateDocumentParts[0]).toMatchObject({ state: "output-available" });
  expect(seenCreateDocumentParts[0]?.toolCallId).toBeTruthy();

  // Worklog：真实语义标签（查看课表 / 创建文档），不存在「执行操作」
  const worklog = page.getByTestId("kiro-worklog");
  await expect(worklog).toBeVisible();
  await expect(worklog.getByRole("status")).toHaveText("已完成 2 个步骤", { timeout: 10000 });
  // turn 结束自动折叠 → 展开后检查 tool 行语义标签
  const summary = worklog.getByRole("button").first();
  await summary.click();
  await expect(worklog).toContainText("查看课表");
  await expect(worklog).toContainText("创建文档");
  await expect(worklog.getByText("执行操作", { exact: true })).toHaveCount(0);
  // 不存在模型自述 JSON/结构错误的文字
  await expect(page.getByText(/JSON|schema|结构错误|Let me fix/i)).toHaveCount(0);

  // Sandbox 已生成文件
  const fp = await readSandboxBinaryFingerprint(page, "课表.docx");
  expect(fp).not.toBeNull();
  expect(fp!.size).toBeGreaterThan(0);
});

// ==================== V2.5：Legacy DOCX Self-Heal + delete_file ====================

/** test-only legacy DOCX（真实错误签名：w:tc → w:r direct child；w:style → w:numPr） */
async function buildLegacyDocx(): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
  );
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Kiro</dc:creator></cp:coreProperties>`
  );
  zip.file(
    "docProps/app.xml",
    `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Kiro</Application></Properties>`
  );
  const legacyCells = Array.from({ length: 24 }, (_, i) =>
    `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:r><w:t>cell${i}</w:t></w:r></w:tc>`
  ).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:tbl><w:tr>${legacyCells}</w:tr></w:tbl></w:body></w:document>`
  );
  const legacyStyles = Array.from({ length: 2 }, (_, i) =>
    `<w:style w:type="paragraph" w:styleId="List${i}"><w:name w:val="List${i}"/><w:numPr><w:numId w:val="1"/></w:numPr></w:style>`
  ).join("");
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${legacyStyles}</w:styles>`
  );
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

/** 读取当前 sandbox workspace（enable Computer 后从 persist 读取） */
async function readSandboxWorkspace(page: import("@playwright/test").Page): Promise<{ workspaceId: string; rootId: string }> {
  return page.evaluate(async () => {
    const raw = localStorage.getItem("classflow-kiro-computer-v1");
    const state = raw ? (JSON.parse(raw) as { state?: { workspaces?: { id: string; roots?: { id: string; adapterRef?: string }[] }[] } }).state : undefined;
    const ws = state?.workspaces?.find((w) => w.roots?.some((r) => r.adapterRef === "sandbox-default"));
    return { workspaceId: ws?.id ?? "", rootId: ws?.roots?.find((r) => r.adapterRef === "sandbox-default")?.id ?? "root-sandbox" };
  });
}

/** 直接向 Sandbox IndexedDB 写入文件（测试辅助；不进生产代码） */
async function seedSandboxFile(page: import("@playwright/test").Page, path: string, payload: { text?: string; base64?: string }): Promise<void> {
  const result = await page.evaluate(
    async (p) => {
      const bytes = p.payload.base64 !== undefined
        ? Uint8Array.from(atob(p.payload.base64), (c) => c.charCodeAt(0))
        : null;
      const entry = bytes !== null
        ? { kind: "file", bytes: bytes.buffer, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
        : { kind: "file", text: p.payload.text ?? "", type: "text/plain" };
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const req = indexedDB.open("classflow-kiro-sandbox-v1", 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains("files")) req.result.createObjectStore("files");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (!db) return { stored: false, bytesLen: bytes?.byteLength ?? -1 };
      try {
        await new Promise<void>((resolve) => {
          const tx = db.transaction("files", "readwrite");
          tx.objectStore("files").put(entry, `sandbox-default\u0000${p.path}`);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      } finally {
        db.close();
      }
      return { stored: true, bytesLen: bytes?.byteLength ?? -1, b64len: p.payload.base64?.length ?? -1 };
    },
    { path, payload }
  );
  void result;
}

/** 直接向 Artifact Registry 写入 record + Source（测试辅助） */
async function seedArtifact(
  page: import("@playwright/test").Page,
  artifact: { id: string; workspaceId: string; rootId: string; relativePath: string; type: string; title: string; source: string },
  source?: { revision: number; document: unknown; rendererVersion?: number }
): Promise<void> {
  await page.evaluate(
    async (p) => {
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const req = indexedDB.open("classflow-kiro-artifacts-v1", 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains("artifacts")) req.result.createObjectStore("artifacts");
          if (!req.result.objectStoreNames.contains("sources")) req.result.createObjectStore("sources");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (!db) return;
      try {
        await new Promise<void>((resolve) => {
          const tx = db.transaction(["artifacts", "sources"], "readwrite");
          const now = new Date().toISOString();
          tx.objectStore("artifacts").put(
            {
              id: p.artifact.id,
              workspaceId: p.artifact.workspaceId,
              rootId: p.artifact.rootId,
              relativePath: p.artifact.relativePath,
              displayName: p.artifact.relativePath.split("/").pop() ?? p.artifact.relativePath,
              type: p.artifact.type,
              title: p.artifact.title,
              source: p.artifact.source,
              revision: p.source?.revision ?? 1,
              createdAt: now,
              updatedAt: now,
            },
            p.artifact.id
          );
          if (p.source) {
            tx.objectStore("sources").put(
              { artifactId: p.artifact.id, revision: p.source.revision, document: p.source.document, updatedAt: now },
              p.artifact.id
            );
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      } finally {
        db.close();
      }
    },
    { artifact, source }
  );
}

test("V2.5 场景 A：legacy Kiro DOCX 下载时自动 self-heal（下载 = current renderer bytes）", async ({ page }) => {
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

  const { workspaceId, rootId } = await readSandboxWorkspace(page);
  expect(workspaceId).toBeTruthy();

  // seed legacy DOCX + kiro-created artifact + matching Source IR（revision 1）
  const legacy = await buildLegacyDocx();
  const legacyB64 = Buffer.from(legacy).toString("base64");
  await seedSandboxFile(page, "legacy.docx", { base64: legacyB64 });
  await seedArtifact(
    page,
    { id: "legacy-art-1", workspaceId, rootId, relativePath: "legacy.docx", type: "docx", title: "旧课表", source: "kiro-created" },
    { revision: 1, document: { title: "本周课表", stylePreset: "business-report", blocks: [{ type: "paragraph", content: [{ text: "旧文档正文" }] }] } }
  );

  // Recent Files → 下载
  await page.getByRole("button", { name: "最近文件" }).click();
  const dlRow = page.locator('[data-testid="kiro-recent-artifact-row"]').filter({ hasText: "legacy.docx" });
  await expect(dlRow).toBeVisible({ timeout: 10000 });
  const downloadPromise = page.waitForEvent("download");
  await dlRow.getByRole("button", { name: "下载 legacy.docx" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const downloaded = await fsp.readFile(downloadPath!);
  expect(downloaded.byteLength).toBeGreaterThan(0);

  // 下载字节 = current renderer（非 legacy）：合法 DOCX + 无 direct tc→r
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(downloaded);
  const documentXml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const tcRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
  let m: RegExpExecArray | null;
  let directRunCells = 0;
  while ((m = tcRe.exec(documentXml))) {
    let inner = m[1].replace(/<w:tcPr\b[^>]*?\/?>[\s\S]*?<\/w:tcPr>/g, "");
    inner = inner.replace(/<w:p\b[^>]*?\/?>[\s\S]*?<\/w:p>/g, "");
    if (/<w:r\b[^>]*>/.test(inner)) directRunCells += 1;
  }
  expect(directRunCells).toBe(0);
  const { verifyDocxBytes } = await import("@/lib/ai/computer/documents/verify");
  expect(await verifyDocxBytes(new Uint8Array(downloaded))).toBe(true);
  // 与 legacy bytes 不同（已被替换）
  expect(Buffer.from(downloaded).toString("base64")).not.toBe(legacyB64);
  // Sandbox 原文件已被替换
  const fp = await readSandboxBinaryFingerprint(page, "legacy.docx");
  expect(fp).not.toBeNull();
  expect(fp!.size).toBe(downloaded.byteLength);
});

test("V2.5 场景 B：Agent delete_file → 确认后删除（Approval 前文件仍在，允许后消失，Task Card 显示删除）", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("v25-msg-1", "call_del_test", "delete_file", { rootId: "root-sandbox", path: "test.txt" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: answerStream("v25-msg-1", "已删除 test.txt。"),
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
  await composer.getByRole("button", { name: "Computer" }).click();
  await expect(composer.getByRole("button", { name: "Computer" })).toHaveAttribute("aria-pressed", "true");
  const modeMenu = composer.getByRole("button", { name: "权限模式" });
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /工作区自动/ }).first().click();

  await seedSandboxFile(page, "test.txt", { text: "要删除的内容" });
  expect(await readSandboxText(page, "test.txt")).toBe("要删除的内容");

  await composer.getByLabel("Ask Kiro").fill("删除 test.txt");
  await composer.getByLabel("发送").click();

  // Approval Dialog（fs.delete always-ask，即使 Workspace Auto）
  const approval = page.getByTestId("kiro-approval-dialog");
  await expect(approval).toBeVisible({ timeout: 15000 });
  await expect(approval).toContainText("删除文件 test.txt");
  await expect(approval).toContainText("删除后无法通过 Kiro 撤销");
  // 未批准前零 IO：文件仍在
  expect(await readSandboxText(page, "test.txt")).toBe("要删除的内容");

  await approval.getByTestId("approval-allow-once").click();

  // 允许后真正删除 + Task Card 显示「删除 test.txt」
  const taskCard = page.locator('[data-testid="kiro-message"]').last().getByTestId("kiro-agent-task-card");
  await expect(taskCard).toBeVisible({ timeout: 15000 });
  await expect(taskCard).toContainText("删除 test.txt");
  expect(await readSandboxText(page, "test.txt")).toBeNull();
});

test("V2.5 场景 C：Recent Files 手动删除（二次确认 → 文件消失 + row 消失）", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("v25c-msg-1", "call_create_manual", "create_text_file", {
          rootId: "root-sandbox",
          path: "manual.txt",
          content: "手动删除目标",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: answerStream("v25c-msg-1", "已创建 manual.txt。"),
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
  await composer.getByRole("button", { name: "Computer" }).click();
  await expect(composer.getByRole("button", { name: "Computer" })).toHaveAttribute("aria-pressed", "true");
  const modeMenu = composer.getByRole("button", { name: "权限模式" });
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /工作区自动/ }).first().click();

  await composer.getByLabel("Ask Kiro").fill("创建 manual.txt");
  await composer.getByLabel("发送").click();
  await expect(page.locator('[data-testid="kiro-message"]').last().getByTestId("kiro-agent-task-card")).toBeVisible({ timeout: 15000 });
  expect(await readSandboxText(page, "manual.txt")).toBe("手动删除目标");

  // Recent Files → available 行有「删除」按钮
  await page.getByRole("button", { name: "最近文件" }).click();
  const row = page.locator('[data-testid="kiro-recent-artifact-row"]').filter({ hasText: "manual.txt" });
  await expect(row).toBeVisible();
  const deleteBtn = row.getByRole("button", { name: "删除 manual.txt" });
  await expect(deleteBtn).toBeVisible();
  await deleteBtn.click();

  // 二次确认（危险操作；点击确认前文件仍在）
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("删除后无法通过 Kiro 撤销");
  expect(await readSandboxText(page, "manual.txt")).toBe("手动删除目标");
  await confirm.getByTestId("confirm-dialog-confirm").click();

  // 文件消失（异步删除 + 确认对话框先关闭 popover）；重新打开 Recent Files 断言 row 消失
  await expect.poll(async () => readSandboxText(page, "manual.txt")).toBeNull();
  await page.getByRole("button", { name: "最近文件" }).click();
  await expect(page.locator('[data-testid="kiro-recent-artifact-row"]').filter({ hasText: "manual.txt" })).toHaveCount(0, { timeout: 10000 });
});

test("V2.5 场景 D：Task Card 文件行也有删除入口（二次确认 → 文件消失）", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("v25d-msg-1", "call_create_taskdel", "create_text_file", {
          rootId: "root-sandbox",
          path: "taskdel.txt",
          content: "从任务卡删除",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: answerStream("v25d-msg-1", "已创建 taskdel.txt。"),
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
  await composer.getByRole("button", { name: "Computer" }).click();
  await expect(composer.getByRole("button", { name: "Computer" })).toHaveAttribute("aria-pressed", "true");
  const modeMenu = composer.getByRole("button", { name: "权限模式" });
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /工作区自动/ }).first().click();

  await composer.getByLabel("Ask Kiro").fill("创建 taskdel.txt");
  await composer.getByLabel("发送").click();
  const taskCard = page.locator('[data-testid="kiro-message"]').last().getByTestId("kiro-agent-task-card");
  await expect(taskCard).toBeVisible({ timeout: 15000 });
  expect(await readSandboxText(page, "taskdel.txt")).toBe("从任务卡删除");

  // Task Card 行内删除按钮 → 二次确认
  await taskCard.getByRole("button", { name: "删除 taskdel.txt" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("删除后无法通过 Kiro 撤销");
  expect(await readSandboxText(page, "taskdel.txt")).toBe("从任务卡删除");
  await confirm.getByTestId("confirm-dialog-confirm").click();

  await expect.poll(async () => readSandboxText(page, "taskdel.txt")).toBeNull();
});

// ==================== V2.6：Runtime Provenance + 三段 Bytes 锁死 ====================

/**
 * V2.6 探针：Kiro-V26-Word-Probe.docx（全新唯一文件名，避免旧 Artifact/Source IR/同名下载混淆）。
 * 三段 bytes SHA 必须一致：A=renderDocx 输出（Node 侧同代码复算） / B=Sandbox 持久化 / C=浏览器下载。
 * 全部 legacy=false；package provenance = currentRendererMarker（creator=ClassFlow Kiro + description marker）。
 *
 * 确定性前提：docx Packer 在 docProps 写入 new Date() 时间戳 → 浏览器 addInitScript 与 Node 侧
 * 都把 Date 固定到同一 epoch（已实证：同 IR 三次 renderDocx SHA 相同）。
 */
const PROBE_FILE = "Kiro-V26-Word-Probe.docx";
const PROBE_DRAFT = {
  title: "本周课表",
  stylePreset: "business-report",
  blocks: [
    { type: "paragraph", text: "生成日期：2026-08-14" },
    {
      type: "table",
      header: ["星期", "课程", "时间", "地点"],
      rows: [
        ["周一", "数据结构与算法", "08:00–09:40", "计算机楼 102"],
        ["周二", "概率论与数理统计", "10:00–11:40", "教三 305"],
        ["周三", "操作系统", "14:00–15:40", "计算机楼 208"],
        ["周四", "学术英语写作", "13:00–14:40", "外语楼 207"],
        ["周五", "计算机网络", "10:00–11:40", "计算机楼 305"],
      ],
    },
  ],
} as const;
const PROBE_FIXED_EPOCH_MS = 1784070000000;

function withFixedDate<T>(fn: () => Promise<T>): Promise<T> {
  const RealDate = globalThis.Date;
  const FixedDate = class extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date>) {
      if (args.length === 0) super(PROBE_FIXED_EPOCH_MS);
      else super(...(args as [number | string | Date]));
    }
    static now() {
      return PROBE_FIXED_EPOCH_MS;
    }
  };
  globalThis.Date = FixedDate as typeof Date;
  return fn().finally(() => {
    globalThis.Date = RealDate;
  });
}

test("V2.6 探针：Kiro-V26-Word-Probe.docx 三段 SHA 一致（render=Sandbox=下载）+ provenance + legacy=false", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("v26-msg-1", "call_probe", "create_document", {
          path: PROBE_FILE,
          document: PROBE_DRAFT,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: answerStream("v26-msg-1", "已生成 Kiro-V26-Word-Probe.docx。"),
    });
  });
  await page.addInitScript(({ epoch }) => {
    // 与 Node 侧 withFixedDate 相同：docx Packer 的 docProps 时间戳固定 → 输出确定性
    const RealDate = Date;
    const FixedDate = class extends RealDate {
      constructor(...args: any[]) {
        if (args.length === 0) super(epoch);
        else super(...args);
      }
      static now() {
        return epoch;
      }
    };
    (globalThis as any).Date = FixedDate;
  }, { epoch: PROBE_FIXED_EPOCH_MS });
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

  await composer.getByLabel("Ask Kiro").fill(`生成 ${PROBE_FILE}`);
  await composer.getByLabel("发送").click();
  const taskCard = page.locator('[data-testid="kiro-message"]').last().getByTestId("kiro-agent-task-card");
  await expect(taskCard).toBeVisible({ timeout: 15000 });
  await expect(taskCard).toContainText(PROBE_FILE);

  // B = Sandbox 持久化 bytes（浏览器侧 SHA）
  const sandboxFp = await readSandboxBinaryFingerprint(page, PROBE_FILE);
  expect(sandboxFp).not.toBeNull();
  expect(sandboxFp!.size).toBeGreaterThan(0);

  // A = renderDocx 输出：Node 侧用与 executor 完全相同的 canonical 化 + 同代码 renderDocx 复算
  const canonical = await withFixedDate(async () => {
    const { parseDocumentAuthoringInput } = await import("@/lib/ai/computer/documents/authoring/compat");
    const { renderDocx } = await import("@/lib/ai/computer/documents/docx");
    const parsed = parseDocumentAuthoringInput(PROBE_DRAFT as never);
    if (!parsed.ok) throw new Error("probe draft parse failed");
    return renderDocx(parsed.value.document);
  });
  const renderSha = sha256Hex(Buffer.from(canonical));
  expect(renderSha).toBe(sandboxFp!.sha256);

  // C = 浏览器真实下载 bytes
  const downloadPromise = page.waitForEvent("download");
  await taskCard.getByRole("button", { name: `下载 ${PROBE_FILE}` }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(PROBE_FILE);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const downloaded = await fsp.readFile(downloadPath!);
  expect(downloaded.byteLength).toBe(sandboxFp!.size);
  expect(sha256Hex(downloaded)).toBe(sandboxFp!.sha256);

  // 三段全部 legacy=false（A/B/C）：B 用浏览器原始 bytes → Node 侧 detector
  const { detectLegacyKiroDocx } = await import("@/lib/ai/computer/documents/legacy");
  const { inspectKiroDocxProvenance } = await import("@/lib/ai/computer/documents/provenance");
  expect((await detectLegacyKiroDocx(canonical)).legacy).toBe(false);
  expect((await detectLegacyKiroDocx(new Uint8Array(downloaded))).legacy).toBe(false);
  const sandboxB64 = await page.evaluate(async (p) => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open("classflow-kiro-sandbox-v1", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db) return null;
    try {
      return await new Promise<string | null>((resolve) => {
        const tx = db.transaction("files", "readonly");
        const req = tx.objectStore("files").get(`sandbox-default\u0000${p}`);
        req.onsuccess = () => {
          const entry = req.result as { bytes?: ArrayBuffer } | undefined;
          if (!entry || !entry.bytes) {
            resolve(null);
            return;
          }
          let binary = "";
          const view = new Uint8Array(entry.bytes);
          for (let i = 0; i < view.byteLength; i += 0x8000) {
            binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
          }
          resolve(btoa(binary));
        };
        req.onerror = () => resolve(null);
      });
    } finally {
      db.close();
    }
  }, PROBE_FILE);
  expect(sandboxB64).not.toBeNull();
  const sandboxBuffer = Buffer.from(sandboxB64!, "base64");
  expect((await detectLegacyKiroDocx(new Uint8Array(sandboxBuffer))).legacy).toBe(false);
  expect(sha256Hex(sandboxBuffer)).toBe(sandboxFp!.sha256);

  // Package provenance：下载文件 = 新 renderer 标记（creator + description marker），无旧 Kiro 结构
  const provenance = await inspectKiroDocxProvenance(new Uint8Array(downloaded));
  expect(provenance.currentRendererMarker).toBe(true);
  expect(provenance.legacyKiroProducer).toBe(false);
  expect(provenance.legacyStructuralSignature).toBe(false);
  expect(provenance.creator).toBe("ClassFlow Kiro");
  expect(provenance.description).toContain("docx-library-v2");

  // 完整 4×6 表格文本存在于下载文件（标题/日期/表格内容齐全）
  const { verifyRenderedDocx } = await import("@/lib/ai/computer/documents/verify");
  const { normalizeDocumentDraft } = await import("@/lib/ai/computer/documents/authoring/normalize");
  expect(await verifyRenderedDocx(new Uint8Array(downloaded), normalizeDocumentDraft(PROBE_DRAFT as never))).toBe(true);

  // ---- Optional：LibreOffice headless 渲染（环境无 soffice 则 SKIPPED）----
  try {
    execFileSync("soffice", ["--version"], { stdio: "ignore" });
    const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), "kiro-v26-smoke-"));
    execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", outDir, downloadPath!], {
      stdio: "ignore",
      timeout: 120_000,
    });
    const pdfs = await fsp.readdir(outDir);
    expect(pdfs.some((f) => f.endsWith(".pdf"))).toBe(true);
  } catch {
    console.log("SKIPPED: soffice not found — LibreOffice render smoke skipped");
  }
});
