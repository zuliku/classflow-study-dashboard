import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Kiro Workspace / Sidecar 布局与响应式（Task 5.5）：
 * 1. 互斥：activeTab=kiro 时不渲染 Sidecar；从 Sidecar 展开进入 Workspace 正确
 * 2. 建议互斥：Entry Context 建议显示时，EmptyState 通用建议隐藏
 * 3. Sidecar ContextBar 默认 collapsed（compact），点击展开 chips
 * 4. 2xl Docked：整屏 sticky Panel（height = viewport），Composer 固定底部
 * 5. Header 不重复展示 Context chip（Context 只在 ContextBar）
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

async function seedAI(page: Page) {
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
}

async function openSidecarViaHandoff(page: Page) {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByLabel("命令中心搜索").fill("看看本周安排");
  await page.getByLabel("命令中心搜索").press("Enter");
  await expect(page.getByTestId("kiro-sidecar")).toBeVisible();
}

test("互斥：进入 Kiro Workspace 后 Sidecar 不再渲染（会话保留）", async ({ page }) => {
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await openSidecarViaHandoff(page);

  // 进入 Kiro Workspace（导航）
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();
  // 互斥：同一时刻只有一套 ChatSurface
  await expect(page.getByTestId("kiro-sidecar")).toHaveCount(0);
  expect(await page.getByTestId("kiro-composer").count()).toBe(1);

  // 离开 Workspace 后不会复现隐形 Sidecar；会话数据仍由 Provider 保留。
  await page.locator("aside").first().getByRole("button", { name: "总览" }).click();
  await expect(page.getByTestId("kiro-sidecar")).toHaveCount(0);
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-user-message")).toContainText("看看本周安排");
});

test("expandSidecar：关闭 Sidecar 进入 Workspace，同一会话保留", async ({ page }) => {
  await page.route("**/api/ai/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse(
        [
          JSON.stringify({ type: "start", messageId: "mock-1" }),
          JSON.stringify({ type: "start-step" }),
          JSON.stringify({ type: "text-start", id: "t1" }),
          JSON.stringify({ type: "text-delta", id: "t1", delta: "好的，本周安排已梳理。" }),
          JSON.stringify({ type: "text-end", id: "t1" }),
          JSON.stringify({ type: "finish-step" }),
          JSON.stringify({ type: "finish", finishReason: "stop" }),
        ].join("\n")
      ),
    });
  });
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await openSidecarViaHandoff(page);

  // Sidecar 中先发一条消息
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("帮我梳理本周");
  await composer.getByLabel("发送").click();
  await expect(page.getByTestId("kiro-message").last()).toContainText("本周安排已梳理", { timeout: 10000 });

  // Expand：Sidecar 关闭 → Workspace 显示同一会话
  await page.getByLabel("展开到 Kiro 工作区").click();
  await expect(page.getByTestId("kiro-sidecar")).toHaveCount(0);
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();
  await expect(page.getByTestId("kiro-user-message").last()).toContainText("帮我梳理本周");
});

test("建议互斥：Assignment Entry 时只显示 Context-aware 建议，EmptyState 通用建议隐藏", async ({ page }) => {
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  // 任务 Drawer → More 菜单 Ask Kiro → Sidecar（assignment entry）
  await page.locator("aside").first().getByRole("button", { name: "任务" }).click();
  await page.locator('[data-testid="assignment-list"] [data-assignment-id="a1"]').click();
  await page.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "Ask Kiro" }).click();

  const sidecar = page.getByTestId("kiro-sidecar");
  await expect(sidecar).toBeVisible();
  // 建议区作为 EmptyState 主操作区（标题下方）
  const suggestions = page.getByTestId("kiro-context-suggestions");
  await expect(suggestions).toBeVisible();
  await expect(suggestions).toContainText("拆分这个任务");
  // 通用建议不同时出现（EmptyState 内只有 Context-aware 按钮）
  const empty = page.getByTestId("kiro-empty");
  await expect(empty).toContainText("拆分这个任务");
  await expect(empty).not.toContainText("帮我规划今天");
  await expect(empty.getByText("帮我规划今天", { exact: true })).toHaveCount(0);
});

test("Sidecar ContextBar 默认 collapsed；点击展开 chips；Header 不重复 Context", async ({ page }) => {
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  // Timetable Ask Kiro → week entry → sidecar
  await page.locator("aside").first().getByRole("button", { name: "时间表" }).click();
  await page.getByRole("button", { name: "Ask Kiro" }).click();
  await expect(page.getByTestId("kiro-sidecar")).toBeVisible();

  // Header 只有品牌 + 操作，不重复 Context（Context 在 Strip 展示，不在 Header）
  await expect(page.getByTestId("kiro-sidecar-title")).toHaveText("Kiro");
  expect(await page.getByTestId("kiro-sidecar").getByText("时间范围").count()).toBe(0);

  // Task 7E：Context Strip 直接展示 Ambient Capsule（本周 · 第 N 周），无展开/收起交互
  const bar = page.getByTestId("kiro-context-bar");
  await expect(bar).toBeVisible();
  await expect(bar.getByText("本周 · 第")).toBeVisible();
  await expect(bar.getByRole("button", { expanded: false })).toHaveCount(0);
  await expect(bar.getByRole("button", { name: "收起上下文" })).toHaveCount(0);
});

