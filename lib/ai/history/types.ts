/**
 * Kiro Conversation History — Persistence Model（本地 IndexedDB，v1）。
 * 只保存恢复 UI / 继续聊天所需的最小数据。
 * 严格禁止：API Key / Blob / File / storageKey / Tool Arguments / Provider raw response / Error stack。
 */

export type PersistedRole = "user" | "assistant";

export interface PersistedContextRef {
  kind: "course" | "assignment" | "group-project" | "material" | "week";
  entityId?: string;
  label: string;
}

export interface PersistedAttachmentView {
  id: string;
  /** local：临时上传（历史恢复后不可读，tempNotRetained=true）；material：课程资料引用（原文件仍在） */
  source: "local" | "material";
  kind: string;
  name: string;
  size?: number;
  /** material 引用 */
  courseId?: string;
  materialId?: string;
  courseName?: string;
  /** local 临时文件：刷新后未保留 */
  tempNotRetained?: boolean;
}

/** Action Card 最小事实数据（展示用，非可执行 Tool state） */
export interface PersistedActionView {
  toolCallId: string;
  variant: string;
  heading: string;
  title: string;
  change?: { from: string; to: string } | null;
  bullets?: string[];
  footer?: string;
  /** Change Set 明细（compact 动作视图，可持久化；不保存 Undo / Store / Tool JSON） */
  details?: { label: string }[];
}

export interface PersistedKiroMessage {
  id: string;
  role: PersistedRole;
  content: string;
  attachments?: PersistedAttachmentView[];
  actions?: PersistedActionView[];
}

/** Conversation Summary（Task 7）：内部 Model Context，不代表当前 ClassFlow 数据 */
export interface KiroConversationSummary {
  version: 1;
  text: string;
  throughMessageId: string;
  updatedAt: string;
}

export interface KiroConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  messages: PersistedKiroMessage[];
  manualRefs: PersistedContextRef[];
  entryRefs: PersistedContextRef[];
  /** 旧记录可能没有 summary（正常加载） */
  summary?: KiroConversationSummary;
}
