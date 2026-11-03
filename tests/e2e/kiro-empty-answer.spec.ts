import { expect, test } from "@playwright/test";

/**
 * 空终答安全网 E2E（fix：思考吃光配额 → 工具成功但零正文）：
 * mock /api/ai/chat 三轮：
 * 1. 模型发出 search_assignments（客户端真实执行，空 store 也返回 ok）；
 * 2. 续跑返回零正文 + finish stop → turn settled → 行内出现「重新生成回答」；
 * 3. 点击 → 断言 body.textOnlyAnswer === true → 返回正文 → 渲染 + 按钮消失。
 */

const AI_SETTINGS = {
  enabled: true,
  provider: "deepseek",
  model: "deepseek-flash",
  custom: { providerName: "", baseURL: "", model: "" },
};

function sse(body: string): string {
  return body
    .split("\n")
    .filter(Boolean)
    .map((line) => `data: ${line}`)
    .join("\n\n") + "\n\n";
}

function toolCallSSE(): string {
  return sse(
    [
      JSON.stringify({ type: "start", messageId: "mock-msg-1" }),
      JSON.stringify({ type: "start-step" }),
      JSON.stringify({ type: "tool-input-start", toolCallId: "call_1", toolName: "search_assignments" }),
      JSON.stringify({ type: "tool-input-available", toolCallId: "call_1", toolName: "search_assignments", input: { scope: "today" } }),
      JSON.stringify({ type: "finish-step" }),
      JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
    ].join("\n")
  );
}

function emptyAnswerSSE(): string {
  // 保真要点：生产空 step 照样带 messageMetadata（contextUsage 快照，start/finish 各一次），
  // 它是唯一触发客户端 write() 提交新 step-start 的 part；缺了它 state 永不推进，
  // sendAutomaticallyWhen 恒真 → 无限续跑（已验证：412 次相同请求）。
  const usage = {
    version: 1,
    at: "2026-09-30T00:00:00.000Z",
    provider: "deepseek",
    model: "deepseek-flash",
    totalEstimatedTokens: 100,
    breakdown: { systemPromptTokens: 10, toolSchemaTokens: 80, conversationTokens: 10, attachmentTokens: 0, summaryTokens: 0 },
    conversationBudget: { max: 100000, used: 10, compactAt: 75000, compacted: false },
  };
  return sse(
    [
      JSON.stringify({ type: "start", messageId: "mock-msg-1", messageMetadata: { contextUsage: usage } }),
      JSON.stringify({ type: "start-step" }),
      JSON.stringify({ type: "finish-step" }),
      JSON.stringify({ type: "finish", finishReason: "stop", messageMetadata: { contextUsage: usage } }),
    ].join("\n")
  );
}

function textSSE(content: string): string {
  return sse(
    [
      JSON.stringify({ type: "start", messageId: "mock-msg-2" }),
      JSON.stringify({ type: "text-start", id: "mock-text" }),
      JSON.stringify({ type: "text-delta", id: "mock-text", delta: content }),
      JSON.stringify({ type: "text-end", id: "mock-text" }),
      JSON.stringify({ type: "finish-step" }),
      JSON.stringify({ type: "finish", finishReason: "stop" }),
    ].join("\n")
  );
}

test("空终答：工具成功零正文 → 追答按钮 → textOnly 重跑出正文", async ({ page }) => {
  const bodies: { textOnlyAnswer?: unknown; messages?: unknown[] }[] = [];
  await page.route("**/api/ai/chat", async (route) => {
    const body = route.request().postDataJSON() as { apiKey?: string; textOnlyAnswer?: unknown; messages?: unknown[] };
    // eslint-disable-next-line no-console
    console.log(`[E2E empty-answer] req#${bodies.length + 1} textOnly=${String(body?.textOnlyAnswer)}`);
    if (body?.apiKey !== "sk-test-key") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ code: "INVALID_API_KEY", message: "缺少 API Key。" }),
      });
      return;
    }
    bodies.push({ textOnlyAnswer: body?.textOnlyAnswer, messages: body?.messages });
    const hasToolOutput = (body?.messages ?? []).some(
      (m) =>
        (m as { role?: string }).role === "assistant" &&
        ((m as { parts?: { type?: string; state?: string }[] }).parts ?? []).some(
          (p) => p.type.startsWith("tool-") && p.state === "output-available"
        )
    );
    if (body?.textOnlyAnswer === true) {
      // 第三轮：纯文本追答 → 直接正文（零工具）
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: textSSE("今天有 2 个任务需要处理，详见上方查询结果。"),
      });
      return;
    }
    if (!hasToolOutput) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: toolCallSSE(),
      });
      return;
    }
    // 第二轮：续跑零正文（复现空终答 bug）
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: emptyAnswerSSE(),
    });
  });

  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
    // Task-12 发送门：纯 Chromium 无 Electron preload bridge，此处替身 beginLocal；
    // server 侧 invocation 校验由本文件的 route mock 整体代替（trust 边界另有单测覆盖）。
    (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
      invocation: { beginLocal: async () => ({ invocationId: "inv_e2e_empty_answer_1" }) },
    };
  }, { settings: AI_SETTINGS, key: "sk-test-key" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();

  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("今天还有哪些任务");
  await composer.getByLabel("发送").click();
  await expect(page.getByTestId("kiro-user-message")).toContainText("今天还有哪些任务");

  // 空终答出现：行内追答按钮（nudge 可见文案 + 按钮）
  const retryButton = page.getByTestId("kiro-regenerate-answer");
  await expect(retryButton).toBeVisible({ timeout: 15000 });
  await expect(retryButton).toContainText("重新生成回答");

  // 点击 → 第三轮 textOnlyAnswer 追答 → 正文渲染 + 按钮消失
  await retryButton.click();
  await expect(page.getByTestId("kiro-message").last()).toContainText("今天有 2 个任务", { timeout: 15000 });
  await expect(page.getByTestId("kiro-regenerate-answer")).toHaveCount(0);
  expect(bodies.length).toBe(3);
  expect(bodies[2].textOnlyAnswer).toBe(true);
});
