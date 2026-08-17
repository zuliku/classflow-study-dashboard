/**
 * Document Style Layer — Resolver（Kiro Document Engine V2）。
 *
 * preset + styleHints → 最终 ResolvedDocumentTheme（唯一被 renderer 消费的对象）。
 * Style Priority：renderer safety limits（clamp）> styleHints > stylePreset > ClassFlow fallback。
 * 模型输入不可信：所有数值在 schema 边界之外再做一次 resolver clamp。
 *
 * mergeDocumentStyleForUpdate：update_document 的 style 保持语义
 * - incoming 无 style → 完整保持 previous style
 * - incoming 只有 hints → 保持 previous preset + merge hints
 * - incoming 切换 preset（无 hints）→ 新 preset + 清空旧 hints（不被旧 hint 污染）
 * - incoming preset + hints → 新 preset + 新 hints
 */

import {
  KIRO_DOCUMENT_PRESETS,
  KIRO_EAST_ASIA_FONT_MAP,
  KIRO_LATIN_FONT_MAP,
  KIRO_PAGE_A4,
} from "@/lib/ai/computer/documents/styles/presets";
import {
  KiroDocumentStylePreset,
  KiroStyleFont,
  KiroStyleHints,
  ResolvedDocumentTheme,
  ResolvedTableTheme,
  ResolvedTextTheme,
} from "@/lib/ai/computer/documents/styles/types";
import { KiroDocument } from "@/lib/ai/computer/documents/types";

/** 一厘米 ≈ 1440 / 2.54 twips */
export function cmToTwip(cm: number): number {
  return Math.round((cm / 2.54) * 1440);
}

/** 1 pt = 2 half-points（docx `size` 使用 half-point） */
export function ptToHalfPoint(pt: number): number {
  return Math.round(pt * 2);
}

/** 默认 preset：模型未指定时回退 academic-cn（学习管理默认场景） */
export const KIRO_DEFAULT_STYLE_PRESET: KiroDocumentStylePreset = "academic-cn";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampOpt(value: number | undefined, min: number, max: number): number | undefined {
  return value === undefined ? undefined : clamp(value, min, max);
}

/** resolver 第二层边界（schema 已做第一层；这里防御模型/旧数据越界） */
const RESOLVER_LIMITS = {
  bodyFontSizePt: { min: 9, max: 16 },
  titleFontSizePt: { min: 14, max: 32 },
  headingSizesPt: { h1: { min: 11, max: 24 }, h2: { min: 10, max: 20 }, h3: { min: 10, max: 18 } },
  firstLineIndentChars: { min: 0, max: 4 },
  marginCm: { min: 1, max: 5 },
};

const LINE_SPACING_VALUES = [1, 1.15, 1.25, 1.3, 1.5, 2] as const;

function resolveLineSpacing(value: number | undefined): number {
  if (value === undefined) return LINE_SPACING_VALUES[1]; // 占位；preset 覆盖
  const picked = LINE_SPACING_VALUES.find((v) => v === value);
  return picked ?? 1.5;
}

/** density：只影响排版密度（spacing），不改变正文内容、不用字号大幅缩放 */
function densityScale(density: KiroStyleHints["density"]): { body: number; heading: number } {
  switch (density) {
    case "compact":
      return { body: 0.75, heading: 0.8 };
    case "relaxed":
      return { body: 1.25, heading: 1.15 };
    default:
      return { body: 1, heading: 1 };
  }
}

/** font hint → { eastAsia?, latin? }：CJK hint 只改 eastAsia；Latin hint 只改 latin */
function resolveFontPair(hint: KiroStyleFont | undefined, fallbackEastAsia: string, fallbackLatin: string) {
  if (!hint) return { eastAsia: fallbackEastAsia, latin: fallbackLatin };
  const eastAsia = KIRO_EAST_ASIA_FONT_MAP[hint];
  const latin = KIRO_LATIN_FONT_MAP[hint];
  return {
    eastAsia: eastAsia ?? fallbackEastAsia,
    latin: latin ?? fallbackLatin,
  };
}

