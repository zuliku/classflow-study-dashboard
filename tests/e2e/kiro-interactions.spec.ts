import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Kiro 交互完善（Share / More / Message Actions / Scroll-to-bottom / 清空确认）+ Dashboard reflow。
 */

const AI_SETTINGS = {
  enabled: true,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  custom: { providerName: "", baseURL: "", model: "" },
};

function sse(body: string): string {
  return body
    .split("\n")
    .filter(Boolean)
    .map((line) => `data: ${line}`)
    .join("\n\n") + "\n\n";
}

function chatSSE(content: string): string {
  return sse(
    [
      JSON.stringify({ type: "start", messageId: "mock-1" }),
      JSON.stringify({ type: "start-step" }),
      JSON.stringify({ type: "text-start", id: "t1" }),
      JSON.stringify({ type: "text-delta", id: "t1", delta: content }),
      JSON.stringify({ type: "text-end", id: "t1" }),
      JSON.stringify({ type: "finish-step" }),
      JSON.stringify({ type: "finish", finishReason: "stop" }),
    ].join("\n")
  );
}

async function seedAI(page: Page) {
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
}

async function openWorkspace(page: Page) {
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();
}

async function sendMessage(page: Page, text: string) {
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill(text);
  await composer.getByLabel("发送").click();
}

test("Task 7D：输出字号 - Rail More 与 Settings 实时同步（同一 store）", async ({ page }) => {
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);

  // Rail Collapsed More（对话更多操作）→ 输出字号 segmented（默认 标准）
  await page.getByLabel("对话更多操作").click();
  const railGroup = page.getByRole("group", { name: "Kiro 输出字号" });
  await expect(railGroup).toBeVisible();
  await expect(railGroup.getByRole("button", { name: "标准字号" })).toHaveAttribute("aria-pressed", "true");

  // 选「大」→ 菜单不关闭（可连续比较）
  await railGroup.getByRole("button", { name: "大字号" }).click();
  await expect(railGroup.getByRole("button", { name: "大字号" })).toHaveAttribute("aria-pressed", "true");
  await expect(railGroup).toBeVisible();

  // Settings → Kiro → 输出字号 = 大（同一 useKiroPreferencesStore）
  await page.locator("aside").first().getByRole("button", { name: "设置" }).click();
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "Kiro" }).click();
  const settingsGroup = page.getByRole("group", { name: "Kiro 输出字号" });
  await expect(settingsGroup).toBeVisible();
  await expect(settingsGroup.getByRole("button", { name: "大", exact: true })).toHaveAttribute("aria-pressed", "true");

  // Settings 选「小」→ 关闭 → 回到 Kiro Rail More → active = 小
  await settingsGroup.getByRole("button", { name: "小", exact: true }).click();
  await expect(settingsGroup.getByRole("button", { name: "小", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("dialog", { name: "设置" }).getByRole("button", { name: "关闭" }).click();

  await page.getByLabel("对话更多操作").click();
  const railGroup2 = page.getByRole("group", { name: "Kiro 输出字号" });
  await expect(railGroup2.getByRole("button", { name: "小字号" })).toHaveAttribute("aria-pressed", "true");
});

test("Share：无消息时 disabled；发消息后可打开并复制对话", async ({ page }) => {
  await page.route("**/api/ai/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: chatSSE("好的，这是回归分析的要点。"),
    });
  });
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);

  // 无消息：Share disabled
  const shareBtn = page.getByLabel("分享对话");
  await expect(shareBtn).toBeDisabled();

  await sendMessage(page, "讲讲回归分析");
  await expect(page.getByTestId("kiro-message").last()).toContainText("回归分析的要点", { timeout: 10000 });
  await expect(shareBtn).toBeEnabled();

  // 打开 Share Sheet → 复制对话 → 剪贴板含可见内容 + Toast
  await shareBtn.click();
  await expect(page.getByText("仅分享当前对话中可见的内容")).toBeVisible();
  await page.getByRole("button", { name: /复制对话/ }).click();
  await expect(page.getByText("已复制").first()).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain("讲讲回归分析");
  expect(clip).toContain("回归分析的要点");
});

test("More Menu：Esc / 点击外部关闭；清空对话需确认", async ({ page }) => {
  await page.route("**/api/ai/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: chatSSE("已收到。"),
    });
  });
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);

  await sendMessage(page, "第一条消息");
  await expect(page.getByTestId("kiro-message").last()).toContainText("已收到", { timeout: 10000 });

  // Esc 关闭
  await page.getByLabel("更多操作", { exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "清空当前对话" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "清空当前对话" })).toHaveCount(0);

  // 点击外部关闭
  await page.getByLabel("更多操作", { exact: true }).click();
  await page.locator("body").click({ position: { x: 10, y: 400 } });
  await expect(page.getByRole("menuitem", { name: "清空当前对话" })).toHaveCount(0);

  // 清空：取消 → 消息保留
  await page.getByLabel("更多操作", { exact: true }).click();
  await page.getByRole("menuitem", { name: "清空当前对话" }).click();
  await expect(page.getByText("清空当前对话？")).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByTestId("kiro-user-message")).toHaveCount(1);

  // 清空：确认 → Empty State
  await page.getByLabel("更多操作", { exact: true }).click();
  await page.getByRole("menuitem", { name: "清空当前对话" }).click();
  await page.getByRole("button", { name: "清空" }).click();
  await expect(page.getByTestId("kiro-empty")).toBeVisible();
  await expect(page.getByTestId("kiro-user-message")).toHaveCount(0);
});

