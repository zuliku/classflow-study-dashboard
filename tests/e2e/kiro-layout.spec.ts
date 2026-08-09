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

  // 离开 Workspace 后 Sidecar 会话仍在（未销毁）
  await page.locator("aside").first().getByRole("button", { name: "总览" }).click();
  await expect(page.getByTestId("kiro-sidecar")).toBeVisible();
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

  // 任务 Drawer → Ask Kiro → Sidecar（assignment entry）
  await page.locator("aside").first().getByRole("button", { name: "任务" }).click();
  await page.locator('[data-testid="assignment-list"] [data-assignment-id="a1"]').click();
  await page.getByRole("button", { name: "Ask Kiro" }).click();

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
  await page.locator("aside").first().getByRole("button", { name: "我的课表" }).click();
  await page.getByRole("button", { name: "Ask Kiro" }).click();
  await expect(page.getByTestId("kiro-sidecar")).toBeVisible();

  // Header 只有品牌 + 操作，不重复 Context（collapsed 摘要不显示具体标签）
  await expect(page.getByTestId("kiro-sidecar-title")).toHaveText("Kiro");
  expect(await page.getByTestId("kiro-sidecar").getByText("时间范围").count()).toBe(0);

  // ContextBar：collapsed 摘要行（aria-expanded=false，短文案）
  const bar = page.getByTestId("kiro-context-bar");
  await expect(bar).toBeVisible();
  const summary = bar.getByRole("button", { expanded: false });
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("项上下文");
  // 点击展开 → chips 出现（entry 标签，语义去重后不重复本周）
  await summary.click();
  await expect(bar.getByRole("button", { name: "收起上下文" })).toBeVisible();
  await expect(bar).toContainText("时间范围 · 第");
  await expect(bar.getByText("时间范围", { exact: true })).toHaveCount(0);
});

test("2xl Docked：Sidecar 为整屏 sticky Panel（高度=viewport，宽 424，Composer 底部留白）", async ({ page }) => {
  await seedAI(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await openSidecarViaHandoff(page);

  const sidecar = page.getByTestId("kiro-sidecar");
  const box = await sidecar.boundingBox();
  expect(box!.height).toBe(900);
  expect(box!.y).toBe(0);
  expect(box!.width).toBe(424);
  // Composer 位于 Panel 底部且带 12px 底部留白（输入框不与 Panel 贴边）
  const composerBox = await page.getByTestId("kiro-composer").boundingBox();
  const inputBox = await page
    .getByTestId("kiro-composer")
    .locator("div.rounded-2xl")
    .first()
    .boundingBox();
  // 输入框底部 = 900 - 12px（pb-3 留白）
  expect(inputBox!.y + inputBox!.height).toBe(888);
  // 左右留白：输入框 inset 12px（+1px panel border-l）
  expect(composerBox!.x - box!.x).toBe(1);
  expect(inputBox!.x - box!.x).toBe(13);
  expect(box!.x + box!.width - (inputBox!.x + inputBox!.width)).toBe(12);
});

test("Header 对齐：全局 Header 与 Sidecar Header border-bottom 同一水平线（md+/xl+/2xl）", async ({ page }) => {
  await seedAI(page);
  for (const width of [1280, 1440, 1536, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await openSidecarViaHandoff(page);

    const globalHeader = page.locator("header").first();
    const sidecarHeader = page.getByTestId("kiro-sidecar").locator("div").first();
    const gBox = await globalHeader.boundingBox();
    const sBox = await sidecarHeader.boundingBox();
    // 统一 60–64px 视觉高度（含 1px border-b）
    expect(gBox!.height).toBeGreaterThanOrEqual(64);
    expect(gBox!.height).toBeLessThanOrEqual(66);
    expect(Math.abs(gBox!.height - sBox!.height)).toBeLessThanOrEqual(1);
    // 关键：border-bottom 同一水平线
    expect(Math.abs(gBox!.y + gBox!.height - (sBox!.y + sBox!.height))).toBeLessThanOrEqual(1);
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
