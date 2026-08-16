import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";
import { installMemoryDesktopBridgeMock } from "../helpers/memoryDesktopBridge";

/**
 * Kiro Desktop Terminal V1 — E2E（memory bridge；不运行真实命令）。
 * - Settings：桌面 Terminal toggle 仅 Desktop 显示；开启需确认
 * - Workspace Auto：普通命令自动执行；Remove-Item → approval → allow-once 才执行
 * - Guided：git status → approval（PowerShell/工作目录/命令可见；只有 取消/运行这一次）
 * - Stop：pending terminal 执行 → Stop → bridge.cancel 一次
 * - delete_file：Workspace Auto 也要求确认
 * - Composer Workspace Auto 红色警示（danger token）
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

async function setupDesktop(page: Page) {
  await page.addInitScript(({ src }) => {
    (0, eval)(src);
  }, { src: `(${installMemoryDesktopBridgeMock.toString()})()` });
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

/** 授权 Native 文件夹 + 开启终端 */
async function authorizeFolderAndEnableTerminal(page: Page) {
  await openAgentSettings(page);
  await page.getByRole("button", { name: "添加本地文件夹" }).click();
  await expect(page.getByTestId("kiro-workspace-row").filter({ hasText: "论文资料" })).toBeVisible();
  // 终端开关（仅桌面显示）+ 确认
  const terminalToggle = page.getByTestId("settings-kiro-agent").getByRole("switch", { name: "允许 Kiro 使用终端" });
  await expect(terminalToggle).toBeVisible();
  await terminalToggle.click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByTestId("settings-kiro-agent")).toContainText("允许 Kiro 使用终端");
}

async function openKiro(page: Page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-composer")).toBeVisible();
}

function ctlOp(page: Page, op: string) {
  return page.evaluate(
    (o) =>
      (window as unknown as { __desktopBridgeControl: { opCount: (op: string) => number } })
        .__desktopBridgeControl.opCount(o),
    op
  );
}

function ctlValue(page: Page, key: string) {
  return page.evaluate(
    (k) =>
      (window as unknown as { __desktopBridgeControl: Record<string, unknown> })
        .__desktopBridgeControl[k],
    key
  );
}

/** control 上的函数型 getter（evaluate 内调用并返回结果；函数无法跨边界序列化） */
function ctlCall(page: Page, fnName: string) {
  return page.evaluate(
    (n) => {
      const c = (window as unknown as { __desktopBridgeControl: Record<string, unknown> }).__desktopBridgeControl;
      return (c[n] as () => unknown)();
    },
    fnName
  );
}

test("Web（无 Bridge）：Settings 不出现终端开关/终端组；桌面版可访问等数据状态也不出现", async ({ page }) => {
  await page.goto("/");
  await openAgentSettings(page);
  await expect(page.getByTestId("settings-kiro-agent").getByRole("switch", { name: "允许 Kiro 使用终端" })).toHaveCount(0);
  const text = await page.getByTestId("settings-kiro-agent").innerText();
  // 无桌面专用 surface（模式描述按 Part 30 提及「普通终端命令」属全局文案，不算 surface）
  expect(text).not.toContain("仅桌面版可访问");
  expect(text).not.toContain("允许 Kiro 使用终端");
});

