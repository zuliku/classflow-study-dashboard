/**
 * Document Style Layer — Presets（Kiro Document Engine V2）。
 *
 * ClassFlow 默认长什么样。两个预设：
 * - academic-cn：中文论文 / 课程作业 / 研究计划 / 调研报告的规范默认格式
 *   （不是宣称满足某一所高校的强制论文格式；用户给出学校格式要求时由 styleHints 覆盖）
 * - business-report：项目方案 / 商业分析 / 市场报告 / 可行性分析等现代正式报告
 *   （专业、克制、高信息密度，不是宣传海报式 Word）
 *
 * 单位：pt / cm 原始值；换算（cmToTwip / ptToHalfPoint）在 resolve.ts 统一完成。
 */

import type {
  KiroDocumentStylePreset,
  KiroStyleFont,
  ResolvedCodeTheme,
  ResolvedDocumentTheme,
  ResolvedListTheme,
  ResolvedQuoteTheme,
  ResolvedTableTheme,
  ResolvedTextTheme,
} from "@/lib/ai/computer/documents/styles/types";

/** Font hint → 中文字体名（eastAsia）。Latin hint 只改 latin 字体，不改 eastAsia。 */
export const KIRO_EAST_ASIA_FONT_MAP: Record<KiroStyleFont, string | null> = {
  simsun: "宋体",
  simhei: "黑体",
  fangsong: "仿宋",
  kaiti: "楷体",
  yahei: "微软雅黑",
  dengxian: "等线",
  "times-new-roman": null,
  arial: null,
  aptos: null,
};

/** Font hint → Latin 字体名。CJK hint 不影响 latin（保持 preset latin）。 */
export const KIRO_LATIN_FONT_MAP: Record<KiroStyleFont, string | null> = {
  simsun: null,
  simhei: null,
  fangsong: null,
  kaiti: null,
  yahei: null,
  dengxian: null,
  "times-new-roman": "Times New Roman",
  arial: "Arial",
  aptos: "Aptos",
};

/** A4（twips）：11906 × 16838 */
export const KIRO_PAGE_A4 = { widthTwip: 11906, heightTwip: 16838 } as const;

interface PresetDefinition {
  page: {
    topCm: number;
    rightCm: number;
    bottomCm: number;
    leftCm: number;
  };
  body: Omit<ResolvedTextTheme, "bold" | "alignment" | "lineSpacing" | "firstLineIndentChars" | "spaceBeforePt" | "spaceAfterPt"> & {
    alignment: "left" | "justify";
    lineSpacing: number;
    firstLineIndentChars: number;
    spaceBeforePt: number;
    spaceAfterPt: number;
  };
  title: Omit<ResolvedTextTheme, "alignment" | "lineSpacing" | "firstLineIndentChars" | "spaceBeforePt"> & {
    alignment: "left" | "center";
    spaceAfterPt: number;
  };
  heading1: Omit<ResolvedTextTheme, "alignment" | "lineSpacing" | "firstLineIndentChars" | "spaceBeforePt" | "spaceAfterPt"> & {
    spaceBeforePt: number;
    spaceAfterPt: number;
  };
  heading2: Omit<ResolvedTextTheme, "alignment" | "lineSpacing" | "firstLineIndentChars" | "spaceBeforePt" | "spaceAfterPt"> & {
    spaceBeforePt: number;
    spaceAfterPt: number;
  };
  heading3: Omit<ResolvedTextTheme, "alignment" | "lineSpacing" | "firstLineIndentChars" | "spaceBeforePt" | "spaceAfterPt"> & {
    spaceBeforePt: number;
    spaceAfterPt: number;
  };
  quote: Omit<ResolvedQuoteTheme, "indentLeftTwip" | "indentRightTwip"> & {
    indentLeftCm: number;
    indentRightCm: number;
  };
  list: Omit<ResolvedListTheme, "indentLeftTwip" | "hangingTwip"> & {
    indentLeftCm: number;
    hangingCm: number;
  };
  table: Omit<ResolvedTableTheme, "headerShading"> & { headerShading?: string };
  code: ResolvedCodeTheme;
}

