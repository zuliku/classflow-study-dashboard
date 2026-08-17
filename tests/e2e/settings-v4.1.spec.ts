import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Settings V4.1 — Reliability & Finish E2E：
 * 1) 条件搜索：gate 未满足 → 跳到控制设置 + 提示（绝不产生死跳转 / 绝不改偏好）
 * 2) 条件搜索：gate 满足 → 直达目标；披露目标自动展开（搜索设置 / 高级设置）
 * 3) 脏草稿保护：Profile / Semester 的 X / Esc / backdrop 关闭均需显式确认
 * 4) 头像完整备份 round-trip（ZIP 携带 + 恢复一致）；JSON 备份不导出不可用引用
 * 5) 头像健壮性：伪 image/* 载荷拒绝；重复选择时旧预览 URL 被回收
 * 6) 桌面 / 移动 smoke
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

async function searchAndClickResult(page: Page, query: string, resultText: string) {
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

async function setCustomProvider(page: Page) {
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "Kiro" })
    .click();
  const providerSelect = page.getByTestId("settings-kiro").getByRole("combobox", { name: "AI 服务" });
  await providerSelect.click();
  await page
    .getByRole("listbox", { name: "AI 服务" })
    .getByRole("option", { name: "自定义 OpenAI 兼容服务" })
    .click();
  await expect(page.getByTestId("settings-kiro").locator('[data-setting-id="ai-custom-name"]')).toBeVisible();
}

// ==================== 1. 条件搜索：gate 未满足 ====================

test("条件搜索：自定义服务字段在 deepseek 下不可直达 → 跳「AI 服务」+ 提示（不改偏好）", async ({ page }) => {
  await openSettings(page);
  // 默认 provider = deepseek：custom 字段隐藏
  await searchAndClickResult(page, "服务名称", "服务名称");

  // 落到 Kiro 节、AI 服务行高亮、目标不存在
  await expect(page.getByTestId("settings-kiro")).toBeVisible();
  await expect(page.locator('[data-setting-id="ai-provider"]')).toHaveClass(/bg-pastel-mint/);
  await expect(page.locator('[data-setting-id="ai-custom-name"]')).toHaveCount(0);
  // 引导提示
  await expect(page.getByText(/「服务名称」需要先调整「AI 服务」/)).toBeVisible();
  // 未改动任何偏好（provider 仍为 deepseek）
  await expect(page.getByTestId("settings-kiro").getByRole("combobox", { name: "AI 服务" })).toContainText("DeepSeek");
});

test("条件搜索：联网搜索关闭时「Tavily API Key」→ 跳「联网搜索」+ 提示", async ({ page }) => {
  await openSettings(page);
  // 关闭联网搜索
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "Kiro" })
    .click();
  const webToggle = page.getByTestId("settings-kiro").getByRole("switch", { name: "联网搜索" });
  if ((await webToggle.getAttribute("aria-checked")) === "true") {
    await webToggle.click();
  }
  await expect(webToggle).toHaveAttribute("aria-checked", "false");

  await searchAndClickResult(page, "Tavily", "Tavily API Key");
  await expect(page.locator('[data-setting-id="kiro-web-search-enabled"]')).toHaveClass(/bg-pastel-mint/);
  await expect(page.locator('[data-setting-id="kiro-web-search-byok-key"]')).toHaveCount(0);
  await expect(page.getByText(/「Tavily API Key」需要先调整「联网搜索」/)).toBeVisible();
});

// ==================== 2. 条件搜索：gate 满足 + 披露自动展开 ====================

test("条件搜索：custom provider 时「服务地址」可直达（无需展开任何折叠区）", async ({ page }) => {
  await openSettings(page);
  await setCustomProvider(page);

  await searchAndClickResult(page, "服务地址", "服务地址");
  await expect(page.locator('[data-setting-id="ai-custom-url"]')).toBeVisible();
  await expect(page.locator('[data-setting-id="ai-custom-url"]')).toHaveClass(/bg-pastel-mint/);
  await expect(page.getByText(/需要先调整/)).toHaveCount(0);
});

test("条件搜索：搜索设置披露自动展开 →「凭据」直达", async ({ page }) => {
  await openSettings(page);
  // 确保联网搜索开启
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "Kiro" })
    .click();
  const webToggle = page.getByTestId("settings-kiro").getByRole("switch", { name: "联网搜索" });
  if ((await webToggle.getAttribute("aria-checked")) !== "true") {
    await webToggle.click();
  }

  await searchAndClickResult(page, "凭据", "凭据");
  // 披露自动展开 + 目标直达高亮
  await expect(page.getByRole("button", { name: "搜索设置" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('[data-setting-id="kiro-web-search-credential"]')).toBeVisible();
  await expect(page.locator('[data-setting-id="kiro-web-search-credential"]')).toHaveClass(/bg-pastel-mint/);
});

test("条件搜索：高级设置披露自动展开 →「自定义模型能力」直达", async ({ page }) => {
  await openSettings(page);
  await setCustomProvider(page);

  await searchAndClickResult(page, "自定义模型能力", "自定义模型能力");
  await expect(page.getByRole("button", { name: "高级设置" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('[data-setting-id="ai-custom-capabilities"]')).toBeVisible();
  await expect(page.locator('[data-setting-id="ai-custom-capabilities"]')).toHaveClass(/bg-pastel-mint/);
});

test("条件搜索：高级设置披露自动展开 →「扫描 PDF 识别」直达（无需切 provider）", async ({ page }) => {
  await openSettings(page);
  await searchAndClickResult(page, "扫描 PDF", "扫描 PDF 识别");
  await expect(page.getByRole("button", { name: "高级设置" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('[data-setting-id="kiro-web-pdf-vision-enabled"]')).toBeVisible();
});

// ==================== 3. 脏草稿保护 ====================

test("脏草稿（Profile）：X 关闭需确认；取消保留草稿；确认后丢弃", async ({ page }) => {
  await openSettings(page);
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "个人资料" })
    .click();
  const nameInput = page.getByTestId("settings-profile").getByLabel("姓名");
  await nameInput.fill("未保存的名字");

  // X → 确认对话框
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "放弃未保存的更改？" })).toBeVisible();
  // 取消 → 保持打开且草稿仍在
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  await expect(nameInput).toHaveValue("未保存的名字");

  // 再 X → 放弃更改 → 关闭
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByRole("dialog", { name: "设置" })).toHaveCount(0);

  // 重新打开：草稿已丢弃（回到 store 值）
  await page.getByRole("button", { name: "设置" }).first().click();
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "个人资料" })
    .click();
  await expect(page.getByTestId("settings-profile").getByLabel("姓名")).not.toHaveValue("未保存的名字");
});

test("脏草稿（Profile）：Esc 关闭需确认；backdrop 关闭被禁用", async ({ page }) => {
  await openSettings(page);
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "个人资料" })
    .click();
  const nameInput = page.getByTestId("settings-profile").getByLabel("姓名");
  await nameInput.fill("Esc 草稿");

  // backdrop 点击：脏状态下不关闭
  await page.mouse.click(8, 8);
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  await expect(nameInput).toHaveValue("Esc 草稿");

  // Esc → 确认对话框（脏）
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog", { name: "放弃未保存的更改？" })).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();

  // 确认丢弃 → 关闭
  await page.keyboard.press("Escape");
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByRole("dialog", { name: "设置" })).toHaveCount(0);
});

test("脏草稿（Semester）：X / backdrop 需确认；保存后清除脏状态", async ({ page }) => {
  await openSettings(page);
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "学期与课表" })
    .click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const nameInput = page.getByTestId("settings-semester").getByLabel("学期名称");
  await nameInput.fill("修改后的学期名");

  // backdrop 不关闭
  await page.mouse.click(8, 8);
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  // X → 确认 → 取消 → 仍打开
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "放弃未保存的更改？" })).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();

  // 保存 → 脏状态清除 → X 直接关闭（无确认；编辑表单卸载后 save bar 消失）
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "设置" })).toHaveCount(0);
});

// ==================== 4. 头像备份 round-trip ====================

test("头像完整备份 round-trip：导出 ZIP（含头像）→ 移除 → 恢复 → 头像与引用一致", async ({ page }) => {
  await openSettings(page);
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "个人资料" })
    .click();
  const profile = page.getByTestId("settings-profile");

  // 1) 设置头像并保存
  await profile.getByTestId("profile-avatar-input").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: TINY_PNG,
  });
  await profile.getByRole("button", { name: "保存" }).click();
  await expect(profile.getByTestId("settings-save-status")).toContainText("已保存");

  // 2) 导出完整备份 ZIP（下载）
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "数据与隐私" })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 ZIP" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("classflow_full_backup");
  const zipPath = await download.path();

  // 3) 移除头像
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "个人资料" })
    .click();
  await profile.getByRole("button", { name: "移除头像" }).click();
  await profile.getByRole("button", { name: "保存" }).click();
  await expect(profile.getByTestId("settings-save-status")).toContainText("已保存");
  await expect(profile.locator("img")).toHaveCount(0);
  await expect.poll(async () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("classflow-storage-v2");
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.state?.userProfile?.avatarStorageKey ?? "";
    })
  ).toBe("");

  // 4) 恢复完整备份 → 头像回来（下载临时路径无 .zip 后缀，以 buffer + 明确文件名传入）
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "数据与隐私" })
    .click();
  const { readFile } = await import("node:fs/promises");
  const zipBuffer = await readFile(zipPath!);
  await page.locator("#restore-file-input").setInputFiles({
    name: "classflow_full_backup_roundtrip.zip",
    mimeType: "application/zip",
    buffer: zipBuffer,
  });
  const preview = page.getByTestId("restore-preview");
  await expect(preview).toBeVisible();
  await preview.getByTestId("confirm-restore").click();
  await expect(page.getByTestId("restore-result")).toBeVisible();

  // 5) 验证：metadata 引用 + 本地头像 Blob 均已恢复
  await expect.poll(async () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("classflow-storage-v2");
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.state?.userProfile?.avatarStorageKey ?? "";
    })
  ).toBe("profile-avatar");
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "个人资料" })
    .click();
  const img = page.getByTestId("settings-profile").locator("img");
  await expect(img).toBeVisible();
  const src = (await img.getAttribute("src")) ?? "";
  expect(src.startsWith("blob:")).toBe(true);
});

test("JSON 备份头像语义：不导出不可用引用；恢复后无头像且无悬挂 key", async ({ page }) => {
  await openSettings(page);
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "个人资料" })
    .click();
  const profile = page.getByTestId("settings-profile");
  await profile.getByTestId("profile-avatar-input").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: TINY_PNG,
  });
  await profile.getByRole("button", { name: "保存" }).click();
  await expect(profile.getByTestId("settings-save-status")).toContainText("已保存");

  // 导出 JSON：内容不得包含 avatarStorageKey
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "数据与隐私" })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let text = "";
  for await (const chunk of stream) text += chunk.toString();
  const parsed = JSON.parse(text);
  expect(parsed.data.userProfile.avatarStorageKey).toBeUndefined();

  // 恢复 JSON → 头像不恢复、无悬挂 key
  await page.locator("#restore-file-input").setInputFiles({
    name: "classflow_backup_semantics.json",
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
  await page.getByTestId("restore-preview").getByTestId("confirm-restore").click();
  await expect(page.getByTestId("restore-result")).toBeVisible();
  await expect.poll(async () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("classflow-storage-v2");
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.state?.userProfile?.avatarStorageKey ?? "";
    })
  ).toBe("");
});

// ==================== 5. 头像健壮性 ====================

test("头像健壮性：伪装 image/* 的无效字节在选择阶段被拒绝", async ({ page }) => {
  await openSettings(page);
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "个人资料" })
    .click();
  const profile = page.getByTestId("settings-profile");

  await profile.getByTestId("profile-avatar-input").setInputFiles({
    name: "fake.png",
    mimeType: "image/png",
    buffer: Buffer.from("this is definitely not a valid image payload"),
  });
  await expect(profile.getByText(/无法识别该图片文件/)).toBeVisible();
  // 未产生预览（仍为 demoFixtures 的 URL 头像）
  const img = profile.locator("img");
  await expect(img).toHaveCount(1);
  const src = (await img.getAttribute("src")) ?? "";
  expect(src.startsWith("blob:")).toBe(false);
  // 未进入保存状态
  await expect(profile.getByTestId("settings-save-status")).toContainText("已保存");
});

test("头像健壮性：重复选择时旧预览 Object URL 被回收", async ({ page }) => {
  await page.addInitScript(() => {
    const created: string[] = [];
    const revoked: string[] = [];
    const origCreate = URL.createObjectURL.bind(URL);
    const origRevoke = URL.revokeObjectURL.bind(URL);
    (window as unknown as Record<string, unknown>).__createdUrls = created;
    (window as unknown as Record<string, unknown>).__revokedUrls = revoked;
    URL.createObjectURL = (b: Blob) => {
      const u = origCreate(b);
      created.push(u);
      return u;
    };
    URL.revokeObjectURL = (u: string) => {
      revoked.push(u);
      origRevoke(u);
    };
  });
  await openSettings(page);
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "个人资料" })
    .click();
  const profile = page.getByTestId("settings-profile");

  // 第一次选择（PNG）
  await profile.getByTestId("profile-avatar-input").setInputFiles({
    name: "a.png",
    mimeType: "image/png",
    buffer: TINY_PNG,
  });
  const createdAfterFirst = await page.evaluate(
    () => ((window as unknown as Record<string, unknown>).__createdUrls as string[]).slice()
  );
  expect(createdAfterFirst.length).toBeGreaterThan(0);

  // 第二次选择（JPEG，经 canvas 生成确保可解码）
  const jpegB64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 4;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#336699";
      ctx.fillRect(0, 0, 4, 4);
    }
    return c.toDataURL("image/jpeg").split(",")[1];
  });
  await profile.getByTestId("profile-avatar-input").setInputFiles({
    name: "b.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(jpegB64, "base64"),
  });

  // 旧预览 URL 已被回收
  const revoked = await page.evaluate(
    () => ((window as unknown as Record<string, unknown>).__revokedUrls as string[]).slice()
  );
  expect(revoked).toContain(createdAfterFirst[0]);
});

// ==================== 6. 桌面 / 移动 smoke ====================

test("smoke：桌面设置可开合、导航可用；移动端搜索与 tabs 可用且无溢出", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "搜索设置" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "任务与提醒" })
    .click();
  await expect(page.getByTestId("settings-tasks")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "设置" })).toHaveCount(0);

  // Mobile：全屏 + 搜索 + 横向 tabs（设置入口在底部导航「更多」菜单内）
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("navigation", { name: "底部导航" }).getByRole("button", { name: "更多" }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "搜索设置" })).toBeVisible();
  await page.getByRole("button", { name: "学期与课表" }).click();
  await expect(page.getByTestId("settings-semester")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(overflow).toBe(false);
});