test("Workspace Auto：npm test 自动执行；Remove-Item 需确认后才执行", async ({ page }) => {
  await setupDesktop(page);
  const seq: string[] = [];
  await page.route("**/api/ai/chat", async (route) => {
    const n = seq.length + 1;
    seq.push(`req${n}`);
    if (n === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("msg-t", "call_term_1", "run_terminal_command", { shell: "powershell", cwd: "", command: "npm test", timeoutMs: 30000 }),
      });
      return;
    }
    if (n === 2) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("msg-t", "call_term_2", "run_terminal_command", { shell: "powershell", cwd: "", command: "Remove-Item temp.txt" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: answerStream("msg-t", "已运行 npm test 并处理删除。"),
    });
  });

  await page.goto("/");
  await authorizeFolderAndEnableTerminal(page);
  await openKiro(page);
  // Workspace Auto
  const modeMenu = page.getByRole("button", { name: "权限模式" });
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /工作区自动/ }).first().click();

  const before = await ctlOp(page, "terminalExecute");
  await page.getByLabel("Ask Kiro").fill("运行 npm test，然后删除 temp.txt");
  await page.getByLabel("发送").click();

  // npm test：workspace-auto 普通命令自动执行
  await page.waitForTimeout(1500);
  expect(await ctlOp(page, "terminalExecute")).toBe(before + 1);
  const last = (await ctlCall(page, "lastTerminalInput")) as unknown as { command: string } | null;
  expect(last?.command).toBe("npm test");

  // Remove-Item：destructive → approval dialog
  const approval = page.getByTestId("kiro-approval-dialog");
  await expect(approval).toBeVisible({ timeout: 15000 });
  await expect(approval).toContainText("Kiro 想运行终端命令");
  await expect(approval).toContainText("Remove-Item temp.txt");
  await expect(approval).toContainText("可能删除或不可逆修改");
  // ask 阶段：没有第二次 execute
  expect(await ctlOp(page, "terminalExecute")).toBe(before + 1);
  // 运行这一次 → execute +1
  await approval.getByTestId("approval-allow-once").click();
  await expect
    .poll(() => ctlOp(page, "terminalExecute"), { timeout: 10000 })
    .toBe(before + 2);
  const last2 = (await ctlCall(page, "lastTerminalInput")) as unknown as { command: string } | null;
  expect(last2?.command).toBe("Remove-Item temp.txt");
});

test("Guided：git status → approval 显示 shell/工作目录/命令；只有 取消/运行这一次", async ({ page }) => {
  await setupDesktop(page);
  const seq: string[] = [];
  await page.route("**/api/ai/chat", async (route) => {
    const n = seq.length + 1;
    seq.push(`req${n}`);
    if (n === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("msg-g", "call_term_g", "run_terminal_command", { shell: "powershell", cwd: "", command: "git status" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: answerStream("msg-g", "已查看 git status。"),
    });
  });

  await page.goto("/");
  await authorizeFolderAndEnableTerminal(page);
  await openKiro(page);
  // 默认 Guided
  const before = await ctlOp(page, "terminalExecute");
  await page.getByLabel("Ask Kiro").fill("看看 git 状态");
  await page.getByLabel("发送").click();

  const approval = page.getByTestId("kiro-approval-dialog");
  await expect(approval).toBeVisible({ timeout: 15000 });
  await expect(approval).toContainText("Kiro 想运行终端命令");
  await expect(approval).toContainText("PowerShell");
  await expect(approval).toContainText("工作目录 /");
  await expect(approval).toContainText("git status");
  expect(await ctlOp(page, "terminalExecute")).toBe(before);
  // 只有 deny + allow-once（无 允许本次会话 / 始终允许）
  await expect(approval.getByTestId("approval-allow-once")).toBeVisible();
  await expect(approval.getByTestId("approval-deny")).toBeVisible();
  await expect(approval.getByTestId("approval-allow-session")).toHaveCount(0);
  await expect(approval.getByTestId("approval-allow-workspace")).toHaveCount(0);
  await approval.getByTestId("approval-allow-once").click();
  await expect
    .poll(() => ctlOp(page, "terminalExecute"), { timeout: 10000 })
    .toBe(before + 1);
});

test("Stop：pending terminal 执行 → Stop → bridge.cancel 恰好一次；不继续完成", async ({ page }) => {
  await setupDesktop(page);
  await page.route("**/api/ai/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: toolCallStream("msg-s", "call_term_s", "run_terminal_command", { shell: "powershell", cwd: "", command: "npm install" }),
    });
  });

  await page.goto("/");
  await authorizeFolderAndEnableTerminal(page);
  await openKiro(page);
  const modeMenu = page.getByRole("button", { name: "权限模式" });
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /工作区自动/ }).first().click();
  // hold 下一次 execute（pending）
  await page.evaluate(() => {
    ((window as unknown as { __desktopBridgeControl: { holdNextTerminal: { value: boolean } } }).__desktopBridgeControl.holdNextTerminal.value = true);
  });
  await page.getByLabel("Ask Kiro").fill("运行 npm install");
  await page.getByLabel("发送").click();
  // pending 执行中
  await expect
    .poll(() => ctlValue(page, "pendingTerminal").then((p) => (p as { isPending: boolean }).isPending), { timeout: 10000 })
    .toBe(true);
  const last = (await ctlCall(page, "lastTerminalInput")) as unknown as { command: string } | null;
  expect(last?.command).toBe("npm install");
  // Stop Kiro
  await page.getByRole("button", { name: "停止生成" }).click();
  await expect
    .poll(() => ctlOp(page, "terminalCancel"), { timeout: 10000 })
    .toBe(1);
  // pending 不再挂起（cancel 已 resolve）
  expect(await ctlValue(page, "pendingTerminal").then((p) => (p as { isPending: boolean }).isPending)).toBe(false);
});

