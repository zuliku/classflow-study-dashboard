/**
 * 课程颜色统一工具（Settings + AddCourseModal 共用唯一真相）。
 * - 所有调色板色值统一为 `#RRGGBB` 大写（比较时大小写不敏感，存储时归一化）。
 * - 不引入取色依赖：自定义颜色走预设 + HEX 输入，彻底告别原生 <input type="color">
 *   的 Chrome 方形白底拾色器（与 ClassFlow 暖米 + 圆角语言冲突，见课程调色板截图）。
 */

export const HEX_6_RE = /^#[0-9a-fA-F]{6}$/;
const HEX_3_RE = /^#[0-9a-fA-F]{3}$/;

export const MAX_COURSE_PALETTE_SIZE = 12;
export const MIN_COURSE_PALETTE_SIZE = 1;

/** 默认 8 色（preferences 默认调色板，保持历史顺序，轮换语义依赖顺序） */
export const DEFAULT_COURSE_PALETTE: readonly string[] = [
  "#FADCD9",
  "#F8E9A1",
  "#A8E6CF",
  "#A0C4FF",
  "#FFC8A2",
  "#D8B4FE",
  "#FFADAD",
  "#CAFFBF",
];

/**
 * 预设候选（统一拾色器网格唯一来源）：
 * 默认 8 色 + 课程身份 muted 系 8 色，共 16 格，全部低饱和暖调。
 */
export const CURATED_COLOR_PRESETS: readonly string[] = [
  "#FADCD9",
  "#F8E9A1",
  "#A8E6CF",
  "#A0C4FF",
  "#FFC8A2",
  "#D8B4FE",
  "#FFADAD",
  "#CAFFBF",
  "#E3E6E0",
  "#F0EBE1",
  "#CCCBC4",
  "#CDB9AB",
  "#E8E2D5",
  "#E3E7DE",
  "#E9E2DC",
  "#E4E6EB",
];

export function normalizeHex(input: string): string | null {
  const trimmed = (input ?? "").trim();
  if (HEX_6_RE.test(trimmed)) return trimmed.toUpperCase();
  if (HEX_3_RE.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  // 允许缺 # 的 6 位输入（如 A8E6CF），输入体验更宽容
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toUpperCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[0];
    const g = trimmed[1];
    const b = trimmed[2];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

export function isValidHex(input: string): boolean {
  return normalizeHex(input) !== null;
}

/** 大小写不敏感的包含判断（调色板去重用） */
export function paletteIncludes(palette: readonly string[], hex: string): boolean {
  const normalized = normalizeHex(hex);
  if (!normalized) return false;
  return palette.some((c) => c.toUpperCase() === normalized);
}

/** 亮色判断（与 courseAppearance 的对比文本逻辑同源） */
export function isLightHex(hex: string): boolean {
  const normalized = normalizeHex(hex);
  if (!normalized) return true;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

export function contrastTextForHex(hex: string): "#313032" | "#FFFFFF" {
  return isLightHex(hex) ? "#313032" : "#FFFFFF";
}
