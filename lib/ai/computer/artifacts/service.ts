/**
 * Kiro Artifact Service（V2 Part 1）。
 * 不变量：
 * - Artifact ID 长期稳定；rename/move 不变；路径变化不增加 revision。
 * - 同一 logical location（workspaceId + rootId + relativePath）只能有一个 Artifact record；
 *   文件被外部删除后重建 → 替换 stale identity（旧 metadata/source 删除，新 id + revision 1）。
 * - sources 只保存 Kiro 通过 create_document 生成的 KiroDocument IR；generic text 不保存 IR。
 */
import {
  KiroArtifact,
  KiroArtifactSource,
  KiroArtifactSourceRecord,
  KiroArtifactType,
} from "@/lib/ai/computer/artifacts/types";
import {
  artifactDbAll,
  artifactDbCommitMetadataRevision,
  artifactDbCommitRevision,
  artifactDbDelete,
  artifactDbGet,
  artifactDbPut,
  artifactSourceDelete,
  artifactSourceGet,
  artifactSourcePut,
} from "@/lib/ai/computer/artifacts/db";
import { KiroDocument } from "@/lib/ai/computer/documents/types";
import { ComputerError } from "@/lib/ai/computer/errors";

function newArtifactId(): string {
  return `artifact-${crypto.randomUUID()}`;
}

function now(): string {
  return new Date().toISOString();
}

function logicalKey(workspaceId: string, rootId: string, relativePath: string): string {
  return `${workspaceId}\u0000${rootId}\u0000${relativePath}`;
}

async function findByLogicalKey(key: string): Promise<KiroArtifact | null> {
  const all = await artifactDbAll();
  return all.find((a) => logicalKey(a.workspaceId, a.rootId, a.relativePath) === key) ?? null;
}

async function writeSource(artifactId: string, document: KiroDocument, revision: number): Promise<boolean> {
  const record: KiroArtifactSourceRecord = {
    artifactId,
    revision,
    document,
    updatedAt: now(),
  };
  return artifactSourcePut(record);
}

/** 替换同 logical location 的 stale identity：旧 source + metadata 先删除，再建新记录 */
async function replaceLogicalIdentity(
  existing: KiroArtifact | null,
  input: {
    workspaceId: string;
    rootId: string;
    relativePath: string;
    type: KiroArtifactType;
    title?: string;
    source: KiroArtifactSource;
    sourceConversationId?: string;
    sourceTaskId?: string;
    document?: KiroDocument;
  }
): Promise<KiroArtifact> {
  if (existing) {
    await artifactSourceDelete(existing.id);
    await artifactDbDelete(existing.id);
  }
  const artifact: KiroArtifact = {
    id: newArtifactId(),
    workspaceId: input.workspaceId,
    rootId: input.rootId,
    relativePath: input.relativePath,
    type: input.type,
    title: input.title ?? input.relativePath.split("/").pop() ?? input.relativePath,
    displayName: input.relativePath.split("/").pop() ?? input.relativePath,
    source: input.source,
    sourceConversationId: input.sourceConversationId,
    sourceTaskId: input.sourceTaskId,
    revision: 1,
    createdAt: now(),
    updatedAt: now(),
  };
  const stored = await artifactDbPut(artifact);
  if (!stored) throw new Error("artifact-registry-write-failed");
  // Kiro-owned 文档 IR：只存 markdown/docx（generic text 不存 IR）
  if (input.document && (artifact.type === "markdown" || artifact.type === "docx")) {
    const ok = await writeSource(artifact.id, input.document, artifact.revision);
    if (!ok) throw new Error("artifact-source-write-failed");
  }
  return artifact;
}

/** Kiro 通过 verified 工具创建的文件（create_text_file / create_document） */
export async function registerCreatedArtifact(input: {
  workspaceId: string;
  rootId: string;
  relativePath: string;
  type: KiroArtifactType;
  title?: string;
  sourceConversationId?: string;
  sourceTaskId?: string;
  document?: KiroDocument;
}): Promise<KiroArtifact> {
  const existing = await findByLogicalKey(logicalKey(input.workspaceId, input.rootId, input.relativePath));
  return replaceLogicalIdentity(existing, { ...input, source: "kiro-created" });
}