test("2xl：Sidecar 保持 floating（默认 620×760 · top 24 · 无 docked 覆盖）", async ({ page }) => {
  await seedAI(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "总览" }).first()).toBeVisible({ timeout: 15000 });
  await openSidecarViaHandoff(page);

  const sidecar = page.getByTestId("kiro-sidecar");
  await expect
    .poll(async () =>
      sidecar.evaluate((el) => {
        const t = getComputedStyle(el).transform;
        return t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)";
      })
    )
    .toBe(true);
  const box = (await sidecar.boundingBox())!;
  // 2xl 无 docked 变体：仍是 floating 默认尺寸 + 右上 inset
  expect(box.height).toBe(760);
  expect(box.width).toBe(620);
  expect(box.y).toBe(24);
  // Composer 可用
  await expect(page.getByTestId("kiro-composer")).toBeVisible();
});

test("Sidecar Header：与全局 Header 高度一致（64px）；浮层 top-24（非 docked 0）", async ({ page }) => {
  await seedAI(page);
  for (const width of [1280, 1440, 1536, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "总览" }).first()).toBeVisible({ timeout: 15000 });
    await openSidecarViaHandoff(page);

    const globalHeader = page.locator("header").first();
    const sidecarHeader = page.getByTestId("kiro-sidecar-header");
    const sidecar = page.getByTestId("kiro-sidecar");
    await expect
      .poll(async () =>
        sidecar.evaluate((el) => {
          const t = getComputedStyle(el).transform;
          return t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)";
        })
      )
      .toBe(true);
    const gBox = await globalHeader.boundingBox();
    const sBox = await sidecarHeader.boundingBox();
    // 统一 64px 视觉高度（含 1px border-b）
    expect(gBox!.height).toBeGreaterThanOrEqual(64);
    expect(gBox!.height).toBeLessThanOrEqual(66);
    expect(Math.abs(gBox!.height - sBox!.height)).toBeLessThanOrEqual(1);
    // Floating 语义：面板从 top-24 开始（header 与全局 header 的 border 有意错位，不再 docked 对齐）
    const sBox2 = (await sidecar.boundingBox())!;
    expect(sBox2.y).toBe(24);
  }
});

test("响应式：768–1279 Sheet / 1280–1535 Overlay 不横向溢出", async ({ page }) => {
  await seedAI(page);
  for (const width of [1024, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await openSidecarViaHandoff(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
    await expect(page.getByTestId("kiro-composer")).toBeVisible();
  }
});

test("Move V1 smoke：hover 显示把手 → 拖拽移动 → close/reopen 位置保持", async ({ page }) => {
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  // 等 App hydrate（nav 渲染）后再按 Control+K，避免全局快捷键竞态
  await expect(page.getByRole("button", { name: "总览" }).first()).toBeVisible({ timeout: 15000 });
  await openSidecarViaHandoff(page);

  const sidecar = page.getByTestId("kiro-sidecar");
  const handle = page.getByTestId("kiro-sidecar-move-handle");
  await expect(handle).toBeVisible();

  // hover 顶部中央 → pill 淡入（opacity 1）
  await handle.hover();
  await expect
    .poll(async () =>
      handle.evaluate((el) => getComputedStyle(el.querySelector("div")!).opacity)
    )
    .toBe("1");

  // 拖拽：从右上向左下移动（right/top 变化 → boundingBox 移动）
  const before = (await sidecar.boundingBox())!;
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 300, hb.y + hb.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await sidecar.boundingBox())!.x).toBeLessThan(before.x - 200);
  const moved = (await sidecar.boundingBox())!;

  // close → reopen：位置保持（不 reset）
  await page.keyboard.press("Escape");
  await expect(sidecar).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByRole("button", { name: "总览" }).first()).toBeVisible({ timeout: 15000 });
  await openSidecarViaHandoff(page);
  // 等 enter motion settle 后再测量（presence transform 未结束时 boundingBox 会偏移）
  await expect
    .poll(async () =>
      sidecar.evaluate((el) => {
        const t = getComputedStyle(el).transform;
        return t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)";
      })
    )
    .toBe(true);
  await expect.poll(async () => (await sidecar.boundingBox())!.x).toBeLessThan(before.x - 200);
  const reopened = (await sidecar.boundingBox())!;
  expect(Math.abs(reopened.x - moved.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(reopened.y - moved.y)).toBeLessThanOrEqual(2);
});
