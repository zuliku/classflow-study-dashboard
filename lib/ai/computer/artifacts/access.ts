/**
 * Kiro Computer V2 Part 3 — Artifact Access Service。
 * 唯一 live resolve 链：artifactId → Registry → live Workspace → root → 归一化逻辑路径 → adapter → filesystem。
 * Preview / Download 是用户显式 UI Read：无 audit、无 Computer quota、无 Approval；
 * 但绝不绕过 Workspace/Sandbox/Grant/Permission（adapter 内部强制 grant 检查）。
 * 调用方永远拿不到 adapterRef / handle / native path。
 */
import { ComputerError } from "@/lib/ai/computer/errors";
import { KiroArtifact } from "@/lib/ai/computer/artifacts/types";
import {
  getArtifact,
  getArtifactSource,
  listRecentArtifactsForWorkspace,
} from "@/lib/ai/computer/artifacts/service";
import { KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { normalizeRelativeComputerPath } from "@/lib/ai/computer/workspace/resolver";
import { getComputerAdapterForAdapterRef } from "@/lib/ai/computer/executor";
import { inspectDocumentFacts, verifyDocxBytes, verifyRenderedDocx } from "@/lib/ai/computer/documents/verify";
import { detectLegacyKiroDocx } from "@/lib/ai/computer/documents/legacy";

export const MAX_ARTIFACT_PREVIEW_BYTES = 20 * 1024 * 1024;
export const MAX_ARTIFACT_PREVIEW_CHARS = 100_000;

export type KiroArtifactAvailability = "available" | "missing" | "unavailable";

export interface KiroRecentArtifactEntry {
  artifact: KiroArtifact;
  workspaceLabel: string;
  rootLabel: string;
  availability: KiroArtifactAvailability;
  unavailableReason?: string;
}

export type KiroArtifactPreview =
  | {
      kind: "markdown";
      artifact: KiroArtifact;
      workspaceLabel: string;
      rootLabel: string;
      text: string;
      truncated: boolean;
      size: number;
    }
  | {
      kind: "text";
      artifact: KiroArtifact;
      workspaceLabel: string;
      rootLabel: string;
      text: string;
      truncated: boolean;
      size: number;
    }
  | {
      kind: "docx";
      artifact: KiroArtifact;
      workspaceLabel: string;
      rootLabel: string;
      text: string;
      truncated: boolean;
      size: number;
      facts: {
        title?: string;
        headings: number;
        paragraphs: number;
        lists: number;
        tables: number;
        codeBlocks: number;
        characters: number;
      };
    };

export interface KiroArtifactDownloadPayload {
  artifact: KiroArtifact;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export function mimeTypeForArtifact(type: KiroArtifact["type"]): string {
  switch (type) {
    case "markdown":
      return "text/markdown;charset=utf-8";
    case "text":
      return "text/plain;charset=utf-8";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
}

interface ResolvedArtifactLocation {
  artifact: KiroArtifact;
  workspace: KiroWorkspaceMeta;
  rootLabel: string;
  path: string;
  io: ReturnType<typeof getComputerAdapterForAdapterRef>;
}

/** 唯一 live resolve（list/preview/download 共用）；缺失 → ARTIFACT_NOT_FOUND / WORKSPACE_NOT_FOUND / ROOT_NOT_FOUND */
async function resolveArtifactLocation(
  artifactId: string,
  workspaces: KiroWorkspaceMeta[]
): Promise<ResolvedArtifactLocation> {
  const artifact = await getArtifact(artifactId);
  if (!artifact) throw new ComputerError("ARTIFACT_NOT_FOUND", "Artifact 不存在");
  const workspace = workspaces.find((w) => w.id === artifact.workspaceId);
  if (!workspace) throw new ComputerError("WORKSPACE_NOT_FOUND", "Artifact 所属 Workspace 不存在");
  const root = workspace.roots.find((r) => r.id === artifact.rootId);
  if (!root) throw new ComputerError("ROOT_NOT_FOUND", "Artifact 根目录不存在");
  const path = normalizeRelativeComputerPath(artifact.relativePath).path;
  return {
    artifact,
    workspace,
    rootLabel: root.label,
    path,
    io: getComputerAdapterForAdapterRef(root.adapterRef),
  };
}

/** 区分「文件不存在」（missing）与「adapter/grant 暂时不可访问」（unavailable） */
async function statOrUnavailable(
  io: ReturnType<typeof getComputerAdapterForAdapterRef>,
  path: string
): Promise<{ found: boolean; kind?: string } | null> {
  try {
    const stat = await io.stat(path);
    if (stat === null) return { found: false };
    return { found: true, kind: stat.kind };
  } catch {
    return null; // grant 缺失 / adapter 错误 → 不可访问（真实文件可能在电脑里）
  }
}

/** 最近 12（当前 Workspace；updatedAt DESC metadata）→ 对 12 条 stat 分类可用性 */
export async function listRecentArtifactEntries(input: {
  workspaceId: string;
  workspaces: KiroWorkspaceMeta[];
  limit?: number;
}): Promise<KiroRecentArtifactEntry[]> {
  const workspace = input.workspaces.find((w) => w.id === input.workspaceId);
  if (!workspace) return [];
  const artifacts = await listRecentArtifactsForWorkspace(input.workspaceId, input.limit ?? 12);
  const entries: KiroRecentArtifactEntry[] = [];
  for (const artifact of artifacts) {
    const root = workspace.roots.find((r) => r.id === artifact.rootId);
    let availability: KiroArtifactAvailability = "unavailable";
    let unavailableReason: string | undefined;
    if (!root) {
      unavailableReason = "根目录不存在";
    } else {
      try {
        const path = normalizeRelativeComputerPath(artifact.relativePath).path;
        const io = getComputerAdapterForAdapterRef(root.adapterRef);
        const result = await statOrUnavailable(io, path);
        if (result === null) {
          availability = "unavailable";
          unavailableReason = "暂时无法访问";
        } else if (result.found && result.kind === "file") {
          availability = "available";
        } else {
          availability = "missing";
        }
      } catch {
        availability = "unavailable";
        unavailableReason = "暂时无法访问";
      }
    }
    entries.push({
      artifact,
      workspaceLabel: workspace.name,
      rootLabel: root?.label ?? artifact.rootId,
      availability,
      unavailableReason,
    });
  }
  return entries;
}

function boundText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_ARTIFACT_PREVIEW_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_ARTIFACT_PREVIEW_CHARS), truncated: true };
}

