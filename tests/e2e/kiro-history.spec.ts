import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Task 6 E2E：
 * 1. 主链路：发送 → 刷新 → History 可见 → 打开恢复 → 继续对话
 * 2. 重命名 / 删除
 * 3. Regenerate 安全：read-only 轮次可重新生成；Write Tool 轮次无重新生成；恢复后无重新生成
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

test("主链路：发送 → 刷新 → History 恢复 → 继续对话", async ({ page }) => {
  await page.route("**/api/ai/chat", async (route) => {
    const body = route.request().postDataJSON() as {
      messages?: { role: string; parts?: { type: string; text?: string }[] }[];
    };
    const isSecondTurn = (body?.messages ?? []).some(
      (m) => m.role === "user" && (m.parts ?? []).some((p) => p.type === "text" && p.text?.includes("最紧急"))
    );
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: chatSSE(isSecondTurn ? "最紧急的是统计学作业，明天 23:59 截止。" : "本周共 5 项任务，其中 2 项临近截止。"),
    });
  });
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);

  // 第一轮：read-only，应有「重新生成」
  await sendMessage(page, "帮我分析这周任务");
  await expect(page.getByTestId("kiro-message").last()).toContainText("本周共 5 项任务", { timeout: 10000 });
  await expect(page.getByTestId("kiro-message").last().getByLabel("重新生成")).toBeVisible();

  // 刷新前先确认已持久化（面板可见该对话）
  await page.getByLabel("更多操作", { exact: true }).click();
  await page.getByRole("menuitem", { name: "历史记录" }).click();
  const prePanel = page.getByRole("dialog", { name: "历史记录" });
  await expect(prePanel.getByText("帮我分析这周任务")).toBeVisible();
  await prePanel.getByLabel("关闭历史记录").click();

  // 刷新页面 → 重新进入 Kiro → History 列表仍存在该对话
  await page.reload();
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();
  await page.getByLabel("更多操作", { exact: true }).click();
  await page.getByRole("menuitem", { name: "历史记录" }).click();

  const panel = page.getByRole("dialog", { name: "历史记录" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("帮我分析这周任务")).toBeVisible();

  // 打开恢复：原消息可见；恢复的消息不可重新生成
  await panel.getByText("帮我分析这周任务").click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("kiro-user-message")).toContainText("帮我分析这周任务");
  await expect(page.getByTestId("kiro-message").last()).toContainText("本周共 5 项任务");
  await expect(page.getByTestId("kiro-message").last().getByLabel("重新生成")).toHaveCount(0);

  // 继续对话：新回合正常工作
  await sendMessage(page, "那最紧急的是哪一个？");
  await expect(page.getByTestId("kiro-message").last()).toContainText("最紧急的是统计学作业", { timeout: 10000 });
});

test("历史行：重命名 / 删除", async ({ page }) => {
  await page.route("**/api/ai/chat", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: chatSSE("收到。") });
  });
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);

  await sendMessage(page, "本周学习规划");
  await expect(page.getByTestId("kiro-message").last()).toContainText("收到", { timeout: 10000 });
  await expect(page.getByTestId("kiro-message").last().getByLabel("重新生成")).toBeVisible();
  await page.waitForTimeout(500); // 等稳定点保存落盘
  await page.reload();
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.getByLabel("更多操作", { exact: true }).click();
  await page.getByRole("menuitem", { name: "历史记录" }).click();
  const panel = page.getByRole("dialog", { name: "历史记录" });
  await expect(panel.getByText("本周学习规划")).toBeVisible();

  // 重命名
  await panel.getByLabel("对话 本周学习规划 更多操作").click();
  await panel.getByRole("menuitem", { name: "重命名" }).click();
  const renameInput = panel.getByLabel("重命名对话");
  await renameInput.fill("新的规划标题");
  await panel.getByLabel("确认重命名").click();
  await expect(panel.getByText("新的规划标题")).toBeVisible();

  // 删除
  await panel.getByLabel("对话 新的规划标题 更多操作").click();
  await panel.getByRole("menuitem", { name: "删除" }).click();
  await expect(panel.getByText("新的规划标题")).toHaveCount(0);
  await expect(panel.getByText("暂无历史对话")).toBeVisible();
});

test("Regenerate 安全：Write Tool 轮次不显示重新生成；直接 retry 不重复执行", async ({ page }) => {
  let requests = 0;
  let writeExecuted = false;
  await page.route("**/api/ai/chat", async (route) => {
    requests++;
    const body = route.request().postDataJSON() as {
      messages?: { role: string; parts?: { type: string; state?: string; output?: { ok: boolean } }[] }[];
    };
    const hasToolOutput = (body?.messages ?? []).some(
      (m) => m.role === "assistant" && (m.parts ?? []).some((p) => p.type.startsWith("tool-") && p.state === "output-available")
    );
    if (!hasToolOutput) {
      // 第一轮：set_assignment_ddl tool call
      const chunks = [
        JSON.stringify({ type: "start", messageId: "m1" }),
        JSON.stringify({ type: "start-step" }),
        JSON.stringify({ type: "tool-input-start", toolCallId: "call_1", toolName: "set_assignment_ddl" }),
        JSON.stringify({ type: "tool-input-delta", toolCallId: "call_1", inputTextDelta: '{"assignmentId":"a1","ddl":"2026-08-20T22:00:00"}' }),
        JSON.stringify({ type: "tool-input-available", toolCallId: "call_1", toolName: "set_assignment_ddl", input: { assignmentId: "a1", ddl: "2026-08-20T22:00:00" } }),
        JSON.stringify({ type: "finish-step" }),
        JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
      ];
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(chunks.join("\n")) });
      return;
    }
    // 第二轮：客户端执行后回传 → 最终回答
    const chunks = [
      JSON.stringify({ type: "start", messageId: "m1" }),
      JSON.stringify({ type: "start-step" }),
      JSON.stringify({ type: "text-start", id: "t1" }),
      JSON.stringify({ type: "text-delta", id: "t1", delta: "已调整统计学作业的截止时间。" }),
      JSON.stringify({ type: "text-end", id: "t1" }),
      JSON.stringify({ type: "finish-step" }),
      JSON.stringify({ type: "finish", finishReason: "stop" }),
    ];
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(chunks.join("\n")) });
  });
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);

  await sendMessage(page, "把统计学作业改到 8 月 20 号晚上十点");
  await expect(page.getByTestId("kiro-message").last()).toContainText("已调整统计学作业", { timeout: 15000 });
  // 该轮包含 Write Tool：不显示重新生成
  await expect(page.getByTestId("kiro-message").last().getByLabel("重新生成")).toHaveCount(0);
  // Action Card 显示（live，可撤销）
  await expect(page.getByTestId("kiro-action-card")).toContainText("撤销");
  expect(requests).toBe(2);

  // 模拟误调用 retry：注册 chat.retry 的守卫通过「重新生成」按钮不存在验证；
  // 深层 guard 由单元测试 lastTurnCanRegenerate 覆盖（此处验证 UI 层面不可触发第二次写请求）
  await page.waitForTimeout(1200);
  expect(requests).toBe(2);
});