export const KIRO_DOCUMENT_PRESETS: Record<KiroDocumentStylePreset, PresetDefinition> = {
  "academic-cn": {
    page: { topCm: 2.54, bottomCm: 2.54, leftCm: 2.8, rightCm: 2.8 },
    body: {
      eastAsiaFont: "宋体",
      latinFont: "Times New Roman",
      fontSizePt: 12,
      alignment: "justify",
      lineSpacing: 1.5,
      firstLineIndentChars: 2,
      spaceBeforePt: 0,
      spaceAfterPt: 0,
    },
    title: {
      eastAsiaFont: "黑体",
      latinFont: "Times New Roman",
      fontSizePt: 18,
      bold: true,
      alignment: "center",
      spaceAfterPt: 14,
    },
    heading1: {
      eastAsiaFont: "黑体",
      latinFont: "Times New Roman",
      fontSizePt: 16,
      bold: true,
      spaceBeforePt: 12,
      spaceAfterPt: 6,
    },
    heading2: {
      eastAsiaFont: "黑体",
      latinFont: "Times New Roman",
      fontSizePt: 14,
      bold: true,
      spaceBeforePt: 10,
      spaceAfterPt: 4,
    },
    heading3: {
      eastAsiaFont: "黑体",
      latinFont: "Times New Roman",
      fontSizePt: 12,
      bold: true,
      spaceBeforePt: 8,
      spaceAfterPt: 3,
    },
    quote: {
      fontSizePt: 10.5,
      lineSpacing: 1.25,
      spaceBeforePt: 6,
      spaceAfterPt: 6,
      indentLeftCm: 1,
      indentRightCm: 1,
      alignment: "justify",
    },
    list: { indentLeftCm: 0.75, hangingCm: 0.42 },
    table: {
      style: "three-line",
      headerFontSizePt: 10.5,
      bodyFontSizePt: 10.5,
    },
    code: {
      font: "Consolas",
      fontSizePt: 9,
      lineSpacing: 1,
      backgroundFill: "F4F4F4",
    },
  },
  "business-report": {
    page: { topCm: 2.2, bottomCm: 2.2, leftCm: 2.3, rightCm: 2.3 },
    body: {
      eastAsiaFont: "微软雅黑",
      latinFont: "Aptos",
      fontSizePt: 11,
      alignment: "left",
      lineSpacing: 1.3,
      firstLineIndentChars: 0,
      spaceBeforePt: 0,
      spaceAfterPt: 6,
    },
    title: {
      eastAsiaFont: "微软雅黑",
      latinFont: "Aptos",
      fontSizePt: 22,
      bold: true,
      alignment: "left",
      spaceAfterPt: 16,
    },
    heading1: {
      eastAsiaFont: "微软雅黑",
      latinFont: "Aptos",
      fontSizePt: 16,
      bold: true,
      spaceBeforePt: 16,
      spaceAfterPt: 6,
    },
    heading2: {
      eastAsiaFont: "微软雅黑",
      latinFont: "Aptos",
      fontSizePt: 13,
      bold: true,
      spaceBeforePt: 12,
      spaceAfterPt: 4,
    },
    heading3: {
      eastAsiaFont: "微软雅黑",
      latinFont: "Aptos",
      fontSizePt: 11,
      bold: true,
      spaceBeforePt: 8,
      spaceAfterPt: 3,
    },
    quote: {
      fontSizePt: 10.5,
      lineSpacing: 1.25,
      spaceBeforePt: 6,
      spaceAfterPt: 6,
      indentLeftCm: 0.75,
      indentRightCm: 0.75,
      alignment: "left",
    },
    list: { indentLeftCm: 0.6, hangingCm: 0.35 },
    table: {
      style: "clean",
      headerFontSizePt: 10.5,
      bodyFontSizePt: 10.5,
      headerShading: "F2F2F2",
    },
    code: {
      font: "Consolas",
      fontSizePt: 9,
      lineSpacing: 1,
      backgroundFill: "F4F4F4",
    },
  },
};
