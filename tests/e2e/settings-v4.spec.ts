import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Settings V4 — IA / Search Reliability / Profile Avatar / Agent 语言 E2E：
 * 1) 侧栏一级导航 = 9 项，无「交互与快捷键 / Kiro Agent / 数据与存储 / 已修改 N」
 * 2) Registry 搜索 → 跳转：section 切换 + 搜索清空 + DOM target + 高亮
 * 3) Profile 本地头像：选择图片 → 预览 → 保存 → reload 持久化；移除 → fallback + Blob 清理；
 *    非图片 / 超大图片拒绝；大图降采样后保存尺寸合理
 * 4) Agent 与权限：用户语言（无 Computer Agent / 默认权限模式 / Kiro Sandbox）
 */

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function openSettings(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

async function searchAndJump(page: Page, query: string, resultText: string) {
  const searchInput = page.getByRole("textbox", { name: "搜索设置" });
  await searchInput.fill(query);
  await expect(page.getByTestId("settings-search-results")).toContainText(resultText);
  await page
    .getByTestId("settings-search-results")
    .getByText(resultText, { exact: true })
    .first()
    .click();
  await expect(searchInput).toHaveValue("");
}

test("Settings V4 IA：侧栏一级导航 = 9 项，旧入口与「已修改 N」消失", async ({ page }) => {
  await openSettings(page);
  const nav = page.getByRole("navigation", { name: "设置导航" });

  const expected = [
    "通用",
    "个人资料",
    "学期与课表",
    "任务与提醒",
    "专注与学习",
    "Kiro",
    "Agent 与权限",
    "数据与隐私",
    "关于",
  ];
  for (const label of expected) {
    await expect(nav.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole("button", { name: "交互与快捷键" })).toHaveCount(0);
  await expect(nav.getByRole("button", { name: "Kiro Agent" })).toHaveCount(0);
  await expect(nav.getByRole("button", { name: "数据与存储" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /已修改/ })).toHaveCount(0);
});

test("搜索「头像」→ 个人资料 → avatar target 存在且高亮", async ({ page }) => {
  await openSettings(page);
  await searchAndJump(page, "头像", "头像");
  await expect(page.getByTestId("settings-profile")).toBeVisible();
  const target = page.locator('[data-setting-id="profile-avatar"]');
  await expect(target).toBeVisible();
  await expect(target).toHaveClass(/bg-pastel-mint/);
});

test("搜索「快捷键」→ 通用 → shortcut target 存在且高亮", async ({ page }) => {
  await openSettings(page);
  await searchAndJump(page, "快捷键", "启用单键快捷键");
  await expect(page.getByTestId("settings-general")).toBeVisible();
  const target = page.locator('[data-setting-id="single-key-shortcuts"]');
  await expect(target).toBeVisible();
  await expect(target).toHaveClass(/bg-pastel-mint/);
});

test("搜索「API Key」→ Kiro → API key target 存在且高亮", async ({ page }) => {
  await openSettings(page);
  await searchAndJump(page, "API Key", "API Key");
  await expect(page.getByTestId("settings-kiro")).toBeVisible();
  const target = page.locator('[data-setting-id="ai-api-key"]');
  await expect(target).toBeVisible();
  await expect(target).toHaveClass(/bg-pastel-mint/);
});

test("搜索「工作区」→ Agent 与权限 → workspace target 存在且高亮", async ({ page }) => {
  await openSettings(page);
  await searchAndJump(page, "工作区", "当前工作区");
  await expect(page.getByTestId("settings-kiro-agent")).toBeVisible();
  const target = page.locator('[data-setting-id="kiro-agent-workspace"]');
  await expect(target).toBeVisible();
  await expect(target).toHaveClass(/bg-pastel-mint/);
});

test("搜索「备份」→ 数据与隐私 → backup target 存在且高亮", async ({ page }) => {
  await openSettings(page);
  await searchAndJump(page, "备份", "完整备份");
  await expect(page.getByTestId("settings-data")).toBeVisible();
  const target = page.locator('[data-setting-id="backup-full"]');
  await expect(target).toBeVisible();
  await expect(target).toHaveClass(/bg-pastel-mint/);
});

test("Profile 头像：选择有效图片 → 预览 → 保存 → reload 后仍在", async ({ page }) => {
  await openSettings(page);
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "个人资料" })
    .click();
  const profile = page.getByTestId("settings-profile");
  await expect(profile).toBeVisible();

  // 选择图片 → 预览出现
  await profile.getByTestId("profile-avatar-input").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: TINY_PNG,
  });
  await expect(profile.getByTestId("settings-save-status")).toContainText("有未保存的更改");
  await expect(profile.locator("img")).toBeVisible();

  // 保存 → avatarStorageKey 写入持久化
  await profile.getByRole("button", { name: "保存" }).click();
  await expect(profile.getByTestId("settings-save-status")).toContainText("已保存");
  await expect.poll(async () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("classflow-storage-v2");
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.state?.userProfile?.avatarStorageKey ?? "";
    })
  ).toBe("profile-avatar");

  // reload 后头像仍在（从 IndexedDB Blob 加载，非 blob: URL 残留）
  await page.reload();
  await page.getByRole("button", { name: "设置" }).first().click();
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "个人资料" })
    .click();
  const img = page.getByTestId("settings-profile").locator("img");
  await expect(img).toBeVisible();
  const src = (await img.getAttribute("src")) ?? "";
  expect(src.startsWith("blob:")).toBe(true);
  await expect.poll(async () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("classflow-storage-v2");
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.state?.userProfile?.avatarUrl ?? "";
    })
  ).toBe("");
});

