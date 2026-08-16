/**
 * search_project_file（Browser Client 执行，V1.4）：
 * 对单个 Project File 的完整原文做 LOCAL / DETERMINISTIC / LEXICAL 检索。
 *
 * 安全 invariant：
 * - 复用 resolveProjectFileForTurn（frozen index + metadata + projectId 双重检查）—— 跨 Project 0 Blob 读取
 * - image → NOT_SEARCHABLE（不 OCR / 不自动 Vision / 不调 endpoint）
 * - PDF：读取 Original Blob 全页扫描（绕过 100k prefix cache），逐页 cleanup（bounded memory），
 *   不提前 break（后部 exact match 不丢失）
 * - TXT/MD：blob.text() 完整原文（绝不调用 extractTextFile 的 100k truncate）
 * - DOCX：extractDocxRawText（mammoth untruncated raw text）
 * - 不持久化全文（不进 cache / IndexedDB / Memory）
 * - 输出 bounded：maxResults ≤ 8、snippet ≤ 1200、总 chars ≤ 8000
 * - truncated 表示「存在更多匹配未返回」（maxResults / 总预算），绝不是原文 100k 截断
 */
import { z } from "zod";
import { getProjectFileBlob } from "@/lib/ai/projects/files/db";
import { resolveProjectFileForTurn } from "@/lib/ai/projects/files/access";
import { searchPdfText, searchLocalText } from "@/lib/ai/attachments/documentSearch";
import { extractDocxRawText } from "@/lib/ai/attachments/docx";
import { KiroProjectTurnContext } from "@/lib/ai/contextBudget/types";

const schema = z
  .object({
    projectFileId: z.string().trim().min(1).max(120),
    query: z.string().trim().min(1).max(200),
    maxResults: z.number().int().min(1).max(8).default(5).optional(),
  })
  .strict();

export type SearchProjectFileMatch =
  | { page: number; text: string }
  | { text: string };

export type SearchProjectFileResult = {
  projectFileId: string;
  name: string;
  kind: "text" | "pdf" | "docx";
  query: string;
  matches: SearchProjectFileMatch[];
  matchCount: number;
  /** 存在更多匹配但因 maxResults / 总字符预算未全部返回（≠ 原文 100k 截断） */
  truncated: boolean;
};

export type SearchProjectFileErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FILE_MISSING"
  | "NOT_SEARCHABLE"
  | "SEARCH_FAILED";

export interface SearchProjectFileDeps {
  getBlob?: typeof getProjectFileBlob;
  searchPdf?: typeof searchPdfText;
  searchText?: typeof searchLocalText;
  docxRawText?: typeof extractDocxRawText;
}

export type SearchProjectFileOutcome =
  | { ok: true; data: SearchProjectFileResult }
  | { ok: false; code: SearchProjectFileErrorCode; message: string };

export async function executeSearchProjectFile(
  input: unknown,
  opts: {
    frozenProjectContext: KiroProjectTurnContext | undefined;
    deps?: SearchProjectFileDeps;
  }
): Promise<SearchProjectFileOutcome> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "输入不合法。" };
  }
  const { projectFileId, query } = parsed.data;
  const maxResults = parsed.data.maxResults ?? 5;

  // ---- 共享 access guard（frozen index + metadata + 跨项目双重检查；失败不读 Blob）----
  const access = await resolveProjectFileForTurn({ projectFileId, projectContext: opts.frozenProjectContext });
  if (!access.ok) {
    return { ok: false, code: access.code, message: access.message };
  }
  const { record } = access;

  // ---- image：无文本层可搜（不 OCR / 不自动 Vision / 不调 endpoint）----
  if (record.kind === "image") {
    return {
      ok: false,
      code: "NOT_SEARCHABLE",
      message: "图片资料没有可搜索的文本层，请使用 read_project_visual。",
    };
  }

  const getBlob = opts.deps?.getBlob ?? getProjectFileBlob;
  const blob = await getBlob(record.storageKey);
  if (!blob) {
    return { ok: false, code: "FILE_MISSING", message: "该项目资料文件已不存在，请重新上传。" };
  }

  try {
    if (record.kind === "pdf") {
      // 全页扫描（绕过 100k prefix cache；逐页 cleanup；不提前 break）
      const searchPdf = opts.deps?.searchPdf ?? searchPdfText;
      const r = await searchPdf(blob, query, { maxResults });
      // V1.4.2：无可用文本层（scanned / zero-text）→ 明确 NOT_SEARCHABLE，
      // 绝不能把「无法搜索」表示成「全文没有该 query」
      if (r.textLayer.possiblyScanned) {
        return {
          ok: false,
          code: "NOT_SEARCHABLE",
          message: "这份 PDF 没有可用文本层，无法进行关键词全文检索。请使用 read_project_file 查看页面信息，并使用 read_project_visual 按页读取视觉内容。",
        };
      }
      return {
        ok: true,
        data: {
          projectFileId,
          name: record.name,
          kind: "pdf",
          query,
          matches: r.matches.map((m) => ({ page: m.page, text: m.text })),
          matchCount: r.matchCount,
          truncated: r.truncated,
        },
      };
    }

    if (record.kind === "docx") {
      // untruncated mammoth raw text（绝不使用 extractDocx 的 100k bounded 结果）
      const docxRawText = opts.deps?.docxRawText ?? extractDocxRawText;
      const raw = await docxRawText(blob);
      const searchText = opts.deps?.searchText ?? searchLocalText;
      const r = searchText(raw, query, { maxResults });
      return {
        ok: true,
        data: {
          projectFileId,
          name: record.name,
          kind: "docx",
          query,
          matches: r.matches.map((m) => ({ text: m.text })),
          matchCount: r.matchCount,
          truncated: r.truncated,
        },
      };
    }

    // TXT / Markdown：完整原文（blob.text()，绝不 extractTextFile 100k truncate）
    const raw = await blob.text();
    const searchText = opts.deps?.searchText ?? searchLocalText;
    const r = searchText(raw, query, { maxResults });
    return {
      ok: true,
      data: {
        projectFileId,
        name: record.name,
        kind: "text",
        query,
        matches: r.matches.map((m) => ({ text: m.text })),
        matchCount: r.matchCount,
        truncated: r.truncated,
      },
    };
  } catch {
    return { ok: false, code: "SEARCH_FAILED", message: "全文检索失败，请重试。" };
  }
}
