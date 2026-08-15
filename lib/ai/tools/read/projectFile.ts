/**
 * read_project_file（Browser Client 执行，V1.3A）：
 * 读取当前 Kiro Project 中明确指定资料的正文。
 * 安全 invariant：
 * - 必须存在 frozenProjectContext（当前 Turn 冻结的 Project Context）
 * - projectFileId 必须在 frozen index 中（否则 NOT_FOUND）
 * - record.projectId === frozenProjectContext.id 双重检查（阻止跨 Project 读取）
 * - storageKey 绝不进入 Tool Output
 * - scanned PDF：possiblyScanned=true + note，不做 Vision / OCR
 */
import { z } from "zod";
import { getProjectFile, getProjectFileBlob } from "@/lib/ai/projects/files/db";
import { extractAttachment } from "@/lib/ai/attachments";
import { extractCacheKey } from "@/lib/ai/attachments/cache";
import { KiroProjectTurnContext } from "@/lib/ai/contextBudget/types";

const schema = z
  .object({
    projectFileId: z.string().trim().min(1).max(120),
  })
  .strict();

export type ReadProjectFileResult = {
  projectFileId: string;
  name: string;
  kind: "text" | "pdf" | "docx";
  text: string;
  truncated: boolean;
  pages?: { page: number; text: string }[];
  possiblyScanned?: boolean;
  note?: string;
};

export async function executeReadProjectFile(
  input: unknown,
  frozenProjectContext: KiroProjectTurnContext | undefined
): Promise<{ ok: true; data: ReadProjectFileResult } | { ok: false; code: string; message: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "输入不合法。" };
  }
  const { projectFileId } = parsed.data;

  if (!frozenProjectContext) {
    return { ok: false, code: "NOT_FOUND", message: "当前对话不属于 Kiro 项目。" };
  }
  // 1. frozen index 检查：只能读取当前 Turn 索引中存在的文件
  const indexEntry = (frozenProjectContext.files ?? []).find((f) => f.id === projectFileId);
  if (!indexEntry) {
    return { ok: false, code: "NOT_FOUND", message: "该项目资料不在当前会话可用索引中。" };
  }

  // 2. metadata + 跨项目双重检查（即使 IndexedDB 存在其他 Project 的文件也拒绝）
  let record;
  try {
    record = await getProjectFile(projectFileId);
  } catch {
    return { ok: false, code: "NOT_FOUND", message: "无法读取该项目资料。" };
  }
  if (!record || record.projectId !== frozenProjectContext.id) {
    return { ok: false, code: "NOT_FOUND", message: "无法读取该项目资料。" };
  }

  // 3. Blob → 提取（复用 extraction cache）
  const blob = await getProjectFileBlob(record.storageKey);
  if (!blob) {
    return { ok: false, code: "FILE_MISSING", message: "该项目资料文件已不存在，请重新上传。" };
  }

  const extracted = await extractAttachment(blob, {
    kind: record.kind,
    cacheKey: extractCacheKey({ name: record.storageKey, size: record.sizeBytes, lastModified: 0 }),
  });
  if (!extracted.ok) {
    return { ok: false, code: "EXTRACT_FAILED", message: "该项目资料读取失败，请重新上传。" };
  }
  const doc = extracted.extracted;

  // 4. scanned PDF：明确提示，不自动 Vision / OCR
  if (doc.possiblyScanned) {
    return {
      ok: true,
      data: {
        projectFileId,
        name: record.name,
        kind: record.kind,
        text: "",
        truncated: false,
        possiblyScanned: true,
        note: "这份 PDF 主要由扫描图片组成，当前 Project Files 版本暂不读取其图像正文。",
      },
    };
  }

  return {
    ok: true,
    data: {
      projectFileId,
      name: record.name,
      kind: record.kind,
      text: doc.text,
      truncated: doc.truncated,
      pages: doc.pages,
    },
  };
}
