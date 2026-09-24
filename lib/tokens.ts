/**
 * ClassFlow Design Token Contract V1（S1 立约）—— 颜色 / 字号 / 间距 / 圆角 / 层级 / 焦点环的 JS 侧镜像。
 *
 * 唯一真值：app/globals.css :root。
 * tailwind.config.cjs 只做派生（字面量须与 :root 同值）。
 * 本文件常量须与 :root 同值 —— 三方由 tests/tokenContract.test.ts 校验，一种语义只存在一个真值。
 *
 * 约定：
 * - 新增 token 先加 :root，再派生到 tailwind / 本文件，禁止反向在调用方发明新值。
 * - charcoal / --dark-charcoal / #313032 收敛目标为 --ink-primary（本轮只加别名不删旧名，迁移见 S1-2）。
 * - Light-only 暖纸主题 by design，无 darkMode。
 */

export const TOKEN_COLORS = {
  background: "#F7F5F5",
  alabaster: "#F0EBE1",
  stoneBeige: "#CDB9AB",
  charcoal: "#313032",
  mozzarella: "#EFECEA",
  alba: "#E3DDD2",
  sandrift: "#A48F82",
  pastelMint: "#E3E6E0",
  ashyBeige: "#CCCBC4",
  satinGrey: "#676266",
  surface: "#F4F2EF",
  surfaceSoft: "#F0EBE1",
  surfaceMuted: "#E3E6E0",
  inkPrimary: "#313032",
  inkSecondary: "#676266",
  inkMuted: "#A48F82",
} as const;

export const TOKEN_SEMANTIC = {
  danger: "#9B5B57",
  dangerBg: "#F2E8E6",
  dangerBorder: "#D9BCB8",
  warning: "#936E4C",
  warningBg: "#F1EAE1",
  warningBorder: "#DFD2C2",
  success: "#627566",
  successBg: "#E7ECE6",
  successBorder: "#C8D3C7",
} as const;

export const TOKEN_SPACE_PX = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  gutterSm: 16,
  gutterMd: 24,
  shellRail: 64,
  shellFull: 224,
} as const;

export const TOKEN_TEXT = {
  caption: { size: 11, leading: 16 },
  body: { size: 13, leading: 20 },
  title: { size: 14, leading: 20 },
  h: { size: 19, leading: 26 },
} as const;

export const TOKEN_RADIUS_PX = {
  sm: 8,
  md: 12,
  lg: 14,
  xl: 18,
  xxl: 22,
  sidecar: 28,
} as const;

export const TOKEN_Z = {
  header: 20,
  peek: 30,
  sidecar: 40,
  dialog: 50,
  reminder: 80,
  titlebar: 100,
} as const;

export type TokenColor = keyof typeof TOKEN_COLORS;
export type TokenTextTier = keyof typeof TOKEN_TEXT;
