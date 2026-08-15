/**
 * Visual Action Intake Preflight：
 * Proposal 创建时即对当前真实 Store 执行 Change Set preflight（当前真实可执行方案），
 * 并生成 previewFingerprint（normalized actions + before + 实体标识）。
 * 任何 preflight 失败 → 不产出「可应用」Proposal，返回 structured failure 由 Kiro 继续解释/询问。
 */
import { AppState } from "@/store/useAppStore";
import { createId } from "@/lib/utils";
import {
  preflightChangeSet,
  reserveCreateIds,
} from "@/lib/ai/transactions/preflight";
import { PreparedActionView } from "@/lib/ai/tools/write/prepare";
import {
  ChangeSetActionInput,
  TransactionSafeToolName,
} from "@/lib/ai/transactions/types";
import {
  VISUAL_PROPOSAL_ALLOWED_TOOL_CHECK,
  VISUAL_KIND_OF_TOOL,
  VisualActionProposal,
  VisualProposalAction,
} from "@/lib/ai/visual/types";
import { ProposeVisualActionsInput } from "@/lib/ai/visual/schemas";

export type VisualProposalBuildResult =
  | { ok: true; proposal: VisualActionProposal }
  | { ok: false; code: string; message: string; failedActionIndex?: number };

const fail = (code: string, message: string, failedActionIndex?: number): VisualProposalBuildResult => ({
  ok: false,
  code,
  message,
  failedActionIndex,
});

/** 截图明确表达的同实体的重复创建（course+title+ddl 完全相同 → 已有 Assignment）不做复杂 fuzzy dedupe */
function findDuplicateAssignment(state: AppState, input: Record<string, unknown>): boolean {
  const courseId = typeof input.courseId === "string" ? input.courseId : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const ddl = typeof input.ddl === "string" ? input.ddl : undefined;
  return state.assignments.some(
    (a) => a.courseId === courseId && a.title.trim() === title && (ddl === undefined || a.ddl === ddl)
  );
}

/**
 * 构建 VisualActionProposal：
 * 1. whitelist 检查（V1 白名单；destructive / 课程 / 小组 / 提醒一律拒绝）
 * 2. attachment 引用一致性
 * 3. 明显重复（course+title+ddl 完全一致）→ 让模型改为 update
 * 4. Change Set preflight（reserved IDs 由本层预留并存入 Proposal）
 * 5. fingerprint
 * 全程 0 Store mutation。
 */
export function buildVisualActionProposal(
  input: ProposeVisualActionsInput,
  state: AppState
): VisualProposalBuildResult {
  const actions: ChangeSetActionInput[] = [];
  const displayByActionId: Record<string, { kind: VisualProposalAction["display"]["kind"]; title: string; subtitle?: string }> = {};

  for (let i = 0; i < input.actions.length; i++) {
    const a = input.actions[i];
    const { tool } = a.change;
    if (!VISUAL_PROPOSAL_ALLOWED_TOOL_CHECK(tool)) {
      return fail(
        "VISUAL_UNSUPPORTED_ACTION",
        `第 ${i + 1} 项操作（${tool}）不在截图处理支持的修改范围内。`,
        i
      );
    }
    if (!input.attachmentIds.includes(a.attachmentId)) {
      return fail(
        "VISUAL_ATTACHMENT_MISMATCH",
        `第 ${i + 1} 项操作的依据图片不在本次截图中。`,
        i
      );
    }
    if (tool === "create_assignment" && findDuplicateAssignment(state, a.change.input as Record<string, unknown>)) {
      return fail(
        "VISUAL_DUPLICATE_ASSIGNMENT",
        "截图中要求的任务（课程 + 标题 + 截止时间）在 ClassFlow 中已经存在，应改为更新已有任务，而不是重复创建。",
        i
      );
    }
    actions.push({ tool: tool as TransactionSafeToolName, input: a.change.input });
    displayByActionId[actions.length - 1] = {
      kind: VISUAL_KIND_OF_TOOL[tool] ?? "assignment-update",
      title: a.displayTitle,
      subtitle: a.displaySubtitle,
    };
  }

  // 客户端事务层一次性预留 create 实体 ID（Preflight → Re-preflight → Commit 同一 ID）
  const reservedIds = reserveCreateIds(actions);
  const preflight = preflightChangeSet({ actions, reservedIds }, state);
  if (!preflight.ok) {
    return {
      ok: false,
      code: preflight.code,
      message: preflight.message,
      failedActionIndex: preflight.failedActionIndex,
    };
  }

  const proposalActions: VisualProposalAction[] = input.actions.map((a, i) => ({
    id: createId("vp"),
    change: actions[i],
    evidence: { attachmentId: a.attachmentId, text: a.evidence },
    display: displayByActionId[i],
  }));

  const proposal: VisualActionProposal = {
    id: createId("vprop"),
    sourceAttachmentIds: [...input.attachmentIds],
    summary: input.summary,
    actions: proposalActions,
    createdAt: Date.now(),
    previewFingerprint: computeVisualProposalFingerprint(preflight.preview),
    reservedIds,
  };

  return { ok: true, proposal };
}

/** 确定性 fingerprint：normalized actions + before + after + 实体标识（数据变化 → fingerprint 变化 → stale） */
export function computeVisualProposalFingerprint(preview: PreparedActionView[]): string {
  return preview
    .map((v) =>
      [
        v.tool,
        v.entityType,
        v.entityId,
        v.operation,
        v.title,
        v.before !== undefined ? JSON.stringify(v.before) : "",
        v.after !== undefined ? JSON.stringify(v.after) : "",
      ].join("::")
    )
    .join("§§");
}

export interface VisualProposalStaleCheck {
  stale: boolean;
  reason?: string;
}

/** Apply 前基于最新 Store 的 stale 检查（re-preflight + fingerprint 重算）；0 mutation */
export function checkVisualProposalStale(proposal: VisualActionProposal, state: AppState): VisualProposalStaleCheck {
  const actions = proposal.actions.map((a) => a.change);
  const re = preflightChangeSet({ actions, reservedIds: proposal.reservedIds }, state);
  if (!re.ok) {
    return { stale: true, reason: re.message };
  }
  const fingerprint = computeVisualProposalFingerprint(re.preview);
  if (fingerprint !== proposal.previewFingerprint) {
    return { stale: true, reason: "方案所依据的数据已经变化。" };
  }
  return { stale: false };
}
