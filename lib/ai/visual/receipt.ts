/**
 * Visual Action Intake V1.4：Proposal 执行 Lifecycle Runtime（Conversation-owned）。
 *
 * 三层严格分离：
 * A. VisualActionProposal —— live executable（change/reservedIds/fingerprint），不进 History
 * B. VisualProposalRuntimeEntry —— 当前 Conversation runtime 状态（applied/revoked/stale +
 *    ephemeral undo closure；刷新 / load 后消失）
 * C. VisualProposalReceiptView —— 只读展示 Receipt（applied/revoked；无任何执行能力）
 *
 * 安全：
 * - undo closure 永不进入 receiptSnapshot / History
 * - stale 只存在于 runtime（re-preflight 对当时 Store 的判断），不持久化
 * - key = proposal.id（当前 Proposal 的 id；不是 continuationSource.sourceProposalId）
 * - one-shot undo：claim 后执行；失败保持 applied（绝不显示「已撤销」而业务未恢复）
 */
export type VisualProposalRuntimeStatus = "applied" | "revoked" | "stale";

export interface VisualProposalReceiptView {
  status: "applied" | "revoked";
  count: number;
  appliedAt: number;
  revokedAt?: number;
}

export interface VisualProposalRuntimeEntry {
  status: VisualProposalRuntimeStatus;
  count?: number;
  appliedAt?: number;
  revokedAt?: number;
  /** Runtime-only：永不进入 receiptSnapshot / History / ChatView persistence shape */
  undo?: () => void;
}

export type VisualProposalUndoOutcome =
  | { ok: true }
  | { ok: false; message: string };

export interface VisualProposalRuntime {
  getState(proposalId: string): VisualProposalRuntimeEntry | undefined;
  /** Apply 成功：status=applied + count + appliedAt + undo closure */
  recordApplied(input: { proposalId: string; count: number; undo: () => void }): void;
  /** Apply stale（re-preflight 判断；不持久化） */
  markStale(proposalId: string): void;
  /**
   * one-shot Undo：claim undo → 执行 → 成功 revoked；
   * 失败保持 applied 且 undo 已消费（防止重复补偿；绝不误报 revoked）。
   */
  consumeUndo(proposalId: string): VisualProposalUndoOutcome;
  /** 同步 Receipt 快照（无 undo；pagehide / sanitize 使用） */
  receiptSnapshot(): ReadonlyMap<string, VisualProposalReceiptView>;
  /** Conversation isolation：new/load/delete/clear 时清空 */
  clear(): void;
}

export function createVisualProposalRuntime(): VisualProposalRuntime {
  const entries = new Map<string, VisualProposalRuntimeEntry>();

  return {
    getState(proposalId: string): VisualProposalRuntimeEntry | undefined {
      return entries.get(proposalId);
    },

    recordApplied(input: { proposalId: string; count: number; undo: () => void }): void {
      entries.set(input.proposalId, {
        status: "applied",
        count: Math.max(0, Math.floor(input.count)),
        appliedAt: Date.now(),
        undo: input.undo,
      });
    },

    markStale(proposalId: string): void {
      entries.set(proposalId, { status: "stale" });
    },

    consumeUndo(proposalId: string): VisualProposalUndoOutcome {
      const entry = entries.get(proposalId);
      if (!entry || entry.status !== "applied" || typeof entry.undo !== "function") {
        return { ok: false, message: "没有可撤销的操作。" };
      }
      // one-shot claim（先移除再执行：并发 / Toast + Card 双入口只能成功一次）
      const undo = entry.undo;
      entry.undo = undefined;
      try {
        undo();
      } catch {
        // 失败：保持 applied（绝不显示「已撤销」而业务没有恢复）；undo 已消费（防重复补偿）
        return { ok: false, message: "撤销失败，请手动检查相关数据。" };
      }
      entry.status = "revoked";
      entry.revokedAt = Date.now();
      return { ok: true };
    },

    receiptSnapshot(): ReadonlyMap<string, VisualProposalReceiptView> {
      const out = new Map<string, VisualProposalReceiptView>();
      for (const entryPair of Array.from(entries.entries())) {
        const id = entryPair[0];
        const entry = entryPair[1];
        if (entry.status === "applied" || entry.status === "revoked") {
          out.set(id, {
            status: entry.status,
            count: entry.count ?? 0,
            appliedAt: entry.appliedAt ?? 0,
            ...(entry.revokedAt !== undefined ? { revokedAt: entry.revokedAt } : {}),
          });
        }
      }
      return out;
    },

    clear(): void {
      entries.clear();
    },
  };
}

/** History save invalidation signature（V1.4）：message 内容不变但 lifecycle 变化也必须重新落盘 */
export function buildConversationPersistenceSignature(input: {
  id: string;
  messageCount: number;
  lastContentLength: number;
  status: string;
  computerVersion: number;
  visualProposalVersion: number;
}): string {
  return `${input.id}|${input.messageCount}|${input.lastContentLength}|${input.status}|${input.computerVersion}|${input.visualProposalVersion}`;
}

/**
 * History boundary 的 receipt 校验 / 投影（独立 bounded）：
 * - status 只允许 applied / revoked
 * - count 为合理非负整数（≤ 10000）
 * - appliedAt / revokedAt 必须 finite 且 revokedAt >= appliedAt
 * 非法输入 → undefined（不落库；保持旧记录兼容）。
 */
export function sanitizeVisualProposalReceipt(raw: unknown): VisualProposalReceiptView | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Record<string, unknown>;
  if (v.status !== "applied" && v.status !== "revoked") return undefined;
  const count = typeof v.count === "number" && Number.isInteger(v.count) && v.count >= 0
    ? v.count
    : undefined;
  const appliedAt = typeof v.appliedAt === "number" && Number.isFinite(v.appliedAt) ? v.appliedAt : undefined;
  const revokedAt = v.revokedAt === undefined
    ? undefined
    : typeof v.revokedAt === "number" && Number.isFinite(v.revokedAt)
      ? v.revokedAt
      : undefined;
  if (count === undefined || appliedAt === undefined) return undefined;
  if (count > 10_000) return undefined;
  if (v.status === "revoked" && (revokedAt === undefined || revokedAt < appliedAt)) return undefined;
  return {
    status: v.status,
    count,
    appliedAt,
    ...(revokedAt !== undefined ? { revokedAt } : {}),
  };
}
