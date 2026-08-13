/**
 * Kiro Computer V2 Part 2.1 — Document Revision Undo Runtime Helper。
 * 目标：restore-document-revision 的 filesystem 与 Artifact/Source revision 保持一致。
 *
 * 关键不变量：
 * - restoreArtifactRevision() throw 不代表其 IndexedDB 事务一定未提交 → 恢复错误后必须事实重读
 *   Artifact + Source 再决定补偿路径。
 * - 只有 Artifact 与 Source 都仍等于 expectedCurrentRevision（newer）时才把文件补偿回撤销前；
 *   split / missing / 读取失败（unknown）绝不 blind 补偿或 blind commit。
 * - 快照（previous/current）runtime-only，绝不进入 Tool Output / history / audit / store。
 */
import { ComputerError } from "@/lib/ai/computer/errors";
import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";
import {
  ComputerInverseOperation,
  DocumentFileSnapshot,
} from "@/lib/ai/computer/checkpoints";
import { KiroArtifact, KiroArtifactSourceRecord } from "@/lib/ai/computer/artifacts/types";
import {
  getArtifact,
  getArtifactSource,
  restoreArtifactRevision,
} from "@/lib/ai/computer/artifacts/service";

export type RestoreDocumentRevisionInverse = Extract<
  ComputerInverseOperation,
  { type: "restore-document-revision" }
>;

export interface DocumentRevisionUndoDeps {
  getArtifact: typeof getArtifact;
  getArtifactSource: typeof getArtifactSource;
  restoreArtifactRevision: typeof restoreArtifactRevision;
}

export const DOCUMENT_UNDO_LIMIT_BYTES = 5 * 1024 * 1024;

type RegistryRevisionState = "previous" | "newer" | "unknown";

/** 只有 Artifact 与 Source 的 revision 一致时才算 previous/newer；其它（split/missing/读取失败）→ unknown */
function classifyRegistryState(input: {
  artifact: KiroArtifact | null;
  source: KiroArtifactSourceRecord | null;
  previousRevision: number;
  expectedCurrentRevision: number;
}): RegistryRevisionState {
  if (
    input.artifact?.revision === input.previousRevision &&
    input.source?.revision === input.previousRevision
  ) {
    return "previous";
  }
  if (
    input.artifact?.revision === input.expectedCurrentRevision &&
    input.source?.revision === input.expectedCurrentRevision
  ) {
    return "newer";
  }
  return "unknown";
}

/** 读取当前/newer exact 文件快照（runtime-only；≤ 5 MiB） */
async function readCurrentSnapshot(
  io: ComputerAdapterIO,
  inverse: RestoreDocumentRevisionInverse
): Promise<DocumentFileSnapshot> {
  const stat = await io.stat(inverse.relativePath);
  if (!stat || stat.kind !== "file") {
    throw new ComputerError("RESOURCE_NOT_FOUND", "Artifact 文件不存在");
  }
  if (stat.size > DOCUMENT_UNDO_LIMIT_BYTES) {
    throw new ComputerError("FILE_TOO_LARGE", "文档超过 5 MiB，无法安全撤销");
  }
  return inverse.snapshot.format === "markdown"
    ? { format: "markdown", text: await io.readText(inverse.relativePath) }
    : { format: "docx", bytes: await io.readBytes(inverse.relativePath) };
}

