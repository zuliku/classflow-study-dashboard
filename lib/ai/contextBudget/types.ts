/**
 * Kiro Context Budget —— ClassFlow 自己的安全输入预算（不是模型真实 Context Window）。
 */

export interface KiroContextBudget {
  /** 应用安全输入预算（默认 24k） */
  maxInputTokens: number;
  /** 为输出预留 */
  reserveOutputTokens: number;
  /** Conversation Summary 预算 */
  summaryBudgetTokens: number;
  /** 最近对话轮次预算 */
  recentMessagesBudgetTokens: number;
  /** 附件正文预算 */
  attachmentBudgetTokens: number;
}

export interface KiroContextBudgetReport {
  estimatedTokens: number;
  summarizedMessages: number;
  recentTurns: number;
  attachmentsTruncated: number;
}

/** 语义 Turn：从 user message 起到下一条 user message 前（含 assistant / tool 链） */
export interface KiroTurn {
  /** 该 Turn 在原始数组中的起始索引 */
  startIndex: number;
  /** 该 Turn 的结束索引（含） */
  endIndex: number;
  userMessageId: string;
}

/** 传给 Planner 的 UIMessage 形状（与 AI SDK 兼容的最小子集） */
export interface KiroPlannableMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: {
    type: string;
    text?: string;
    state?: string;
    [key: string]: unknown;
  }[];
  metadata?: Record<string, string>;
}

/** Turn Context Snapshot：一个 User Turn 内保持不变的 Prompt Context（Task 7 关键修复） */
export interface KiroTurnContextSnapshot {
  baseContext: Record<string, unknown>;
  contextRefs: { kind: string; id?: string; label: string }[];
  /** 已按预算裁剪的附件 Context（Composer 清空后仍可用） */
  attachmentsContext: {
    name: string;
    type: string;
    text: string;
    source: "chat" | "course-material";
    truncated: boolean;
    budgetTruncated?: boolean;
    courseName?: string;
  }[];
  provider: string;
  model: string;
  customConfig?: unknown;
  /** 当前 Conversation Summary（若有） */
  conversationSummary?: { text: string; throughMessageId: string } | null;
  /** 长期学习记忆 Index（Task 9）：只含 id/title/category/scope，不含 content */
  memoryIndex?: { id: string; title: string; category: string; scope: string; scopeId?: string }[];
  /** Computer Agent Turn Snapshot（Kiro Computer Agent V1）：发送瞬间冻结的意图元数据。
   *  只含逻辑信息；绝不包含 adapterRef / native handle / 路径 / permission token。
   *  live grants/rules 保持 runtime state，不冻结进请求。 */
  computerSnapshot?: KiroComputerTurnSnapshot;
}

/**
 * Computer Agent Turn Snapshot（frozen at send boundary）。
 * - enabled / workspaceId / agentMode / roots（仅 id/label/access）。
 * - 不含 adapterRef、FileSystemDirectoryHandle、native path、permission rules、token。
 */
export interface KiroComputerTurnSnapshot {
  enabled: boolean;
  workspaceId: string | null;
  agentMode: "plan" | "guided" | "workspace-auto";
  roots: Array<{
    id: string;
    label: string;
    access: "read-only" | "read-write";
  }>;
}
