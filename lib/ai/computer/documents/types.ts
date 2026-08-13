/**
 * Kiro Document IR（结构化文档中间表示）：
 * 模型生成 IR，renderer 负责产出 Markdown/DOCX 字节。
 * 模型永远不能直接提交 raw Markdown blob / HTML / OOXML / base64。
 */

export type KiroDocumentBlock =
  | { type: "heading"; level: 1 | 2 | 3; content: KiroInline[] }
  | { type: "paragraph"; content: KiroInline[] }
  | { type: "bullet-list"; items: KiroInline[][] }
  | { type: "numbered-list"; items: KiroInline[][] }
  | { type: "table"; header: KiroInline[][]; rows: KiroInline[][][] }
  | { type: "quote"; content: KiroInline[] }
  | { type: "code"; language?: string; text: string }
  | { type: "page-break" };

export interface KiroInline {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export interface KiroDocument {
  title?: string;
  blocks: KiroDocumentBlock[];
}

/** 校验模型提交的 IR（block 类型白名单 + 结构约束） */
export function isKiroDocument(value: unknown): value is KiroDocument {
  if (typeof value !== "object" || value === null) return false;
  const doc = value as Record<string, unknown>;
  if (doc.title !== undefined && typeof doc.title !== "string") return false;
  if (!Array.isArray(doc.blocks)) return false;
  const BLOCK_TYPES = new Set(["heading", "paragraph", "bullet-list", "numbered-list", "table", "quote", "code", "page-break"]);
  for (const block of doc.blocks) {
    if (typeof block !== "object" || block === null) return false;
    const b = block as Record<string, unknown>;
    if (typeof b.type !== "string" || !BLOCK_TYPES.has(b.type)) return false;
    if (b.type === "heading" && (b.level !== 1 && b.level !== 2 && b.level !== 3)) return false;
    if (b.type === "code" && typeof b.text !== "string") return false;
    if (!isInlineArray(b.content) && b.type !== "code" && b.type !== "page-break" && b.type !== "table") return false;
  }
  return true;
}

function isInlineArray(value: unknown): value is KiroInline[] {
  if (!Array.isArray(value)) return true; // 允许缺省 content
  return value.every((item) => {
    if (typeof item !== "object" || item === null) return false;
    const i = item as Record<string, unknown>;
    return typeof i.text === "string";
  });
}
