import { test, expect } from "@playwright/test";

test("no auto-inject on first run - empty workspace remains empty", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  // First run should show empty workspace, not demo data
  await expect(page.getByTestId("getting-started")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("欢迎使用 ClassFlow")).toBeVisible();
  // No auto toast
  await expect(page.getByText("已载入完整演示数据")).toHaveCount(0);
  const diag = await page.evaluate(() => {
    const raw = localStorage.getItem("classflow-storage-v2") || "{}";
    const s = JSON.parse(raw).state ?? JSON.parse(raw) ?? {};
    return {
      assignments: s.assignments?.length ?? 0,
      courses: s.courses?.length ?? 0,
      schedules: s.schedules?.length ?? 0,
    };
  });
  expect(diag.assignments).toBe(0);
  expect(diag.courses).toBe(0);
  expect(diag.schedules).toBe(0);
});

test("manual demo load via settings with confirm", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("getting-started")).toBeVisible();
  // Open settings -> data
  await page.getByRole("button", { name: /设置/ }).click();
  await page.getByText("数据与隐私").click();
  await page.getByTestId("dev-demo-reload").getByRole("button", { name: /载入完整演示数据/ }).click();
  // Confirm dialog should appear (not native confirm)
  await expect(page.getByText("载入完整演示数据？")).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  // Cancel should not change data
  await expect(page.getByTestId("getting-started")).toBeVisible();
  // Re-open and confirm
  await page.getByTestId("dev-demo-reload").getByRole("button", { name: /载入完整演示数据/ }).click();
  await page.getByRole("button", { name: "载入演示数据" }).click();
  await expect(page.getByText("完整演示数据已载入")).toBeVisible();
  await page.getByRole("button", { name: /关闭/ }).click(); // close settings
  // Now overview should have data
  await expect(page.getByTestId("getting-started")).toHaveCount(0);
});
