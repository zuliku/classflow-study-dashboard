/**
 * V3 Part 2 — Grounded Workspace Context Retrieval 编排。
 * Knowledge = candidate discovery；filesystem = factual authority。
 * 最终 excerpt 必须来自本次 live adapter read（Knowledge snippet 绝不直接作为正文返回）。
 * 两层权限：候选发现经 fs.search（executor 侧逐 root）；每个最终候选在此重算精确 fs.read——
 * ask/deny → skip 且不泄露任何缓存正文。
 */
import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";
import { KiroAgentMode, ComputerPermissionRule, KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { prepareComputerTool } from "@/lib/ai/computer/prepare";
import {
  getWorkspaceKnowledgeStatus,
  queryWorkspaceKnowledge,
  refreshWorkspaceKnowledge,
} from "@/lib/ai/computer/knowledge/service";
import { buildLiveExcerpt, RETRIEVE_EXCERPT_MAX_CHARS } from "@/lib/ai/computer/knowledge/excerpt";
import { KiroKnowledgeIndexState, KiroKnowledgeSearchResult } from "@/lib/ai/computer/knowledge/types";
import { KIRO_KNOWLEDGE_MAX_CONTENT_BYTES } from "@/lib/ai/computer/knowledge/types";

export const RETRIEVE_DEFAULT_MAX_FILES = 3;
export const RETRIEVE_MAX_FILES = 4;
export const RETRIEVE_DEFAULT_MAX_CHARS = 4_800;
export const RETRIEVE_MAX_CHARS = 6_000;

export interface RetrieveWorkspaceContextInput {
  workspace: KiroWorkspaceMeta;
  agentMode: KiroAgentMode;
  permissionRules: ComputerPermissionRule[];
  getAdapter: (adapterRef: string) => ComputerAdapterIO;
  query: string;
  rootIds?: string[];
  maxFiles?: number;
  maxChars?: number;
}

export interface RetrievedContextItem {
  rootId: string;
  path: string;
  title?: string;
  type: "text" | "docx";
  excerpt: string;
  matchReasons: string[];
  truncated: boolean;
}

export interface RetrievedContextSkip {
  rootId: string;
  path: string;
  reason: "permission" | "missing" | "unsupported" | "too-large";
}

export interface RetrievedContextPack {
  query: string;
  items: RetrievedContextItem[];
  indexState: KiroKnowledgeIndexState;
  partial: boolean;
  skipped: RetrievedContextSkip[];
}

/** 基于候选文件构建 live excerpt（text 直接读；docx 走 Mammoth raw-text） */
async function buildItemExcerpt(input: {
  io: ComputerAdapterIO;
  path: string;
  extension: string;
  query: string;
}): Promise<{ type: "text" | "docx"; excerpt: string; truncated: boolean }> {
  if (input.extension === "docx") {
    const bytes = await input.io.readBytes(input.path);
    const { extractDocx } = await import("@/lib/ai/attachments/docx");
    const extracted = await extractDocx(
      new Blob([bytes.slice().buffer as ArrayBuffer], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      })
    );
    const { excerpt, truncated } = buildLiveExcerpt(extracted.text, input.query);
    return { type: "docx", excerpt, truncated };
  }
  const text = await input.io.readText(input.path);
  const { excerpt, truncated } = buildLiveExcerpt(text, input.query);
  return { type: "text", excerpt, truncated };
}

