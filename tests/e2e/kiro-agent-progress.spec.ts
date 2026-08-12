import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/** Agent 执行反馈 smoke：发送所有权 → 准备 → 回答完成。 */

const AI_SETTINGS = {
  enabled: true,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  custom: { providerName: "", baseURL: "", model: "" },
};

test("发送后立即接管 UI、锁定本轮上下文，回答到达后解锁", async ({ page }) => {
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let requestCount = 0;
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        JSON.stringify({ type: "start", messageId: "m1" }),
        JSON.stringify({ type: "start-step" }),
        JSON.stringify({ type: "text-start", id: "t1" }),
        JSON.stringify({ type: "text-delta", id: "t1", delta: "这是最近 7 天内的 DDL 情况。" }),
        JSON.stringify({ type: "text-end", id: "t1" }),
        JSON.stringify({ type: "finish-step" }),
        JSON.stringify({ type: "finish", finishReason: "stop" }),
      ]
        .map((l) => `data: ${l}`)
        .join("\n\n") + "\n\n",
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();

  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill("查看最近 DDL");
  await composer.getByLabel("发送").click();

  const pending = page.getByTestId("kiro-pending");
  await expect(pending).toContainText("正在准备");
  await expect(pending).toHaveAttribute("aria-live", "polite");
  await expect(composer.getByLabel("停止生成")).toBeVisible();
  await expect(page.getByTestId("kiro-context-bar")).toContainText(
    "本轮上下文已锁定 · 回复完成后可为下一条调整"
  );
  expect(requestCount).toBe(1);
  await expect(page.getByText("正在回复", { exact: true })).toHaveCount(0); // 无重复三点 loading
  // 一个 Assistant Turn 只有一个 Kiro Logo（Progress 承担；空 assistant message 不再渲染）
  await expect(
    page.getByTestId("kiro-conversation").locator('img[src*="kiro-mark"]')
  ).toHaveCount(1);

  releaseResponse();

  // 回答到达 → pending 消退并恢复上下文操作，唯一 Logo 由回答消息承担
  await expect(page.getByTestId("kiro-message").last()).toContainText("DDL 情况", { timeout: 10000 });
  await expect(pending).toHaveCount(0);
  await expect(page.getByText("本轮上下文已锁定 · 回复完成后可为下一条调整")).toHaveCount(0);
  await expect(
    page.getByTestId("kiro-conversation").locator('img[src*="kiro-mark"]')
  ).toHaveCount(1);
});

test("快捷建议双击只提交一次，共享发送所有权立即接管", async ({ page }) => {
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let requestCount = 0;
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        JSON.stringify({ type: "start", messageId: "m-double" }),
        JSON.stringify({ type: "text-start", id: "t-double" }),
        JSON.stringify({ type: "text-delta", id: "t-double", delta: "已接收。" }),
        JSON.stringify({ type: "text-end", id: "t-double" }),
        JSON.stringify({ type: "finish", finishReason: "stop" }),
      ].map((line) => `data: ${line}`).join("\n\n") + "\n\n",
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();

  const suggestion = page.getByRole("button", { name: /帮我规划今天/ });
  await suggestion.evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(page.getByTestId("kiro-pending")).toBeVisible();
  await expect.poll(() => requestCount).toBe(1);
  await expect(page.getByTestId("kiro-user-message")).toHaveCount(1);

  releaseResponse();
  await expect(page.getByTestId("kiro-message").last()).toContainText("已接收", { timeout: 10000 });
});