/** 当前真实文件 Preview（filesystem 是事实来源；20 MiB 上限；绝不返回 Source IR/adapterRef/HTML） */
export async function getArtifactPreview(input: {
  artifactId: string;
  workspaces: KiroWorkspaceMeta[];
}): Promise<KiroArtifactPreview> {
  const { artifact, workspace, rootLabel, path, io } = await resolveArtifactLocation(input.artifactId, input.workspaces);
  const stat = await io.stat(path);
  if (!stat || stat.kind !== "file") {
    throw new ComputerError("RESOURCE_NOT_FOUND", "文件不存在");
  }
  if (stat.size > MAX_ARTIFACT_PREVIEW_BYTES) {
    throw new ComputerError("FILE_TOO_LARGE", "文件超过 20 MiB，无法预览");
  }
  const size = stat.size;

  if (artifact.type === "markdown") {
    const raw = await io.readText(path);
    const { text, truncated } = boundText(raw);
    return { kind: "markdown", artifact, workspaceLabel: workspace.name, rootLabel, text, truncated, size };
  }
  if (artifact.type === "text") {
    const raw = await io.readText(path);
    const { text, truncated } = boundText(raw);
    return { kind: "text", artifact, workspaceLabel: workspace.name, rootLabel, text, truncated, size };
  }

  // DOCX（V2.5）：与 Download 共用 resolveLiveDocxBytes（legacy detection → optional migration → verified bytes）
  const { bytes } = await resolveLiveDocxBytes({ artifactId: artifact.id, workspaces: input.workspaces });
  const { extractDocx } = await import("@/lib/ai/attachments/docx");  let extracted: { text: string; truncated: boolean };
  try {
    extracted = await extractDocx(
      new Blob([bytes.slice().buffer as ArrayBuffer], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      })
    );
  } catch {
    extracted = { text: "", truncated: true };
  }
  const { text, truncated } = boundText(extracted.text);

  // 结构事实：优先匹配的 Source IR；否则安全 fallback
  const source = await getArtifactSource(artifact.id);
  let factValue: {
    title?: string;
    headings: number;
    paragraphs: number;
    lists: number;
    tables: number;
    codeBlocks: number;
    characters: number;
  };
  if (source && source.revision === artifact.revision) {
    const inspected = inspectDocumentFacts(source.document, "docx");
    factValue = {
      title: inspected.title,
      headings: inspected.headings,
      paragraphs: inspected.paragraphs,
      lists: inspected.lists,
      tables: inspected.tables,
      codeBlocks: inspected.codeBlocks,
      characters: inspected.characters,
    };
  } else {
    const paragraphs = text
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean).length;
    factValue = {
      title: artifact.title,
      headings: 0,
      paragraphs,
      lists: 0,
      tables: 0,
      codeBlocks: 0,
      characters: text.length,
    };
  }
  return {
    kind: "docx",
    artifact,
    workspaceLabel: workspace.name,
    rootLabel,
    text,
    truncated: truncated || extracted.truncated,
    size,
    facts: factValue,
  };
}

