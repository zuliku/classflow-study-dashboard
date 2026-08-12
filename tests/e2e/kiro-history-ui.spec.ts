import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Thread Rail / Logo UI 验证（测试简化）：
 * 1. Thread Rail：collapsed 52px → expanded overlay（对话宽度不变 → 无跳动）→ Esc 收起
 * 2. Thread Header 无重复品牌（标题替换 Logo/Kiro/AI Workspace）；Empty State 40px Logo
 * 3. Sidebar Kiro Featured 无左侧黑线（active 用 pastel-mint + 静态 ring）
 */

const AI_SETTINGS = {
  enabled: true,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  custom: { providerName: "", baseURL: "", model: "" },
};

test("Thread Rail：collapsed → expanded overlay（聊天宽度不变）→ Esc 收起", async ({ page }) => {
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();

  // Collapsed Rail：52px 浮动条（含 Kiro Logo 唯一品牌点）
  const rail = page.getByTestId("kiro-thread-rail");
  await expect(rail).toBeVisible();
  const collapsedBox = await rail.boundingBox();
  expect(collapsedBox!.width).toBeGreaterThanOrEqual(50);
  expect(collapsedBox!.width).toBeLessThanOrEqual(56);
  await expect(rail.locator('img[src="/kiro/kiro-mark.png"]')).toBeVisible();

  // 展开前记录 Composer 宽度（中心聊天区位置）
  const composer = page.getByTestId("kiro-composer");
  const beforeBox = await composer.boundingBox();

  // 展开：Overlay dialog
  await page.getByLabel("展开对话").click();
  const dialog = page.getByRole("dialog", { name: "对话" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("暂无历史对话")).toBeVisible();

  // 关键：展开不重排聊天宽度（无左右跳动）
  const afterBox = await composer.boundingBox();
  expect(Math.abs(afterBox!.x - beforeBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(afterBox!.width - beforeBox!.width)).toBeLessThanOrEqual(1);

  // Esc 收起
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(rail).toBeVisible();
});

test("Thread Header：不再显示 Kiro Logo / 名称 / AI Workspace；标题 = 当前对话", async ({ page }) => {
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();

  // Header 只剩标题（新对话）+ 操作；无 Logo / AI Workspace badge
  await expect(page.getByTestId("kiro-header-title")).toHaveText("新对话");
  const headerRow = page.getByTestId("kiro-header-title").locator("..");
  await expect(headerRow.locator('img[src="/kiro/kiro-mark.png"]')).toHaveCount(0);
  await expect(page.getByText("AI Workspace")).toHaveCount(0);

  // 发送消息后标题 = 第一条消息（auto title）
  await page.route("**/api/ai/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        JSON.stringify({ type: "start", messageId: "m1" }),
        JSON.stringify({ type: "start-step" }),
        JSON.stringify({ type: "text-start", id: "t1" }),
        JSON.stringify({ type: "text-delta", id: "t1", delta: "好的。" }),
        JSON.stringify({ type: "text-end", id: "t1" }),
        JSON.stringify({ type: "finish-step" }),
        JSON.stringify({ type: "finish", finishReason: "stop" }),
      ]
        .map((l) => `data: ${l}`)
        .join("\n\n") + "\n\n",
    });
  });
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("查看明天课程");
  await composer.getByLabel("发送").click();
  await expect(page.getByTestId("kiro-message").last()).toContainText("好的", { timeout: 10000 });
  await expect(page.getByTestId("kiro-header-title")).toHaveText("查看明天课程");

  // Empty State 大号 Logo（40px）
  await page.getByLabel("新对话").click();
  const emptyMark = page.getByTestId("kiro-empty").locator('img[src="/kiro/kiro-mark.png"]');
  const eBox = await emptyMark.boundingBox();
  expect(eBox!.width).toBeCloseTo(40, 0);
});

test("Rail 溢出检查：展开后不超 viewport、无横向溢出（1024/1280/1536/1920）", async ({ page }) => {
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  for (const width of [1024, 1280, 1536, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
    await page.getByLabel("展开对话").click();
    const dialog = page.getByRole("dialog", { name: "对话" });
    await expect(dialog).toBeVisible();
    const dBox = await dialog.boundingBox();
    // Rail 在 viewport 内（右缘 / 底部不超）
    expect(dBox!.x).toBeGreaterThanOrEqual(0);
    expect(dBox!.x + dBox!.width).toBeLessThanOrEqual(width);
    expect(dBox!.y).toBeGreaterThanOrEqual(0);
    expect(dBox!.y + dBox!.height).toBeLessThanOrEqual(900);
    // 页面无横向溢出
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
    // Composer 可见且未被遮挡
    await expect(page.getByTestId("kiro-composer")).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("Sidebar Kiro Active：无左侧黑线（active = 浅 Soft Plate + 常驻流光）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();

  const kiroBtn = page.locator("aside").first().getByRole("button", { name: "Kiro" });
  await expect(kiroBtn).toHaveAttribute("aria-current", "page");
  // 无黑色左侧指示条（rounded-full + bg-charcoal 组合只属于旧 indicator）
  await expect(kiroBtn.locator("span.rounded-full.bg-charcoal")).toHaveCount(0);
  // active：极浅 Soft Plate 内容层（bg-surface，不压 Logo 原色）
  const content = kiroBtn.locator("span.relative");
  await expect(content).toHaveCSS("background-color", "rgb(244, 242, 239)"); // surface
  // 流光常驻：动画环始终可见且足够强（idle 0.8 → active 1）
  const ring = kiroBtn.locator(".kiro-featured-flow");
  await expect(ring).toBeVisible();
  await expect
    .poll(() => ring.evaluate((el) => parseFloat(getComputedStyle(el).opacity)))
    .toBeGreaterThan(0.7);

  // 普通导航保留左侧黑线
  const overviewBtn = page.locator("aside").first().getByRole("button", { name: "总览" });
  await overviewBtn.click();
  await expect(overviewBtn.locator("span.rounded-full.bg-charcoal")).toHaveCount(1);
});
