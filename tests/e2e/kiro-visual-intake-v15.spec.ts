import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Visual Intake V1.5：Screenshot Intake 入口 + Live Image Preview（E2E；无需 AI）。
 * 1. Attachment Picker 显示截图用途（添加聊天截图或图片 + 场景描述）
 * 2. ready image suggestions 仍是「点击只填 Prompt」（不直接发送）
 * 3. Composer thumbnail 点击 → 大图 Preview（Esc / Backdrop 关闭）
 * 4. Preview 不把 File/dataURL/blob 写入任何持久层
 */

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

// suggestions 依赖 vision capability（deepseek 无 vision）；用 vision 模型 mimo-v2.5 配置
const AI_SETTINGS = {
  enabled: true,
  provider: "opencode-go",
  model: "mimo-v2.5",
  custom: { providerName: "", baseURL: "", model: "" },
  memoryEnabled: true,
  reasoningEffort: "medium",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:opencode-go", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
});

async function openKiro(page: Page) {
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  return page.getByTestId("kiro-composer");
}

/** 走真实 Picker 菜单项（pickFiles 挂载 onchange 后由 filechooser 提供文件；同一 pipeline） */
async function addImageViaPicker(page: Page, name: string) {
  const composer = page.getByTestId("kiro-composer");
  await composer.getByRole("button", { name: "添加附件" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /添加聊天截图或图片/ }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name, mimeType: "image/png", buffer: PNG_BYTES });
}

test("Attachment Picker：截图用途入口文案（添加聊天截图或图片）", async ({ page }) => {
  const composer = await openKiro(page);
  await composer.getByRole("button", { name: "添加附件" }).click();
  const item = page.getByRole("menuitem", { name: /添加聊天截图或图片/ });
  await expect(item).toBeVisible();
  await expect(item).toContainText(/班群通知、作业或调课截图/);
  await expect(item).toContainText(/JPG \/ PNG \/ WEBP/);
});

test("ready image suggestions：点击只填 Prompt，不直接发送", async ({ page }) => {
  const composer = await openKiro(page);
  await addImageViaPicker(page, "chat-screenshot.png");
  await expect(page.getByTestId("kiro-attachment-chip")).toBeVisible();
  await expect(page.getByTestId("kiro-attachment-chip")).toContainText(/PNG/);
  // ready 后出现 intent chips（3 个；含「处理截图通知」）
  const suggestions = page.getByTestId("visual-suggestion");
  await expect(suggestions).toHaveCount(3);
  await expect(suggestions).toContainText(["处理截图通知", "整理任务与 DDL", "识别课程变动"]);
  // 点击只填 Prompt（textarea 有值；没有发送 → 无 assistant 消息）
  await suggestions.filter({ hasText: "处理截图通知" }).click();
  await expect(composer.getByRole("textbox", { name: "Ask Kiro" })).toHaveValue("处理截图通知");
  await expect(page.getByTestId("kiro-message")).toHaveCount(0);
});

test("Composer 缩略图点击 → 大图 Preview；Esc / Backdrop 关闭", async ({ page }) => {
  const composer = await openKiro(page);
  await addImageViaPicker(page, "long-chat.png");
  await expect(page.getByTestId("kiro-attachment-thumb-preview")).toBeVisible();
  await page.getByTestId("kiro-attachment-thumb-preview").click();
  const preview = page.getByTestId("kiro-image-preview");
  await expect(preview).toBeVisible();
  await expect(preview.locator("img")).toBeVisible();
  // Esc 关闭
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  // 再开 → Backdrop 关闭
  await page.getByTestId("kiro-attachment-thumb-preview").click();
  await expect(page.getByTestId("kiro-image-preview")).toBeVisible();
  await page.getByTestId("kiro-image-preview-backdrop").click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId("kiro-image-preview")).toHaveCount(0);
});

test("Preview 不把 File / dataURL / blob 写入任何持久层", async ({ page }) => {
  const composer = await openKiro(page);
  await addImageViaPicker(page, "chat.png");
  await page.getByTestId("kiro-attachment-thumb-preview").click();
  await expect(page.getByTestId("kiro-image-preview")).toBeVisible();
  // 预览打开期间：localStorage 不应出现文件内容 / blob URL
  const all = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      out[k] = localStorage.getItem(k) ?? "";
    }
    return JSON.stringify(out);
  });
  expect(all).not.toContain("blob:");
  expect(all).not.toContain("data:image");
  expect(all).not.toContain("iVBORw0KGgo"); // PNG base64 内容不得落 localStorage
});
