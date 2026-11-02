import { expect } from "@playwright/test";
import { test } from "@playwright/test";

/**
 * Kiro Model Selector · Glass（dev-only demo）
 * 访问 ?model-selector-demo=1；覆盖玻璃面板、背景动态模糊、选择/关闭、深浅主题与 keyboard。
 * 不依赖业务 Store / demoFixtures。
 */

test("打开：暖色玻璃面板（无全局磨砂）+ 鼠标滚轮；选择后关闭并更新 trigger", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?model-selector-demo=1");
  const demo = page.getByTestId("model-selector-demo");
  await expect(demo).toBeVisible();

  const trigger = demo.getByTestId("kiro-composer-model");
  await expect(trigger).toHaveText("GPT-5.6 Sol");
  await trigger.click();

  const menu = page.getByTestId("kiro-composer-model-menu");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveClass(/kiro-model-glass/);
  await expect(menu).toHaveAttribute("data-appearance", "light");

  // 动画结束后：只有面板自身 18px 玻璃，不触发全局背景磨砂
  await expect
    .poll(() => menu.evaluate((el) => getComputedStyle(el).backdropFilter), { timeout: 3000 })
    .toContain("blur(18px)");
  await expect(page.getByTestId("kiro-model-scrim")).toHaveCount(0);

  // 鼠标滚轮可滚动列表（不是只靠键盘/滚动条）
  const list = menu.getByTestId("kiro-model-list");
  await expect.poll(() => list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

  // hover 下方“半可见”选项：只换高亮，不自动滚动（旧实现会瞬间跳一截）
  const beforeHover = await list.evaluate((el) => el.scrollTop);
  const partialIndex = await list.evaluate((el) => {
    const listRect = el.getBoundingClientRect();
    const options = Array.from(el.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
    return options.findIndex((option) => {
      const r = option.getBoundingClientRect();
      return r.top < listRect.bottom - 4 && r.bottom > listRect.bottom + 4;
    });
  });
  if (partialIndex >= 0) {
    const optionBox = await menu.getByRole("menuitemradio").nth(partialIndex).boundingBox();
    const listBox = await list.boundingBox();
    if (optionBox && listBox) {
      await page.mouse.move(optionBox.x + 20, Math.max(listBox.y + 4, optionBox.y + 4));
      await page.waitForTimeout(80);
      expect(await list.evaluate((el) => el.scrollTop)).toBe(beforeHover);
    }
  }

  await list.hover();
  await page.mouse.wheel(0, 260);
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  await menu.getByRole("menuitemradio", { name: "Gemini 4 Argon" }).click();
  await expect(trigger).toHaveText("Gemini 4 Argon");
  await expect(menu).toHaveCount(0);
});

test("搜索 + Enter 选择；Esc 关闭；Dark 材质", async ({ page }) => {
  await page.goto("/?model-selector-demo=1");
  const demo = page.getByTestId("model-selector-demo");
  const trigger = demo.getByTestId("kiro-composer-model");
  const menu = page.getByTestId("kiro-composer-model-menu");

  await trigger.click();
  await expect(menu).toBeVisible();
  const input = page.getByLabel("搜索模型");
  await input.fill("gem");
  await expect(menu.getByRole("menuitemradio")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveText("Gemini 4 Argon");
  await expect(menu).toHaveCount(0);

  await trigger.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await page.getByRole("button", { name: "切换到深色主题" }).click();
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-appearance", "dark");
  await expect(menu).toHaveClass(/kiro-model-glass/);
});

test("prefers-reduced-motion：仍可打开/选择（无过渡依赖）", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?model-selector-demo=1");
  const demo = page.getByTestId("model-selector-demo");
  const trigger = demo.getByTestId("kiro-composer-model");
  const menu = page.getByTestId("kiro-composer-model-menu");

  await trigger.click();
  await expect(menu).toBeVisible();
  await expect
    .poll(() => menu.evaluate((el) => getComputedStyle(el).opacity), { timeout: 2000 })
    .toBe("1");
  await menu.getByRole("menuitemradio", { name: "Claude Haiku 5.5" }).click();
  await expect(trigger).toHaveText("Claude Haiku 5.5");
  await expect(menu).toHaveCount(0);
});