test("Profile 头像：移除 → 姓名首字 fallback + 本地 Blob 清理", async ({ page }) => {
  await openSettings(page);
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "个人资料" })
    .click();
  const profile = page.getByTestId("settings-profile");

  // 先设置一个头像（demoFixtures 的 URL 头像会被本地头像覆盖）
  await profile.getByTestId("profile-avatar-input").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: TINY_PNG,
  });
  await profile.getByRole("button", { name: "保存" }).click();
  await expect(profile.getByTestId("settings-save-status")).toContainText("已保存");

  // 移除头像 → 保存
  await profile.getByRole("button", { name: "移除头像" }).click();
  await profile.getByRole("button", { name: "保存" }).click();
  await expect(profile.getByTestId("settings-save-status")).toContainText("已保存");

  // 首字 fallback（img 消失）
  await expect(profile.locator("img")).toHaveCount(0);
  // 本地 Blob 已清理
  const blobExists = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open("classflow-profile-avatars", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db) return true;
    try {
      return await new Promise<boolean>((resolve) => {
        const tx = db.transaction("avatars", "readonly");
        const req = tx.objectStore("avatars").get("profile-avatar");
        req.onsuccess = () => resolve(req.result != null);
        req.onerror = () => resolve(true);
      });
    } finally {
      db.close();
    }
  });
  expect(blobExists).toBe(false);
});

test("Profile 头像：非图片文件被拒绝", async ({ page }) => {
  await openSettings(page);
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "个人资料" })
    .click();
  const profile = page.getByTestId("settings-profile");

  await profile.getByTestId("profile-avatar-input").setInputFiles({
    name: "avatar.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(profile.getByText(/请选择图片文件/)).toBeVisible();
  // 拒绝后头像保持原样（仍是 demoFixtures 的 URL 头像，未切换为 blob 预览）
  const img = profile.locator("img");
  await expect(img).toHaveCount(1);
  const src = (await img.getAttribute("src")) ?? "";
  expect(src.startsWith("blob:")).toBe(false);
});

test("Profile 头像：超过 5 MB 的图片被拒绝", async ({ page }) => {
  await openSettings(page);
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "个人资料" })
    .click();
  const profile = page.getByTestId("settings-profile");

  await profile.getByTestId("profile-avatar-input").setInputFiles({
    name: "huge.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 1),
  });
  await expect(profile.getByText(/不能超过 5 MB/)).toBeVisible();
  // 拒绝后头像保持原样（未切换为 blob 预览）
  const img = profile.locator("img");
  await expect(img).toHaveCount(1);
  const src = (await img.getAttribute("src")) ?? "";
  expect(src.startsWith("blob:")).toBe(false);
});

test("Profile 头像：大图保存前降采样（最长边 ≤ 512px）", async ({ page }) => {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 400;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#4A90D9";
      ctx.fillRect(0, 0, 600, 400);
    }
    return c.toDataURL("image/png").split(",")[1];
  });

  await openSettings(page);
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "个人资料" })
    .click();
  const profile = page.getByTestId("settings-profile");
  await profile.getByTestId("profile-avatar-input").setInputFiles({
    name: "big.png",
    mimeType: "image/png",
    buffer: Buffer.from(b64, "base64"),
  });
  await profile.getByRole("button", { name: "保存" }).click();
  await expect(profile.getByTestId("settings-save-status")).toContainText("已保存");

  // 预览 img 的 intrinsic 尺寸 = 已保存 Blob 尺寸（≤512）
  const dims = await page.evaluate(() => {
    const img = document.querySelector('[data-setting-id="profile-avatar"] img');
    if (!img) return null;
    const el = img as HTMLImageElement;
    return { w: el.naturalWidth, h: el.naturalHeight };
  });
  expect(dims).not.toBeNull();
  expect(dims!.w).toBeLessThanOrEqual(512);
  expect(dims!.h).toBeLessThanOrEqual(512);
  expect(dims!.w).toBe(512); // 600 宽 → 等比缩放至 512
});

test("Agent 与权限：用户语言覆盖（无 Computer Agent / 默认权限模式 / Kiro Sandbox）", async ({ page }) => {
  await openSettings(page);
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "Agent 与权限" })
    .click();
  const agent = page.getByTestId("settings-kiro-agent");
  await expect(agent).toBeVisible();

  // 主信息使用用户语言
  await expect(agent.getByText("允许 Kiro 操作文件", { exact: true }).first()).toBeVisible();
  await expect(agent.getByText("自动执行级别", { exact: true })).toBeVisible();
  await expect(agent.getByText("当前工作区", { exact: true })).toBeVisible();
  await expect(agent.getByText("可访问的位置", { exact: true })).toBeVisible();
  await expect(agent.getByText("权限与安全", { exact: true })).toBeVisible();
  await expect(agent.getByText("安全边界", { exact: true })).toBeVisible();
  await expect(agent.getByText("仅规划", { exact: true })).toBeVisible();
  await expect(agent.getByText("每次确认", { exact: true })).toBeVisible();
  await expect(agent.getByText("授权范围内自动", { exact: true })).toBeVisible();
  await expect(agent.getByRole("button", { name: "添加本地位置" })).toBeVisible();
  await expect(agent.getByRole("button", { name: "使用 Kiro 内置工作区" })).toBeVisible();

  // 工程术语不再出现（settings 内）
  await expect(agent.getByText("Computer Agent", { exact: true })).toHaveCount(0);
  await expect(agent.getByText("默认权限模式", { exact: true })).toHaveCount(0);
  await expect(agent.getByText("Kiro Sandbox", { exact: true })).toHaveCount(0);
  await expect(agent.getByText("受控", { exact: true })).toHaveCount(0);
  await expect(agent.getByText("工作区自动", { exact: true })).toHaveCount(0);
  await expect(agent.getByRole("switch", { name: "允许 Kiro 操作文件" })).toBeVisible();
});
