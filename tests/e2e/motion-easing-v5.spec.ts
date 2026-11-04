import { expect, test, type Page } from "@playwright/test";

/**
 * Motion V5 easing 全量默认：
 * - 无灰度开关 / dataset；
 * - legacy alias（standard / emphasized / exit / spring）全部解析为 linear()；
 * - 空间壳、选中面、页面 fade 使用对应语义曲线；
 * - MotionGallery 不再暴露 V5 开关。
 */

async function computedEase(page: Page, token: string): Promise<string> {
  return page.evaluate((cssVar) => {
    const probe = document.createElement("div");
    probe.style.transition = `opacity 1s var(${cssVar})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).transitionTimingFunction;
    probe.remove();
    return value;
  }, token);
}

test("Motion V5 全量默认：legacy alias 与语义 token 均解析为 linear()", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(300);

  await expect(page.locator("html")).not.toHaveAttribute("data-motion-easing", "v5");
  expect(await computedEase(page, "--ease-standard")).toContain("linear(");
  expect(await computedEase(page, "--ease-emphasized")).toContain("linear(");
  expect(await computedEase(page, "--ease-exit")).toContain("linear(");
  expect(await computedEase(page, "--ease-spring")).toContain("linear(");
  expect(await computedEase(page, "--ease-selection")).toContain("1.0106");
  expect(await computedEase(page, "--ease-spatial")).toContain("0.0754");
  expect(await computedEase(page, "--ease-page")).toContain("0.1855");
});

test("MotionGallery 不再暴露灰度开关", async ({ page }) => {
  await page.goto("/?motion-gallery=1");
  await expect(page.getByTestId("motion-gallery")).toBeVisible();
  await expect(page.getByTestId("motion-gallery-easing-toggle")).toHaveCount(0);
});