/** exact 写入 + read-back verify（Markdown 字符串相等 / DOCX 逐字节相等）；失败抛 VERIFICATION_FAILED */
async function writeAndVerifySnapshot(
  io: ComputerAdapterIO,
  path: string,
  snapshot: DocumentFileSnapshot
): Promise<void> {
  if (snapshot.format === "markdown") {
    await io.writeText(path, snapshot.text);
    const readBack = await io.readText(path);
    if (readBack !== snapshot.text) {
      throw new ComputerError("VERIFICATION_FAILED", "文档快照校验失败");
    }
    return;
  }
  await io.writeBytes(path, snapshot.bytes);
  const readBack = await io.readBytes(path);
  if (!bytesEqual(readBack, snapshot.bytes)) {
    throw new ComputerError("VERIFICATION_FAILED", "文档快照校验失败");
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const DEFAULT_DEPS: DocumentRevisionUndoDeps = {
  getArtifact,
  getArtifactSource,
  restoreArtifactRevision,
};

/**
 * restore-document-revision Undo（runtime-only；useKiroChat 委托调用）。
 * - preflight 在文件写入前完成：Artifact 存在、workspace/root/path 匹配、revision 等于
 *   expectedCurrentRevision、Source 存在且 revision 匹配（stale → ARTIFACT_REVISION_CONFLICT）。
 * - 正常路径：恢复 exact previous 文件 → restoreArtifactRevision → 事实重读分类：
 *   previous → 验证文件后成功；newer → 文件补偿回撤销前并失败；unknown → 安全失败（人工检查）。
 */
export async function undoDocumentRevisionRuntime(input: {
  io: ComputerAdapterIO;
  inverse: RestoreDocumentRevisionInverse;
  deps?: Partial<DocumentRevisionUndoDeps>;
}): Promise<void> {
  const { io, inverse } = input;
  const deps = { ...DEFAULT_DEPS, ...input.deps };

  // ---- Preflight（文件写入前）----
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
  const source = await deps.getArtifactSource(inverse.artifactId);
  if (!source) {
    throw new ComputerError("VERIFICATION_FAILED", "Artifact Source 不存在");
  }
  if (artifact.revision !== inverse.expectedCurrentRevision || source.revision !== inverse.expectedCurrentRevision) {
    throw new ComputerError("ARTIFACT_REVISION_CONFLICT", "Artifact 已被更新到更新版本，撤销被拒绝");
  }

  // ---- 捕获当前/newer exact 快照（补偿用；runtime-only）----
  const newerSnapshot = await readCurrentSnapshot(io, inverse);

  // ---- 恢复 previous exact 文件（失败时 Registry 仍已知是 newer，可安全补偿）----
  try {
    await writeAndVerifySnapshot(io, inverse.relativePath, inverse.snapshot);
  } catch {
    try {
      await writeAndVerifySnapshot(io, inverse.relativePath, newerSnapshot);
    } catch {
      throw new ComputerError(
        "VERIFICATION_FAILED",
        "撤销文件恢复失败且无法恢复撤销前状态，文件 / Artifact 可能需要人工检查"
      );
    }
    throw new ComputerError("VERIFICATION_FAILED", "撤销未完成，已恢复撤销前状态");
  }

  // ---- Artifact revision 恢复（throw 不决定状态；下方事实重读）----
  try {
    await deps.restoreArtifactRevision({
      artifactId: inverse.artifactId,
      expectedCurrentRevision: inverse.expectedCurrentRevision,
      revision: inverse.previousRevision,
      document: inverse.previousDocument,
    });
  } catch {
    // 记录不决策：事务可能已提交也可能未提交
  }

  // ---- 事实重读 + 精确恢复路径 ----
  const artifactAfter = await deps.getArtifact(inverse.artifactId);
  const sourceAfter = await deps.getArtifactSource(inverse.artifactId);
  const state = classifyRegistryState({
    artifact: artifactAfter,
    source: sourceAfter,
    previousRevision: inverse.previousRevision,
    expectedCurrentRevision: inverse.expectedCurrentRevision,
  });

  if (state === "previous") {
    // Registry + Source 已事实恢复：即使 restoreArtifactRevision 抛过，也验证文件后成功
    await writeAndVerifySnapshot(io, inverse.relativePath, inverse.snapshot);
    return;
  }

  if (state === "newer") {
    // Registry 未恢复：文件补偿回撤销前状态，然后失败（undo_failed by caller）
    await writeAndVerifySnapshot(io, inverse.relativePath, newerSnapshot);
    const confirmArtifact = await deps.getArtifact(inverse.artifactId);
    const confirmSource = await deps.getArtifactSource(inverse.artifactId);
    if (
      confirmArtifact?.revision !== inverse.expectedCurrentRevision ||
      confirmSource?.revision !== inverse.expectedCurrentRevision
    ) {
      throw new ComputerError(
        "VERIFICATION_FAILED",
        "撤销状态无法确认，文件 / Artifact 可能需要人工检查"
      );
    }
    throw new ComputerError("VERIFICATION_FAILED", "撤销未完成，已恢复撤销前状态");
  }

  // unknown：绝不 blind 补偿 / blind commit
  throw new ComputerError("VERIFICATION_FAILED", "撤销状态无法确认，文件 / Artifact 可能需要人工检查");
}