/** 采纳 Workspace 已有文件（V2 Part 1 不扫描整个 Workspace；后续按需 lazy adopt） */
export async function adoptWorkspaceArtifact(input: {
  workspaceId: string;
  rootId: string;
  relativePath: string;
  type: KiroArtifactType;
  title?: string;
}): Promise<KiroArtifact> {
  const existing = await findByLogicalKey(logicalKey(input.workspaceId, input.rootId, input.relativePath));
  return replaceLogicalIdentity(existing, { ...input, source: "workspace-existing" });
}

export async function getArtifact(id: string): Promise<KiroArtifact | null> {
  return artifactDbGet(id);
}

export async function findArtifactByLocation(
  workspaceId: string,
  rootId: string,
  relativePath: string
): Promise<KiroArtifact | null> {
  return findByLogicalKey(logicalKey(workspaceId, rootId, relativePath));
}

export async function listArtifactsForWorkspace(workspaceId: string): Promise<KiroArtifact[]> {
  const all = await artifactDbAll();
  return all.filter((a) => a.workspaceId === workspaceId);
}

/** rename/move 后同步位置：只改 rootId/relativePath/displayName/updatedAt；revision 不变 */
export async function updateArtifactLocation(
  id: string,
  rootId: string,
  relativePath: string
): Promise<KiroArtifact> {
  const existing = await artifactDbGet(id);
  if (!existing) throw new Error("artifact-not-found");
  const updated: KiroArtifact = {
    ...existing,
    rootId,
    relativePath,
    displayName: relativePath.split("/").pop() ?? relativePath,
    updatedAt: now(),
  };
  const stored = await artifactDbPut(updated);
  if (!stored) throw new Error("artifact-registry-write-failed");
  return updated;
}

export async function getArtifactSource(id: string): Promise<KiroArtifactSourceRecord | null> {
  return artifactSourceGet(id);
}

/** Settings 删除 Workspace：清理 Artifact metadata + Kiro-owned source IR（不动真实文件） */
export async function removeArtifactsForWorkspace(workspaceId: string): Promise<void> {
  const all = await artifactDbAll();
  const targets = all.filter((a) => a.workspaceId === workspaceId);
  for (const artifact of targets) {
    await artifactSourceDelete(artifact.id);
    await artifactDbDelete(artifact.id);
  }
}

/** 显式删除 Artifact record（只删 metadata + Source IR；绝不触碰 filesystem 内容） */
export async function removeArtifactRecord(artifactId: string): Promise<void> {
  await artifactSourceDelete(artifactId);
  await artifactDbDelete(artifactId);
  const after = await artifactDbGet(artifactId);
  const sourceAfter = await artifactSourceGet(artifactId);
  if (after !== null || sourceAfter !== null) {
    throw new ComputerError("VERIFICATION_FAILED", "Artifact 记录清理失败");
  }
}

/**
 * 条件删除（create Undo 用）：Artifact 已不存在 → idempotent success；
 * 存在但 logical location 已变化（移动/重绑定）→ 拒绝删除（防旧 checkpoint 误删）。
 */
export async function removeArtifactRecordIfMatches(input: {
  artifactId: string;
  workspaceId: string;
  rootId: string;
  relativePath: string;
}): Promise<void> {
  const artifact = await artifactDbGet(input.artifactId);
  if (!artifact) return; // idempotent
  if (
    artifact.workspaceId !== input.workspaceId ||
    artifact.rootId !== input.rootId ||
    artifact.relativePath !== input.relativePath
  ) {
    throw new ComputerError(
      "ARTIFACT_REVISION_CONFLICT",
      "Artifact 已移动到其它位置，拒绝用旧记录删除"
    );
  }
  await removeArtifactRecord(input.artifactId);
}

/** generic Artifact 文本 patch 后：metadata revision +1（原子单事务；无 Source IR） */
export async function commitGenericArtifactRevision(input: {
  artifactId: string;
  expectedRevision: number;
}): Promise<KiroArtifact> {
  return artifactDbCommitMetadataRevision(input);
}

