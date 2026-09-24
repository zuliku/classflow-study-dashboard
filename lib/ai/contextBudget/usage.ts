/**
 * Kiro Context Usage（Codex-style 上下文占用指示）—— 纯展示域。
 *
 * 契约：
 * - 只描述「估算输入开销」，不参与任何预算 / 压缩 / 路由决策（决策仍在 server）；
 * - 数字全部来自 server 真实请求计划：系统提示 + 本 Turn 暴露的工具 schema + 对话部分
 *   （summary + recent turns + 附件，即 buildKiroModelContext 的 budgetReport）；
 * - 快照只含数字 / provider / model / 时间戳，绝不含消息内容、附件名或路径；
 * - conversationBudget 是唯一驱动自动压缩的真实阈值（maxInputTokens × 75%）。
 */
import type { KiroContextBudget } from "@/lib/ai/contextBudget/types";
import { CONTEXT_COMPACT_RATIO } from "@/lib/ai/contextBudget/planner";
import { estimateTokens } from "@/lib/ai/contextBudget/estimate";

export const CONTEXT_USAGE_VERSION = 1 as const;

/** 展示状态：unknown（尚未发送）/ ok / warn（达到压缩阈值）/ danger（已超预算） */
export type ContextUsageTone = "unknown" | "ok" | "warn" | "danger";

export interface ContextUsageBreakdown {
  /** 系统提示（KIRO_SYSTEM_PROMPT + 回答偏好等受信任段） */
  systemPromptTokens: number;
  /** 本 Turn 实际暴露的工具 schema（条件暴露：web / computer / terminal） */
  toolSchemaTokens: number;
  /** 对话部分合计（summary + recent turns + 附件） */
  conversationTokens: number;
  /** 其中：附件正文 */
  attachmentTokens: number;
  /** 其中：较早对话摘要 */
  summaryTokens: number;
}

export interface ContextUsageConversationBudget {
  max: number;
  used: number;
  /** 达到该值触发后台自动压缩（max × 75%） */
  compactAt: number;
  /** 本 Turn 是否已使用更激进的 Plan（说明曾超预算） */
  compacted: boolean;
}

export interface ContextUsageSnapshot {
  version: typeof CONTEXT_USAGE_VERSION;
  at: string;
  provider: string;
  model: string;
  /** 固定开销 + 对话部分（估算） */
  totalEstimatedTokens: number;
  breakdown: ContextUsageBreakdown;
  conversationBudget: ContextUsageConversationBudget;
}

/** 非有限 / 负数 → 0（快照必须是可安全持久化的有界数字） */
function safeTokens(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.round(value);
}

/** 构建快照（server 侧唯一入口；数字均为估算值） */
export function buildContextUsageSnapshot(input: {
  provider: string;
  model: string;
  systemPromptTokens: number;
  toolSchemaTokens: number;
  conversationTokens: number;
  attachmentTokens: number;
  summaryTokens: number;
  budget: KiroContextBudget;
  compacted: boolean;
  at?: number;
}): ContextUsageSnapshot {
  const systemPromptTokens = safeTokens(input.systemPromptTokens);
  const toolSchemaTokens = safeTokens(input.toolSchemaTokens);
  const conversationTokens = safeTokens(input.conversationTokens);
  return {
    version: CONTEXT_USAGE_VERSION,
    at: new Date(input.at ?? Date.now()).toISOString(),
    provider: input.provider,
    model: input.model,
    totalEstimatedTokens: systemPromptTokens + toolSchemaTokens + conversationTokens,
    breakdown: {
      systemPromptTokens,
      toolSchemaTokens,
      conversationTokens,
      attachmentTokens: safeTokens(input.attachmentTokens),
      summaryTokens: safeTokens(input.summaryTokens),
    },
    conversationBudget: {
      max: input.budget.maxInputTokens,
      used: conversationTokens,
      compactAt: Math.floor(input.budget.maxInputTokens * CONTEXT_COMPACT_RATIO),
      compacted: input.compacted,
    },
  };
}

/** 工具 schema 估算（bounded；execute 等函数不参与序列化） */
export function estimateToolSchemaTokens(tools: unknown): number {
  if (!tools || typeof tools !== "object") return 0;
  try {
    const json = JSON.stringify(tools, (_key, value) => (typeof value === "function" ? undefined : value));
    if (typeof json !== "string") return 0;
    return estimateTokens(json.slice(0, 400_000));
  } catch {
    return 0;
  }
}

/** 对话部分展示状态（唯一判定来源；warn = 将自动压缩） */
export function resolveContextUsageTone(
  snapshot: ContextUsageSnapshot | null | undefined
): ContextUsageTone {
  if (!snapshot) return "unknown";
  const { used, max, compactAt } = snapshot.conversationBudget;
  if (used > max) return "danger";
  if (used >= compactAt) return "warn";
  return "ok";
}

