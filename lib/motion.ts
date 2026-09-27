/**
 * ClassFlow Motion Contract V3 —— 全局交互动效时间 + 缓动唯一真值（JS 侧）。
 *
 * 与 app/globals.css :root 的同名 CSS 变量一一对应：
 *   MOTION_MS.snap        = --motion-snap        press / instant feedback
 *   MOTION_MS.fast        = --motion-fast        popover / tooltip / icon / tiny surface
 *   MOTION_MS.base        = --motion-base        disclosure / list enter / selection / content transition
 *   MOTION_MS.overlay     = --motion-overlay     Dialog / Drawer panel enter
 *   MOTION_MS.panel       = --motion-panel       App Chrome morph 域（Sidebar shell/profile padding；
 *                                                属 Sidebar Rail Morph choreography，本轮不动）
 *   MOTION_MS.page        = --motion-page        页面 Tab 切换（opacity-only）
 *   MOTION_MS.data        = --motion-data        progress / chart / number transitions
 *
 * Exit durations ≈ 对应 enter 档位的 70–80%：
 *   MOTION_EXIT_MS.fast   = --motion-exit-fast   popover / select menu / toast exit
 *   MOTION_EXIT_MS.base   = --motion-exit-base   disclosure close / dialog exit / content swap-out
 *   MOTION_EXIT_MS.panel  = --motion-exit-panel  drawer exit / list-row structural collapse
 *
 * Easing（V3 新增，M3/Apple 对齐：进入减速、退出加速）：
 *   EASE.standard   = --ease-standard    通用进入 / 常驻（decelerate-like，保持历史视觉）
 *   EASE.emphasized = --ease-emphasized  品牌 / intro / Sidebar morph（原值不变）
 *   EASE.enter      = --ease-enter       新代码进入首选（M3 standard decelerate）
 *   EASE.exit       = --ease-exit        所有退出首选（M3 standard accelerate，比进入更快离场）
 *   EASE.spring     = --ease-spring      大位移 morph 近似 spring（无 bounce，bounce=0 通用档）
 *
 * 约定：
 * - Primitive 的 CSS transition 时长必须引用上述 CSS 变量（或与注释声明对应），
 *   presence/unmount 计时必须引用本文件常量——一种交互语义只存在一个 Motion 时间真值。
 * - 退出分支的 easing 必须用 --ease-exit（或 EASE.exit 注释对应），进入保持 --ease-standard
 *   （历史视觉不变）——进出不对称，关闭更快离场。
 * - 特殊组件确需独立 duration 时，必须在使用处注释解释原因（如 PopoverPanel kiro profile）。
 * - Reduced Motion 不走这些常量：usePresence / useEffectiveReducedMotion 直接落最终态。
 */
export const MOTION_MS = {
  snap: 90,
  fast: 140,
  base: 180,
  overlay: 220,
  panel: 230,
  page: 180,
  data: 200,
} as const;

export const MOTION_EXIT_MS = {
  fast: 110,
  base: 150,
  panel: 160,
} as const;

/**
 * Easing 唯一真值（V3，与 :root --ease-* 一一对应）。
 * 数值 = cubic-bezier 字面量（CSS 侧 var() 引用；JS 侧仅契约与 WAAPI/测试用途）。
 */
export const EASE = {
  standard: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  emphasized: "cubic-bezier(0.22, 1, 0.36, 1)",
  enter: "cubic-bezier(0, 0, 0.2, 1)",
  exit: "cubic-bezier(0.3, 0, 1, 1)",
  spring: "cubic-bezier(0.32, 0.72, 0, 1)",
} as const;

/**
 * Kiro Motion tiers（S3-1 立约，零行为变更：数值 = app/globals.css :root 默认值）。
 * - workspace scope 与 :root 同值；sidecar scope 更快（小浮层节奏），见 KIRO_MOTION_SIDECAR_MS。
 * - presence/unmount 计时引用本文件常量；CSS transition 引用同名 --kiro-motion-* 变量。
 * - stagger（delay 55/75/95/140 与 empty 60/110 + index*32）尚未 token 化，见 S3-3。
 */
export const KIRO_MOTION_MS = {
  control: 120,
  structure: 150,
  spatial: 220,
  popoverEnter: 140,
  popoverExit: 120,
  intro: 320,
  composerIntro: 220,
} as const;

/** Sidecar scope 更快档（= .kiro-motion-sidecar 覆盖值） */
export const KIRO_MOTION_SIDECAR_MS = {
  control: 100,
  structure: 130,
  spatial: 180,
  popoverEnter: 120,
  popoverExit: 100,
  intro: 250,
  composerIntro: 130,
} as const;

/**
 * Stagger delays（S3-3 立约，与 :root --kiro-stagger-* 一一对应）。
 * s0 首批 / s1 次批 / s2 末批（Panel 90 收敛至 95）/ s3 容器；
 * empty 家族供 Empty intro（base + index*step）。
 * CSS 侧用 var(--kiro-stagger-*, <fallback>) 引用；JS 侧仅契约与文档用途。
 */
export const STAGGER_MS = {
  s0: 55,
  s1: 75,
  s2: 95,
  s3: 140,
  empty1: 60,
  empty2: 110,
  emptyBase: 150,
  emptyStep: 32,
} as const;

export type MotionTier = keyof typeof MOTION_MS;
export type MotionExitTier = keyof typeof MOTION_EXIT_MS;
export type KiroMotionTier = keyof typeof KIRO_MOTION_MS;
export type EaseTier = keyof typeof EASE;
