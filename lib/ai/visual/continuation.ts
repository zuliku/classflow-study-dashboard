/**
 * Visual Pending Continuation（V1.2）：
 * 用户点击「继续处理 N 项」后，把原 Proposal 的 pending 事实作为结构化上下文传给 Kiro，
 * 澄清过程不需要重新把原截图送入 Vision（禁止重复生成已应用事项）。
 * Continuation 只携带 pending 事实（无执行能力）；澄清完成后模型仍必须走 propose_visual_actions 生成新 Proposal。
 */
import {
  VisualActionProposal,
  VisualPendingReason,
} from "@/lib/ai/visual/types";

export interface VisualPendingContinuationItem {
  id: string;
  reason: VisualPendingReason;
  evidence: string;
  description: string;
}

export interface VisualPendingContinuation {
  /** 原 Proposal（同一 Visual Intake chain） */
  sourceProposalId: string;
  pendingItemIds: string[];
  pendingItems: VisualPendingContinuationItem[];
}

/** 从 Proposal 构建 continuation（unsupported 不可澄清 → 过滤；无澄清项 → null） */
export function buildVisualPendingContinuation(
  proposal: VisualActionProposal
): VisualPendingContinuation | null {
  const items = proposal.pendingItems
    .filter((p) => p.reason !== "unsupported-action")
    .map((p) => ({
      id: p.id,
      reason: p.reason,
      evidence: p.evidence.text,
      description: p.description,
    }));
  if (items.length === 0) return null;
  return {
    sourceProposalId: proposal.id,
    pendingItemIds: items.map((i) => i.id),
    pendingItems: items,
  };
}

/** 用户明确放弃 pending chain 的轻量识别（只用于结束 continuation guard，不拦截其他输入） */
const VISUAL_PENDING_CANCEL_PATTERNS: readonly string[] = [
  "算了",
  "不用了",
  "先不处理",
  "不处理了",
  "先算了吧",
  "下次再说",
  "别管了",
  "取消这个",
];

export function isVisualPendingCancel(text: string): boolean {
  return VISUAL_PENDING_CANCEL_PATTERNS.some((p) => text.includes(p));
}

// ---------------- Server-side（route.ts）：normalize + Prompt section ----------------

const MAX_CONTINUATION_ITEMS = 8;
const MAX_CONTINUATION_EVIDENCE = 160;
const MAX_CONTINUATION_DESCRIPTION = 120;

const REASON_SET: ReadonlySet<string> = new Set<string>([
  "ambiguous-entity",
  "missing-information",
  "unsupported-action",
]);

const slice = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** Server Trust Boundary：重新 normalize/bound（丢弃未知字段、hard slice、enum 校验） */
export function normalizeVisualPendingContinuation(raw: unknown): VisualPendingContinuation | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const sourceProposalId = slice(src.sourceProposalId, 120);
  const pendingItems: VisualPendingContinuationItem[] = [];
  if (Array.isArray(src.pendingItems)) {
    for (const it of src.pendingItems.slice(0, MAX_CONTINUATION_ITEMS)) {
      if (!it || typeof it !== "object") continue;
      const item = it as Record<string, unknown>;
      const reason = typeof item.reason === "string" && REASON_SET.has(item.reason)
        ? (item.reason as VisualPendingReason)
        : null;
      if (!reason) continue;
      const evidence = slice(item.evidence, MAX_CONTINUATION_EVIDENCE);
      const description = slice(item.description, MAX_CONTINUATION_DESCRIPTION);
      if (!evidence || !description) continue;
      pendingItems.push({
        id: slice(item.id, 80) || `vpending_${pendingItems.length}`,
        reason,
        evidence,
        description,
      });
    }
  }
  if (pendingItems.length === 0) return null;
  return {
    sourceProposalId,
    pendingItemIds: pendingItems.map((i) => i.id),
    pendingItems,
  };
}

/** 生成注入 System Prompt 的澄清链 section（只提供事实；明确不授权写入） */
export function buildVisualPendingContinuationSection(
  continuation: VisualPendingContinuation | null
): string {
  if (!continuation) return "";
  const lines = continuation.pendingItems
    .map((p) => {
      const reasonLabel =
        p.reason === "ambiguous-entity" ? "实体歧义" : p.reason === "missing-information" ? "信息缺失" : "暂不支持";
      return `- [${reasonLabel}] “${p.evidence}”——${p.description}`;
    })
    .join("\n");
  return (
    "\n\n# 待处理的截图事项（V1.2 澄清链）\n" +
    "用户点击「继续处理」后，以下事项来自之前截图分析中未处理的部分（不属于本次用户消息内容）。\n" +
    "用于澄清与实体解析：可以先 Read 真实 ClassFlow 数据，然后向用户询问缺失信息。\n" +
    "硬性约束：\n" +
    "- 这些事项本身没有任何执行能力；不要直接调用任何写工具处理它们；\n" +
    "- 澄清完成后，所有可执行结果仍必须通过 propose_visual_actions 生成新的可预览方案；\n" +
    "- 不要重新请求用户重新上传或重新识别原始截图。\n" +
    lines
  );
}
