/**
 * Kiro Document IR — 唯一 Schema Source of Truth。
 * one schema → runtime validation → TypeScript types → AI SDK model-facing input schema。
 * 真实支持范围（renderer 实际消费）：heading/paragraph/bullet-list/numbered-list/table/quote/code/page-break。
 * 无 sections/chapters/children/body；不要为了兼容模型猜测新增结构。
 *
 * stylePreset / styleHints（Document Engine V2）：
 * - 全部 optional（旧 Artifact / Source IR 完全向后兼容）
 * - styleHints 只接受受控枚举/数值范围（Zod 第一层边界；resolver 第二层 clamp）
 * - 没有用户明确排版要求时，模型不得随机生成 hints
 */
import { z } from "zod";
import {
  KIRO_DOCUMENT_STYLE_PRESETS,
  KIRO_STYLE_HINT_BODY_ALIGNMENTS,
  KIRO_STYLE_HINT_DENSITY,
  KIRO_STYLE_HINT_FONTS,
  KIRO_STYLE_HINT_LINE_SPACINGS,
  KIRO_STYLE_HINT_MARGIN_MODES,
  KIRO_STYLE_HINT_TABLE_STYLES,
  KIRO_STYLE_HINT_TITLE_ALIGNMENTS,
} from "@/lib/ai/computer/documents/styles/types";

export const kiroInlineSchema = z.object({
  text: z.string().describe("富文本 run 文本"),
  bold: z.boolean().optional().describe("是否加粗"),
  italic: z.boolean().optional().describe("是否斜体"),
});

export const kiroHeadingBlockSchema = z.object({
  type: z.literal("heading").describe("标题 block"),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).describe("标题级别：1 | 2 | 3"),
  content: z.array(kiroInlineSchema).describe("标题行内内容"),
});

export const kiroParagraphBlockSchema = z.object({
  type: z.literal("paragraph").describe("段落 block"),
  content: z.array(kiroInlineSchema).describe("段落内 inline runs；每个 run 至少包含 text"),
});

export const kiroBulletListBlockSchema = z.object({
  type: z.literal("bullet-list").describe("无序列表 block"),
  items: z.array(z.array(kiroInlineSchema)).describe("列表项；每项是 KiroInline[]"),
});

export const kiroNumberedListBlockSchema = z.object({
  type: z.literal("numbered-list").describe("有序列表 block"),
  items: z.array(z.array(kiroInlineSchema)).describe("列表项；每项是 KiroInline[]"),
});

export const kiroTableBlockSchema = z.object({
  type: z.literal("table").describe("表格 block"),
  header: z.array(z.array(kiroInlineSchema)).describe("表头 cells；每个 cell 是 KiroInline[]"),
  rows: z.array(z.array(z.array(kiroInlineSchema))).describe("二维表格行：row -> cells -> inline runs"),
});

export const kiroQuoteBlockSchema = z.object({
  type: z.literal("quote").describe("引用 block"),
  content: z.array(kiroInlineSchema).describe("引用文本 runs"),
});

export const kiroCodeBlockSchema = z.object({
  type: z.literal("code").describe("代码块"),
  language: z.string().optional().describe("代码语言（如 stata / ts / python）"),
  text: z.string().describe("代码内容"),
});

export const kiroPageBreakBlockSchema = z.object({
  type: z.literal("page-break").describe("分页符（无其它字段）"),
});

export const kiroDocumentBlockSchema = z.discriminatedUnion("type", [
  kiroHeadingBlockSchema,
  kiroParagraphBlockSchema,
  kiroBulletListBlockSchema,
  kiroNumberedListBlockSchema,
  kiroTableBlockSchema,
  kiroQuoteBlockSchema,
  kiroCodeBlockSchema,
  kiroPageBreakBlockSchema,
]);

/** Style Hints（受控覆盖）：用户明确排版要求时才填写；数值范围 = Zod 第一层边界 */
export const kiroStyleHintsSchema = z
  .object({
    density: z.enum(KIRO_STYLE_HINT_DENSITY).optional().describe("排版密度（只影响间距，不改内容）"),
    bodyFont: z.enum(KIRO_STYLE_HINT_FONTS).optional().describe("正文字体（中文/西文字体名枚举）"),
    headingFont: z.enum(KIRO_STYLE_HINT_FONTS).optional().describe("标题字体"),
    bodyFontSizePt: z.number().min(9).max(16).optional().describe("正文字号（pt，9–16）"),
    bodyAlignment: z.enum(KIRO_STYLE_HINT_BODY_ALIGNMENTS).optional().describe("正文对齐：left | justify"),
    lineSpacing: z
      .union([z.literal(1), z.literal(1.15), z.literal(1.25), z.literal(1.3), z.literal(1.5), z.literal(2)])
      .optional()
      .describe("行距倍数（1 / 1.15 / 1.25 / 1.3 / 1.5 / 2）"),
    firstLineIndentChars: z.number().min(0).max(4).optional().describe("首行缩进字符数（0–4）"),
    titleAlignment: z.enum(KIRO_STYLE_HINT_TITLE_ALIGNMENTS).optional().describe("文档标题对齐：left | center"),
    titleFontSizePt: z.number().min(14).max(32).optional().describe("文档标题字号（pt，14–32）"),
    headingSizesPt: z
      .object({
        h1: z.number().min(11).max(24).optional(),
        h2: z.number().min(10).max(20).optional(),
        h3: z.number().min(10).max(18).optional(),
      })
      .optional()
      .describe("各级标题字号（pt，h1 11–24 / h2 10–20 / h3 10–18）"),
    tableStyle: z.enum(KIRO_STYLE_HINT_TABLE_STYLES).optional().describe("表格风格：three-line | clean | grid"),
    pageMarginMode: z.enum(KIRO_STYLE_HINT_MARGIN_MODES).optional().describe("页边距模式：narrow | normal | wide"),
    pageMarginsCm: z
      .object({
        top: z.number().min(1).max(5).optional(),
        bottom: z.number().min(1).max(5).optional(),
        left: z.number().min(1).max(5).optional(),
        right: z.number().min(1).max(5).optional(),
      })
      .optional()
      .describe("自定义页边距（cm，1–5）"),
  })
  .describe("用户明确的排版要求（受控枚举；没有用户排版要求时不要生成）");

export const kiroDocumentSchema = z
  .object({
    title: z.string().optional().describe("文档标题（可选）"),
    blocks: z.array(kiroDocumentBlockSchema).describe("按文档顺序排列的 block 数组"),
    stylePreset: z
      .enum(KIRO_DOCUMENT_STYLE_PRESETS)
      .optional()
      .describe(
        "排版预设：academic-cn（论文/课程作业/研究计划/调研报告等中文规范文档）| business-report（商业分析/项目方案/市场报告等现代正式报告）。根据任务自动选择。"
      ),
    styleHints: kiroStyleHintsSchema.optional().describe("用户明确提出的排版要求（无要求时不要生成）"),
  })
  .describe("结构化 KiroDocument。仅包含 title + blocks（+ 可选 stylePreset / styleHints）。");

export type KiroInline = z.infer<typeof kiroInlineSchema>;
export type KiroDocumentBlock = z.infer<typeof kiroDocumentBlockSchema>;
export type KiroDocument = z.infer<typeof kiroDocumentSchema>;

/** 薄封装（保持旧调用方兼容）；验证完整委托给 schema */
export function isKiroDocument(value: unknown): value is KiroDocument {
  return kiroDocumentSchema.safeParse(value).success;
}
