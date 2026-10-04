/**
 * Computer Use Phase 1 — 截图采集（Electron desktopCapturer；只读）。
 *
 * 契约：
 * - 只在内存中生成 bounded JPEG（dataUrl）；绝不写入磁盘 / 绝不持久化
 * - 窗口截图按窗口标题匹配 source；匹配失败 → 降级为主屏截图（调用方记录 warning）
 * - 尺寸/体积双重 bound（thumbnail → resize → toJPEG quality 阶梯）
 */
import { desktopCapturer, screen } from "electron";

export interface NativeScreenshot {
  mimeType: "image/jpeg";
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  capturedAt: string;
}

export const MAX_SCREENSHOT_WIDTH = 1280;
export const MAX_SCREENSHOT_HEIGHT = 800;
export const MAX_SCREENSHOT_BYTES = 1_200_000;

export interface CaptureScreenshotInput {
  target: "active-window" | "screen";
  /** 目标窗口标题（window target 时用于匹配 desktopCapturer source） */
  windowTitle?: string | null;
}

/** 主屏逻辑尺寸（viewport 兜底 / screen target 使用） */
export function getPrimaryScreenSize(): { width: number; height: number } {
  try {
    const display = screen.getPrimaryDisplay();
    return {
      width: Math.max(1, Math.round(display.size?.width ?? display.workAreaSize?.width ?? 0)),
      height: Math.max(1, Math.round(display.size?.height ?? display.workAreaSize?.height ?? 0)),
    };
  } catch {
    return { width: 0, height: 0 };
  }
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** P2：截图 500ms LRU（expect 轮询 300ms 间隔连续 getSources 全量缩略图；UIA 保持每次新鲜，仅截图复用） */
const SCREENSHOT_CACHE_TTL_MS = 500;
const screenshotCache = new Map<string, { at: number; shot: NativeScreenshot }>();
function screenshotCacheKey(input: CaptureScreenshotInput): string {
  return `${input.target}::${(input.windowTitle ?? "").toLowerCase().slice(0, 80)}`;
}

/**
 * 采集截图；失败 / 无可用 source → null（调用方降级为无截图观察）。
 */
export async function captureDesktopScreenshot(
  input: CaptureScreenshotInput
): Promise<NativeScreenshot | null> {
  const key = screenshotCacheKey(input);
  const hit = screenshotCache.get(key);
  if (hit && Date.now() - hit.at < SCREENSHOT_CACHE_TTL_MS) return hit.shot;
  let sources: Electron.DesktopCapturerSource[];
  try {
    sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: MAX_SCREENSHOT_WIDTH, height: MAX_SCREENSHOT_HEIGHT },
      fetchWindowIcons: false,
    });
  } catch {
    return null;
  }
  if (!sources || sources.length === 0) return null;

  let source: Electron.DesktopCapturerSource | undefined;
  if (input.target === "active-window" && input.windowTitle) {
    const wanted = normalizeTitle(input.windowTitle);
    source = sources.find((s) => s.id.startsWith("window:") && normalizeTitle(s.name) === wanted);
  }
  // window source 缺失（UWP / 标题不匹配 / 权限窗口）→ 主屏截图兜底，保证观察仍有证据
  if (!source && (input.target === "screen" || input.target === "active-window")) {
    let primaryDisplayId: string | null = null;
    try {
      primaryDisplayId = String(screen.getPrimaryDisplay().id);
    } catch {
      primaryDisplayId = null;
    }
    source = sources.find((s) => s.id.startsWith("screen:") && s.display_id === primaryDisplayId);
    if (!source) source = sources.find((s) => s.id.startsWith("screen:"));
  }
  if (!source) return null;

  let image = source.thumbnail;
  if (!image || image.isEmpty()) return null;
  const original = image.getSize();
  if (original.width > MAX_SCREENSHOT_WIDTH) {
    image = image.resize({ width: MAX_SCREENSHOT_WIDTH, quality: "good" });
  }
  const size = image.getSize();
  if (!size.width || !size.height) return null;

  let jpeg = image.toJPEG(70);
  if (jpeg.length > MAX_SCREENSHOT_BYTES) {
    jpeg = image.toJPEG(45);
  }
  if (jpeg.length > MAX_SCREENSHOT_BYTES) return null;

  const shot: NativeScreenshot = {
    mimeType: "image/jpeg",
    dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
    width: size.width,
    height: size.height,
    bytes: jpeg.length,
    capturedAt: new Date().toISOString(),
  };
  if (screenshotCache.size > 8) screenshotCache.clear();
  screenshotCache.set(key, { at: Date.now(), shot });
  return shot;
}
