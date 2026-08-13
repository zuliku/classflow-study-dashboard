import { expect } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Kiro Computer Agent V3 Part 1 — Workspace Knowledge & KIRO.md Offline E2E。
 * 固定 Sandbox fixture + 确定性 /api/ai/chat mock：
 * KIRO.md → search_workspace_knowledge("研究方法") → read_text("research/method.md") → final answer。
 * 最终回答依赖 live read_text（请求历史断言真实正文），非 Knowledge snippet。
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

/** 页面加载后写入 Sandbox fixture（classflow-kiro-sandbox-v1） */
async function seedSandboxFixture(page: import("@playwright/test").Page) {
  await page.evaluate(async (files) => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open("classflow-kiro-sandbox-v1", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("files")) {
          req.result.createObjectStore("files");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db) return;
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction("files", "readwrite");
        const store = tx.objectStore("files");
        for (const [path, text] of Object.entries(files)) {
          store.put({ kind: "file", text, size: new TextEncoder().encode(text).byteLength, mtime: new Date().toISOString() }, `sandbox-default\u0000${path}`);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    } finally {
      db.close();
    }
  }, {
    "KIRO.md": "方法论问题优先参考 research/method.md。",
    "research/literature.md": "文献综述与参考文献整理。",
    "research/method.md": "研究方法采用事件研究，并进行平行趋势检验。",
    "data/README.txt": "数据目录说明。",
  });
}

test("V3 Part 1：KIRO.md 指令 + 知识搜索 + 实时读取回答", async ({ page }) => {
  let requestCount = 0;
  let firstBody: Record<string, unknown> | null = null;
  let thirdBody: Record<string, unknown> | null = null;
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (requestCount === 1) firstBody = body;
    if (requestCount === 3) thirdBody = body;
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("k3-msg-1", "call_knowledge", "search_workspace_knowledge", {
          query: "研究方法",
          maxResults: 5,
        }),
      });
      return;
    }
    if (requestCount === 2) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("k3-msg-2", "call_read_method", "read_text", {
          rootId: "root-sandbox",
          path: "research/method.md",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: answerStream("k3-msg-2", "研究方法采用事件研究，并进行平行趋势检验。"),
    });
  });

  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await seedSandboxFixture(page);
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.waitForTimeout(800);

  const composer = page.getByTestId("kiro-composer");
  await expect(composer).toBeVisible();
  await composer.getByRole("button", { name: "Computer" }).click();
  await expect(composer.getByRole("button", { name: "Computer" })).toHaveAttribute("aria-pressed", "true");

  await composer.getByLabel("Ask Kiro").fill("研究方法是什么？");
  await composer.getByLabel("发送").click();
  await expect(page.locator('[data-testid="kiro-message"]').last()).toContainText("事件研究", { timeout: 20000 });
  expect(requestCount).toBe(3);

  // ---- 首个请求：KIRO.md Workspace Instructions（bounded、logical-only）----
  const computerSnapshot = ((firstBody as Record<string, unknown> | null)?.computerSnapshot ?? null) as Record<string, unknown> | null;
  expect(computerSnapshot).not.toBeNull();
  expect(computerSnapshot?.workspaceId).toBeTruthy();
  const instructions = (((firstBody as Record<string, unknown> | null)?.computerWorkspaceInstructions ?? null)) as {
    workspaceId?: string;
    entries?: { path?: string; availability?: string; text?: string }[];
  } | null;
  expect(instructions?.workspaceId).toBe(computerSnapshot?.workspaceId);
  const kiroEntry = instructions?.entries?.find((e) => e.path === "KIRO.md");
  expect(kiroEntry?.availability).toBe("loaded");
  expect(kiroEntry?.text).toContain("方法论问题优先参考 research/method.md");
  const serializedFirst = JSON.stringify(firstBody);
  for (const forbidden of ["adapterRef", "sandbox-default", "nativePath", "FileSystemDirectoryHandle", "grant"]) {
    expect(serializedFirst).not.toContain(forbidden);
  }
  // 正文不在 Context（只含 metadata + KIRO.md 指令）
  expect(serializedFirst).not.toContain("平行趋势检验");

  // ---- 第三个请求：read_text 真实 output（证明最终回答依赖 live read）----
  const serializedThird = JSON.stringify(thirdBody);
  expect(serializedThird).toContain("平行趋势检验");
  expect(serializedThird).toContain("research/method.md");
  expect(serializedThird).not.toContain("adapterRef");
});
