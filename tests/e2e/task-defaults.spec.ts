import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Settings V2 Task 3：真实工作流接入 E2E
 * 1) 任务默认值（优先级/状态/DDL 时刻）→ N 新建任务 → 预填 + 落库
 * 2) startupView=任务 → reload 进入任务工作区
 * 3) 界面密度 compact → 任务工作区 data-density=compact
 */

async function openSettings(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

test("任务默认值：设置 高/进行中/21:00 → N 新建任务预填并落库", async ({ page }) => {
  await openSettings(page);

  // 任务 section：默认优先级 = 高，默认状态 = 进行中，默认截止时间 = 21:00
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "任务" })
    .click();
  await page.getByLabel("默认优先级").selectOption("high");
  await page.getByLabel("默认状态").selectOption("doing");
  await page.getByTestId("settings-tasks").locator("input[type='time']").fill("21:00");
  await expect(page.getByTestId("settings-tasks").locator("input[type='time']")).toHaveValue("21:00");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // N 新建任务：编辑器预填高优先级 + 21:00
  await page.keyboard.press("n");
  await expect(page.getByRole("heading", { name: "新建任务" })).toBeVisible();
  await expect(page.locator("form select").nth(1)).toHaveValue("high");
  await expect(page.locator("input[type='time']")).toHaveValue("21:00");

  // 填写标题保存 → 落库检查 priority/status/ddl
  await page.getByPlaceholder("如：计量经济学实证报告").fill("默认值接入测试");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("heading", { name: "新建任务" })).toHaveCount(0);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem("classflow-storage-v2");
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const a = (parsed.state.assignments ?? []).find(
          (x: { title: string }) => x.title === "默认值接入测试"
        );
        return a ? { priority: a.priority, status: a.status, ddl: a.ddl } : null;
      })
    )
    .not.toBeNull();
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("classflow-storage-v2")!;
    const parsed = JSON.parse(raw);
    return (parsed.state.assignments as any[]).find((x) => x.title === "默认值接入测试");
  });
  expect(stored.priority).toBe("high");
  expect(stored.status).toBe("doing");
  expect(stored.ddl).toMatch(/T21:00/);
});

test("startupView=任务：设置后 reload 进入任务工作区", async ({ page }) => {
  await openSettings(page);

  // 通用 section：默认打开位置 → 任务
  await page
    .locator('[data-setting-id="startup-view"]')
    .getByRole("button", { name: "任务", exact: true })
    .click();
  await expect(page.locator('[data-setting-id="startup-view"]')).toContainText("上次使用的位置");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 修改设置不影响当前页面（不会把用户踢走），reload 后才进入任务
  await expect(page.getByRole("heading", { name: "任务工作区" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "任务工作区" })).toBeVisible();
  await expect(page.getByTestId("assignment-list")).toBeVisible();
});

test("界面密度：紧凑 → 任务工作区 data-density=compact", async ({ page }) => {
  await openSettings(page);

  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "交互与快捷键" })
    .click();
  await page.locator('[data-setting-id="content-density"]').getByRole("button", { name: "紧凑" }).click();
  await expect(page.locator('[data-setting-id="content-density"]').getByRole("button", { name: "紧凑" })).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: "任务与 DDL" }).click();
  await expect(page.getByTestId("assignment-list")).toHaveAttribute("data-density", "compact");
});