export function resolveDocumentTheme(
  preset?: KiroDocumentStylePreset,
  hints?: KiroStyleHints
): ResolvedDocumentTheme {
  const resolvedPreset: KiroDocumentStylePreset = preset ?? KIRO_DEFAULT_STYLE_PRESET;
  const base = KIRO_DOCUMENT_PRESETS[resolvedPreset];
  const h = hints ?? {};
  const scale = densityScale(h.density);

  // ---- Page：pageMarginsCm > pageMarginMode > preset ----
  let topCm = base.page.topCm;
  let rightCm = base.page.rightCm;
  let bottomCm = base.page.bottomCm;
  let leftCm = base.page.leftCm;
  if (h.pageMarginMode === "narrow") {
    topCm = rightCm = bottomCm = leftCm = 2.0;
  } else if (h.pageMarginMode === "wide") {
    topCm = rightCm = bottomCm = leftCm = 3.0;
  }
  if (h.pageMarginsCm) {
    if (h.pageMarginsCm.top !== undefined) topCm = clamp(h.pageMarginsCm.top, RESOLVER_LIMITS.marginCm.min, RESOLVER_LIMITS.marginCm.max);
    if (h.pageMarginsCm.right !== undefined) rightCm = clamp(h.pageMarginsCm.right, RESOLVER_LIMITS.marginCm.min, RESOLVER_LIMITS.marginCm.max);
    if (h.pageMarginsCm.bottom !== undefined) bottomCm = clamp(h.pageMarginsCm.bottom, RESOLVER_LIMITS.marginCm.min, RESOLVER_LIMITS.marginCm.max);
    if (h.pageMarginsCm.left !== undefined) leftCm = clamp(h.pageMarginsCm.left, RESOLVER_LIMITS.marginCm.min, RESOLVER_LIMITS.marginCm.max);
  }

  // ---- Body ----
  const bodyFont = resolveFontPair(h.bodyFont, base.body.eastAsiaFont, base.body.latinFont);
  const body: ResolvedTextTheme = {
    eastAsiaFont: bodyFont.eastAsia,
    latinFont: bodyFont.latin,
    fontSizePt: clampOpt(h.bodyFontSizePt, RESOLVER_LIMITS.bodyFontSizePt.min, RESOLVER_LIMITS.bodyFontSizePt.max) ?? base.body.fontSizePt,
    bold: false,
    alignment: h.bodyAlignment ?? base.body.alignment,
    lineSpacing: resolveLineSpacing(h.lineSpacing ?? base.body.lineSpacing),
    firstLineIndentChars:
      clampOpt(h.firstLineIndentChars, RESOLVER_LIMITS.firstLineIndentChars.min, RESOLVER_LIMITS.firstLineIndentChars.max) ??
      base.body.firstLineIndentChars,
    spaceBeforePt: base.body.spaceBeforePt * scale.body,
    spaceAfterPt: base.body.spaceAfterPt * scale.body,
  };

  // ---- Title ----
  const titleFont = resolveFontPair(h.headingFont, base.title.eastAsiaFont, base.title.latinFont);
  const title: ResolvedTextTheme = {
    eastAsiaFont: titleFont.eastAsia,
    latinFont: titleFont.latin,
    fontSizePt: clampOpt(h.titleFontSizePt, RESOLVER_LIMITS.titleFontSizePt.min, RESOLVER_LIMITS.titleFontSizePt.max) ?? base.title.fontSizePt,
    bold: base.title.bold,
    alignment: h.titleAlignment ?? base.title.alignment,
    lineSpacing: 1.5,
    firstLineIndentChars: 0,
    spaceBeforePt: 0,
    spaceAfterPt: base.title.spaceAfterPt * scale.body,
  };

  // ---- Headings ----
  const headingFont = resolveFontPair(h.headingFont, base.heading1.eastAsiaFont, base.heading1.latinFont);
  const mkHeading = (
    presetDef: (typeof base)["heading1"],
    defaultSize: number,
    min: number,
    max: number,
    hintSize: number | undefined
  ): ResolvedTextTheme => ({
    eastAsiaFont: headingFont.eastAsia,
    latinFont: headingFont.latin,
    fontSizePt: clampOpt(hintSize, min, max) ?? defaultSize,
    bold: presetDef.bold,
    alignment: "left",
    lineSpacing: 1.3,
    firstLineIndentChars: 0,
    spaceBeforePt: presetDef.spaceBeforePt * scale.heading,
    spaceAfterPt: presetDef.spaceAfterPt * scale.heading,
  });

  const heading1 = mkHeading(base.heading1, base.heading1.fontSizePt, RESOLVER_LIMITS.headingSizesPt.h1.min, RESOLVER_LIMITS.headingSizesPt.h1.max, h.headingSizesPt?.h1);
  const heading2 = mkHeading(base.heading2, base.heading2.fontSizePt, RESOLVER_LIMITS.headingSizesPt.h2.min, RESOLVER_LIMITS.headingSizesPt.h2.max, h.headingSizesPt?.h2);
  const heading3 = mkHeading(base.heading3, base.heading3.fontSizePt, RESOLVER_LIMITS.headingSizesPt.h3.min, RESOLVER_LIMITS.headingSizesPt.h3.max, h.headingSizesPt?.h3);

  // ---- Quote ----
  const quote = {
    fontSizePt: base.quote.fontSizePt,
    lineSpacing: base.quote.lineSpacing,
    spaceBeforePt: base.quote.spaceBeforePt * scale.body,
    spaceAfterPt: base.quote.spaceAfterPt * scale.body,
    indentLeftTwip: cmToTwip(base.quote.indentLeftCm),
    indentRightTwip: cmToTwip(base.quote.indentRightCm),
    alignment: base.quote.alignment,
  };

  // ---- List ----
  const list = {
    indentLeftTwip: cmToTwip(base.list.indentLeftCm),
    hangingTwip: cmToTwip(base.list.hangingCm),
  };

  // ---- Table ----
  const table: ResolvedTableTheme = {
    style: h.tableStyle ?? base.table.style,
    headerFontSizePt: base.table.headerFontSizePt,
    bodyFontSizePt: base.table.bodyFontSizePt,
    headerShading: base.table.headerShading,
  };

  // ---- Code ----
  const code = { ...base.code };

  return {
    preset: resolvedPreset,
    page: {
      widthTwip: KIRO_PAGE_A4.widthTwip,
      heightTwip: KIRO_PAGE_A4.heightTwip,
      topTwip: cmToTwip(topCm),
      rightTwip: cmToTwip(rightCm),
      bottomTwip: cmToTwip(bottomCm),
      leftTwip: cmToTwip(leftCm),
    },
    body,
    title,
    heading1,
    heading2,
    heading3,
    quote,
    list,
    table,
    code,
  };
}

