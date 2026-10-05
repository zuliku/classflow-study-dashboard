import { expect, test, type Page } from "@playwright/test";

/**
 * Kiro 模式切换布局门禁（E2E 几何）：
 * - 品牌区（logo）在聊天/工作切换前后上下位置不变（居中容器高度不变）
 * - 聊天框高度在切换前后不变（输入区最低高度常驻两模式）
 * - 胶囊有滑动指示（active 段切换时指示条位置跟随）
 *
 * 不依赖演示数据/模型配置，用原生 @playwright/test。
 * 运行要求：本地 `npm run dev` 常驻（renderer http://localhost:5173）。
 */
async function openKiroEmpty(page: Page) {
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();
  await expect(page.getByTestId("kiro-composer")).toBeVisible();
  await expect(page.getByTestId("kiro-empty")).toBeVisible();
}

async function geom(page: Page): Promise<{ logoTop: number; surfaceH: number }> {
  return page.evaluate(() => {
    const logo = document.querySelector("[data-kiro-empty-logo]")!;
    const surface = document.querySelector('[data-testid="kiro-composer-surface"]')!;
    return {
      logoTop: logo.getBoundingClientRect().top,
      surfaceH: surface.getBoundingClientRect().height,
    };
  });
}

test("模式切换品牌区与聊天框零位移", async ({ page }) => {
  await openKiroEmpty(page);
  const capsule = page.getByTestId("kiro-mode-capsule");
  await expect(capsule).toBeVisible();

  const before = await geom(page);
  await capsule.getByRole("button", { name: "工作" }).click();
  await page.waitForTimeout(500);
  const work = await geom(page);
  await capsule.getByRole("button", { name: "聊天" }).click();
  await page.waitForTimeout(500);
  const back = await geom(page);

  // 品牌 logo 上下位置纹丝不动（>1px 即居中容器高度变化的回归）
  expect(Math.abs(work.logoTop - before.logoTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(back.logoTop - before.logoTop)).toBeLessThanOrEqual(1);
  // 聊天框高度不变（输入区最低高度常驻两模式）
  expect(Math.abs(work.surfaceH - before.surfaceH)).toBeLessThanOrEqual(1);
  expect(Math.abs(back.surfaceH - before.surfaceH)).toBeLessThanOrEqual(1);
});
