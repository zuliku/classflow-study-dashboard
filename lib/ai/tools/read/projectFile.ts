/**
 * read_project_file（Browser Client 执行，V1.3A + V1.3B + V1.4）：
 * 读取当前 Kiro Project 中明确指定资料的正文。
 * 安全 invariant：
 * - 必须存在 frozenProjectContext（当前 Turn 冻结的 Project Context）
 * - projectFileId 必须在 frozen index 中（否则 NOT_FOUND）
 * - record.projectId === frozenProjectContext.id 双重检查（阻止跨 Project 读取）
 * - storageKey 绝不进入 Tool Output
 * - image（V1.3B）：返回 visualRequired=true + note，不做文本提取、不注册 Citation
 * - scanned PDF（V1.3B）：返回 possiblyScanned=true + pageCount + visualRequired=true，
 *   不做 Vision；工具链 read_project_file → read_project_visual
 * - pages（V1.4）：仅 PDF 定向页正文读取；canonicalize（dedupe/sort/越界 → INVALID_INPUT，
 *   不静默 clamp）；绝不写入 prefix extraction cache（不污染 read_project_file 默认路径）；
 *   输出受 MAX_PROJECT_TARGETED_TEXT_CHARS 预算（单页超限保留前段 + truncated=true）
 */
import { z } from "zod";
import { getProjectFileBlob } from "@/lib/ai/projects/files/db";
import { resolveProjectFileForTurn } from "@/lib/ai/projects/files/access";
import { extractAttachment } from "@/lib/ai/attachments";
import { extractCacheKey } from "@/lib/ai/attachments/cache";
import { extractPdfPagesText } from "@/lib/ai/attachments/documentSearch";
import { MAX_PROJECT_PDF_TEXT_PAGES_PER_READ, MAX_PROJECT_TARGETED_TEXT_CHARS } from "@/lib/ai/attachments/limits";
import { KiroProjectTurnContext } from "@/lib/ai/contextBudget/types";

const schema = z
  .object({
    projectFileId: z.string().trim().min(1).max(120),
    pages: z
      .array(z.number().int().min(1).max(10000))
      .min(1)
      .max(MAX_PROJECT_PDF_TEXT_PAGES_PER_READ)
      .optional(),
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
  const { projectFileId, pages: requestedPages } = parsed.data;

  // 共享 access guard（frozen index + metadata 存在 + 跨项目双重检查）
  const access = await resolveProjectFileForTurn({ projectFileId, projectContext: frozenProjectContext });
  if (!access.ok) {
    return { ok: false, code: access.code, message: access.message };
  }
  const { record } = access;

  // V1.3B：image 不做文本提取 —— 明确指向 read_project_visual；无正文所以不注册 Citation Source
  if (record.kind === "image") {
    // V1.4：pages 仅适用于 PDF；对 image 显式拒绝而不是忽略输入
    if (requestedPages) {
      return { ok: false, code: "INVALID_INPUT", message: "pages 仅适用于 PDF 项目资料。" };
    }
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

  // ---- V1.4：PDF 定向页正文读取（pages 指定时）----
  if (requestedPages) {
    if (record.kind !== "pdf") {
      return { ok: false, code: "INVALID_INPUT", message: "pages 仅适用于 PDF 项目资料。" };
    }
    const blob = await getProjectFileBlob(record.storageKey);
    if (!blob) {
      return { ok: false, code: "FILE_MISSING", message: "该项目资料文件已不存在，请重新上传。" };
    }
    // canonicalize：dedupe / sort ascending；越界页 → INVALID_INPUT（不静默 clamp）
    const seen = new Set<number>();
    const pageNumbers = requestedPages
      .filter((p) => !seen.has(p) && seen.add(p))
      .sort((a, b) => a - b);
    try {
      const { numPages, pages, invalid } = await extractPdfPagesText(blob, pageNumbers);
      if (invalid.length > 0) {
        return { ok: false, code: "INVALID_INPUT", message: `请求的页码超出该 PDF 的页码范围（1-${numPages}）。` };
      }
      // 输出预算：累计到 MAX_PROJECT_TARGETED_TEXT_CHARS；单页超限保留该页前段（truncated=true），
      // 绝不整页丢弃（用户明确指定了该页）
      const resultPages: { page: number; text: string }[] = [];
      let used = 0;
      let overBudget = false;
      for (const p of pages) {
        if (used >= MAX_PROJECT_TARGETED_TEXT_CHARS) {
          overBudget = true;
          continue;
        }
        const remaining = MAX_PROJECT_TARGETED_TEXT_CHARS - used;
        if (p.text.length > remaining) {
          resultPages.push({ page: p.page, text: p.text.slice(0, remaining) });
          used = MAX_PROJECT_TARGETED_TEXT_CHARS;
          overBudget = true;
        } else {
          resultPages.push({ page: p.page, text: p.text });
          used += p.text.length;
        }
      }
      const emptyAll = resultPages.every((p) => p.text.length === 0);
      return {
        ok: true,
        data: {
          projectFileId,
          name: record.name,
          kind: "pdf",
          text: resultPages.map((p) => `【第 ${p.page} 页】\n${p.text}`).join("\n\n"),
          truncated: overBudget,
          pages: resultPages.filter((p) => p.text.length > 0),
          pageCount: numPages,
          note: emptyAll
            ? "指定页面没有可提取文本；如需读取图表或扫描内容，请使用 read_project_visual。"
            : `已读取指定页面：第 ${resultPages.map((p) => p.page).join("、")} 页。${overBudget ? "指定页面内容因单次返回预算被部分截断。" : ""}`,
        },
      };
    } catch {
      return { ok: false, code: "EXTRACT_FAILED", message: "该项目资料读取失败，请重新上传。" };
    }
  }

  // 3. Blob → 提取（复用 extraction cache；无 pages 时保持既有快速路径）
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

  // V1.4：truncated=true 时给出全文检索提示（与既有视觉提示合并，不互相覆盖）
  const notes: string[] = [];
  if (doc.truncated) {
    notes.push("文档较长，本次只提供部分正文。需要查找后续章节或特定内容时，请使用 search_project_file。");
  }
  if (record.kind === "pdf") {
    notes.push("正文已从文本层读取；如需分析图表、示意图、图片或页面布局，可使用 read_project_visual 并指定相关页码。");
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
      ...(notes.length > 0 ? { note: notes.join("") } : {}),
    },
  };
}
