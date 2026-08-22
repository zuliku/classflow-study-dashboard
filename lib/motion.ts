/**
 * ClassFlow Motion Contract V2 —— 全局交互动效时间唯一真值（JS 侧）。
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
 * 约定：
 * - Primitive 的 CSS transition 时长必须引用上述 CSS 变量（或与注释声明对应），
 *   presence/unmount 计时必须引用本文件常量——一种交互语义只存在一个 Motion 时间真值。
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

export type MotionTier = keyof typeof MOTION_MS;
export type MotionExitTier = keyof typeof MOTION_EXIT_MS;
