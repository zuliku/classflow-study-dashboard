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

/**
 * Motion V5 easing dev 灰度：
 * - URL ?motion-easing=v5 / v4（显式覆盖）
 * - localStorage 持久化（Gallery 开关写入）
 * - 只有 localhost / 127.0.0.1 的 dev 构建会应用；生产不暴露。
 */
export const MOTION_EASING_QUERY = "motion-easing";
export const MOTION_EASING_V5 = "v5";
export const MOTION_EASING_V4 = "v4";
export const MOTION_EASING_STORAGE_KEY = "classflow-motion-easing";
export const MOTION_EASING_EVENT = "classflow:motion-easing-change";

export type MotionEasingPreview = "v4" | "v5";

/** 解析 URL + localStorage：URL 显式值优先，否则 localStorage；非法值回落 v4 */
export function resolveMotionEasingPreview(search: string, stored: string | null): MotionEasingPreview {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  const urlValue = params.get(MOTION_EASING_QUERY);
  if (urlValue === MOTION_EASING_V5 || urlValue === MOTION_EASING_V4) return urlValue;
  return stored === MOTION_EASING_V5 ? MOTION_EASING_V5 : MOTION_EASING_V4;
}

/** dev 构建 + URL/localStorage 命中时启用 V5 曲线 */
export function shouldUseMotionEasingV5(search: string, stored: string | null = null): boolean {
  return isMotionDev() && resolveMotionEasingPreview(search, stored) === MOTION_EASING_V5;
}

/** 当前文档是否已挂 V5 标记（CSS flag 的运行时读取） */
export function isMotionEasingV5Active(): boolean {
  return typeof document !== "undefined"
    && document.documentElement.dataset.motionEasing === MOTION_EASING_V5;
}

/**
 * 切换 V5 灰度（仅 dev Gallery 调用）：
 * - DOM dataset 驱动 CSS 变量；
 * - localStorage 持久化；
 * - URL 同步（可分享/刷新）
 * - 派发事件，供 Framer Motion 等 JS easing 消费方同步。
 */
export function applyMotionEasingPreview(enabled: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (enabled) root.dataset.motionEasing = MOTION_EASING_V5;
  else delete root.dataset.motionEasing;

  try {
    window.localStorage.setItem(
      MOTION_EASING_STORAGE_KEY,
      enabled ? MOTION_EASING_V5 : MOTION_EASING_V4
    );
  } catch {
    /* localStorage 不可用时仅本次会话生效 */
  }

  try {
    const params = new URLSearchParams(window.location.search);
    if (enabled) params.set(MOTION_EASING_QUERY, MOTION_EASING_V5);
    else params.delete(MOTION_EASING_QUERY);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  } catch {
    /* URL 同步失败不影响 dataset 生效 */
  }

  try {
    window.dispatchEvent(new CustomEvent(MOTION_EASING_EVENT, { detail: enabled }));
  } catch {
    /* CustomEvent 不可用（极老环境）时静默 */
  }
}

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
