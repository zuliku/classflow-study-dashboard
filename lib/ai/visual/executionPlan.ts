/**
 * Visual Action Intake V1.5：Visual Execution Plan（Selective Apply 的确定性核心）。
 *
 * 禁止 naive filter + execute：Change Set preflight 是 projected-state sequential，
 * reservedIds 与原始 action index 有对应关系。选择子集可能改变 conflict / before /
 * projected state / reserved ID alignment / later action semantics。
 *
 * 流程（buildVisualProposalExecutionPlan）：
 * 1. validate selected IDs（存在性 / 去重 / 保持 proposal original order）
 * 2. 用 FULL actions + FULL reservedIds 重新执行完整 preflight
 * 3. 重算 FULL fingerprint；!= proposal.previewFingerprint → STALE（不能因只选一项绕过 stale detection）
 * 4. 取 fresh full preview 中 selected rows = 这些 action 的 current expected facts
 * 5. 构造 subset（selected actions + selected reservedIds，按 original index 对齐）
 * 6. 对 subset 单独 preflight；subset preview 与步骤 4 逐项比较
 *    —— 任一 before/after/entity semantics 改变 → VISUAL_SELECTION_DEPENDENCY_CHANGED（0 mutation）
 *
 * 返回的 reservedIds 与 subset actions 按下标对齐，直接交给 executeChangeSet
 * （executor 通过 caller-only reservedIds 透传，绝不进入 LLM schema / Tool input / History）。
 */
import { AppState } from "@/store/useAppStore";
import { preflightChangeSet } from "@/lib/ai/transactions/preflight";
import { ChangeSetActionInput } from "@/lib/ai/transactions/types";
import { VisualActionProposal } from "@/lib/ai/visual/types";
import { computeVisualProposalFingerprint } from "@/lib/ai/visual/preflight";

export const VISUAL_SELECTION_DEPENDENCY_CHANGED_CODE = "VISUAL_SELECTION_DEPENDENCY_CHANGED";

export type VisualExecutionPlanResult =
  | {
      ok: true;
      /** 原 Proposal 中的 action index（升序 = original order；与 reservedIds 对齐） */
      selectedIndexes: number[];
      actions: ChangeSetActionInput[];
      reservedIds: (string | undefined)[];
      count: number;
    }
  | {
      ok: false;
      code: "VISUAL_SELECTION_EMPTY" | "VISUAL_SELECTION_INVALID_ID" | "VISUAL_PROPOSAL_STALE" | string;
      message: string;
    };

export interface BuildVisualExecutionPlanInput {
  proposal: VisualActionProposal;
  /** 用户勾选的 action ids（可能含重复 / 未知 id；内部 normalize） */
  selectedActionIds: readonly string[];
  state: AppState;
}

function normalizedSelectedIndexes(proposal: VisualActionProposal, selectedActionIds: readonly string[]): number[] | null {
  const idToIndex = new Map<string, number>();
  proposal.actions.forEach((a, i) => {
    if (!idToIndex.has(a.id)) idToIndex.set(a.id, i);
  });
  const seen = new Set<number>();
  const indexes: number[] = [];
  for (const id of selectedActionIds) {
    const idx = idToIndex.get(id);
    if (idx === undefined) return null; // 未知 id → 拒绝（绝不静默忽略）
    if (seen.has(idx)) continue; // 去重
    seen.add(idx);
    indexes.push(idx);
  }
  // 保持 proposal original order（subset 与 full 的下标对齐语义必须稳定）
  indexes.sort((a, b) => a - b);
  return indexes;
}

export function buildVisualProposalExecutionPlan(
  input: BuildVisualExecutionPlanInput
): VisualExecutionPlanResult {
  const { proposal, state } = input;
  const selectedActionIds = Array.isArray(input.selectedActionIds) ? input.selectedActionIds : [];

  // 1. validate + dedupe + original order
  const selectedIndexes = normalizedSelectedIndexes(proposal, selectedActionIds);
  if (selectedIndexes === null) {
    return { ok: false, code: "VISUAL_SELECTION_INVALID_ID", message: "所选修改包含无法识别的项目，请重新选择。" };
  }
  if (selectedIndexes.length === 0) {
    return { ok: false, code: "VISUAL_SELECTION_EMPTY", message: "请选择至少一项要应用的修改。" };
  }

  // 2-3. FULL preflight + fingerprint（stale 检查永远基于原 Proposal 全集）
  const fullActions = proposal.actions.map((a) => a.change);
  const fullPreflight = preflightChangeSet(
    { actions: fullActions, reservedIds: proposal.reservedIds },
    state
  );
  if (!fullPreflight.ok) {
    return { ok: false, code: "VISUAL_PROPOSAL_STALE", message: "这组修改所依据的数据已经变化，需要重新检查。" };
  }
  if (computeVisualProposalFingerprint(fullPreflight.preview) !== proposal.previewFingerprint) {
    return { ok: false, code: "VISUAL_PROPOSAL_STALE", message: "这组修改所依据的数据已经变化，需要重新检查。" };
  }

  // 4. selected rows 的 current expected facts（来自 fresh full preview）
  const expectedRows = selectedIndexes.map((i) => fullPreflight.preview[i]);
  const expectedFingerprint = computeVisualProposalFingerprint(expectedRows);

  // 5. subset：selected actions + selected reservedIds（按 original index 对齐）
  const subsetActions = selectedIndexes.map((i) => fullActions[i]);
  const subsetReservedIds = selectedIndexes.map((i) => proposal.reservedIds[i]);

  // 6. subset 独立 preflight
  const subsetPreflight = preflightChangeSet({ actions: subsetActions, reservedIds: subsetReservedIds }, state);
  if (!subsetPreflight.ok) {
    return { ok: false, code: subsetPreflight.code, message: subsetPreflight.message };
  }

  // 7. 语义比较：subset preview vs full-preview selected rows
  const subsetFingerprint = computeVisualProposalFingerprint(subsetPreflight.preview);
  if (subsetFingerprint !== expectedFingerprint) {
    return {
      ok: false,
      code: VISUAL_SELECTION_DEPENDENCY_CHANGED_CODE,
      message: "所选修改无法脱离其它修改安全执行，请重新选择或重新分析方案。",
    };
  }

  return {
    ok: true,
    selectedIndexes,
    actions: subsetActions,
    reservedIds: subsetReservedIds,
    count: subsetActions.length,
  };
}
