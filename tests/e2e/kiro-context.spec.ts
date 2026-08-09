import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Kiro 全站入口 E2E（Task 5）：
 * 1. Assignment Drawer「Ask Kiro」→ 关闭 Drawer → Sidecar（entry context + 建议 + 发送带 entry ref）
 * 2. Command Center「交给 Kiro」→ handoffPrompt → Sidecar 自动发送
 * 3. Expand 保留同一会话 → 新对话清空
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
      JSON.stringify({ type: "start", messageId: "mock-msg-1" }),
      JSON.stringify({ type: "start-step" }),
      JSON.stringify({ type: "text-start", id: "mock-text" }),
      JSON.stringify({ type: "text-delta", id: "mock-text", delta: content }),
      JSON.stringify({ type: "text-end", id: "mock-text" }),
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
}

test("Assignment Drawer → Ask Kiro：关闭 Drawer、打开 Sidecar（entry context + 建议），发送时携带 entry ref", async ({ page }) => {
  let lastContextRefs: { kind: string; id?: string; label: string }[] = [];
  await page.route("**/api/ai/chat", async (route) => {
    const body = route.request().postDataJSON() as { contextRefs?: { kind: string; id?: string; label: string }[] };
    lastContextRefs = body?.contextRefs ?? [];
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: chatSSE("这个任务的重点是回归分析。"),
    });
  });
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  // 进入任务页 → 打开任务 Drawer（demo a1 = 计量经济学大作业）
  await page.locator("aside").first().getByRole("button", { name: "任务" }).click();
  const row = page.locator('[data-testid="assignment-list"] [data-assignment-id="a1"]');
  await row.click();
  await expect(page.getByRole("button", { name: "Ask Kiro" })).toBeVisible();
  await expect(page.getByText("计量经济学大作业").first()).toBeVisible();

  // Ask Kiro：Drawer 关闭 + Sidecar 打开 + ContextBar collapsed 摘要（Header 不再重复 chip）
  await page.getByRole("button", { name: "Ask Kiro" }).click();
  await expect(page.getByRole("button", { name: "Ask Kiro" })).toHaveCount(0);
  const sidecar = page.getByTestId("kiro-sidecar");
  await expect(sidecar).toBeVisible();
  const bar = page.getByTestId("kiro-context-bar");
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { expanded: false })).toContainText("使用");
  // 展开 chips 可见 entry 标签
  await bar.getByRole("button", { expanded: false }).click();
  await expect(bar).toContainText("计量经济学大作业");

  // Entry 建议出现（assignment kind）
  const suggestions = page.getByTestId("kiro-context-suggestions");
  await expect(suggestions).toBeVisible();
  await expect(suggestions).toContainText("拆分这个任务");

  // 发送 → 请求携带 entry ref；回复渲染；建议隐藏（最后一轮已回应）
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("这个任务的重点是什么？");
  await composer.getByLabel("发送").click();
  await expect(page.getByTestId("kiro-message").last()).toContainText("回归分析", { timeout: 10000 });
  expect(lastContextRefs.some((r) => r.kind === "assignment" && r.label.includes("计量经济学大作业"))).toBe(true);
  await expect(suggestions).toHaveCount(0);
});

test("Command Center：输入查询 → 「交给 Kiro」→ 回车 → Sidecar 自动发送查询", async ({ page }) => {
  let lastBody = "";
  await page.route("**/api/ai/chat", async (route) => {
    lastBody = JSON.stringify(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: chatSSE("好的，我来帮你梳理这门课。"),
    });
  });
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  // Cmd/Ctrl+K 打开 Command Center
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await expect(page.getByTestId("command-center")).toBeVisible();

  // 输入查询 → 「交给 Kiro」row 出现（置顶、键盘可选）
  const input = page.getByLabel("命令中心搜索");
  await input.fill("帮我复习计量经济学");
  const handoffRow = page.getByRole("button", { name: /交给 Kiro/ });
  await expect(handoffRow).toBeVisible();

  // 回车 → Command Center 关闭 + Sidecar 打开 + 查询自动发送
  await input.press("Enter");
  await expect(page.getByTestId("command-center")).toHaveCount(0);
  const sidecar = page.getByTestId("kiro-sidecar");
  await expect(sidecar).toBeVisible();
  await expect(page.getByTestId("kiro-user-message")).toContainText("帮我复习计量经济学", { timeout: 10000 });
  await expect(page.getByTestId("kiro-message").last()).toContainText("梳理这门课", { timeout: 10000 });
  expect(lastBody).toContain("帮我复习计量经济学");
});

test("Sidecar → 展开到 Kiro 工作区：同一会话保留；新对话清空", async ({ page }) => {
  await page.route("**/api/ai/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: chatSSE("已收到你的问题。"),
    });
  });
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  // 从 Command Center 发起一次 handoff（Sidecar 中先有会话）
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByLabel("命令中心搜索").fill("帮我整理本周任务");
  await page.getByLabel("命令中心搜索").press("Enter");
  await expect(page.getByTestId("kiro-user-message")).toContainText("帮我整理本周任务", { timeout: 10000 });
  await expect(page.getByTestId("kiro-message").last()).toContainText("已收到你的问题", { timeout: 10000 });

  // Expand：Sidecar 关闭 → Kiro 工作区显示同一会话
  await page.getByLabel("展开到 Kiro 工作区").click();
  await expect(page.getByTestId("kiro-sidecar")).toHaveCount(0);
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();
  await expect(page.getByTestId("kiro-user-message")).toContainText("帮我整理本周任务");

  // 新对话：会话清空 → Empty State
  await page.getByRole("button", { name: "新对话" }).first().click();
  await expect(page.getByTestId("kiro-empty")).toBeVisible();
  await expect(page.getByTestId("kiro-message")).toHaveCount(0);
});
