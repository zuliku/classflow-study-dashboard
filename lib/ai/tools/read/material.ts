import { z } from "zod";
import { getFileBlob } from "@/lib/fileStorage";
import { extractAttachment } from "@/lib/ai/attachments";
import { extractCacheKey } from "@/lib/ai/attachments/cache";
import { KiroAttachmentKind } from "@/lib/ai/attachments/types";
import { ReadToolState, ReadToolResult } from "@/lib/ai/tools/read/executor";

const readMaterialSchema = z.object({
  courseId: z.string().trim().min(1).max(120),
  materialId: z.string().trim().min(1).max(120),
});

/** Material.type → 提取器 kind（doc/ppt 由调用方先经标题扩展名消歧，不直接使用） */
function materialTypeToKind(type: string): KiroAttachmentKind | null {
  switch (type) {
    case "pdf":
      return "pdf";
    case "image":
      return "image";
    default:
      return null;
  }
}

/**
 * 材料 kind 消歧（导出供测试）："doc" 类型可能是 DOCX / 纯文本 / XLSX（上传时统一映射为 doc），
 * "ppt" 类型可能是 PPTX（可读）或旧版 PPT（二进制，需明确拒绝）。
 * 文件名扩展名优先（材料标题即原文件名），Blob MIME 兜底。
 */
export function resolveMaterialKind(type: string, title: string, blobMime: string): KiroAttachmentKind | null {
  const ext = (title.split(".").pop() ?? "").toLowerCase();
  if (type === "ppt") {
    // .ppt 为旧版二进制，zip 解析必失败 → 走 legacy 明确指引而非笼统失败
    return ext === "ppt" ? null : "slides";
  }
  if (type === "doc") {
    if (ext === "xlsx" || ext === "xls") return "spreadsheet";
    if (ext === "pptx") return "slides";
    if (ext === "txt" || ext === "md" || ext === "markdown" || ext === "csv" || ext === "tsv") return "text";
    if (ext === "doc" || ext === "ppt") return null; // 旧版二进制：明确拒绝
    if ((blobMime || "").toLowerCase().startsWith("text/")) return "text";
    return "docx";
  }
  return materialTypeToKind(type);
}

/**
 * read_material（Browser Client 执行）：
 * 通过 storageKey 读取 IndexedDB Blob → Attachment Router → 提取文本。
 * 只返回 extracted text，绝不把 20MB Blob 作为 Tool Output。
 */
export async function executeReadMaterial(
  input: unknown,
  state: ReadToolState
): Promise<ReadToolResult<unknown>> {
  const parsed = readMaterialSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "输入不合法。" };
  }
  const { courseId, materialId } = parsed.data;
  const course = state.courses.find((c) => c.id === courseId);
  if (!course) return { ok: false, code: "NOT_FOUND", message: "未找到对应课程。" };
  const material = course.materials.find((m) => m.id === materialId);
  if (!material) return { ok: false, code: "NOT_FOUND", message: "未找到对应资料。" };

  // URL 资料：不主动抓取任意 URL（SSRF/CORS/隐私），只给 metadata
  if (!material.storageKey) {
    return {
      ok: true,
      data: {
        materialId,
        courseId,
        title: material.title,
        type: material.type,
        text: "",
        note: "该资料为外部链接，当前不会自动下载正文。",
      },
    };
  }

  const blob = await getFileBlob(material.storageKey);
  if (!blob) {
    return {
      ok: false,
      code: "FILE_MISSING",
      message: "课程资料记录存在，但本地文件已丢失，请重新上传。",
    };
  }

  // kind 消歧：Material.type（ppt/doc）+ 标题扩展名 + Blob MIME 三源确定真实格式；
  // 旧版二进制（.doc/.ppt）走明确拒绝而非提取失败
  const kind = resolveMaterialKind(material.type, material.title, blob.type);
  if (!kind) {
    return {
      ok: true,
      data: {
        materialId,
        courseId,
        title: material.title,
        type: material.type,
        text: "",
        note: "暂不支持旧版 Office 格式（.doc/.ppt），请另存为 .docx/.pptx 后重试。",
      },
    };
  }

  const result = await extractAttachment(blob as Blob & { name?: string; lastModified?: number }, {
    kind,
    cacheKey: extractCacheKey({ storageKey: material.storageKey }),
  });
  if (!result.ok) {
    return { ok: false, code: "INVALID_INPUT", message: result.message };
  }

  const scanned = (result.extracted as { possiblyScanned?: boolean }).possiblyScanned === true;
  return {
    ok: true,
    data: {
      materialId,
      courseId,
      title: material.title,
      type: material.type,
      text: result.extracted.text,
      truncated: result.extracted.truncated,
      pages: result.extracted.pages,
      possiblyScanned: scanned,
      note: scanned
        ? "这份 PDF 主要由扫描图片组成，当前版本暂不进行逐页图像转换。"
        : undefined,
    },
  };
}
