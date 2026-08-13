/**
 * Kiro Document IR — 唯一 Schema Source of Truth。
 * one schema → runtime validation → TypeScript types → AI SDK model-facing input schema。
 * 真实支持范围（renderer 实际消费）：heading/paragraph/bullet-list/numbered-list/table/quote/code/page-break。
 * 无 sections/chapters/children/body；不要为了兼容模型猜测新增结构。
 */
import { z } from "zod";

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

export const kiroDocumentSchema = z
  .object({
    title: z.string().optional().describe("文档标题（可选）"),
    blocks: z.array(kiroDocumentBlockSchema).describe("按文档顺序排列的 block 数组"),
  })
  .describe("结构化 KiroDocument。仅包含 title + blocks。");

export type KiroInline = z.infer<typeof kiroInlineSchema>;
export type KiroDocumentBlock = z.infer<typeof kiroDocumentBlockSchema>;
export type KiroDocument = z.infer<typeof kiroDocumentSchema>;

/** 薄封装（保持旧调用方兼容）；验证完整委托给 schema */
export function isKiroDocument(value: unknown): value is KiroDocument {
  return kiroDocumentSchema.safeParse(value).success;
}
