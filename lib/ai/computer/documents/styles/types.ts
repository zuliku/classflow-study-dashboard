/**
 * Document Style Layer — Types（Kiro Document Engine V2）。
 *
 * 职责边界：
 * - schema.ts      → Model 可表达什么（stylePreset / styleHints 的 Zod 边界）
 * - presets.ts     → ClassFlow 默认长什么样（academic-cn / business-report）
 * - resolve.ts     → preset + styleHints → 最终 ResolvedDocumentTheme（含 clamp）
 * - docx.ts        → 把 resolved theme 转为 DOCX（不自行堆 magic number）
 *
 * Style Priority（resolve 实现）：
 *   renderer safety limits（clamp） > styleHints > stylePreset > ClassFlow fallback
 */

export const KIRO_DOCUMENT_STYLE_PRESETS = ["academic-cn", "business-report"] as const;
export type KiroDocumentStylePreset = (typeof KIRO_DOCUMENT_STYLE_PRESETS)[number];

export const KIRO_STYLE_HINT_DENSITY = ["compact", "normal", "relaxed"] as const;
export type KiroStyleDensity = (typeof KIRO_STYLE_HINT_DENSITY)[number];

export const KIRO_STYLE_HINT_FONTS = [
  "simsun",
  "simhei",
  "fangsong",
  "kaiti",
  "yahei",
  "dengxian",
  "times-new-roman",
  "arial",
  "aptos",
] as const;
export type KiroStyleFont = (typeof KIRO_STYLE_HINT_FONTS)[number];

export const KIRO_STYLE_HINT_BODY_ALIGNMENTS = ["left", "justify"] as const;
export type KiroStyleBodyAlignment = (typeof KIRO_STYLE_HINT_BODY_ALIGNMENTS)[number];

export const KIRO_STYLE_HINT_LINE_SPACINGS = [1, 1.15, 1.25, 1.3, 1.5, 2] as const;
export type KiroStyleLineSpacing = (typeof KIRO_STYLE_HINT_LINE_SPACINGS)[number];

export const KIRO_STYLE_HINT_TITLE_ALIGNMENTS = ["left", "center"] as const;
export type KiroStyleTitleAlignment = (typeof KIRO_STYLE_HINT_TITLE_ALIGNMENTS)[number];

export const KIRO_STYLE_HINT_TABLE_STYLES = ["three-line", "clean", "grid"] as const;
export type KiroStyleTableStyle = (typeof KIRO_STYLE_HINT_TABLE_STYLES)[number];

export const KIRO_STYLE_HINT_MARGIN_MODES = ["narrow", "normal", "wide"] as const;
export type KiroStyleMarginMode = (typeof KIRO_STYLE_HINT_MARGIN_MODES)[number];

/** Model-facing Style Hints（用户明确排版要求；无要求时模型不要生成） */
export interface KiroStyleHints {
  density?: KiroStyleDensity;
  bodyFont?: KiroStyleFont;
  headingFont?: KiroStyleFont;
  bodyFontSizePt?: number;
  bodyAlignment?: KiroStyleBodyAlignment;
  lineSpacing?: KiroStyleLineSpacing;
  firstLineIndentChars?: number;
  titleAlignment?: KiroStyleTitleAlignment;
  titleFontSizePt?: number;
  headingSizesPt?: { h1?: number; h2?: number; h3?: number };
  tableStyle?: KiroStyleTableStyle;
  pageMarginMode?: KiroStyleMarginMode;
  pageMarginsCm?: { top?: number; bottom?: number; left?: number; right?: number };
}

/** Resolved theme：renderer 唯一消费对象（所有数值已 clamp，单位已换算） */
export interface ResolvedPageTheme {
  widthTwip: number;
  heightTwip: number;
  topTwip: number;
  rightTwip: number;
  bottomTwip: number;
  leftTwip: number;
}

export interface ResolvedTextTheme {
  eastAsiaFont: string;
  latinFont: string;
  fontSizePt: number;
  bold: boolean;
  alignment: "left" | "center" | "justify";
  lineSpacing: number;
  firstLineIndentChars: number;
  spaceBeforePt: number;
  spaceAfterPt: number;
}

export interface ResolvedQuoteTheme {
  fontSizePt: number;
  lineSpacing: number;
  spaceBeforePt: number;
  spaceAfterPt: number;
  indentLeftTwip: number;
  indentRightTwip: number;
  alignment: "left" | "center" | "justify";
}

export interface ResolvedListTheme {
  indentLeftTwip: number;
  hangingTwip: number;
}

export interface ResolvedTableTheme {
  style: KiroStyleTableStyle;
  headerFontSizePt: number;
  bodyFontSizePt: number;
  /** 表头底纹（clean 预设）；无底纹时为 undefined */
  headerShading?: string;
}

export interface ResolvedCodeTheme {
  font: string;
  fontSizePt: number;
  lineSpacing: number;
  backgroundFill: string;
}

export interface ResolvedDocumentTheme {
  preset: KiroDocumentStylePreset;
  page: ResolvedPageTheme;
  body: ResolvedTextTheme;
  title: ResolvedTextTheme;
  heading1: ResolvedTextTheme;
  heading2: ResolvedTextTheme;
  heading3: ResolvedTextTheme;
  quote: ResolvedQuoteTheme;
  list: ResolvedListTheme;
  table: ResolvedTableTheme;
  code: ResolvedCodeTheme;
}