/** token 数紧凑显示：980 → "980"；9800 → "9.8k"；1_050_000 → "1.05M" */
export function formatContextUsageTokens(tokens: number): string {
  const value = Math.max(0, Math.round(tokens));
  if (value < 1000) return String(value);
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${m.toFixed(2).replace(/\.?0+$/, "")}M`;
  }
  const k = value / 1000;
  return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
}

/**
 * 模型窗口占用（Phase 2）：仅当 registry 有官方可核实的 contextWindowTokens 时返回。
 * 分母 = 模型窗口；分子 = 本请求总估算输入（系统提示 + 工具 + 对话部分）。
 * 缺失窗口 → null（UI 不显示百分比，绝不猜测）。
 */
export function resolveModelWindowUsage(
  snapshot: ContextUsageSnapshot | null | undefined,
  windowTokens: number | null | undefined
): { percent: number; label: string } | null {
  if (!snapshot) return null;
  if (typeof windowTokens !== "number" || !Number.isFinite(windowTokens) || windowTokens <= 0) return null;
  const percent = (snapshot.totalEstimatedTokens / windowTokens) * 100;
  const rounded = Math.max(0, Math.round(percent * 10) / 10);
  return {
    percent: rounded,
    label: `占模型窗口 ${rounded}%（估算 ${formatContextUsageTokens(snapshot.totalEstimatedTokens)} / ${formatContextUsageTokens(windowTokens)}）`,
  };
}

/** 一行摘要（Composer 角标 title / aria-label） */
export function formatContextUsageLabel(
  snapshot: ContextUsageSnapshot | null | undefined,
  opts?: { overflow?: boolean }
): string {
  if (!snapshot) {
    return opts?.overflow
      ? "上下文：已超出输入预算"
      : "上下文：等待首次请求";
  }
  const { used, max, compactAt } = snapshot.conversationBudget;
  const base = `上下文 ${formatContextUsageTokens(used)} / ${formatContextUsageTokens(max)}`;
  if (opts?.overflow || used > max) return `${base} · 已超出输入预算`;
  if (used >= compactAt) return `${base} · 较早对话将自动压缩`;
  return base;
}

/** Popover 明细文案（固定开销 / 对话部分 / 压缩阈值） */
export function formatContextUsageDetail(
  snapshot: ContextUsageSnapshot | null | undefined
): { conversation: string; fixed: string; compact: string } | null {
  if (!snapshot) return null;
  const { breakdown, conversationBudget } = snapshot;
  return {
    conversation: `对话上下文 ${formatContextUsageTokens(conversationBudget.used)} / ${formatContextUsageTokens(conversationBudget.max)}`,
    fixed: `固定开销（不计入压缩预算）：系统提示 ~${formatContextUsageTokens(breakdown.systemPromptTokens)} · 工具定义 ~${formatContextUsageTokens(breakdown.toolSchemaTokens)}`,
    compact: conversationBudget.compacted
      ? `本 Turn 已使用更激进的裁剪（压缩阈值 ${formatContextUsageTokens(conversationBudget.compactAt)}）`
      : `达到 ${formatContextUsageTokens(conversationBudget.compactAt)} 时会自动压缩较早对话`,
  };
}

/**
 * 归一化（读取持久化 / 历史数据时防御）：非法 / 旧数据 → null（不猜测）。
 * 只接受 version 1 + 有界数字，绝不读取任何自由文本字段。
 */
export function normalizeContextUsageSnapshot(value: unknown): ContextUsageSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (rec.version !== CONTEXT_USAGE_VERSION) return null;
  const num = (v: unknown): number | null => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
    return Math.min(Math.round(v), 100_000_000);
  };
  const breakdownRec = (rec.breakdown ?? {}) as Record<string, unknown>;
  const budgetRec = (rec.conversationBudget ?? {}) as Record<string, unknown>;
  const systemPromptTokens = num(breakdownRec.systemPromptTokens);
  const toolSchemaTokens = num(breakdownRec.toolSchemaTokens);
  const conversationTokens = num(breakdownRec.conversationTokens);
  const attachmentTokens = num(breakdownRec.attachmentTokens);
  const summaryTokens = num(breakdownRec.summaryTokens);
  const max = num(budgetRec.max);
  const used = num(budgetRec.used);
  const compactAt = num(budgetRec.compactAt);
  const total = num(rec.totalEstimatedTokens);
  if (
    systemPromptTokens === null ||
    toolSchemaTokens === null ||
    conversationTokens === null ||
    attachmentTokens === null ||
    summaryTokens === null ||
    max === null ||
    used === null ||
    compactAt === null ||
    total === null
  ) {
    return null;
  }
  return {
    version: CONTEXT_USAGE_VERSION,
    at: typeof rec.at === "string" ? rec.at.slice(0, 40) : "",
    provider: typeof rec.provider === "string" ? rec.provider.slice(0, 40) : "",
    model: typeof rec.model === "string" ? rec.model.slice(0, 80) : "",
    totalEstimatedTokens: total,
    breakdown: { systemPromptTokens, toolSchemaTokens, conversationTokens, attachmentTokens, summaryTokens },
    conversationBudget: { max, used, compactAt, compacted: budgetRec.compacted === true },
  };
}
