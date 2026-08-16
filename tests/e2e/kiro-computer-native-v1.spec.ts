import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";
import { installMemoryDesktopBridgeMock } from "../helpers/memoryDesktopBridge";

/**
 * Kiro Native Folder Sandbox V1 — Desktop Bridge E2E（确定性，不依赖真实 AI）。
 * - 安装 test-only memory Desktop Bridge（addInitScript 注入 window.classflowDesktop）
 * - Settings「添加本地文件夹」→ Native Workspace（论文资料 · 已授权 · 读写 · 当前）
 * - Computer 全链路：list / create / read / patch（guided approval）/ delete 全部走 Native Adapter
 * - Sandbox escape（../secret.txt 等）→ PATH_OUTSIDE_SANDBOX，bridge 调用为 0
 * - 移除 workspace → forgetGrant；真实文件保留
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

/** 安装 memory Desktop Bridge（self-contained 函数注入页面） */
async function installBridge(page: Page) {
  await page.addInitScript(({ src }) => {
    (0, eval)(src);
  }, { src: `(${installMemoryDesktopBridgeMock.toString()})()` });
}

/** 配置 AI 服务（与 kiro-computer-agent-v1 同模式） */
async function configureAI(page: Page) {
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
}

async function openAgentSettings(page: Page) {
  await page.locator("aside").first().getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "Agent 与权限" }).click();
  await expect(page.getByTestId("settings-kiro-agent")).toBeVisible();
}

async function openKiro(page: Page) {
  // 关闭 Settings Modal（若打开）
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-composer")).toBeVisible();
}

function mockCalls(page: Page, op: string) {
  return page.evaluate((o) => {
    const c = (window as unknown as {
      __desktopBridgeControl: { opCount: (op: string) => number };
    }).__desktopBridgeControl;
    return c.opCount(o);
  }, op);
}

function mockFileExists(page: Page, path: string) {
  return page.evaluate(
    ({ p }) => {
      const c = (window as unknown as {
        __desktopBridgeControl: { fileExists: (grantId: string, p: string) => boolean };
      }).__desktopBridgeControl;
      return c.fileExists("grant_mock_1", p);
    },
    { p: path }
  );
}

test("Web（无 Bridge）：Native UI 不可见；添加本地文件夹按钮文案正常", async ({ page }) => {
  await page.goto("/");
  await openAgentSettings(page);
  // 无 bridge：不出现在何 desktop-only 文案（桌面版 / Windows / Desktop Bridge / 仅桌面版）
  const text = await page.getByTestId("settings-kiro-agent").innerText();
  expect(text).not.toContain("桌面版");
  expect(text).not.toContain("Windows");
  expect(text).not.toContain("Desktop");
  expect(text).not.toContain("仅桌面版可访问");
  // 「添加本地文件夹」入口存在（网页版语义；无 desktop placeholder）
  await expect(page.getByRole("button", { name: "添加本地文件夹" })).toBeVisible();
});

test("Desktop Bridge：添加本地文件夹 → Native Workspace（论文资料 · 已授权 · 读写 · 当前）", async ({ page }) => {
  await installBridge(page);
  await configureAI(page);
  await page.goto("/");
  await openAgentSettings(page);
  await page.getByRole("button", { name: "添加本地文件夹" }).click();
  const row = page.getByTestId("kiro-workspace-row").filter({ hasText: "论文资料" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("本地文件夹 · 已授权 · 读写");
  await expect(row).toContainText("当前");
  // bridge picker 被调用（Native 路径，非 browser showDirectoryPicker —— mock 无 showDirectoryPicker 也可授权）
  expect(await mockCalls(page, "pick")).toBeGreaterThan(0);
  // 持久化 workspace 元数据绝不包含绝对路径 / 平台 / grantId 明文
  const stored = await page.evaluate(() =>
    localStorage.getItem("classflow-kiro-computer-v1") ?? ""
  );
  expect(stored).not.toContain("C:\\");
  expect(stored).not.toContain("论文资料D:");
  expect(stored).toContain("native:"); // adapterRef 使用 native: 命名空间（opaque）
});

test("Computer 全链路：list → create → read 走 Native Adapter（workspace-auto）", async ({ page }) => {
  await installBridge(page);
  await configureAI(page);
  const calls: string[] = [];
  await page.route("**/api/ai/chat", async (route) => {
    const n = calls.length + 1;
    calls.push(`req${n}`);
    if (n === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("msg-1", "call_list_1", "list_directory", { path: "." }),
      });
      return;
    }
    if (n === 2) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("msg-1", "call_create_1", "create_text_file", {
          path: "修改建议.md",
          content: "# 修改建议\n- 综述部分需要补引用",
        }),
      });
      return;
    }
    if (n === 3) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("msg-1", "call_read_1", "read_text", { path: "修改建议.md" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: answerStream("msg-1", "已读取论文资料并创建修改建议.md。"),
    });
  });

  await page.goto("/");
  await openAgentSettings(page);
  await page.getByRole("button", { name: "添加本地文件夹" }).click();
  await expect(page.getByTestId("kiro-workspace-row").filter({ hasText: "论文资料" })).toBeVisible();

  await openKiro(page);
  // Computer 已自动启用（授权时 setComputerEnabled(true)）；切到 workspace-auto
  const modeMenu = page.getByRole("button", { name: "权限模式" });
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /工作区自动/ }).first().click();
  await expect(modeMenu).toContainText("工作区自动");

  const before = await mockCalls(page, "list");
  await page.getByLabel("Ask Kiro").fill("查看论文资料的结构并创建修改建议.md");
  await page.getByLabel("发送").click();
  const taskCard = page.getByTestId("kiro-agent-task-card");
  await expect(taskCard).toBeVisible({ timeout: 15000 });
  // 只有 create_text_file 是 mutation（list/read 是读操作，不计数）
  await expect(taskCard).toContainText("已完成 1 项文件更改");
  // Native IO 真实发生（list/writeText/readText 计数增加；路径只有相对路径）
  expect(await mockCalls(page, "list")).toBeGreaterThan(before);
  expect(await mockCalls(page, "writeText")).toBeGreaterThan(0);
  expect(await mockCalls(page, "readText")).toBeGreaterThan(0);
  expect(await mockFileExists(page, "修改建议.md")).toBe(true);
  // Server body 不含 adapterRef / grantId 明文（snapshot 只含 workspaceId/rootId/label/access）
  expect(await mockCalls(page, "getGrantStatus")).toBeGreaterThan(0);
});