/** Grounded retrieval（executor 已做 snapshot/root 校验与 fs.search policy；本函数负责 live grounding） */
export async function retrieveWorkspaceContext(
  input: RetrieveWorkspaceContextInput
): Promise<RetrievedContextPack> {
  const { workspace, agentMode, permissionRules, getAdapter, query } = input;
  const maxFiles = Math.max(1, Math.min(input.maxFiles ?? RETRIEVE_DEFAULT_MAX_FILES, RETRIEVE_MAX_FILES));
  const maxChars = Math.max(1, Math.min(input.maxChars ?? RETRIEVE_DEFAULT_MAX_CHARS, RETRIEVE_MAX_CHARS));
  const rootFilter = input.rootIds ? new Set(input.rootIds) : null;

  // ---- Index lifecycle（复用 Part 1）----
  const state = await getWorkspaceKnowledgeStatus(workspace.id);
  let indexState: KiroKnowledgeIndexState;
  let partial = false;
  if (!state) {
    try {
      const refreshed = await refreshWorkspaceKnowledge({
        workspace,
        mode: "incremental",
        agentMode,
        permissionRules,
        getAdapter,
      });
      indexState = refreshed.partial ? "partial" : "ready";
      partial = refreshed.partial;
    } catch {
      indexState = "unavailable";
    }
  } else if (state.dirty) {
    try {
      const refreshed = await refreshWorkspaceKnowledge({
        workspace,
        mode: "incremental",
        agentMode,
        permissionRules,
        getAdapter,
      });
      indexState = refreshed.partial ? "partial" : "ready";
      partial = refreshed.partial;
    } catch {
      indexState = "stale";
    }
  } else {
    indexState = state.partial ? "partial" : "ready";
    partial = state.partial;
  }

  // ---- 候选发现（Knowledge ranking）----
  let candidates: Array<KiroKnowledgeSearchResult & { metadataScore: number; contentScore: number }>;
  try {
    const scored = await queryWorkspaceKnowledge({
      workspaceId: workspace.id,
      query,
      rootIds: input.rootIds,
      maxResults: RETRIEVE_MAX_FILES * 3,
    });
    candidates = scored.map((c) => ({ ...c.result, metadataScore: c.metadataScore, contentScore: c.contentScore }));
  } catch {
    candidates = [];
    if (indexState === "ready" || indexState === "partial") indexState = "stale";
  }

  const items: RetrievedContextItem[] = [];
  const skipped: RetrievedContextSkip[] = [];
  let budgetUsed = 0;

  for (const candidate of candidates) {
    if (items.length >= maxFiles) break;
    if (rootFilter && !rootFilter.has(candidate.rootId)) continue;
    const root = workspace.roots.find((r) => r.id === candidate.rootId);
    if (!root) continue;

    // 每个最终候选：精确 fs.read policy（ask/deny → skip，绝不读取/泄露正文）
    const readPolicy = prepareComputerTool({
      mode: agentMode,
      rules: permissionRules,
      workspace,
      capability: "fs.read",
      resource: { workspaceId: workspace.id, rootId: root.id, path: candidate.path },
    });
    if (readPolicy.effect !== "allow") {
      skipped.push({ rootId: candidate.rootId, path: candidate.path, reason: "permission" });
      continue;
    }

    const io = getAdapter(root.adapterRef);
    let stat;
    try {
      stat = await io.stat(candidate.path);
    } catch {
      skipped.push({ rootId: candidate.rootId, path: candidate.path, reason: "permission" });
      continue;
    }
    if (!stat || stat.kind !== "file") {
      skipped.push({ rootId: candidate.rootId, path: candidate.path, reason: "missing" });
      continue;
    }
    if (candidate.type === "metadata" || stat.size > KIRO_KNOWLEDGE_MAX_CONTENT_BYTES) {
      skipped.push({ rootId: candidate.rootId, path: candidate.path, reason: "too-large" });
      continue;
    }

    const extension = candidate.path.split(".").pop()?.toLowerCase() ?? "";
    if (extension !== "docx" && extension !== "md" && extension !== "txt") {
      skipped.push({ rootId: candidate.rootId, path: candidate.path, reason: "unsupported" });
      continue;
    }

    let built: { type: "text" | "docx"; excerpt: string; truncated: boolean };
    try {
      built = await buildItemExcerpt({ io, path: candidate.path, extension, query });
    } catch {
      skipped.push({ rootId: candidate.rootId, path: candidate.path, reason: "missing" });
      continue;
    }
    if (!built.excerpt) continue;

    // 总预算（hard bound）
    const remaining = Math.max(0, maxChars - budgetUsed);
    const allowedChars = Math.min(RETRIEVE_EXCERPT_MAX_CHARS, remaining);
    if (allowedChars <= 0) break;
    const excerpt = built.excerpt.slice(0, allowedChars);
    budgetUsed += excerpt.length;

    items.push({
      rootId: candidate.rootId,
      path: candidate.path,
      title: candidate.title,
      type: built.type,
      excerpt,
      matchReasons: candidate.matchReasons,
      truncated: built.truncated || excerpt.length < built.excerpt.length,
    });
  }

  return { query, items, indexState, partial, skipped };
}
