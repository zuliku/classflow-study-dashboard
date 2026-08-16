import { test as base, expect, Page } from "@playwright/test";

/**
 * Kiro Motion System V1 —— focused choreography E2E。
 * 覆盖跨组件核心：Empty Intro 生命周期 / Contextual Handoff / Thread Rail anchored morph /
 * Project Panel anchored morph / Reduced Motion。
 * 不重测 Proposal Domain（unit/component tests 承担）。
 */

const AI_SETTINGS = {
  enabled: true,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  apiKey: "sk-test",
  custom: { providerName: "", baseURL: "", model: "" },
};

function seedAI(page: Page) {
  return page.addInitScript(
    ({ settings, key }) => {
      localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
      sessionStorage.setItem("classflow-ai-key:deepseek", key);
    },
    { settings: AI_SETTINGS, key: "sk-test-key" }
  );
}

async function openKiro(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-composer")).toBeVisible();
}

async function sendFirstMessage(page: Page) {
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
      ].join("\n"),
    });
  });
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("你好");
  await composer.getByLabel("发送").click();
}

base("Empty Intro 生命周期 + Contextual Handoff（Composer DOM 稳定）", async ({ page }) => {
  await seedAI(page);
  await openKiro(page);

  // Empty 可见（intro classes 已挂载：claim once）
  const empty = page.getByTestId("kiro-empty-experience");
  await expect(empty).toBeVisible();
  const logo = empty.locator('[data-kiro-empty-logo]');
  await expect(logo).toHaveClass(/kiro-empty-logo-intro/);
  const title = empty.locator('[data-kiro-empty-title]');
  await expect(title).toHaveClass(/kiro-empty-title-intro/);
  await expect(empty.locator('[data-kiro-empty-suggestion]').first()).toHaveClass(/kiro-empty-suggestion-intro/);

  const composerBefore = page.getByTestId("kiro-composer");
  await composerBefore.evaluate((el) => {
    (el as HTMLElement & { __composerProbe?: string }).__composerProbe = "same";
  });

  await sendFirstMessage(page);

  // Conversation 立即 mount；Empty 进入 presence exit（aria-hidden + inert + pointer-events-none）
  await expect(page.getByTestId("kiro-conversation")).toBeVisible({ timeout: 8000 });
  await expect(empty).toHaveAttribute("aria-hidden", "true");
  await expect(empty).toHaveAttribute("inert", "");
  await expect(empty).toHaveClass(/pointer-events-none/);

  // exit 后 Empty unmount；Composer DOM identity 保持
  await expect(empty).toHaveCount(0, { timeout: 3000 });
  const composerAfter = page.getByTestId("kiro-composer");
  expect(
    await composerAfter.evaluate((el) => (el as HTMLElement & { __composerProbe?: string }).__composerProbe === "same")
  ).toBe(true);
});

base("Thread Rail anchored morph：同一 shell DOM、width 52↔216/232、聊天不动", async ({ page }) => {
  await seedAI(page);
  await openKiro(page);

  const shell = page.getByTestId("kiro-thread-rail-shell");
  await expect(shell).toBeVisible();
  await shell.evaluate((el) => { (el as HTMLElement & { __motionProbe?: string }).__motionProbe = "same-shell"; });
  const collapsed = await shell.boundingBox();
  expect(collapsed!.width).toBeGreaterThanOrEqual(50);
  expect(collapsed!.width).toBeLessThanOrEqual(56);

  const composer = page.getByTestId("kiro-composer");
  const before = await composer.boundingBox();

  await page.getByLabel("展开对话").click();
  await expect(page.getByRole("dialog", { name: "对话" })).toBeVisible();

  // 同一 shell DOM 节点（anchored morph，非两套 DOM 切换）
  expect(await shell.evaluate((el) => (el as HTMLElement & { __motionProbe?: string }).__motionProbe === "same-shell")).toBe(true);
  await expect(shell).toHaveAttribute("data-state", "expanded");
  // 等待 width morph 完成（spatial ~220ms）
  await expect(async () => {
    const w = (await shell.boundingBox())!.width;
    expect(w).toBeGreaterThanOrEqual(214);
    expect(w).toBeLessThanOrEqual(234);
  }).toPass({ timeout: 3000 });

  // 聊天几何不动（X 与宽度）
  const after = await composer.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(after!.width - before!.width)).toBeLessThanOrEqual(2);

  // 收起 → 同一 shell，回 52
  await page.getByLabel("收起对话").click();
  await expect(shell).toHaveAttribute("data-state", "collapsed");
  await expect(page.getByRole("dialog", { name: "对话" })).toHaveCount(0);
  await expect(async () => {
    const w = (await shell.boundingBox())!.width;
    expect(Math.abs(w - 52)).toBeLessThanOrEqual(2);
  }).toPass({ timeout: 3000 });
  expect(await shell.evaluate((el) => (el as HTMLElement & { __motionProbe?: string }).__motionProbe === "same-shell")).toBe(true);
});

