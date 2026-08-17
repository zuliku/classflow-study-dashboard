/**
 * Document Authoring 双兼容 Parser（V2.3）。
 *
 * Browser Runtime 在迁移期同时接受：
 * - V2 扁平 Draft（text / items / string 表格）→ normalize 为 canonical
 * - V1 Canonical（content: [{ text }] / 三层表格）→ passthrough
 *
 * 强 invariant：无论输入哪种，输出永远是 Canonical KiroDocument（Artifact Source IR /
 * renderer / revision / undo 只消费 canonical）。
 * 失败返回 bounded issues（path + message），绝不 throw raw ZodError / 不 echo 正文。
 */
import { kiroDocumentSchema, KiroDocument } from "@/lib/ai/computer/documents/schema";
import { kiroDocumentDraftSchema } from "@/lib/ai/computer/documents/authoring/schema";
import { normalizeDocumentDraft } from "@/lib/ai/computer/documents/authoring/normalize";

export type DocumentAuthoringInputFormat = "draft-v2" | "canonical-v1";

export type ParsedDocumentAuthoringInput = {
  document: KiroDocument;
  format: DocumentAuthoringInputFormat;
};

export type ParseDocumentAuthoringResult =
  | { ok: true; value: ParsedDocumentAuthoringInput }
  | { ok: false; issues: Array<{ path: PropertyKey[]; message: string }> };

export function parseDocumentAuthoringInput(value: unknown): ParseDocumentAuthoringResult {
  const draft = kiroDocumentDraftSchema.safeParse(value);
  if (draft.success) {
    return {
      ok: true,
      value: { format: "draft-v2", document: normalizeDocumentDraft(draft.data) },
    };
  }

  const canonical = kiroDocumentSchema.safeParse(value);
  if (canonical.success) {
    return { ok: true, value: { format: "canonical-v1", document: canonical.data } };
  }

  // 两种都失败：bounded issues（最多 3 条；不 echo 正文）
  const sourceIssues = draft.success ? [] : (draft.error.issues as { path: PropertyKey[]; message: string }[]);
  const issues = (sourceIssues.length > 0 ? sourceIssues : (canonical.error.issues as { path: PropertyKey[]; message: string }[]))
    .slice(0, 3)
    .map((i) => ({ path: i.path, message: i.message }));
  return { ok: false, issues };
}
