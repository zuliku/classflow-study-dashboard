/**
 * Kiro Conversation History — Persistence Model（本地 IndexedDB，v1）。
 * 只保存恢复 UI / 继续聊天所需的最小数据。
 * 严格禁止：API Key / Blob / File / storageKey / Tool Arguments / Provider raw response / Error stack。
 */

export type PersistedRole = "user" | "assistant";

/** Visual Action kind（display union；type-only import 不产生 runtime cycle） */
import type { VisualActionKind } from "@/lib/ai/visual/types";

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

/** Citation 来源最小元数据（Task 11/14 + V1.3A）：只存展示所需；正文 / 页码文本 / snippet 永不落库 */
export interface PersistedSourceMeta {
  sourceId: string;
  name: string;
  source: "chat" | "course-material" | "web" | "project-file";
  courseName?: string;
  availablePages?: number[];
  /** Task 14：Web Source（Kiro Search）metadata——恢复后 Citation 仍可点击原 URL */
  url?: string;
  domain?: string;
  publishedAt?: string;
}

/**
 * Computer Task 持久化视图（Part 3 + V2 Part 1）：只存展示事实。
 * 禁止：review 文本 / beforeText / checkpoint / tool input / adapterRef / handle / native path /
 * bytes / Document source IR。
 */
export interface PersistedComputerTaskView {
  taskId: string;
  title: string;
  status: "completed" | "failed" | "cancelled" | "undone" | "undo_failed";
  changes: Array<{
    operation: "create" | "modify" | "move" | "rename" | "delete" | "execute";
    resourceType: "directory" | "text" | "document" | "terminal";
    displayName: string;
    workspaceLabel: string;
    rootLabel: string;
    relativePath: string;
    /** V2：Artifact 长期身份（仅展示） */
    artifactId?: string;
    /** V2：relocation 来源展示事实 */
    fromRootId?: string;
    fromRootLabel?: string;
    fromRelativePath?: string;
    format?: "markdown" | "docx";
    size?: number;
    changeCount?: number;
    revision?: number;
    verification: "passed";
  }>;
  startedAt: string;
  completedAt?: string;
}

/**
 * Visual Action Intake V1.3：历史只读 Proposal 快照（display-only）。
 * 只保存安全展示事实；严禁：change/tool/input/reservedIds/previewFingerprint/
 * sourceAttachmentIds/sourceProposalId/pendingItemIds/continuation runtime/undo/Store state/Blob。
 * 类型上绝不可能转换回 VisualActionProposal（不共享可执行字段）。
 */
export interface PersistedVisualProposalView {
  id: string;
  summary: string;
  /** 仅用于 UI 表示来源；不保存 attachment IDs（历史 Local image Blob 已不保留） */
  imageCount: number;
  /** 普通截图 / 澄清链生成（continuation lineage 只降级为 display fact） */
  origin: "screenshot" | "clarification";
  actions: Array<{
    kind: VisualActionKind;
    title: string;
    subtitle?: string;
    /** 截图中促成该操作的短事实 */
    evidence: string;
  }>;
  pendingItems: Array<{
    reason: "ambiguous-entity" | "missing-information" | "unsupported-action";
    evidence: string;
    description: string;
  }>;
  createdAt: number;
  /**
   * Visual Intake V1.4：Durable Execution Receipt（display-only；描述「当时发生过什么」）。
   * 只有 applied / revoked（stale/idle/applying 不持久化）；绝不包含 undo/change/tool/input/
   * reservedIds/fingerprint/entity replay IDs。旧记录无此字段正常加载。
   * V1.5：appliedActionIndexes 为当时应用的 action index 投影（bounded / 去重 / range checked；
   * 缺省 = 当时全部应用）。
   */
  receipt?: {
    status: "applied" | "revoked";
    count: number;
    appliedAt: number;
    revokedAt?: number;
    appliedActionIndexes?: number[];
  };
}

export interface PersistedKiroMessage {
  id: string;
  role: PersistedRole;
  content: string;
  attachments?: PersistedAttachmentView[];
  actions?: PersistedActionView[];
  /** 本消息的文档来源（Citation 显示用；可选，旧记录无此字段无需迁移） */
  sources?: PersistedSourceMeta[];
  /** Computer Task 展示事实（Part 3；display-only，恢复后不能 Undo） */
  computerTask?: PersistedComputerTaskView;
  /** Visual Action Intake V1.3：历史只读 Proposal 快照（display-only；恢复后不可执行） */
  visualProposals?: PersistedVisualProposalView[];
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
  /**
   * Kiro Project 成员关系（V1）：Conversation 是唯一事实来源，一个对话最多属于一个项目。
   * 旧记录没有此字段（= 未归类），必须正常工作。
   */
  projectId?: string;
}
