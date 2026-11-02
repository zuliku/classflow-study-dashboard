import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Sidecar（compact）思考程度弹窗：
 * - 弹窗通过 Portal 逃出 Sidecar 的 overflow-hidden；
 * - 右对齐 trigger + viewport clamp，完整落在视口内；
 * - 不改变桌面（非 compact）锚点居中路径。
 */

async function seedAI(page: Page) {
  await page.addInitScript(
    ({ settings, key }) => {
      localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
      sessionStorage.setItem("classflow-ai-key:deepseek", key);
    },
    {
      settings: {
        enabled: true,
        provider: "deepseek",
        model: "deepseek-v4-flash",
        custom: { providerName: "", baseURL: "", model: "" },
      },
      key: "sk-test-key",
    }
  );
}

test("Sidecar compact：思考程度弹窗不被裁切（Portal + viewport clamp）", async ({ page }) => {
  await seedAI(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  // 直接派发 Ctrl+K（Playwright 键盘事件在部分环境下会被窗口层截获）
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true })
    );
  });
  await page.getByLabel("命令中心搜索").fill("看看本周安排");
  await page.getByLabel("命令中心搜索").press("Enter");

  const sidecar = page.getByTestId("kiro-sidecar");
  await expect(sidecar).toBeVisible();
  const reasoning = sidecar.getByTestId("kiro-composer-reasoning");
  await expect(reasoning).toBeVisible();
  await reasoning.click();

  const menu = page.getByTestId("kiro-composer-reasoning-menu");
  await expect(menu).toBeVisible();
  // Portal：不在 Sidecar 的 overflow-hidden 子树内
  expect(await menu.evaluate((el) => Boolean(el.closest('[data-testid="kiro-sidecar"]')))).toBe(false);

  const viewport = page.viewportSize()!;
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);

  // 弹窗在 trigger 上方
  const triggerBox = await reasoning.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(triggerBox!.y + 2);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});