/** 嵌套对象字段级合并（只处理 style 相关字段） */
function mergeStyleHints(previous: KiroStyleHints | undefined, incoming: KiroStyleHints | undefined): KiroStyleHints | undefined {
  if (!incoming) return previous;
  const merged: KiroStyleHints = { ...(previous ?? {}), ...incoming };
  if (incoming.headingSizesPt || previous?.headingSizesPt) {
    merged.headingSizesPt = { ...(previous?.headingSizesPt ?? {}), ...(incoming.headingSizesPt ?? {}) };
  }
  if (incoming.pageMarginsCm || previous?.pageMarginsCm) {
    merged.pageMarginsCm = { ...(previous?.pageMarginsCm ?? {}), ...(incoming.pageMarginsCm ?? {}) };
  }
  return merged;
}

/**
 * update_document 的 effective Document IR 合并（style 保持语义）：
 * - incoming 无 style → 完整保持 previous style
 * - incoming 只有 hints → 保持 previous preset + merge hints
 * - incoming 切换 preset（无 hints）→ 新 preset + 清空旧 hints（不被旧 preset-specific hint 污染）
 * - incoming preset + hints → 新 preset + 新 hints
 * commitArtifactRevision 存储的是 effective merged Document IR（不是 raw input）。
 */
export function mergeDocumentStyleForUpdate(previous: KiroDocument, incoming: KiroDocument): KiroDocument {
  const hasPreset = incoming.stylePreset !== undefined;
  const hasHints = incoming.styleHints !== undefined;
  if (!hasPreset && !hasHints) {
    return { ...incoming, stylePreset: previous.stylePreset, styleHints: previous.styleHints };
  }
  if (!hasPreset && hasHints) {
    return { ...incoming, stylePreset: previous.stylePreset, styleHints: mergeStyleHints(previous.styleHints, incoming.styleHints) };
  }
  if (hasPreset && !hasHints) {
    return { ...incoming, stylePreset: incoming.stylePreset, styleHints: undefined };
  }
  return { ...incoming, stylePreset: incoming.stylePreset, styleHints: incoming.styleHints };
}
