/**
 * Render Normalization（V2.2）—— renderer 不直接消费未经处理的 canonical block。
 *
 * 当前职责：
 * - 表格矩形化：columnCount = max(header.length, ...rows.length)；所有行补齐到相同列数，
 *   缺失 cell 用 [{ text: "" }] 填充。禁止把 4/3/5 列混合的表格交给 DOCX renderer。
 * - 只处理 render copy，绝不修改 Artifact Source IR。
 */

import { KiroDocument, KiroDocumentBlock, KiroInline } from "@/lib/ai/computer/documents/schema";

/** XML 1.0 明确禁止的 control chars（U+0000–U+0008 / U+000B / U+000C / U+000E–U+001F）。
 *  保留 \t \n \r、中文、emoji、Unicode 标点。只处理 render copy，不修改 Source IR。 */
const XML_ILLEGAL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export function sanitizeOpenXmlText(text: string): string {
  return text.replace(XML_ILLEGAL_CHARS_RE, "");
}

const EMPTY_CELL: KiroInline[] = [{ text: "" }];

export function normalizeDocumentForRender(doc: KiroDocument): KiroDocument {
  let changed = false;
  const blocks: KiroDocumentBlock[] = doc.blocks.map((block) => {
    if (block.type !== "table") return block;
    const columnCount = Math.max(
      block.header.length,
      ...block.rows.map((row) => row.length)
    );
    if (columnCount === 0) return block;
    const needsPad = block.header.length !== columnCount || block.rows.some((r) => r.length !== columnCount);
    if (!needsPad) return block;
    changed = true;
    const padRow = (row: KiroInline[][]): KiroInline[][] => {
      if (row.length >= columnCount) return row;
      return [...row, ...Array.from({ length: columnCount - row.length }, () => EMPTY_CELL)];
    };
    return {
      type: "table",
      header: padRow(block.header),
      rows: block.rows.map(padRow),
    };
  });
  if (!changed) return doc;
  return { ...doc, blocks };
}

/** 表格矩形化后的列数（供 renderer 计算 fixed DXA grid） */
export function tableColumnCount(block: Extract<KiroDocumentBlock, { type: "table" }>): number {
  return Math.max(1, block.header.length, ...block.rows.map((r) => r.length));
}
