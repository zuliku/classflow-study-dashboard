import { KiroAttachmentKind } from "@/lib/ai/attachments/types";
import { SIZE_LIMITS } from "@/lib/ai/attachments/limits";

/**
 * Attachment Router：根据 MIME + 扩展名判断类型（不只依赖扩展名）。
 * 不支持的扩展（.docm/.html/.zip/.exe 等）返回 null。
 */
export type AttachmentRoute =
  | { ok: true; kind: KiroAttachmentKind }
  | { ok: false; reason: "unsupported" | "too_large" | "too_small" };

const TEXT_MIMES = ["text/plain", "text/markdown", "text/x-markdown"];
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"];
const PDF_MIMES = ["application/pdf"];
const DOCX_MIMES = ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

const EXT_KIND: Record<string, KiroAttachmentKind> = {
  ".txt": "text",
  ".md": "text",
  ".markdown": "text",
  ".pdf": "pdf",
  ".docx": "docx",
  ".jpg": "image",
  ".jpeg": "image",
  ".png": "image",
  ".webp": "image",
};

/** 明确拒绝的扩展（安全边界） */
const BLOCKED_EXTS = new Set([".docm", ".html", ".htm", ".zip", ".exe", ".psd", ".js", ".sh", ".svg"]);

export function routeAttachment(file: { name: string; type: string; size: number }): AttachmentRoute {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const extKey = `.${ext}`;
  const mime = (file.type || "").toLowerCase();

  if (BLOCKED_EXTS.has(extKey)) return { ok: false, reason: "unsupported" };

  let kind: KiroAttachmentKind | null = null;
  if (TEXT_MIMES.includes(mime) || extKey === ".txt" || extKey === ".md" || extKey === ".markdown") {
    kind = "text";
  } else if (PDF_MIMES.includes(mime) || extKey === ".pdf") {
    kind = "pdf";
  } else if (DOCX_MIMES.includes(mime) || extKey === ".docx") {
    kind = "docx";
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
    case "image":
      return "image";
    case "docx":
    case "text":
      return "doc";
  }
}