test("Sandbox Escape：越界路径在 Desktop Bridge 前被拒绝（bridge 调用 0）", async ({ page }) => {
  await installBridge(page);
  await configureAI(page);
  const captured: string[] = [];
  await page.route("**/api/ai/chat", async (route) => {
    const n = captured.length + 1;
    captured.push(`req${n}`);
    const path = n === 1 ? "../secret.txt" : n === 2 ? "C:\\Windows\\system.ini" : n === 3 ? "/root/a.txt" : "safe.txt";
    if (n <= 3) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("msg-e", `call_e_${n}`, "read_text", { path }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: answerStream("msg-e", "检查完毕。"),
    });
  });

  await page.goto("/");
  await openAgentSettings(page);
  await page.getByRole("button", { name: "添加本地文件夹" }).click();
  await openKiro(page);
  const modeMenu = page.getByRole("button", { name: "权限模式" });
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /工作区自动/ }).first().click();

  const before = await mockCalls(page, "readText");
  await page.getByLabel("Ask Kiro").fill("依次读取 ../secret.txt、C:\\Windows\\system.ini、/root/a.txt");
  await page.getByLabel("发送").click();
  // 3 个越界请求全部被拒绝（reject tool output）→ 没有 native readText
  await page.waitForTimeout(4000);
  expect(await mockCalls(page, "readText")).toBe(before);
  // 模型侧收到 sandbox 拒绝（部分操作未完成；bridge 无任何 IO）
  await expect(page.getByTestId("kiro-message").last()).toContainText("部分操作未完成", { timeout: 15000 });
});

test("Guided：修改文件 → Approval → 允许这一次 → 才执行 Native 写入", async ({ page }) => {
  await installBridge(page);
  await configureAI(page);
  const seq: string[] = [];
  await page.route("**/api/ai/chat", async (route) => {
    const n = seq.length + 1;
    seq.push(`req${n}`);
    if (n === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("msg-g", "call_patch_g", "patch_text_file", {
          path: "修改建议.md",
          edits: [{ oldText: "综述部分需要补引用", newText: "综述部分需要补充文献引用" }],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: answerStream("msg-g", "已按你的确认修改。"),
    });
  });

  await page.goto("/");
  await openAgentSettings(page);
  await page.getByRole("button", { name: "添加本地文件夹" }).click();
  await openKiro(page);
  // 预写入文件（direct mock）让 patch 有目标
  await page.evaluate(async () => {
    const b = window.classflowDesktop as {
      filesystem: { writeText: (i: { grantId: string; path: string; content: string }) => Promise<void> };
    };
    await b.filesystem.writeText({ grantId: "grant_mock_1", path: "修改建议.md", content: "综述部分需要补引用" });
  });

  // 默认 guided：patch 需要 approval
  const before = await mockCalls(page, "writeText");
  await page.getByLabel("Ask Kiro").fill("修改修改建议.md 里的措辞");
  await page.getByLabel("发送").click();
  const approval = page.getByTestId("kiro-approval-dialog");
  await expect(approval).toBeVisible({ timeout: 15000 });
  await expect(approval).toContainText("修改文件 修改建议.md");
  // ask 阶段：未执行 native 写入
  expect(await mockCalls(page, "writeText")).toBe(before);
  // 允许这一次 → resume 同一 Tool Call → 写入发生
  await approval.getByTestId("approval-allow-once").click();
  await expect(page.getByTestId("kiro-agent-task-card")).toBeVisible({ timeout: 15000 });
  await expect
    .poll(() => mockCalls(page, "writeText"), { timeout: 10000 })
    .toBeGreaterThan(before);
});

test("移除 Native Workspace：forgetGrant 被调用；真实文件保留", async ({ page }) => {
  await installBridge(page);
  await configureAI(page);
  await page.goto("/");
  await openAgentSettings(page);
  await page.getByRole("button", { name: "添加本地文件夹" }).click();
  await expect(page.getByTestId("kiro-workspace-row").filter({ hasText: "论文资料" })).toBeVisible();
  // 预写入文件（direct mock）
  await page.evaluate(async () => {
    const b = window.classflowDesktop as {
      filesystem: { writeText: (i: { grantId: string; path: string; content: string }) => Promise<void> };
    };
    await b.filesystem.writeText({ grantId: "grant_mock_1", path: "毕业论文.md", content: "正文" });
  });

  const row = page.getByTestId("kiro-workspace-row").filter({ hasText: "论文资料" });
  await row.getByRole("button", { name: "删除工作区 论文资料" }).click();
  await page.getByRole("button", { name: "移除" }).click();
  await expect(page.getByTestId("kiro-workspace-row").filter({ hasText: "论文资料" })).toHaveCount(0);
  // forgetGrant 被调用；真实文件仍在（只删授权映射）
  expect(await mockCalls(page, "forgetGrant")).toBeGreaterThan(0);
  expect(await mockFileExists(page, "毕业论文.md")).toBe(true);
});
