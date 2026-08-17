/** Kiro 附件类型（临时本地文件 + 已有课程资料） */

export type KiroAttachmentKind = "text" | "pdf" | "docx" | "image";

export type KiroAttachmentStatus = "ready" | "processing" | "error" | "unsupported";

/** 临时本地附件：只存在于当前 Chat runtime，不自动保存到课程 */
export interface KiroLocalAttachment {
  id: string;
  source: "local";
  file: File;
  name: string;
  mimeType: string;
  size: number;
  kind: KiroAttachmentKind;
  status: KiroAttachmentStatus;
  error?: string;
  /** 图片缩略图 data URL（克制尺寸） */
  thumbnail?: string;
  /** 文档提取结果（解析完成后；图片无文本） */
  extracted?: {
    text: string;
    pages?: { page: number; text: string }[];
    truncated: boolean;
    pageCount?: number;
    possiblyScanned?: boolean;
  };
}

/** 已有课程资料附件：通过 storageKey 读取原 Blob，不复制 */
export interface KiroMaterialAttachment {
  id: string;
  source: "material";
  materialId: string;
  courseId: string;
  courseName: string;
  name: string;
  mimeType?: string;
  kind: KiroAttachmentKind;
  status: KiroAttachmentStatus;
  error?: string;
  /** PDF inspection 结果（Task 12）：扫描件标记 + 总页数（不保存正文） */
  pdfVision?: { scanned: true; pageCount: number };
}

export type KiroAttachment = KiroLocalAttachment | KiroMaterialAttachment;

/** 文档 Context（传给模型的文本内容，来源明确标注） */
export interface KiroDocumentContext {
  attachmentId: string;
  name: string;
  type: string;
  text: string;
  source: "chat" | "course-material";
  truncated: boolean;
  pages?: { page: number; text: string }[];
  /** 已有资料：来源课程名 */
  courseName?: string;
  /** 本 Turn 稳定来源 id（doc-1…；Citation 用，绝不暴露 storageKey） */
  sourceId?: string;
}

/** 附件视图模型（用户消息下方 chips） */
export interface KiroAttachmentView {
  id: string;
  source: "local" | "material";
  kind: KiroAttachmentKind;
  name: string;
  size?: number;
  status: KiroAttachmentStatus;
  error?: string;
  /** 图片缩略图（data URL，仅 local image） */
  thumbnail?: string;
  courseName?: string;
  /** material 引用（历史恢复后仍可标识原课程资料） */
  courseId?: string;
  materialId?: string;
  /** local 临时文件：历史恢复后未保留（只显示文件名/类型，不可再读） */
  tempNotRetained?: boolean;
  /** 需要 Vision 模型（Task 12：扫描 PDF） */
  visionRequired?: boolean;
  /** PDF 总页数（扫描件展示用） */
  pageCount?: number;
}