base("Project Panel anchored morph：right edge 不动、聊天不移动（纯悬浮层）", async ({ page }) => {
  await seedAI(page);
  await openKiro(page);

  // 经 Rail 打开 Project Panel（expanded）
  const shell = page.getByTestId("kiro-project-panel-shell");
  await page.getByLabel("打开项目").click();
  await expect(shell).toBeVisible();
  await shell.evaluate((el) => { (el as HTMLElement & { __motionProbe?: string }).__motionProbe = "same-shell"; });
  await expect(shell).toHaveAttribute("data-state", "expanded");
  const rightEdgeBefore = (await (async () => {
    const b = (await shell.boundingBox())!;
    return b.x + b.width;
  })())!;

  // expanded width ≥294；right edge 不动
  await expect(async () => {
    const b = (await shell.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(294);
    expect(Math.abs(b.x + b.width - rightEdgeBefore)).toBeLessThanOrEqual(2);
  }).toPass({ timeout: 3000 });

  // 纯悬浮层：聊天几何不因面板展开而改变
  const composer = page.getByTestId("kiro-composer");
  const before = await composer.boundingBox();
  await page.waitForTimeout(400);
  const after = await composer.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(after!.width - before!.width)).toBeLessThanOrEqual(2);

  // 收起 → 同一 shell，52px
  await page.getByLabel("收起项目").click();
  await expect(shell).toHaveAttribute("data-state", "collapsed");
  await expect(async () => {
    const w = (await shell.boundingBox())!.width;
    expect(Math.abs(w - 52)).toBeLessThanOrEqual(2);
  }).toPass({ timeout: 3000 });
  expect(await shell.evaluate((el) => (el as HTMLElement & { __motionProbe?: string }).__motionProbe === "same-shell")).toBe(true);
});

base("Reduced Motion：Empty 无 intro 动画类、功能可用；Rail 立即最终几何", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedAI(page);
  await openKiro(page);

  // documentElement effective motion = reduced
  const effective = await page.evaluate(() => document.documentElement.dataset.motionEffective);
  expect(effective).toBe("reduced");

  // Empty 最终态：内容立即可见（reduced 下 animation 关闭，无 opacity 起始隐藏）
  const empty = page.getByTestId("kiro-empty-experience");
  await expect(empty).toBeVisible();
  await expect(empty.locator('[data-kiro-empty-title]')).toBeVisible();
  const titleAnimation = await empty
    .locator('[data-kiro-empty-title]')
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(titleAnimation).toBe("none");

  // Rail 立即最终几何（expanded 后马上到位）
  const shell = page.getByTestId("kiro-thread-rail-shell");
  await page.getByLabel("展开对话").click();
  await expect(page.getByRole("dialog", { name: "对话" })).toBeVisible();
  const box = await shell.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(214);

  // Send 可用（输入后 ready）
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("你好");
  await expect(page.getByLabel("发送")).toBeEnabled();
});
