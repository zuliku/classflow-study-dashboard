import { expect, test, type Page } from "@playwright/test";

/**
 * Motion V5 easing dev 灰度开关：
 * - 默认（无 flag）legacy token 保持 V3 cubic-bezier；
 * - ?motion-easing=v5 切换 data-motion-easing + linear() 曲线；
 * - MotionGallery 开关写入 localStorage，移除 URL 参数后仍可持久化；
 * - 关闭后恢复 V3 并清理 URL/storage 状态。
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

test("Motion V5 dev flag：默认 V3，URL 开启后切到 linear()", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(300);
  await expect(page.locator("html")).not.toHaveAttribute("data-motion-easing", "v5");
  expect(await computedEase(page, "--ease-standard")).toContain("cubic-bezier");

  await page.goto("/?motion-easing=v5");
  await page.waitForTimeout(300);
  await expect(page.locator("html")).toHaveAttribute("data-motion-easing", "v5");
  expect(await computedEase(page, "--ease-standard")).toContain("linear(");
  expect(await computedEase(page, "--ease-selection")).toContain("1.0106");
});

test("MotionGallery V5 开关：localStorage 持久化，关闭恢复 V3", async ({ page }) => {
  await page.goto("/?motion-gallery=1");
  const gallery = page.getByTestId("motion-gallery");
  await expect(gallery).toBeVisible();
  const toggle = page.getByTestId("motion-gallery-easing-toggle");

  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-motion-easing", "v5");
  expect(await page.evaluate(() => localStorage.getItem("classflow-motion-easing"))).toBe("v5");

  // 移除 URL 显式参数后，localStorage 仍应让 V5 生效
  await page.goto("/?motion-gallery=1");
  await expect(page.locator("html")).toHaveAttribute("data-motion-easing", "v5");
  expect(await computedEase(page, "--ease-standard")).toContain("linear(");

  await page.getByTestId("motion-gallery-easing-toggle").click();
  await expect(page.locator("html")).not.toHaveAttribute("data-motion-easing", "v5");
  expect(await page.evaluate(() => localStorage.getItem("classflow-motion-easing"))).toBe("v4");
  expect(await computedEase(page, "--ease-standard")).toContain("cubic-bezier");
});
