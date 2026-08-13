import { expect } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Kiro Computer Agent V1 Part 1 — Composer/Settings 控制面 E2E（只测 controls，不测文件写入）。
 * CI-friendly：使用 Kiro Sandbox 引导路径（不依赖 native directory picker）。
 * fixture model = DeepSeek official（fixed reasoning）→ 验证不出现假的可调 chip。
 */

test("Computer controls：Sandbox 引导 → 状态同步（Composer ↔ Settings）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.waitForTimeout(800);

  const composer = page.getByTestId("kiro-composer");
  await expect(composer).toBeVisible();

  // 1. clean state：Computer OFF
  const computerToggle = composer.getByRole("button", { name: "Computer" });
  await expect(computerToggle).toHaveAttribute("aria-pressed", "false");

  // 2. 点击 → Sandbox 引导（无 workspace → 自动创建 Kiro Sandbox + 启用）
  await computerToggle.click();
  await expect(computerToggle).toHaveAttribute("aria-pressed", "true");

  // 3. Workspace strip（Context Bar 层）显示 Sandbox
  await expect(composer.getByRole("button", { name: "工作区" })).toBeVisible();
  await expect(composer.getByRole("button", { name: "工作区" })).toContainText("Sandbox");

  // 3b. UX Closeout：Workspace 在 Context Strip（不压缩 Prompt）；textarea 保持稳定输入高度
  const textarea = composer.getByLabel("Ask Kiro");
  const textareaBox = await textarea.boundingBox();
  expect(textareaBox).not.toBeNull();
  expect(textareaBox!.height).toBeGreaterThanOrEqual(60);

  // 4. Agent Mode 菜单可见（Computer ON 时）；受控 → 计划；菜单向上展开且完整在 viewport 内
  const modeMenu = composer.getByRole("button", { name: "权限模式" });
  await expect(modeMenu).toBeVisible();
  await expect(modeMenu).toContainText("受控");
  await modeMenu.click();
  await expect(page.getByRole("menu", { name: "权限模式" })).toBeVisible();
  const menuBox = await page.getByRole("menu", { name: "权限模式" }).boundingBox();
  const triggerBox = await modeMenu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();
  // 向上展开：menu 底 <= trigger 顶（+4 容差），且 menu 完整在 viewport 内
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(triggerBox!.y + 4);
  expect(menuBox!.y).toBeGreaterThanOrEqual(0);
  await page.getByRole("menuitem", { name: /计划/ }).first().click();
  await expect(modeMenu).toContainText("计划");

  // 5. Reasoning：DeepSeek fixture 为 fixed → Composer 不显示假的可调 chip
  await expect(composer.getByRole("button", { name: "思考程度" })).toHaveCount(0);

  // 6. Settings → Kiro Agent：Computer ON + 模式 = 计划（同一 store）
  await page.locator("aside").first().getByRole("button", { name: "设置" }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "Kiro Agent" }).click();
  await page.waitForTimeout(400);
  await expect(page.getByTestId("settings-kiro-agent")).toBeVisible();
  const agentToggle = page.getByRole("switch", { name: "Computer Agent" });
  await expect(agentToggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("settings-kiro-agent")).toContainText("Kiro Sandbox");

  // 6b. Workspace Management：紧凑 row（exactly one canonical Sandbox；当前 badge；inline metadata）
  const workspaceRows = page.getByTestId("kiro-workspace-row");
  await expect(workspaceRows).toHaveCount(1);
  await expect(workspaceRows.first()).toContainText("Kiro Sandbox");
  await expect(workspaceRows.first()).toContainText("当前");
  await expect(workspaceRows.first()).toContainText("当前浏览器");
  await expect(workspaceRows.first()).toContainText("读写");
  await expect(workspaceRows.first().getByRole("button", { name: /删除工作区/ })).toBeVisible();
  // canonical Sandbox 已存在 → 不再显示「使用 Kiro Sandbox」（杜绝重复创建）
  await expect(page.getByRole("button", { name: "使用 Kiro Sandbox" })).toHaveCount(0);

  // 7. Settings → Kiro 与 AI：思考程度 = 当前模型不可调（fixed 不展示假 control）
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "Kiro 与 AI" }).click();
  await page.waitForTimeout(400);
  await expect(page.getByText("思考程度").first()).toBeVisible();
  await expect(page.getByTestId("settings-kiro").getByText("当前模型不可调")).toBeVisible();

  // 8. 返回 Kiro：状态仍一致（Composer ↔ Settings 同一 store）
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.waitForTimeout(600);
  await expect(composer.getByRole("button", { name: "Computer" })).toHaveAttribute("aria-pressed", "true");
  await expect(composer.getByRole("button", { name: "权限模式" })).toContainText("计划");

  // 9. 普通聊天不受影响：Ask Kiro textarea 可用
  await expect(composer.getByLabel("Ask Kiro")).toBeVisible();

  // 9b. Workspace Management：删除最后一个 Sandbox → row 消失 + Computer Agent OFF
  await page.locator("aside").first().getByRole("button", { name: "设置" }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "Kiro Agent" }).click();
  await page.waitForTimeout(400);
  await workspaceRows.first().getByRole("button", { name: /删除工作区/ }).click();
  const confirmDialog = page.getByRole("alertdialog");
  await expect(confirmDialog).toContainText("删除 Kiro Sandbox");
  await confirmDialog.getByRole("button", { name: "删除" }).click();
  await expect(workspaceRows).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Computer Agent" })).toHaveAttribute(
    "aria-checked",
    "false"
  );

  // 10. Responsive sanity：1100×700 下 Composer/Send 可见，权限菜单仍在 viewport 内
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await page.waitForTimeout(600);
  // 删除后 Computer OFF；重新打开走 canonical Sandbox 引导（再次创建且仅一个）
  await expect(composer.getByRole("button", { name: "Computer" })).toHaveAttribute("aria-pressed", "false");
  await composer.getByRole("button", { name: "Computer" }).click();
  await expect(composer.getByRole("button", { name: "Computer" })).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.waitForTimeout(400);
  await expect(composer).toBeVisible();
  await expect(composer.getByRole("button", { name: "发送" })).toBeVisible();
  await modeMenu.click();
  await expect(page.getByRole("menu", { name: "权限模式" })).toBeVisible();
  const respBox = await page.getByRole("menu", { name: "权限模式" }).boundingBox();
  expect(respBox).not.toBeNull();
  expect(respBox!.y).toBeGreaterThanOrEqual(0);
  expect(respBox!.y + respBox!.height).toBeLessThanOrEqual(700);
});
