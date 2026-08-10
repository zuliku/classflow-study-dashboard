import { test, expect } from "@playwright/test";

test("settings dev demo reload button", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  // 无数据（E2E 环境）→ 直接注入空种子则按钮仍在（dev 构建恒显示）
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "数据与存储" })
    .click();
  await expect(page.getByTestId("dev-demo-reload")).toBeVisible();
  await expect(page.getByTestId("data-overview")).toContainText("0");

  page.on("dialog", (d) => d.accept());
  await page.getByTestId("dev-demo-reload").getByRole("button", { name: "重新载入" }).click();
  await expect(page.getByText("已重新载入完整演示数据").first()).toBeVisible();
  await expect(page.getByTestId("overview-任务")).toContainText("15");
  await expect(page.getByTestId("overview-课程")).toContainText("5");
  await expect(page.getByTestId("overview-资料")).toContainText("9");
  await expect(page.getByTestId("overview-项目")).toContainText("2");
});
