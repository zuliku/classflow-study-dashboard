import { expect } from "@playwright/test";
import { test } from "./demoFixtures";
import type { Page } from "@playwright/test";

async function openCourses(page: Page) {
  await page.goto("/");
  const more = page.getByRole("button", { name: "更多", exact: true });
  if (await more.isVisible().catch(() => false)) {
    await more.click();
    await page.getByRole("menuitem", { name: "课程", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "课程资料", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "课程资料", exact: true })).toBeVisible();
}

async function openLibrary(page: Page) {
  await page.getByRole("button", { name: /资料库/ }).click();
  await expect(page.getByTestId("course-library-view")).toBeVisible();
}

test("资料库：搜索 / 类型筛选 / 预览 / 切回课程", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCourses(page);
  await openLibrary(page);

  const materials = page.getByTestId("course-library-material");
  await expect(materials).toHaveCount(7);

  await page.getByLabel("搜索课程资料").fill("Pandas");
  await expect(materials).toHaveCount(1);
  await expect(materials.first()).toContainText("Pandas");

  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(materials).toHaveCount(7);

  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await expect(materials.first()).toContainText("PDF");
  const pdfCount = await materials.count();
  expect(pdfCount).toBeGreaterThan(0);
  expect(pdfCount).toBeLessThan(7);

  await page.getByRole("button", { name: "清除筛选" }).click();
  await materials.first().click();
  const preview = page.getByRole("dialog", { name: "文件预览" });
  await expect(preview).toBeVisible();
  await expect(preview.getByText(/供求曲线与弹性分析/).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();

  await page.getByRole("button", { name: /^课程 \d+/ }).click();
  await expect(page.getByRole("heading", { name: "课程资料", exact: true })).toBeVisible();
  await expect(page.getByTestId("course-library-card-c_1")).toBeVisible();
});

test("资料库 390：单列可浏览，无横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCourses(page);
  await openLibrary(page);

  await expect(page.getByTestId("course-library-material").first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(overflow).toBe(false);
  await page.getByLabel("搜索课程资料").fill("不存在的资料");
  await expect(page.getByText("没有匹配的资料")).toBeVisible();
});
