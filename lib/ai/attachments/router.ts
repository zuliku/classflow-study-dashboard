import { KiroAttachmentKind } from "@/lib/ai/attachments/types";
import { SIZE_LIMITS } from "@/lib/ai/attachments/limits";

/**
 * Attachment Router：根据 MIME + 扩展名判断类型（不只依赖扩展名）。
 * 不支持的扩展（.docm/.html/.zip/.exe 等）返回 null。
 */
export type AttachmentRoute =
  | { ok: true; kind: KiroAttachmentKind }
  | { ok: false; reason: "unsupported" | "too_large" | "too_small" | "legacy" };

const TEXT_MIMES = ["text/plain", "text/markdown", "text/x-markdown", "text/csv", "text/tab-separated-values"];
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"];
const PDF_MIMES = ["application/pdf"];
const DOCX_MIMES = ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const SPREADSHEET_MIMES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];
const SLIDES_MIMES = [
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
];

const EXT_KIND: Record<string, KiroAttachmentKind> = {
  ".txt": "text",
  ".md": "text",
  ".markdown": "text",
  ".csv": "text",
  ".tsv": "text",
  ".pdf": "pdf",
  ".docx": "docx",
  ".xlsx": "spreadsheet",
  ".xls": "spreadsheet",
  ".pptx": "slides",
  ".jpg": "image",
  ".jpeg": "image",
  ".png": "image",
  ".webp": "image",
};

/** 旧版二进制 Office 格式（OLE）：mammoth/jszip 解析器不支持，给出明确指引而非笼统拒绝。
 * 注意：.xls 例外——SheetJS 可直接读取 OLE 表格，走 spreadsheet */
const LEGACY_EXTS = new Set([".doc", ".ppt"]);

/** 明确拒绝的扩展（安全边界） */
const BLOCKED_EXTS = new Set([".docm", ".html", ".htm", ".zip", ".exe", ".psd", ".js", ".sh", ".svg"]);

export function routeAttachment(file: { name: string; type: string; size: number }): AttachmentRoute {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const extKey = `.${ext}`;
  const mime = (file.type || "").toLowerCase();

  if (BLOCKED_EXTS.has(extKey)) return { ok: false, reason: "unsupported" };
  // 旧版二进制 Office：扩展名优先于 MIME（.ppt 的 MIME 与 pptx 同族，必须先拦截）
  if (LEGACY_EXTS.has(extKey)) return { ok: false, reason: "legacy" };

  let kind: KiroAttachmentKind | null = null;
  if (TEXT_MIMES.includes(mime) || extKey === ".txt" || extKey === ".md" || extKey === ".markdown" || extKey === ".csv" || extKey === ".tsv") {
    kind = "text";
  } else if (PDF_MIMES.includes(mime) || extKey === ".pdf") {
    kind = "pdf";
  } else if (DOCX_MIMES.includes(mime) || extKey === ".docx") {
    kind = "docx";
  } else if (SPREADSHEET_MIMES.includes(mime) || extKey === ".xlsx" || extKey === ".xls") {
    kind = "spreadsheet";
  } else if (SLIDES_MIMES.includes(mime) || extKey === ".pptx") {
    kind = "slides";
  } else if (IMAGE_MIMES.includes(mime) || [".jpg", ".jpeg", ".png", ".webp"].includes(extKey)) {
    kind = "image";
  }

  if (!kind) return { ok: false, reason: "unsupported" };
  const limit = SIZE_LIMITS[kind];
  if (file.size > limit) return { ok: false, reason: "too_large" };
  if (file.size <= 0) return { ok: false, reason: "too_small" };
  return { ok: true, kind };
}

/** 附件 kind → Material.type（保存到课程资料时使用） */
export function kindToMaterialType(kind: KiroAttachmentKind): "pdf" | "ppt" | "doc" | "link" | "image" {
  switch (kind) {
    case "pdf":
      return "pdf";
    case "slides":
      return "ppt";
    case "image":
      return "image";
    case "docx":
    case "spreadsheet":
    case "text":
      return "doc";
  }
}
