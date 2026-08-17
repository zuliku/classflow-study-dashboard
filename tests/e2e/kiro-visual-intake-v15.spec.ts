import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";
import zlib from "node:zlib";

/**
 * Visual Intake V1.5 / V1.5.1：Screenshot Intake 入口 + Live Image Preview（E2E；无需 AI）。
 * 1. Attachment Picker 显示截图用途（添加聊天截图或图片 + 场景描述）
 * 2. ready image suggestions 仍是「点击只填 Prompt」（不直接发送）
 * 3. Composer thumbnail 点击 → 大图 Preview（Esc / Backdrop 关闭）
 * 4. Preview 不把 File/dataURL/blob 写入任何持久层
 * 5. V1.5.1：真实长聊天截图（1080×5000+）→ viewport 纵向滚动 + 可读宽度（无高度压缩）
 */

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/** 动态生成真实 PNG（node zlib + CRC32；RGB 8-bit）—— 长截图 fixture 不能是 1×1 假图 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function buildPng(width: number, height: number): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const o = rowStart + 1 + x * 3;
      raw[o] = (x + y) % 256;
      raw[o + 1] = (x * 3) % 256;
      raw[o + 2] = (y * 5) % 256;
    }
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const LONG_CHAT_PNG: Buffer = buildPng(1080, 5000) as Buffer;

// suggestions 依赖 vision capability（deepseek 无 vision）；用 vision 模型 mimo-v2.5 配置
const AI_SETTINGS = {
  enabled: true,
  provider: "opencode-go",
  model: "mimo-v2.5",
  custom: { providerName: "", baseURL: "", model: "" },
  memoryEnabled: true,
  reasoningEffort: "medium",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:opencode-go", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
});

async function openKiro(page: Page) {
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  return page.getByTestId("kiro-composer");
}

/** 走真实 Picker 菜单项（pickFiles 挂载 onchange 后由 filechooser 提供文件；同一 pipeline） */
async function addImageViaPicker(page: Page, name: string, buffer: Buffer = PNG_BYTES) {
  const composer = page.getByTestId("kiro-composer");
  await composer.getByRole("button", { name: "添加附件" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /添加聊天截图或图片/ }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name, mimeType: "image/png", buffer: buffer as Buffer });
}

test("Attachment Picker：截图用途入口文案（添加聊天截图或图片）", async ({ page }) => {
  const composer = await openKiro(page);
  await composer.getByRole("button", { name: "添加附件" }).click();
  const item = page.getByRole("menuitem", { name: /添加聊天截图或图片/ });
  await expect(item).toBeVisible();
  await expect(item).toContainText(/班群通知、作业或调课截图/);
  await expect(item).toContainText(/JPG \/ PNG \/ WEBP/);
});

test("ready image suggestions：点击只填 Prompt，不直接发送", async ({ page }) => {
  const composer = await openKiro(page);
  await addImageViaPicker(page, "chat-screenshot.png");
  await expect(page.getByTestId("kiro-attachment-chip")).toBeVisible();
  await expect(page.getByTestId("kiro-attachment-chip")).toContainText(/PNG/);
  // ready 后出现 intent chips（3 个；含「处理截图通知」）
  const suggestions = page.getByTestId("visual-suggestion");
  await expect(suggestions).toHaveCount(3);
  await expect(suggestions).toContainText(["处理截图通知", "整理任务与 DDL", "识别课程变动"]);
  // 点击只填 Prompt（textarea 有值；没有发送 → 无 assistant 消息）
  await suggestions.filter({ hasText: "处理截图通知" }).click();
  await expect(composer.getByRole("textbox", { name: "Ask Kiro" })).toHaveValue("处理截图通知");
  await expect(page.getByTestId("kiro-message")).toHaveCount(0);
});

test("Composer 缩略图点击 → 大图 Preview；Esc / Backdrop 关闭", async ({ page }) => {
  const composer = await openKiro(page);
  await addImageViaPicker(page, "long-chat.png");
  await expect(page.getByTestId("kiro-attachment-thumb-preview")).toBeVisible();
  await page.getByTestId("kiro-attachment-thumb-preview").click();
  const preview = page.getByTestId("kiro-image-preview");
  await expect(preview).toBeVisible();
  await expect(preview.locator("img")).toBeVisible();
  // Esc 关闭
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  // 再开 → Backdrop 关闭
  await page.getByTestId("kiro-attachment-thumb-preview").click();
  await expect(page.getByTestId("kiro-image-preview")).toBeVisible();
  await page.getByTestId("kiro-image-preview-backdrop").click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId("kiro-image-preview")).toHaveCount(0);
});

test("Preview 不把 File / dataURL / blob 写入任何持久层", async ({ page }) => {
  const composer = await openKiro(page);
  await addImageViaPicker(page, "chat.png");
  await page.getByTestId("kiro-attachment-thumb-preview").click();
  await expect(page.getByTestId("kiro-image-preview")).toBeVisible();
  // 预览打开期间：localStorage 不应出现文件内容 / blob URL
  const all = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      out[k] = localStorage.getItem(k) ?? "";
    }
    return JSON.stringify(out);
  });
  expect(all).not.toContain("blob:");
  expect(all).not.toContain("data:image");
  expect(all).not.toContain("iVBORw0KGgo"); // PNG base64 内容不得落 localStorage
});

test("V1.5.1：真实长聊天截图（1080×5000）→ viewport 纵向滚动 + 可读宽度（无高度压缩）", async ({ page }) => {
  const composer = await openKiro(page);
  await addImageViaPicker(page, "long-chat-real.png", LONG_CHAT_PNG);
  await expect(page.getByTestId("kiro-attachment-thumb-preview")).toBeVisible();
  await page.getByTestId("kiro-attachment-thumb-preview").click();
  const preview = page.getByTestId("kiro-image-preview");
  await expect(preview).toBeVisible();

  const viewport = page.getByTestId("kiro-image-preview-viewport");
  const image = page.getByTestId("kiro-image-preview-image");
  await expect(viewport).toBeVisible();
  await expect(image).toBeVisible();

  // 长图：viewport 纵向可滚动（scrollHeight > clientHeight）
  const dims = await viewport.evaluate((el) => ({
    sh: el.scrollHeight,
    ch: el.clientHeight,
  }));
  expect(dims.sh).toBeGreaterThan(dims.ch);

  // 图片宽度达到可读 viewport 范围（1080 原宽 → 不被高度约束压成窄条）
  const imgDims = await image.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      w: Math.round(el.getBoundingClientRect().width),
      vw: Math.round((el.closest("[data-testid='kiro-image-preview']") as HTMLElement).getBoundingClientRect().width),
      maxHeight: cs.maxHeight,
      maxWidth: cs.maxWidth,
      display: cs.display,
    };
  });
  expect(imgDims.w).toBeGreaterThan(900); // 可读宽度（不是 100px 级窄条）
  expect(imgDims.w).toBeGreaterThan(imgDims.vw * 0.8);
  expect(imgDims.maxHeight).toBe("none"); // img 本身不得有 max-height（否则会压缩长图）
  expect(imgDims.display).toBe("block");

  // 关闭后 object URL 已 revoke（无泄漏）：关闭 preview 后再次打开仍正常
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await page.getByTestId("kiro-attachment-thumb-preview").click();
  await expect(page.getByTestId("kiro-image-preview")).toBeVisible();
});