test("Message Actions：最后一条消息可复制 / 重新生成（真实 regenerate）", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/ai/chat", async (route) => {
    requests++;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: chatSSE(requests === 1 ? "第一版回答。" : "重新生成后的回答。"),
    });
  });
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);

  await sendMessage(page, "解释概念");
  await expect(page.getByTestId("kiro-message").last()).toContainText("第一版回答", { timeout: 10000 });

  const lastMsg = page.getByTestId("kiro-message").last();
  // 复制（hover 显示；直接点击 aria-label）
  await lastMsg.getByLabel("复制").click();
  await expect(page.getByText("已复制").first()).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain("第一版回答");

  // 重新生成：真实第二次请求 → 新回答替换
  await lastMsg.getByLabel("重新生成").click();
  await expect(page.getByTestId("kiro-message").last()).toContainText("重新生成后的回答", { timeout: 10000 });
  expect(requests).toBe(2);

  // 消息级 More：复制文本 / 复制 Markdown
  await page.getByTestId("kiro-message").last().getByLabel("消息更多操作").click();
  await expect(page.getByRole("menuitem", { name: "复制文本" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "复制 Markdown" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("User Message：hover 可复制", async ({ page }) => {
  await page.route("**/api/ai/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: chatSSE("收到。"),
    });
  });
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);

  await sendMessage(page, "用户可见文本 123");
  await expect(page.getByTestId("kiro-message").last()).toContainText("收到", { timeout: 10000 });

  await page.getByTestId("kiro-user-message").getByLabel("复制").click();
  await expect(page.getByText("已复制").first()).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe("用户可见文本 123");
});

test("Scroll-to-bottom：上滑显示，点击回底后隐藏", async ({ page }) => {
  const longReply = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 段：这是一段较长的学习说明文本，用于撑起滚动高度。`).join("\n\n");
  await page.route("**/api/ai/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: chatSSE(longReply),
    });
  });
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);

  await sendMessage(page, "给我详细说明");
  await expect(page.getByTestId("kiro-message").last()).toContainText("第 60 段", { timeout: 10000 });
  // 等待流式完全结束（assistant 操作行出现 = 非 streaming）
  await expect(page.getByTestId("kiro-message").last().getByLabel("重新生成")).toBeVisible({ timeout: 10000 });

  // 上滑离开底部（真实滚轮事件）→ 按钮出现
  const conversation = page.getByTestId("kiro-conversation");
  await conversation.hover();
  await page.mouse.wheel(0, -10000);
  const btn = page.getByLabel("回到底部");
  await expect(btn).toBeVisible({ timeout: 5000 });

  // 点击 → smooth 回到底部 → 按钮隐藏
  await btn.click();
  await expect(btn).toHaveCount(0);
  await expect
    .poll(async () =>
      conversation.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 10)
    )
    .toBe(true);
});

test("Dashboard reflow：Docked Kiro 压窄容器时任务卡降为 1 列且不重叠；关闭后恢复", async ({ page }) => {
  await seedAI(page);
  // 1536：sidebar 224 + sidecar 424 → 主内容 < 940 → 1 列
  await page.setViewportSize({ width: 1536, height: 900 });
  await page.goto("/");

  // 关闭 Kiro 状态：2 列
  const tasksWrap = page.getByTestId("overview-tasks-wrap");
  let w1 = (await tasksWrap.boundingBox())!.width;
  expect(w1).toBeGreaterThan(560); // 2 列（~600）

  // 打开 Docked Kiro（handoff）
  await page.keyboard.press("Control+K");
  await page.getByLabel("命令中心搜索").fill("看看本周安排");
  await page.getByLabel("命令中心搜索").press("Enter");
  await expect(page.getByTestId("kiro-sidecar")).toBeVisible();

  // 降为 1 列
  await expect(async () => {
    const w2 = (await tasksWrap.boundingBox())!.width;
    expect(w2).toBeGreaterThan(780);
  }).toPass({ timeout: 5000 });

  // 任务行与 Footer 不重叠：footer 顶部 ≥ 最后一行底部
  const footer = page.getByTestId("assignment-footer");
  const lastRow = page.locator('[data-testid="assignment-list"] > div').last();
  const fBox = await footer.boundingBox();
  const rBox = await lastRow.boundingBox();
  expect(fBox!.y).toBeGreaterThanOrEqual(rBox!.y + rBox!.height - 1);

  // 页面无横向溢出
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);

  // 关闭 Kiro → 布局恢复 2 列（无需刷新）
  await page.getByLabel("关闭 Kiro").click();
  await expect(page.getByTestId("kiro-sidecar")).toHaveCount(0);
  const w3 = (await tasksWrap.boundingBox())!.width;
  expect(w3).toBeGreaterThan(560);
  expect(Math.abs(w3 - w1)).toBeLessThanOrEqual(2);
});

test("1920：Docked Kiro 下任务卡保持 2 列", async ({ page }) => {
  await seedAI(page);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto("/");
  await page.keyboard.press("Control+K");
  await page.getByLabel("命令中心搜索").fill("看看本周安排");
  await page.getByLabel("命令中心搜索").press("Enter");
  await expect(page.getByTestId("kiro-sidecar")).toBeVisible();

  const tasksWrap = page.getByTestId("overview-tasks-wrap");
  const w = (await tasksWrap.boundingBox())!.width;
  expect(w).toBeGreaterThan(500);
  expect(w).toBeLessThan(800); // 2 列（每列 ~590）
});
