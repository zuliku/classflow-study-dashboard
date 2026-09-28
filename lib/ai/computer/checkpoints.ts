/**
 * Kiro Computer Agent V1 — Task Checkpoint（Part 3）。
 * Runtime checkpoint 常驻内存（useKiroChat ref）；S-fix 起 DURABLE 子集可持久化
 * （per-conversation，随会话记录落盘；刷新后可对简单更改 Undo，见下）。
 * Undo 是 runtime restoration，不是 LLM delete capability（没有 delete_file 工具）。
 */
import { ComputerError } from "@/lib/ai/computer/errors";
import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";
import { KiroDocument } from "@/lib/ai/computer/documents/types";
import { removeArtifactRecordIfMatches } from "@/lib/ai/computer/artifacts/service";
import {
  RestoreGenericArtifactRevisionInverse,
  undoGenericArtifactPatchRuntime,
} from "@/lib/ai/computer/genericArtifactPatchUndo";

/** V2 Part 2：文档 revision 的 exact 文件快照（runtime-only；绝不定持久化/进模型） */
export type DocumentFileSnapshot =
  | { format: "markdown"; text: string }
  | { format: "docx"; bytes: Uint8Array };

export type ComputerInverseOperation =
  | {
      type: "remove-created";
      workspaceId: string;
      rootId: string;
      relativePath: string;
      resourceType: "file" | "directory";
      /** V2 Part 3：create 登记的 Artifact（create_text_file/create_document 携带；目录无） */
      artifactId?: string;
    }
  | {
      type: "restore-text";
      workspaceId: string;
      rootId: string;
      relativePath: string;
      beforeText: string;
    }
  | {
      type: "move-back";
      workspaceId: string;
      fromRootId: string;
      fromPath: string;
      toRootId: string;
      toPath: string;
      /** V2：直接把 artifactId 放进 runtime checkpoint（Undo 时不需要从 UI 反向猜） */
      artifactId?: string;
    }
  | {
      type: "restore-document-revision";
      workspaceId: string;
      rootId: string;
      relativePath: string;
      artifactId: string;
      previousRevision: number;
      expectedCurrentRevision: number;
      previousDocument: KiroDocument;
      snapshot: DocumentFileSnapshot;
    }
  | RestoreGenericArtifactRevisionInverse;

export interface ComputerTaskCheckpoint {
  taskId: string;
  inverses: ComputerInverseOperation[];
  used: boolean;
}

/**
 * S-fix 可持久 Checkpoint（durable subset）。
 *
 * 可落盘（纯数据，刷新后可重建执行）：
 * - remove-created：纯 id/path
 * - restore-text：beforeText ≤ 上限
 * - move-back：纯数据（orchestration 复用模块函数）
 * - restore-generic-artifact-revision：纯数据（registry 本就持久化）
 * - restore-document-revision：仅 markdown 文本快照（previousDocument 须 JSON 安全，
 *   snapshot 文本 ≤ 上限；docx 二进制不进）
 *
 * 诚实原则 all-or-nothing：任一 inverse 不可落盘 → 整个 checkpoint 不持久化
 * （该 Task 刷新后保持不可 Undo，与今日一致；绝不断言部分撤销）。
 */
export const DURABLE_INVERSE_MAX_TEXT_CHARS = 256 * 1024;

export type DurableComputerInverse =
  | Extract<ComputerInverseOperation, { type: "remove-created" }>
  | Extract<ComputerInverseOperation, { type: "restore-text" }>
  | Extract<ComputerInverseOperation, { type: "move-back" }>
  | Extract<ComputerInverseOperation, { type: "restore-generic-artifact-revision" }>
  | Extract<ComputerInverseOperation, { type: "restore-document-revision" }>;

export interface PersistedTaskCheckpoint {
  taskId: string;
  used: boolean;
  inverses: DurableComputerInverse[];
}

function isJsonSafe(value: unknown): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

/** 单条 inverse 是否可落盘（含文本上限与 JSON 安全） */
export function isDurableInverse(inverse: ComputerInverseOperation): inverse is DurableComputerInverse {
  switch (inverse.type) {
    case "remove-created":
    case "move-back":
      return true;
    case "restore-text":
      return inverse.beforeText.length <= DURABLE_INVERSE_MAX_TEXT_CHARS;
    case "restore-generic-artifact-revision":
      return inverse.beforeText.length <= DURABLE_INVERSE_MAX_TEXT_CHARS;
    case "restore-document-revision": {
      if (inverse.snapshot.format !== "markdown") return false;
      if (inverse.snapshot.text.length > DURABLE_INVERSE_MAX_TEXT_CHARS) return false;
      return isJsonSafe(inverse.previousDocument);
    }
    default:
      return false;
  }
}

/**
 * checkpoint → 可持久形态（all-or-nothing：任一 inverse 不可落盘 → 返回 null，
 * 调用方直接丢弃整个 checkpoint；used 状态如实保留，单次语义跨刷新不断）。
 */
