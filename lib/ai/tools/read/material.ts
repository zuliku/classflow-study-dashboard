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

/** Material.type → 提取器 kind */
function materialTypeToKind(type: string): KiroAttachmentKind | null {
  switch (type) {
    case "pdf":
      return "pdf";
    case "doc":
      return "docx";
    case "image":
      return "image";
    default:
      return null; // link / ppt 等暂不支持正文
  }
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

  // "doc" 类型可能是 DOCX 也可能是纯文本：先按 Blob MIME 路由，再按 Material.type
  let kind = materialTypeToKind(material.type);
  if (kind === "docx" && (blob.type || "").toLowerCase().startsWith("text/")) {
    kind = "text";
  }
  if (!kind) {
    return {
      ok: true,
      data: {
        materialId,
        courseId,
        title: material.title,
        type: material.type,
        text: "",
        note: "暂不支持读取该类资料的正文。",
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
