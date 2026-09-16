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

/* ---------- HSV（应用内自绘取色器唯一真相；不依赖原生拾色器） ---------- */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** h: 0–360，s/v: 0–100 */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function hexToRgb(hex: string): Rgb | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const to2 = (n: number) => clamp(n).toString(16).padStart(2, "0").toUpperCase();
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;
  return {
    h: Math.round(h) % 360,
    s: max === 0 ? 0 : Math.round((delta / max) * 100),
    v: Math.round(max * 100),
  };
}

export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const hn = ((h % 360) + 360) % 360;
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const vn = Math.max(0, Math.min(100, v)) / 100;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = vn - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hn < 60) { r = c; g = x; }
  else if (hn < 120) { r = x; g = c; }
  else if (hn < 180) { g = c; b = x; }
  else if (hn < 240) { g = x; b = c; }
  else if (hn < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const { r, g, b } = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

export function hexToHsv(hex: string): Hsv | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return rgbToHsv(rgb.r, rgb.g, rgb.b);
}
