import { test, expect } from "@playwright/test";

test("settings dev demo reload button", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  // 无数据（E2E 环境）→ 直接注入空种子则按钮仍在（dev 构建恒显示）
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "数据与隐私" })
    .click();
  // 体验示例已收拢进数据诊断：展开后可用
  await page.getByTestId("data-diagnostics-toggle").click();
  await expect(page.getByTestId("dev-demo-reload")).toBeVisible();
  await expect(page.getByTestId("data-overview")).toContainText("0");

  await page.getByTestId("dev-demo-reload").getByRole("button", { name: /载入示例数据/ }).click();
  await expect(page.getByText("载入示例数据？")).toBeVisible();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByText("示例数据已载入").first()).toBeVisible();
  await expect(page.getByTestId("overview-任务")).toContainText("30");
  await expect(page.getByTestId("overview-课程")).toContainText("10");
  await expect(page.getByTestId("overview-资料")).toContainText("23");
  await expect(page.getByTestId("overview-项目")).toContainText("3");
});
