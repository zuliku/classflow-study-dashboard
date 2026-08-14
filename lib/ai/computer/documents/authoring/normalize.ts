/**
 * Kiro Document Authoring — Draft → Canonical Normalizer（V2.2）。
 *
 * 纯函数：KiroDocumentDraft → canonical KiroDocument（唯一内部 Source of Truth）。
 * - "周一" → [{ text: "周一" }]
 * - table string[][] → KiroInline[][][]
 * - 扁平 styleHints → canonical 嵌套（headingSizesPt / pageMarginsCm）
 *
 * Artifact Source IR / renderer / update / undo / preview 全部继续消费 canonical KiroDocument。
 */
import { KiroDocument, KiroDocumentBlock, KiroInline } from "@/lib/ai/computer/documents/schema";
import {
  KiroDocumentDraft,
  KiroDocumentDraftStyleHints,
} from "@/lib/ai/computer/documents/authoring/schema";
import { KiroStyleHints } from "@/lib/ai/computer/documents/styles/types";

function inlineOf(text: string): KiroInline[] {
  return [{ text }];
}

export function normalizeDocumentDraft(draft: KiroDocumentDraft): KiroDocument {
  const blocks: KiroDocumentBlock[] = draft.blocks.map((block) => {
    switch (block.type) {
      case "heading":
        return { type: "heading", level: block.level, content: inlineOf(block.text) };
      case "paragraph":
        return { type: "paragraph", content: inlineOf(block.text) };
      case "bullet-list":
        return { type: "bullet-list", items: block.items.map(inlineOf) };
      case "numbered-list":
        return { type: "numbered-list", items: block.items.map(inlineOf) };
      case "table":
        return {
          type: "table",
          header: block.header.map(inlineOf),
          rows: block.rows.map((row) => row.map(inlineOf)),
        };
      case "quote":
        return { type: "quote", content: inlineOf(block.text) };
      case "code":
        return { type: "code", language: block.language, text: block.text };
      case "page-break":
        return { type: "page-break" };
    }
  });

  const doc: KiroDocument = { title: draft.title, blocks };
  if (draft.stylePreset !== undefined) doc.stylePreset = draft.stylePreset;
  if (draft.styleHints !== undefined) {
    const hints = normalizeDraftStyleHints(draft.styleHints);
    if (Object.keys(hints).length > 0) doc.styleHints = hints;
  }
  return doc;
}

/** 扁平 styleHints → canonical 嵌套 styleHints（headingSizesPt / pageMarginsCm） */
export function normalizeDraftStyleHints(hints: KiroDocumentDraftStyleHints): KiroStyleHints {
  const out: KiroStyleHints = {};
  if (hints.density !== undefined) out.density = hints.density;
  if (hints.bodyFont !== undefined) out.bodyFont = hints.bodyFont;
  if (hints.headingFont !== undefined) out.headingFont = hints.headingFont;
  if (hints.bodyFontSizePt !== undefined) out.bodyFontSizePt = hints.bodyFontSizePt;
  if (hints.bodyAlignment !== undefined) out.bodyAlignment = hints.bodyAlignment;
  if (hints.lineSpacing !== undefined) out.lineSpacing = hints.lineSpacing;
  if (hints.firstLineIndentChars !== undefined) out.firstLineIndentChars = hints.firstLineIndentChars;
  if (hints.titleAlignment !== undefined) out.titleAlignment = hints.titleAlignment;
  if (hints.titleFontSizePt !== undefined) out.titleFontSizePt = hints.titleFontSizePt;
  if (hints.tableStyle !== undefined) out.tableStyle = hints.tableStyle;

  const headingSizes: NonNullable<KiroStyleHints["headingSizesPt"]> = {};
  if (hints.heading1FontSizePt !== undefined) headingSizes.h1 = hints.heading1FontSizePt;
  if (hints.heading2FontSizePt !== undefined) headingSizes.h2 = hints.heading2FontSizePt;
  if (hints.heading3FontSizePt !== undefined) headingSizes.h3 = hints.heading3FontSizePt;
  if (Object.keys(headingSizes).length > 0) out.headingSizesPt = headingSizes;

  const margins: NonNullable<KiroStyleHints["pageMarginsCm"]> = {};
  if (hints.marginTopCm !== undefined) margins.top = hints.marginTopCm;
  if (hints.marginBottomCm !== undefined) margins.bottom = hints.marginBottomCm;
  if (hints.marginLeftCm !== undefined) margins.left = hints.marginLeftCm;
  if (hints.marginRightCm !== undefined) margins.right = hints.marginRightCm;
  if (Object.keys(margins).length > 0) out.pageMarginsCm = margins;

  return out;
}