export function serializeCheckpoint(
  checkpoint: ComputerTaskCheckpoint
): PersistedTaskCheckpoint | null {
  if (!checkpoint.inverses.every(isDurableInverse)) return null;
  return {
    taskId: checkpoint.taskId,
    used: checkpoint.used,
    inverses: checkpoint.inverses as DurableComputerInverse[],
  };
}

/**
 * 持久形态 → runtime checkpoint（严格校验：shape 不符/含未知类型/used 非布尔
 * → 返回 null；绝不构造半吊子 checkpoint）。
 */
export function deserializeCheckpoint(value: unknown): ComputerTaskCheckpoint | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.taskId !== "string" || v.taskId.length === 0) return null;
  if (typeof v.used !== "boolean") return null;
  if (!Array.isArray(v.inverses)) return null;
  const inverses: ComputerInverseOperation[] = [];
  for (const item of v.inverses) {
    if (typeof item !== "object" || item === null) return null;
    const type = (item as Record<string, unknown>).type;
    if (
      type !== "remove-created" &&
      type !== "restore-text" &&
      type !== "move-back" &&
      type !== "restore-generic-artifact-revision" &&
      type !== "restore-document-revision"
    ) {
      return null;
    }
    const candidate = item as ComputerInverseOperation;
    if (!isDurableInverse(candidate)) return null;
    inverses.push(candidate);
  }
  return { taskId: v.taskId, inverses, used: v.used };
}

/** 整组序列化（供持久化快照调用；drop null，保持顺序） */
export function serializeCheckpoints(
  checkpoints: Iterable<ComputerTaskCheckpoint>
): PersistedTaskCheckpoint[] {
  const out: PersistedTaskCheckpoint[] = [];
  for (const cp of checkpoints) {
    const serialized = serializeCheckpoint(cp);
    if (serialized) out.push(serialized);
  }
  return out;
}

/** 整组反序列化（供 loadConversation 调用；非法项丢弃，合法项保留） */
export function deserializeCheckpoints(value: unknown): ComputerTaskCheckpoint[] {
  if (!Array.isArray(value)) return [];
  const out: ComputerTaskCheckpoint[] = [];
  for (const item of value) {
    const cp = deserializeCheckpoint(item);
    if (cp) out.push(cp);
  }
  return out;
}

export function createTaskCheckpoint(taskId: string): ComputerTaskCheckpoint {
  return { taskId, inverses: [], used: false };
}

export function appendInverseToCheckpoint(
  checkpoint: ComputerTaskCheckpoint,
  inverse: ComputerInverseOperation
): void {
  checkpoint.inverses.push(inverse);
}

/** 单条 inverse 执行 + 验证（失败抛 ComputerError；任何一步失败 → undo_failed，绝不宣称全部撤销） */
export async function applyInverseToAdapter(io: ComputerAdapterIO, inverse: ComputerInverseOperation): Promise<void> {
  if (inverse.type === "remove-created") {
    await io.remove(inverse.relativePath, inverse.resourceType);
    // Verify：目标必须不存在
    const after = await io.stat(inverse.relativePath);
    if (after !== null) {
      throw new ComputerError("VERIFICATION_FAILED", "撤销删除校验失败");
    }
    // V2 Part 3：create 登记的 Artifact 同步清理（匹配位置才删；registry 清理失败 → undo_failed）
    if (inverse.resourceType === "file" && inverse.artifactId) {
      await removeArtifactRecordIfMatches({
        artifactId: inverse.artifactId,
        workspaceId: inverse.workspaceId,
        rootId: inverse.rootId,
        relativePath: inverse.relativePath,
      });
    }
    return;
  }
  if (inverse.type === "move-back") {
    // 双 root 操作由 useKiroChat Undo orchestration 单独处理；这里防御性拒绝
    throw new ComputerError("VERIFICATION_FAILED", "move-back 需要在 Undo orchestration 中执行");
  }
  if (inverse.type === "restore-document-revision") {
    // revision 恢复需要同步 Artifact metadata + Source Store，由 useKiroChat Undo orchestration 处理
    throw new ComputerError("VERIFICATION_FAILED", "restore-document-revision 需要在 Undo orchestration 中执行");
  }
  if (inverse.type === "restore-generic-artifact-revision") {
    // generic Artifact patch Undo：exact 文本 + 原子 metadata revision 恢复（无 Source IR）
    await undoGenericArtifactPatchRuntime({ io, inverse });
    return;
  }
  // restore-text：写回 beforeText 并 exact read-back verify
  await io.writeText(inverse.relativePath, inverse.beforeText);
  const readBack = await io.readText(inverse.relativePath);
  if (readBack !== inverse.beforeText) {
    throw new ComputerError("VERIFICATION_FAILED", "撤销恢复校验失败");
  }
}
