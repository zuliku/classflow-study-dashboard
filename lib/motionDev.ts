/**
 * Motion Dev 辅助（Motion V3 收尾：Gallery + fps 探针）—— 纯函数，无 DOM。
 *
 * 门禁约定（与 ?preview=task-v2 同模式）：
 * - 仅 development 构建可见（production 永不渲染，由调用组件统一守卫）；
 * - 查询参数显式开启：?motion-gallery=1（Gallery）、?motion-fps=1（fps 探针）；
 * - 默认全部关闭，不影响任何 E2E / 首屏 / 导航测试。
 */

export const MOTION_GALLERY_QUERY = "motion-gallery";
export const MOTION_FPS_QUERY = "motion-fps";

/** dev 构建门禁（测试环境 NODE_ENV=test → false，组件渲染 null） */
export function isMotionDev(): boolean {
  return process.env.NODE_ENV === "development";
}

function hasQueryFlag(search: string, key: string): boolean {
  if (!search) return false;
  try {
    return new URLSearchParams(search.startsWith("?") ? search : `?${search}`).get(key) === "1";
  } catch {
    return false;
  }
}

/** Gallery 开启条件：dev 构建 + ?motion-gallery=1 */
export function shouldShowMotionGallery(search: string): boolean {
  return isMotionDev() && hasQueryFlag(search, MOTION_GALLERY_QUERY);
}

/** fps 探针开启条件：dev 构建 + ?motion-fps=1 */
export function shouldShowFpsProbe(search: string): boolean {
  return isMotionDev() && hasQueryFlag(search, MOTION_FPS_QUERY);
}

/**
 * fps 换算（500ms 窗口帧数 → fps，保留 1 位小数）；
 * elapsedMs <= 0 时返回 0（除零保护）。
 */
export function computeFps(frames: number, elapsedMs: number): number {
  if (!Number.isFinite(frames) || !Number.isFinite(elapsedMs) || elapsedMs <= 0 || frames < 0) return 0;
  return Math.round((frames / elapsedMs) * 1000 * 10) / 10;
}

export interface FrameWindowSummary {
  /** 采样帧数 */
  count: number;
  /** 最差单帧（ms，保留 1 位小数） */
  worstMs: number;
  /** 超过 50ms 的帧数（两帧掉线以上） */
  jank50: number;
}

/**
 * 帧间隔摘要（探针滚动窗口 / E2E 门禁共用；纯函数）：
 * 非法值（非有限/负数）按 0 计，不抛错；空数组返回全零。
 */
export function summarizeFrameDeltas(deltas: number[]): FrameWindowSummary {
  const clean = deltas.filter((d) => Number.isFinite(d) && d >= 0);
  if (clean.length === 0) return { count: 0, worstMs: 0, jank50: 0 };
  return {
    count: clean.length,
    worstMs: Math.round(Math.max(...clean) * 10) / 10,
    jank50: clean.filter((d) => d > 50).length,
  };
}
