import { test, expect, Page } from "@playwright/test";

/**
 * Assignment Workspace E2E：键盘导航 / Peek / 多选 / Context Menu / Mobile 兼容。
 * 演示数据顺序：a1 计量经济学大作业 · a2 市场营销案例汇报 · a3 英语演讲PPT (Unit 6) · a4 数据库实验报告（实验四）
 */

async function openWorkspace(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "任务与 DDL" }).first().click();
  await expect(page.getByRole("heading", { name: "任务工作区" })).toBeVisible();
  const list = page.getByTestId("assignment-list");
  await list.focus();
  return list;
}

test("导航：J J Enter → 打开正确的任务 Drawer", async ({ page }) => {
  const list = await openWorkspace(page);
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");

  // a3 英语演讲PPT (Unit 6)
  await expect(
    page.getByRole("heading", { name: "英语演讲PPT (Unit 6)" }).last()
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭" }).first()).toBeVisible();
});

test("Peek：Space 打开 → J 同步更新 → Esc 关闭", async ({ page }) => {
  await openWorkspace(page);
  await page.keyboard.press("j"); // a1 计量经济学大作业

  await page.keyboard.press("Space");
  const peek = page.getByTestId("assignment-peek");
  await expect(peek).toBeVisible();
  await expect(
    peek.getByRole("heading", { name: "计量经济学大作业（第3章）" })
  ).toBeVisible();

  // J 继续移动 highlight，Peek 内容同步更新（不关闭重开）
  await page.keyboard.press("j");
  await expect(
    peek.getByRole("heading", { name: "市场营销案例汇报" })
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(peek).toHaveCount(0);
});

test("多选：X J X → 已选 2 项 → 批量完成 → 两项均完成", async ({ page }) => {
  await openWorkspace(page);
  await page.keyboard.press("j"); // highlight a1
  await page.keyboard.press("x"); // 选 a1
  await page.keyboard.press("j"); // highlight a2
  await page.keyboard.press("x"); // 选 a2

  const bar = page.getByTestId("assignment-bulk-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("已选 2 项");

  await bar.getByRole("button", { name: "完成" }).click();
  await expect(page.locator('[data-assignment-id="a1"] input[type="checkbox"]')).toBeChecked();
  await expect(page.locator('[data-assignment-id="a2"] input[type="checkbox"]')).toBeChecked();
  // 批量操作后选择仍存在（可在 Esc 清除）
  await expect(bar).toBeVisible();
  await page.getByTestId("assignment-list").focus();
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
});

test("Context Menu：右键任务 → 修改优先级 → 行内状态更新", async ({ page }) => {
  await openWorkspace(page);
  const row = page.locator('[data-assignment-id="a4"]');
  await row.click({ button: "right" });

  const menu = page.getByTestId("assignment-context-menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "将当前任务设为高优先级" }).click();

  await expect(page.locator('[data-assignment-id="a4"]').getByText("高优先", { exact: true })).toBeVisible();
  await expect(page.getByTestId("assignment-context-menu")).toHaveCount(0);
});

test("Mobile 390：点击行仍打开 Drawer，无 Peek / Bulk Bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator('nav[aria-label="底部导航"]').getByRole("button", { name: "任务" }).click();
  await expect(page.getByRole("heading", { name: "任务工作区" })).toBeVisible();

  await page.locator('[data-assignment-id="a1"]').click();
  await expect(page.getByRole("button", { name: "关闭" }).first()).toBeVisible();
  await expect(page.getByTestId("assignment-peek")).toHaveCount(0);
  await expect(page.getByTestId("assignment-bulk-bar")).toHaveCount(0);
});

/** 本地日期字符串（与列表「截止: YYYY-MM-DD」一致） */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function dPlusLocal(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

test("Bulk DDL 平移：已选 2 项延后 2 天（时间保留）→ 撤销恢复", async ({ page }) => {
  await openWorkspace(page);
  await page.keyboard.press("j"); // highlight a1
  await page.keyboard.press("x"); // 选 a1
  await page.keyboard.press("j"); // highlight a2
  await page.keyboard.press("x"); // 选 a2

  const bar = page.getByTestId("assignment-bulk-bar");
  await expect(bar).toContainText("已选 2 项");
  await bar.getByRole("button", { name: "调整DDL" }).click();

  const popover = page.getByTestId("bulk-ddl-popover");
  await expect(popover).toBeVisible();
  await popover.locator('input[aria-label="平移天数"]').fill("2");
  await popover.getByRole("button", { name: "应用" }).nth(1).click();
  await expect(popover).toHaveCount(0);

  // Toast + 两行日期平移 +2 天
  await expect(page.getByText("2 项任务截止时间已调整").first()).toBeVisible();
  const shifted = dPlusLocal(3); // a1 原为 明天(+1) → +2
  await expect(page.locator('[data-assignment-id="a1"]')).toContainText(`截止: ${shifted}`);

  // 撤销恢复原日期
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.locator('[data-assignment-id="a1"]')).toContainText(
    `截止: ${dPlusLocal(1)}`
  );
});

test("Command Center 显示工作区上下文命令（标记当前任务完成）", async ({ page }) => {
  await openWorkspace(page);
  await page.keyboard.press("j"); // highlight a1
  await page.keyboard.press("x"); // 选 a1

  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-center")).toBeVisible();
  await expect(page.getByText("上下文操作")).toBeVisible();
  await expect(
    page.getByTestId("command-results").getByText("标记当前任务完成")
  ).toBeVisible();
  await expect(
    page.getByTestId("command-results").getByText("将当前任务设为高优先级")
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-center")).toHaveCount(0);
});
