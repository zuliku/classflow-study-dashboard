/**
 * Kiro Document Authoring — Model-facing Draft Schema（V2.2）。
 *
 * 为什么不直接暴露 canonical KiroDocument：
 * canonical 的 table = KiroInline[][][]（row → cells → runs 三层数组），模型反复
 * 多一层/少一层/cell 写成 object。不要继续用 description 教模型背内部 IR。
 *
 * Draft = 专门给模型写的扁平 DSL：
 * - heading/paragraph/quote 用 text: string
 * - bullet/numbered list 用 items: string[]
 * - table 用 header: string[] / rows: string[][]
 * - styleHints 扁平化（heading1FontSizePt、marginLeftCm 等，normalize 时转回 canonical）
 *
 * 架构：LLM → KiroDocumentDraft → deterministic normalize → canonical KiroDocument →
 * renderer / Artifact（Artifact Source IR 永远存 canonical，不存 Draft）。
 * canonical KiroDocument 继续是内部 Source of Truth，不删除。
 */
import { z } from "zod";
import {
  KIRO_DOCUMENT_STYLE_PRESETS,
  KIRO_STYLE_HINT_BODY_ALIGNMENTS,
  KIRO_STYLE_HINT_DENSITY,
  KIRO_STYLE_HINT_FONTS,
  KIRO_STYLE_HINT_LINE_SPACINGS,
  KIRO_STYLE_HINT_TABLE_STYLES,
} from "@/lib/ai/computer/documents/styles/types";

export const kiroDocumentDraftStyleHintsSchema = z
  .object({
    density: z.enum(KIRO_STYLE_HINT_DENSITY).optional().describe("排版密度（只影响间距）"),
    bodyFont: z.enum(KIRO_STYLE_HINT_FONTS).optional().describe("正文字体"),
    headingFont: z.enum(KIRO_STYLE_HINT_FONTS).optional().describe("标题字体"),
    bodyFontSizePt: z.number().min(9).max(16).optional().describe("正文字号 pt（9–16）"),
    bodyAlignment: z.enum(KIRO_STYLE_HINT_BODY_ALIGNMENTS).optional().describe("正文对齐：left | justify"),
    lineSpacing: z
      .union([z.literal(1), z.literal(1.15), z.literal(1.25), z.literal(1.3), z.literal(1.5), z.literal(2)])
      .optional()
      .describe("行距倍数"),
    firstLineIndentChars: z.number().min(0).max(4).optional().describe("首行缩进字符数（0–4）"),
    titleAlignment: z.enum(["left", "center"]).optional().describe("文档标题对齐"),
    titleFontSizePt: z.number().min(14).max(32).optional().describe("文档标题字号 pt（14–32）"),
    heading1FontSizePt: z.number().min(11).max(24).optional().describe("一级标题字号 pt（11–24）"),
    heading2FontSizePt: z.number().min(10).max(20).optional().describe("二级标题字号 pt（10–20）"),
    heading3FontSizePt: z.number().min(10).max(18).optional().describe("三级标题字号 pt（10–18）"),
    tableStyle: z.enum(KIRO_STYLE_HINT_TABLE_STYLES).optional().describe("表格风格：three-line | clean | grid"),
    marginTopCm: z.number().min(1).max(5).optional().describe("上页边距 cm（1–5）"),
    marginBottomCm: z.number().min(1).max(5).optional().describe("下页边距 cm（1–5）"),
    marginLeftCm: z.number().min(1).max(5).optional().describe("左页边距 cm（1–5）"),
    marginRightCm: z.number().min(1).max(5).optional().describe("右页边距 cm（1–5）"),
  })
  .describe("用户明确的排版要求（没有用户排版要求时不要生成）");

export const kiroDocumentDraftBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heading").describe("标题 block"),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).describe("标题级别：1 | 2 | 3"),
    text: z.string().describe("标题文本（纯字符串，不要嵌套对象）"),
  }),
  z.object({
    type: z.literal("paragraph").describe("段落 block"),
    text: z.string().describe("段落文本（纯字符串）"),
  }),
  z.object({
    type: z.literal("bullet-list").describe("无序列表 block"),
    items: z.array(z.string()).describe("列表项（每项一个字符串）"),
  }),
  z.object({
    type: z.literal("numbered-list").describe("有序列表 block"),
    items: z.array(z.string()).describe("列表项（每项一个字符串）"),
  }),
  z.object({
    type: z.literal("table").describe("表格 block"),
    header: z.array(z.string()).describe("表头（一维字符串数组，如 [\"星期\",\"课程\",\"时间\",\"地点\"]）"),
    rows: z
      .array(z.array(z.string()))
      .describe("表格行（二维字符串数组；每行与表头列数一致，如 [[\"周一\",\"数据结构\",\"08:00\",\"102 教室\"]]）"),
  }),
  z.object({
    type: z.literal("quote").describe("引用 block"),
    text: z.string().describe("引用文本"),
  }),
  z.object({
    type: z.literal("code").describe("代码块"),
    language: z.string().optional().describe("代码语言（如 stata / ts / python）"),
    text: z.string().describe("代码内容"),
  }),
  z.object({
    type: z.literal("page-break").describe("分页符（无其它字段）"),
  }),
]);

export const kiroDocumentDraftSchema = z
  .object({
    title: z.string().optional().describe("文档标题（可选）"),
    stylePreset: z
      .enum(KIRO_DOCUMENT_STYLE_PRESETS)
      .optional()
      .describe("排版预设：academic-cn（论文/课程作业/研究计划/调研报告）| business-report（商业分析/项目方案/市场报告）。按任务自动选择。"),
    styleHints: kiroDocumentDraftStyleHintsSchema.optional().describe("用户明确提出的排版要求（无要求时不要生成）"),
    blocks: z.array(kiroDocumentDraftBlockSchema).describe("按文档顺序排列的 block 数组"),
  })
  .describe("模型编写用扁平文档 Draft。");

export type KiroDocumentDraft = z.infer<typeof kiroDocumentDraftSchema>;
export type KiroDocumentDraftBlock = z.infer<typeof kiroDocumentDraftBlockSchema>;
export type KiroDocumentDraftStyleHints = z.infer<typeof kiroDocumentDraftStyleHintsSchema>;