/** 当前 Workspace 最近 Artifact（updatedAt DESC；limit 1..12）——只返回 metadata，不 stat 文件 */
export async function listRecentArtifactsForWorkspace(
  workspaceId: string,
  limit = 12
): Promise<KiroArtifact[]> {
  const clamped = Math.max(1, Math.min(limit, 12));
  const all = await artifactDbAll();
  return all
    .filter((a) => a.workspaceId === workspaceId)
    .sort((a, b) => {
      const aTime = Date.parse(a.updatedAt);
      const bTime = Date.parse(b.updatedAt);
      if (aTime !== bTime) return bTime - aTime;
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    })
    .slice(0, clamped);
}

// ==================== V2 Part 2：Structured Document Revision ====================

export interface EditableArtifactRevisionState {
  artifact: KiroArtifact;
  source: KiroArtifactSourceRecord;
}

/** 结构化文档更新前预检（全部通过才可编辑）：
 *  artifact 存在 + kiro-created + markdown/docx + Source IR 存在 + source.revision === artifact.revision + expectedRevision 匹配。
 *  抛 ARTIFACT_NOT_FOUND / ARTIFACT_NOT_EDITABLE / ARTIFACT_REVISION_CONFLICT。
 */
export async function getEditableArtifactRevisionState(
  artifactId: string,
  expectedRevision: number
): Promise<EditableArtifactRevisionState> {
  const artifact = await artifactDbGet(artifactId);
  if (!artifact) {
    throw new ComputerError("ARTIFACT_NOT_FOUND", `Artifact 不存在：${artifactId}`);
  }
  if (artifact.source !== "kiro-created" || (artifact.type !== "markdown" && artifact.type !== "docx")) {
    throw new ComputerError("ARTIFACT_NOT_EDITABLE", "只有 Kiro 创建的 Markdown/DOCX Artifact 支持结构化更新");
  }
  const source = await artifactSourceGet(artifactId);
  if (!source) {
    throw new ComputerError("ARTIFACT_NOT_EDITABLE", "该 Artifact 没有可编辑的结构化文档源");
  }
  if (source.revision !== artifact.revision) {
    throw new ComputerError("ARTIFACT_REVISION_CONFLICT", "Artifact 元数据与文档源版本不一致");
  }
  if (expectedRevision !== artifact.revision) {
    throw new ComputerError(
      "ARTIFACT_REVISION_CONFLICT",
      `Artifact 当前版本为 ${artifact.revision}，期望 ${expectedRevision}`
    );
  }
  return { artifact, source };
}

/** 原子提交新 revision（+1）：artifacts + sources 同事务；乐观锁 expectedRevision 校验 */
export async function commitArtifactRevision(input: {
  artifactId: string;
  expectedRevision: number;
  document: KiroDocument;
}): Promise<KiroArtifact> {
  const { outcome, artifact } = await artifactDbCommitRevision({
    artifactId: input.artifactId,
    expectedRevision: input.expectedRevision,
    artifactPatch: (a) => ({
      ...a,
      revision: a.revision + 1,
      updatedAt: now(),
    }),
    sourcePatch: (s) => ({
      artifactId: s.artifactId,
      revision: s.revision + 1,
      document: input.document,
      updatedAt: now(),
    }),
  });
  if (outcome !== "committed") {
    throw new ComputerError("VERIFICATION_FAILED", "Artifact revision 提交失败");
  }
  return artifact;
}

/** Undo：恢复到显式旧 revision（仅当当前 revision 等于 expectedCurrentRevision） */
export async function restoreArtifactRevision(input: {
  artifactId: string;
  expectedCurrentRevision: number;
  revision: number;
  document: KiroDocument;
}): Promise<KiroArtifact> {
  const { outcome, artifact } = await artifactDbCommitRevision({
    artifactId: input.artifactId,
    expectedRevision: input.expectedCurrentRevision,
    artifactPatch: (a) => ({
      ...a,
      revision: input.revision,
      updatedAt: now(),
    }),
    sourcePatch: (s) => ({
      artifactId: s.artifactId,
      revision: input.revision,
      document: input.document,
      updatedAt: now(),
    }),
  });
  if (outcome !== "committed") {
    throw new ComputerError("VERIFICATION_FAILED", "Artifact revision 恢复失败");
  }
  return artifact;
}
