import { expect, test } from "@playwright/test";

/**
 * Kiro Chat 核心 E2E（Task 1）：mock /api/ai/chat，
 * 验证：进入 Kiro → 输入 → user message → assistant 流式/最终 response。
 * 同时验证错误路径（INVALID_API_KEY → 错误提示 + 重试/设置入口）。
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
      JSON.stringify({ type: "text-start", id: "mock-text" }),
      ...content.split(/(?<=。)/).map((seg) =>
        seg ? JSON.stringify({ type: "text-delta", id: "mock-text", delta: seg }) : null
      ).filter(Boolean),
      JSON.stringify({ type: "text-end", id: "mock-text" }),
      JSON.stringify({ type: "finish", finishReason: "stop" }),
    ].join("\n")
  );
}

test("Kiro Chat：输入消息 → 流式回复最终渲染；错误路径显示归一化提示", async ({ page }) => {
  let chatCalls = 0;
  await page.route("**/api/ai/chat", async (route) => {
    chatCalls++;
    const body = route.request().postDataJSON() as { apiKey?: string; messages?: unknown[] };
    // 安全断言：API Key 必须通过请求体转发（服务端代理模式），且本测试用 mock key
    if (body?.apiKey !== "sk-test-key") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ code: "INVALID_API_KEY", message: "缺少 API Key。" }),
      });
      return;
    }
    if (chatCalls === 2) {
      // 第二次请求：模拟 API Key 无效
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sse(JSON.stringify({ type: "error", errorText: JSON.stringify({ code: "INVALID_API_KEY", message: "API Key 无效，请在设置中检查。" }) })),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: chatSSE("你好！我是 Kiro。这是来自模拟服务的流式回复，用于验证真实聊天链路。"),
    });
  });

  // 配置 AI（localStorage 设置 + sessionStorage API Key）
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();

  // 输入并发送
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("什么是工具变量？");
  await composer.getByLabel("发送").click();

  // user message 出现
  await expect(page.getByTestId("kiro-user-message")).toContainText("什么是工具变量？");
  // assistant 最终 response 出现（含 mock 文本）
  await expect(page.getByTestId("kiro-message").last()).toContainText("流式回复", { timeout: 10000 });
  await expect(chatCalls).toBe(1);

  // 错误路径：再发一条 → INVALID_API_KEY → 错误提示 + 重试/设置按钮
  await composer.getByLabel("Ask Kiro").fill("再问一个问题");
  await composer.getByLabel("发送").click();
  await expect(page.getByTestId("kiro-error")).toContainText("Kiro 暂时没有完成回复", { timeout: 10000 });
  await expect(page.getByTestId("kiro-error")).toContainText("API Key 无效");
  await expect(page.getByTestId("kiro-error").getByRole("button", { name: "重试" })).toBeVisible();
  await expect(page.getByTestId("kiro-error").getByRole("button", { name: "打开设置" })).toBeVisible();
});

test("Kiro Chat：streaming 时 Send 变为 Stop，点击停止生成", async ({ page }) => {
  await page.route("**/api/ai/chat", async (route) => {
    // 延迟响应：让请求保持 in-flight（submitted/streaming），Stop 按钮可观测
    await new Promise((r) => setTimeout(r, 3000));
    const chunks = [
      JSON.stringify({ type: "start", messageId: "mock-msg-1" }),
      JSON.stringify({ type: "text-start", id: "mock-text" }),
      JSON.stringify({ type: "text-delta", id: "mock-text", delta: "正在生成" }),
      JSON.stringify({ type: "text-end", id: "mock-text" }),
      JSON.stringify({ type: "finish", finishReason: "stop" }),
    ];
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse(chunks.join("\n")),
    });
  });

  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();

  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("开始生成");
  await composer.getByLabel("发送").click();

  // 请求进行中：Send 变为 Stop，点击后立即停止并恢复 Send
  const stopBtn = composer.getByLabel("停止生成");
  await expect(stopBtn).toBeVisible({ timeout: 5000 });
  await stopBtn.click();
  await expect(composer.getByLabel("发送")).toBeVisible({ timeout: 5000 });
});
