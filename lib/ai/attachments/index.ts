import { KiroAttachmentKind } from "@/lib/ai/attachments/types";
import { routeAttachment } from "@/lib/ai/attachments/router";
import { extractTextFile, ExtractedDocument } from "@/lib/ai/attachments/extractors";
import { extractPdf } from "@/lib/ai/attachments/pdf";
import { extractDocx } from "@/lib/ai/attachments/docx";
import { getExtractCache, setExtractCache, extractCacheKey } from "@/lib/ai/attachments/cache";
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
  | { ok: false; reason: "unsupported" | "too_large"; message: string }
> {
  const routed = routeAttachment({ name: file.name ?? "", type: file.type ?? "", size: file.size });
  if (!routed.ok) {
    if (routed.reason === "too_large") return { ok: false, reason: "too_large", message: "文件超过大小限制。" };
    return { ok: false, reason: "unsupported", message: "暂不支持这种文件类型。" };
  }

  const cacheKey = options.cacheKey ?? extractCacheKey({ name: file.name, size: file.size, lastModified: file.lastModified });

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
  } catch {
    return { ok: false, reason: "unsupported", message: "无法读取该文件，请确认格式与内容。" };
  }
}

export type { ExtractedDocument };
