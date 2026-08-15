/**
 * read_project_file（Browser Client 执行，V1.3A + V1.3B）：
 * 读取当前 Kiro Project 中明确指定资料的正文。
 * 安全 invariant：
 * - 必须存在 frozenProjectContext（当前 Turn 冻结的 Project Context）
 * - projectFileId 必须在 frozen index 中（否则 NOT_FOUND）
 * - record.projectId === frozenProjectContext.id 双重检查（阻止跨 Project 读取）
 * - storageKey 绝不进入 Tool Output
 * - image（V1.3B）：返回 visualRequired=true + note，不做文本提取、不注册 Citation
 * - scanned PDF（V1.3B）：返回 possiblyScanned=true + pageCount + visualRequired=true，
 *   不做 Vision；工具链 read_project_file → read_project_visual
 */
import { z } from "zod";
import { getProjectFileBlob } from "@/lib/ai/projects/files/db";
import { resolveProjectFileForTurn } from "@/lib/ai/projects/files/access";
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
  kind: "text" | "pdf" | "docx" | "image";
  text: string;
  truncated: boolean;
  pages?: { page: number; text: string }[];
  pageCount?: number;
  possiblyScanned?: boolean;
  /** V1.3B：需要 read_project_visual 才能获得内容（image / scanned PDF） */
  visualRequired?: boolean;
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

  // 共享 access guard（frozen index + metadata 存在 + 跨项目双重检查）
  const access = await resolveProjectFileForTurn({ projectFileId, projectContext: frozenProjectContext });
  if (!access.ok) {
    return { ok: false, code: access.code, message: access.message };
  }
  const { record } = access;

  // V1.3B：image 不做文本提取 —— 明确指向 read_project_visual；无正文所以不注册 Citation Source
  if (record.kind === "image") {
    return {
      ok: true,
      data: {
        projectFileId,
        name: record.name,
        kind: "image",
        text: "",
        truncated: false,
        visualRequired: true,
        note: "这是图片资料，需要使用 read_project_visual 读取视觉内容。",
      },
    };
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

  // V1.3B：scanned PDF —— 明确 possiblyScanned + pageCount + visualRequired；不自动 Vision
  if (doc.possiblyScanned) {
    return {
      ok: true,
      data: {
        projectFileId,
        name: record.name,
        kind: record.kind,
        text: "",
        truncated: false,
        pageCount: doc.pageCount,
        possiblyScanned: true,
        visualRequired: true,
        note: "这份 PDF 主要由扫描图片组成，请使用 read_project_visual 读取指定页面的视觉内容。",
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
      pageCount: doc.pageCount,
    },
  };
}
