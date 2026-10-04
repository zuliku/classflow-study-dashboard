import { KiroAttachmentKind } from "@/lib/ai/attachments/types";
import { routeAttachment, formatAttachmentLimit } from "@/lib/ai/attachments/router";
import { extractTextFile, ExtractedDocument } from "@/lib/ai/attachments/extractors";
import { extractPdf, PdfExtractError } from "@/lib/ai/attachments/pdf";
import { extractDocx } from "@/lib/ai/attachments/docx";
import { extractXlsx } from "@/lib/ai/attachments/xlsx";
import { extractPptx } from "@/lib/ai/attachments/pptx";
import { getExtractCache, setExtractCache, extractCacheKey, hashBlobFingerprint } from "@/lib/ai/attachments/cache";
import { EXTRACTOR_VERSION } from "@/lib/ai/attachments/limits";

/**
 * Attachment 统一入口：路由 → 提取（带缓存）。
 * 图片不做文本提取（vision 走原生 image part）。
 */
export async function extractAttachment(
  file: Blob & { name?: string; lastModified?: number },
  options: { cacheKey?: string; kind: KiroAttachmentKind }
): Promise<
  | { ok: true; extracted: ExtractedDocument }
  | { ok: false; reason: "unsupported" | "too_large" | "too_small" | "legacy"; message: string }
> {
  const routed = routeAttachment({ name: file.name ?? "", type: file.type ?? "", size: file.size });
  if (!routed.ok) {
    if (routed.reason === "too_large")
      return {
        ok: false,
        reason: "too_large",
        message: `文件过大（${(file.size / 1048576).toFixed(1)}MB），${routed.kind}上限 ${formatAttachmentLimit(routed.limit)}，请压缩或拆分后重试。`,
      };
    if (routed.reason === "too_small") return { ok: false, reason: "too_small", message: "文件为空，无法读取。" };
    if (routed.reason === "legacy")
      return { ok: false, reason: "legacy", message: "暂不支持旧版 Office 格式（.doc/.ppt），请另存为 .docx/.pptx 后重试。" };
    return { ok: false, reason: "unsupported", message: "暂不支持这种文件类型（支持 PDF/Word/Excel/PPT/纯文本/图片）。" };
  }

  const cacheKey =
    options.cacheKey ??
    extractCacheKey({
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      // 调用方未给 key 时现算指纹（图片在下方提前返回，走不到这里，不浪费 IO）
      contentHash: await hashBlobFingerprint(file),
    });

  if (options.kind === "image") {
    return { ok: true, extracted: { text: "", truncated: false } };
  }

  const cached = await getExtractCache(cacheKey);
  if (cached) {
    return {
      ok: true,
      extracted: {
        text: cached.text,
        pages: cached.pages,
        // V1.3C.1：恢复真实 truncated 事实（PDF 页边界截断时 text.length < 100k 但 truncated=true）
        truncated: cached.truncated,
        pageCount: cached.pageCount,
        possiblyScanned: cached.possiblyScanned,
      },
    };
  }

  try {
    const extracted =
      options.kind === "pdf"
        ? await extractPdf(file)
        : options.kind === "docx"
        ? await extractDocx(file)
        : options.kind === "spreadsheet"
        ? await extractXlsx(file)
        : options.kind === "slides"
        ? await extractPptx(file)
        : await extractTextFile(file);
    await setExtractCache(cacheKey, {
      text: extracted.text,
      pages: extracted.pages,
      // V1.3C.1：保存提取过程的真实截断事实，绝不重新计算
      truncated: extracted.truncated,
      pageCount: extracted.pageCount,
      possiblyScanned: extracted.possiblyScanned,
      extractedAt: new Date().toISOString(),
      extractorVersion: EXTRACTOR_VERSION,
    });
    return { ok: true, extracted };
  } catch (err) {
    // PDF 分类报错（可操作提示）；其它格式保持笼统文案（不透传 raw error）。
    // 诊断保留在 console（dev 复现用），绝不进入 Tool Output / Audit。
    if (err instanceof PdfExtractError) {
      if (typeof console !== "undefined") {
        console.warn(`[kiro] pdf extract failed (${err.failureKind}):`, err.message, "| cause:", err.causeDetail);
      }
      if (err.failureKind === "encrypted") {
        return { ok: false, reason: "unsupported", message: "该 PDF 已加密，请先解密或打印为新 PDF 后重试。" };
      }
      if (err.failureKind === "invalid") {
        return { ok: false, reason: "unsupported", message: "该文件不是有效的 PDF（可能是改了扩展名或已损坏），请确认后重试。" };
      }
      return { ok: false, reason: "unsupported", message: "该 PDF 页面无法读取，请尝试打印为新 PDF 后重试。" };
    }
    // Office 文档哨兵错误 → 可操作文案（与 PDF invalid 同级；改扩展名/截断 zip 最常见）
    const sentinel = err instanceof Error ? err.message : "";
    if (sentinel === "empty-workbook") {
      return { ok: false, reason: "unsupported", message: "该表格没有可读取的内容（可能是空表或文件已损坏），请确认后重试。" };
    }
    if (sentinel === "empty-slides" || sentinel === "no-slides") {
      return { ok: false, reason: "unsupported", message: "该演示文稿没有可读取的幻灯片（可能是空文件或已损坏），请确认后重试。" };
    }
    if (options.kind === "docx" || options.kind === "spreadsheet" || options.kind === "slides") {
      return { ok: false, reason: "unsupported", message: "该文档无法读取（可能是改了扩展名或文件已损坏），请确认后重试。" };
    }
    return { ok: false, reason: "unsupported", message: "无法读取该文件，请确认格式与内容。" };
  }
}

export type { ExtractedDocument };
