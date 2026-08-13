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

const IR_V1 = {
  title: "研究方案",
  blocks: [
    { type: "heading", level: 1, content: [{ text: "引言" }] },
    { type: "paragraph", content: [{ text: "版本一" }] },
  ],
};

const IR_V2 = {
  title: "研究方案",
  blocks: [
    { type: "heading", level: 1, content: [{ text: "引言" }] },
    { type: "paragraph", content: [{ text: "版本二" }] },
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
              { type: "heading", level: 1, content: [{ text: "研究背景" }] },
              { type: "paragraph", content: [{ text: "这是 Artifact UX 测试正文。" }] },
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