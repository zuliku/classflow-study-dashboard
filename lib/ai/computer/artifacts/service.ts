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
  artifactDbDelete,
  artifactDbGet,
  artifactDbPut,
  artifactSourceDelete,
  artifactSourceGet,
  artifactSourcePut,
} from "@/lib/ai/computer/artifacts/db";
import { KiroDocument } from "@/lib/ai/computer/documents/types";

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
