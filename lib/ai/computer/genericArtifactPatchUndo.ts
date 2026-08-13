/**
 * Kiro Computer V2 Part 3.1 — Generic Artifact Patch Undo Runtime Helper。
 * 修复 revision drift：registered generic Artifact 的 patch Undo 必须同时恢复
 * exact 文件内容 + Artifact metadata revision（无 Source IR）。
 *
 * 与 documentRevisionUndo.ts 相同的安全模式：
 * - preflight 在文件写入前（stale → ARTIFACT_REVISION_CONFLICT，零文件写入）
 * - restore API throw 不决定事实状态 → 重读 Artifact 分类
 * - 事实 previous → 验证文件后成功；事实 newer → 文件补偿回撤销前 + 失败；
 *   missing/wrong/location-changed/read-failure → 安全失败（人工检查），绝不 blind 补偿
 * - beforeText / 补偿快照 runtime-only，绝不定持久化/进模型
 */
import { ComputerError } from "@/lib/ai/computer/errors";
import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";
import { KiroArtifact } from "@/lib/ai/computer/artifacts/types";
import { getArtifact, restoreGenericArtifactRevision } from "@/lib/ai/computer/artifacts/service";

export const GENERIC_ARTIFACT_PATCH_UNDO_LIMIT_BYTES = 1024 * 1024;

export interface RestoreGenericArtifactRevisionInverse {
  type: "restore-generic-artifact-revision";
  workspaceId: string;
  rootId: string;
  relativePath: string;
  artifactId: string;
  previousRevision: number;
  expectedCurrentRevision: number;
  beforeText: string;
}

export interface GenericArtifactPatchUndoDeps {
  getArtifact: typeof getArtifact;
  restoreGenericArtifactRevision: typeof restoreGenericArtifactRevision;
}

const DEFAULT_DEPS: GenericArtifactPatchUndoDeps = {
  getArtifact,
  restoreGenericArtifactRevision,
};

async function writeExactText(io: ComputerAdapterIO, path: string, text: string): Promise<void> {
  await io.writeText(path, text);
  const readBack = await io.readText(path);
  if (readBack !== text) {
    throw new ComputerError("VERIFICATION_FAILED", "文本校验失败");
  }
}

/**
 * generic Artifact patch Undo（runtime-only）。
 * A. preflight（文件写入前）→ B. exact 恢复 beforeText → C. 原子恢复 metadata revision →
 * D. 事实重读分类并精确恢复（previous/newer/unknown）。
 */
export async function undoGenericArtifactPatchRuntime(input: {
  io: ComputerAdapterIO;
  inverse: RestoreGenericArtifactRevisionInverse;
  deps?: Partial<GenericArtifactPatchUndoDeps>;
}): Promise<void> {
  const { io, inverse } = input;
  const deps = { ...DEFAULT_DEPS, ...input.deps };

  // ---- A. Preflight（不写文件）----
  const artifact = await deps.getArtifact(inverse.artifactId);
  if (!artifact) {
    throw new ComputerError("ARTIFACT_NOT_FOUND", "Artifact 不存在");
  }
  if (
    artifact.workspaceId !== inverse.workspaceId ||
    artifact.rootId !== inverse.rootId ||
    artifact.relativePath !== inverse.relativePath
  ) {
    throw new ComputerError("VERIFICATION_FAILED", "Artifact 位置与撤销目标不一致");
  }
  if (artifact.revision !== inverse.expectedCurrentRevision) {
    throw new ComputerError("ARTIFACT_REVISION_CONFLICT", "Artifact 已被更新到更新版本，撤销被拒绝");
  }
  const stat = await io.stat(inverse.relativePath);
  if (!stat || stat.kind !== "file") {
    throw new ComputerError("RESOURCE_NOT_FOUND", "文件不存在");
  }
  if (stat.size > GENERIC_ARTIFACT_PATCH_UNDO_LIMIT_BYTES) {
    throw new ComputerError("FILE_TOO_LARGE", "文件超过 1 MiB，无法安全撤销");
  }
  // 补偿快照（runtime-only）
  const currentText = await io.readText(inverse.relativePath);

  // ---- B. 恢复 exact 之前文本；失败 → 补偿回撤销前 + 失败 ----
  try {
    await writeExactText(io, inverse.relativePath, inverse.beforeText);
  } catch {
    try {
      await writeExactText(io, inverse.relativePath, currentText);
    } catch {
      throw new ComputerError(
        "VERIFICATION_FAILED",
        "撤销文件恢复失败且无法恢复撤销前状态，文件 / Artifact 可能需要人工检查"
      );
    }
    throw new ComputerError("VERIFICATION_FAILED", "撤销未完成，已恢复撤销前状态");
  }

  // ---- C. 原子恢复 metadata revision（throw 不决定事实状态）----
  try {
    await deps.restoreGenericArtifactRevision({
      artifactId: inverse.artifactId,
      expectedCurrentRevision: inverse.expectedCurrentRevision,
      revision: inverse.previousRevision,
    });
  } catch {
    // 记录不决策
  }

  // ---- D. 事实重读分类 ----
  const after = await deps.getArtifact(inverse.artifactId);
  const locationMatches =
    after !== null &&
    after.workspaceId === inverse.workspaceId &&
    after.rootId === inverse.rootId &&
    after.relativePath === inverse.relativePath;

  if (after && locationMatches && after.revision === inverse.previousRevision) {
    // 事实 previous：验证文件后成功（restore API 曾 throw 也不补偿）
    await writeExactText(io, inverse.relativePath, inverse.beforeText);
    return;
  }

  if (after && locationMatches && after.revision === inverse.expectedCurrentRevision) {
    // 事实 newer：Registry 未恢复 → 文件补偿回撤销前 + 失败（caller → undo_failed）
    await writeExactText(io, inverse.relativePath, currentText);
    const confirm = await deps.getArtifact(inverse.artifactId);
    if (!confirm || confirm.revision !== inverse.expectedCurrentRevision) {
      throw new ComputerError("VERIFICATION_FAILED", "撤销状态无法确认，文件 / Artifact 可能需要人工检查");
    }
    throw new ComputerError("VERIFICATION_FAILED", "撤销未完成，已恢复撤销前状态");
  }

  // missing / wrong revision / location changed / reread failure → 安全失败，绝不 blind 补偿
  throw new ComputerError("VERIFICATION_FAILED", "撤销状态无法确认，文件 / Artifact 可能需要人工检查");
}
