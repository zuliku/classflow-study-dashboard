import { test, expect } from "@playwright/test";

test("dev auto-inject fires when webdriver is spoofed off", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByText("已载入完整演示数据").first()).toBeVisible({ timeout: 10000 });
  const diag = await page.evaluate(() => {
    const raw = localStorage.getItem("classflow-storage-v2") || "{}";
    const s = JSON.parse(raw).state ?? {};
    return {
      marker: localStorage.getItem("classflow-demo-injected"),
      assignments: s.assignments?.length,
      courses: s.courses?.length,
      schedules: s.schedules?.length,
      studyBlocks: s.studyBlocks?.length,
      groupProjects: s.groupProjects?.length,
      calendarMarks: s.calendarMarks?.length,
    };
  });
  expect(diag).toEqual({
    marker: "1",
    assignments: 30,
    courses: 10,
    schedules: 16,
    studyBlocks: 13,
    groupProjects: 3,
    calendarMarks: 29,
  });
});

test("marker prevents re-inject on reload", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByText("已载入完整演示数据").first()).toBeVisible();
  await page.reload();
  await page.waitForTimeout(800);
  const toastCount = await page.getByText("已载入完整演示数据").count();
  expect(toastCount).toBe(0); // 未重复注入 → 无第二次 toast
});
