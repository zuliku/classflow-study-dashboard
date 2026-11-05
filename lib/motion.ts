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
 * Easing（V5 全量默认）：
 *   EASE.standard   = --ease-standard     = outStrong（兼容 alias）
 *   EASE.emphasized = --ease-emphasized   = outExpo（兼容 alias）
 *   EASE.enter      = --ease-enter        = outStrong（兼容 alias）
 *   EASE.exit       = --ease-exit         = inExit（兼容 alias）
 *   EASE.spring     = --ease-spring       = springSoft（兼容 alias）
 *   EASE_V5.outSoft / outStrong / outExpo / inExit / springSoft / springSnappy
 *                   = V5 linear() 曲线族（CSS/WAAPI/契约测试共享字面量）
 * 约定：
 * - Primitive 的 CSS transition 时长必须引用上述 CSS 变量（或与注释声明对应），
 *   presence/unmount 计时必须引用本文件常量——一种交互语义只存在一个 Motion 时间真值。
 * - 退出分支的 easing 必须用 --ease-exit（或 EASE.exit 注释对应），进入保持 --ease-standard
 *   （历史视觉不变）——进出不对称，关闭更快离场。
 * - 特殊组件确需独立 duration 时，必须在使用处注释解释原因（如 PopoverPanel kiro profile）。
 * - Reduced Motion 不走这些常量：usePresence / useEffectiveReducedMotion 直接落最终态。
 */
export const MOTION_MS = {
  snap: 100,
  fast: 160,
  base: 200,
  overlay: 250,
  panel: 260,
  page: 220,
  data: 220,
} as const;

export const MOTION_EXIT_MS = {
  fast: 120,
  base: 160,
  panel: 190,
} as const;

/** V6：菜单/列表项编排步长（CSS --motion-stagger-step 同源） */
export const MOTION_STAGGER_MS = {
  menuItem: 18,
} as const;

/**
 * Easing 唯一真值（V5 全量，与 :root --ease-* 一一对应）。
 * 数值 = linear() 字面量（CSS 侧 var() 引用；JS 侧用于 WAAPI/契约/测试）。
 *
 * legacy alias（standard / emphasized / enter / exit / spring）长期保留，
 * 全部指向 EASE_V5；组件可继续使用旧名称，不需要大面积迁移。
 */
export const EASE_V5 = {
  outSoft: "linear(0, 0.1855, 0.3439, 0.478, 0.5904, 0.6836, 0.7599, 0.8215, 0.8704, 0.9085, 0.9375, 0.959, 0.9744, 0.985, 0.9919, 0.9961, 0.9984, 0.9995, 0.9999, 1, 1)",
  outStrong: "linear(0, 0.2262, 0.4095, 0.5563, 0.6723, 0.7627, 0.8319, 0.884, 0.9222, 0.9497, 0.9688, 0.9815, 0.9898, 0.9947, 0.9976, 0.999, 0.9997, 0.9999, 1, 1, 1)",
  outExpo: "linear(0, 0.2932, 0.5005, 0.6471, 0.7507, 0.824, 0.8759, 0.9125, 0.9384, 0.9567, 0.9697, 0.9789, 0.9853, 0.9899, 0.9932, 0.9954, 0.9971, 0.9982, 0.999, 0.9996, 1)",
  inExit: "linear(0, 0.0225, 0.0478, 0.0761, 0.1072, 0.1412, 0.1782, 0.218, 0.2608, 0.3065, 0.355, 0.4065, 0.4608, 0.5181, 0.5782, 0.6412, 0.7072, 0.776, 0.8478, 0.9224, 1)",
  springSoft: "linear(0, 0.0754, 0.2275, 0.3908, 0.5372, 0.6575, 0.7513, 0.8222, 0.8743, 0.912, 0.9389, 0.9579, 0.9711, 0.9803, 0.9866, 0.9909, 0.9939, 0.9959, 0.9972, 0.9982, 1)",
  springSnappy: "linear(0, 0.1477, 0.4125, 0.6511, 0.8209, 0.9243, 0.9789, 1.003, 1.0106, 1.0105, 1.0079, 1.005, 1.0027, 1.0013, 1.0005, 1.0001, 0.9999, 0.9999, 0.9999, 0.9999, 1)",
} as const;

export const EASE = {
  standard: EASE_V5.outStrong,
  emphasized: EASE_V5.outExpo,
  enter: EASE_V5.outStrong,
  exit: EASE_V5.inExit,
  spring: EASE_V5.springSoft,
  outSoft: EASE_V5.outSoft,
  outStrong: EASE_V5.outStrong,
  outExpo: EASE_V5.outExpo,
  inExit: EASE_V5.inExit,
  springSoft: EASE_V5.springSoft,
  springSnappy: EASE_V5.springSnappy,
} as const;

/**
 * EASE 的数值镜像（Framer Motion / WAAPI 需要 tuple；CSS 仍引用 EASE 字符串）。
 * V5 曲线使用 cubic-bezier 近似值，仅供不支持 linear() 字符串的第三方库降级。
 */
export const EASE_BEZIER: Record<keyof typeof EASE, [number, number, number, number]> = {
  standard: [0.22, 1, 0.36, 1],
  emphasized: [0.16, 1, 0.3, 1],
  enter: [0.22, 1, 0.36, 1],
  exit: [0.3, 0, 1, 1],
  spring: [0.22, 1, 0.36, 1],
  outSoft: [0.25, 1, 0.5, 1],
  outStrong: [0.22, 1, 0.36, 1],
  outExpo: [0.16, 1, 0.3, 1],
  inExit: [0.3, 0, 1, 1],
  springSoft: [0.22, 1, 0.36, 1],
  springSnappy: [0.34, 1.06, 0.64, 1],
};

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
  /** 流动层柔光晕染（= --kiro-motion-glow；opacity 慢洇，非位移） */
  glow: 500,
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
  mentionStep: 24,
} as const;

/**
 * Motion V6：语义角色表。CSS 侧仍是唯一执行真值；本表用于契约、测试与
 * 需要 JS（WAAPI / Framer Motion）的少数场景，避免“角色 → 时长/曲线”再次漂移。
 * - spatial（Dialog/Drawer）：spring-soft，零 overshoot，长尾 settle
 * - popover / toast：out-strong，快速响应，锚定方向由 transform-origin 提供
 * - page：out-soft，轻量方向切换
 * - press：spring-snappy，仅用于按压回弹（≤1.1% overshoot）
 */
export const MOTION_ROLE = {
  press: { duration: MOTION_MS.snap, ease: EASE.springSnappy },
  popover: { enter: MOTION_MS.fast, exit: MOTION_EXIT_MS.fast, ease: EASE.standard },
  overlay: { enter: MOTION_MS.overlay, exit: MOTION_EXIT_MS.base, ease: EASE.springSoft },
  drawer: { enter: MOTION_MS.panel, exit: MOTION_EXIT_MS.panel, ease: EASE.springSoft },
  page: { duration: MOTION_MS.page, ease: EASE.outSoft },
  list: { enter: MOTION_MS.base, exit: MOTION_EXIT_MS.base, ease: EASE.standard },
  toast: { enter: MOTION_MS.fast, exit: MOTION_EXIT_MS.fast, ease: EASE.standard },
} as const;

export type MotionRole = keyof typeof MOTION_ROLE;
export type MotionTier = keyof typeof MOTION_MS;
export type MotionExitTier = keyof typeof MOTION_EXIT_MS;
export type KiroMotionTier = keyof typeof KIRO_MOTION_MS;
export type EaseTier = keyof typeof EASE;