/**
 * 共享 DOCX live-bytes resolve（V2.5）：Preview 与 Download 都经过同一链路。
 * legacy detection → 必要时 self-heal migration → verified live bytes。
 *
 * Migration 安全边界（全部满足才自动重写文件）：
 * - artifact.type === "docx"
 * - artifact.source === "kiro-created"（workspace-existing 用户文件绝不自动重写）
 * - 存在匹配 revision 的 Source IR
 * - detectLegacyKiroDocx(bytes).legacy === true（structural evidence 最高优先）
 * 之后：Source IR → 当前 renderDocx() → verifyRenderedDocx → 写回同一 path → read-back verify。
 */
export async function resolveLiveDocxBytes(input: {
  artifactId: string;
  workspaces: KiroWorkspaceMeta[];
}): Promise<{ bytes: Uint8Array; migrated: boolean }> {
  const { artifact, path, io } = await resolveArtifactLocation(input.artifactId, input.workspaces);
  const stat = await io.stat(path);
  if (!stat || stat.kind !== "file") {
    throw new ComputerError("RESOURCE_NOT_FOUND", "文件不存在");
  }
  const bytes = await io.readBytes(path);

  if (artifact.type !== "docx") {
    return { bytes, migrated: false };
  }
  const source = await getArtifactSource(artifact.id);
  const hasMatchingSource =
    artifact.source === "kiro-created" && !!source && source.revision === artifact.revision;
  const detection = await detectLegacyKiroDocx(bytes);

  // Legacy Kiro DOCX（structural evidence 最高优先）→ 用匹配 Source IR 重新渲染（self-heal）
  if (hasMatchingSource && detection.legacy) {
    const { renderDocx } = await import("@/lib/ai/computer/documents/docx");
    const migrated = await renderDocx(source!.document);
    if (!(await verifyRenderedDocx(migrated, source!.document))) {
      throw new ComputerError(
        "VERIFICATION_FAILED",
        "旧版文档自动修复失败，请让 Kiro 重新生成该文档。"
      );
    }
    await io.writeBytes(
      path,
      migrated,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    const readBack = await io.readBytes(path);
    if (!(await verifyDocxBytes(readBack))) {
      throw new ComputerError(
        "VERIFICATION_FAILED",
        "旧版文档修复后回读校验失败，请让 Kiro 重新生成该文档。"
      );
    }
    return { bytes: readBack, migrated: true };
  }

  // 非 legacy / 非 kiro-created：preflight runtime verification（损坏不放行下载）
  const verified =
    source && source.revision === artifact.revision
      ? await verifyRenderedDocx(bytes, source.document)
      : await verifyDocxBytes(bytes);
  if (!verified) {
    throw new ComputerError("VERIFICATION_FAILED", "文档文件校验失败，请让 Kiro 重新生成。");
  }
  return { bytes, migrated: false };
}

/** 下载：永远读当前真实文件 bytes（不做缓存/Source IR/旧 bytes 导出）。
 *  DOCX 下载前（V2.1 + V2.5）：resolveLiveDocxBytes（legacy detection → optional migration →
 *  runtime verification）——损坏/旧版 DOCX 不允许原样下载。 */
export async function getArtifactDownloadPayload(input: {
  artifactId: string;
  workspaces: KiroWorkspaceMeta[];
}): Promise<KiroArtifactDownloadPayload> {
  const { artifact } = await resolveArtifactLocation(input.artifactId, input.workspaces);
  const { bytes } =
    artifact.type === "docx"
      ? await resolveLiveDocxBytes(input)
      : { bytes: await readLiveBytes(input) };
  return {
    artifact,
    fileName: artifact.displayName,
    mimeType: mimeTypeForArtifact(artifact.type),
    bytes,
  };
}

async function readLiveBytes(input: {
  artifactId: string;
  workspaces: KiroWorkspaceMeta[];
}): Promise<Uint8Array> {
  const { path, io } = await resolveArtifactLocation(input.artifactId, input.workspaces);
  const stat = await io.stat(path);
  if (!stat || stat.kind !== "file") {
    throw new ComputerError("RESOURCE_NOT_FOUND", "文件不存在");
  }
  return io.readBytes(path);
}

/** Preview 的 DOCX 分支：与 Download 共用 resolveLiveDocxBytes（legacy detection → migration → verified bytes） */