test("Workspace Auto：delete_file 也要求确认（允许后删除）", async ({ page }) => {
  await setupDesktop(page);
  const seq: string[] = [];
  await page.route("**/api/ai/chat", async (route) => {
    const n = seq.length + 1;
    seq.push(`req${n}`);
    if (n === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallStream("msg-d", "call_del", "delete_file", { path: "旧报告.md" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: answerStream("msg-d", "已删除旧报告.md。"),
    });
  });

  await page.goto("/");
  await authorizeFolderAndEnableTerminal(page);
  // 预写入待删文件（direct mock）
  await page.evaluate(async () => {
    const b = window.classflowDesktop as unknown as {
      filesystem: { writeText: (i: { grantId: string; path: string; content: string }) => Promise<void> };
    };
    await b.filesystem.writeText({ grantId: "grant_mock_1", path: "旧报告.md", content: "old" });
  });
  await openKiro(page);
  const modeMenu = page.getByRole("button", { name: "权限模式" });
  await modeMenu.click();
  await page.getByRole("menuitem", { name: /工作区自动/ }).first().click();

  await page.getByLabel("Ask Kiro").fill("删除旧报告.md");
  await page.getByLabel("发送").click();
  const approval = page.getByTestId("kiro-approval-dialog");
  await expect(approval).toBeVisible({ timeout: 15000 });
  await expect(approval).toContainText("删除文件 旧报告.md");
  await approval.getByTestId("approval-allow-once").click();
  // 删除真正发生（mock filesystem 中文件消失）
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const c = (window as unknown as { __desktopBridgeControl: { fileExists: (g: string, p: string) => boolean } }).__desktopBridgeControl;
          return c.fileExists("grant_mock_1", "旧报告.md");
        }),
      { timeout: 10000 }
    )
    .toBe(false);
});

test("Composer：Workspace Auto 模式 icon/text 使用 danger token（切换立即生效）", async ({ page }) => {
  await setupDesktop(page);
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-composer")).toBeVisible();
  // 开启 Computer（无 workspace → 自动创建内置 sandbox；权限模式菜单出现）
  const computerToggle = page.getByRole("button", { name: "Computer" });
  await computerToggle.click();
  await expect(computerToggle).toHaveAttribute("aria-pressed", "true");
  const modeButton = page.getByRole("button", { name: "权限模式" });
  await expect(modeButton).toBeVisible();
  // 默认 Guided：非红
  expect(await modeButton.getAttribute("data-mode-danger")).toBeNull();
  // 切到 Workspace Auto：红
  await modeButton.click();
  await page.getByRole("menuitem", { name: /工作区自动/ }).first().click();
  await expect(modeButton).toHaveAttribute("data-mode-danger", "1");
  const color = await modeButton.evaluate((el) => getComputedStyle(el).color);
  // 使用 semantic danger token（非黑色默认色）
  expect(color).not.toBe("rgb(51, 51, 51)");
  // 切回 Guided：立即恢复
  await modeButton.click();
  await page.getByRole("menuitem", { name: /受控/ }).first().click();
  expect(await modeButton.getAttribute("data-mode-danger")).toBeNull();
});
