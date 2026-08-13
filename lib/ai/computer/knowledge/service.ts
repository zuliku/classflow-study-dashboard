/**
 * Workspace Knowledge Service（V3 Part 1）编排：refresh/status/dirty/query。
 * - refresh：扫描全部 roots（frozen/Workspace root 顺序）；成功+完整 → ready；
 *   bounded/root 不可访问 → partial；失败但有旧缓存 → stale；失败且无缓存 → unavailable。
 * - dirty：best effort，只更新已存在的 state；未建立索引时不创建假 state。
 * - query：返回带 metadataScore/contentScore 的候选（权限过滤由 executor 侧执行）。
 */
import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";
import { KiroAgentMode, ComputerPermissionRule, KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import {
  KiroKnowledgeChunkRecord,
  KiroKnowledgeFileRecord,
  KiroKnowledgeIndexState,
  KiroKnowledgeScoredCandidate,
  KiroKnowledgeSearchResult,
  KiroKnowledgeWorkspaceState,
} from "@/lib/ai/computer/knowledge/types";
import {
  clearWorkspaceKnowledge,
  getKnowledgeWorkspaceState,
  listKnowledgeChunks,
  listKnowledgeFiles,
  putKnowledgeWorkspaceState,
  removeKnowledgeFile,
  replaceKnowledgeFile,
} from "@/lib/ai/computer/knowledge/db";
import { scanWorkspaceKnowledge } from "@/lib/ai/computer/knowledge/scanner";
import { rankKnowledgeCandidates, buildKnowledgeSnippet } from "@/lib/ai/computer/knowledge/rank";
import { tokenizeKnowledgeText } from "@/lib/ai/computer/knowledge/tokenize";

export interface RefreshWorkspaceKnowledgeInput {
  workspace: KiroWorkspaceMeta;
  mode: "incremental" | "force";
  agentMode: KiroAgentMode;
  permissionRules: ComputerPermissionRule[];
  getAdapter: (adapterRef: string) => ComputerAdapterIO;
}

export async function refreshWorkspaceKnowledge(
  input: RefreshWorkspaceKnowledgeInput
): Promise<KiroKnowledgeWorkspaceState> {
  const priorState = await getKnowledgeWorkspaceState(input.workspace.id);
  const existingFiles = priorState ? await listKnowledgeFiles(input.workspace.id) : [];
  const existingChunks = priorState ? await listKnowledgeChunks(input.workspace.id) : [];
  const dirty = priorState?.dirty ?? false;

  let scan;
  try {
    scan = await scanWorkspaceKnowledge({
      workspace: input.workspace,
      agentMode: input.agentMode,
      permissionRules: input.permissionRules,
      getAdapter: input.getAdapter,
      force: input.mode === "force",
      existingFiles,
      existingChunks,
    });
  } catch {
    // refresh 失败：有旧缓存 → 保持旧 state 标记 stale；无 → unavailable（由调用方判定）
    if (priorState) {
      return { ...priorState, partial: true, dirty: true, unavailableRootIds: priorState.unavailableRootIds };
    }
    throw new Error("knowledge-refresh-failed");
  }

  // 原子写入新记录
  const newFileKeys = new Set(scan.files.map((f) => f.key));
  const chunksByFile = new Map<string, KiroKnowledgeChunkRecord[]>();
  for (const c of scan.chunks) {
    const list = chunksByFile.get(c.fileKey) ?? [];
    list.push(c);
    chunksByFile.set(c.fileKey, list);
  }
  for (const file of scan.files) {
    await replaceKnowledgeFile(file, chunksByFile.get(file.key) ?? []);
  }
  // 删除：旧文件在本轮成功遍历的 roots 中未再观察到（不可访问 root 的旧文件不删除）
  const observed = new Set(scan.observedFileKeys);
  for (const old of existingFiles) {
    if (!observed.has(old.key) && !scan.unavailableRootIds.includes(old.rootId)) {
      await removeKnowledgeFile(old.key);
    }
  }

  const state: KiroKnowledgeWorkspaceState = {
    workspaceId: input.workspace.id,
    lastIndexedAt: new Date().toISOString(),
    fileCount: scan.files.length,
    chunkCount: scan.chunks.length,
    partial: scan.partial || scan.unavailableRootIds.length > 0,
    dirty: dirty && input.mode === "incremental" ? dirty : false,
    unavailableRootIds: scan.unavailableRootIds,
  };
  await putKnowledgeWorkspaceState(state);
  return state;
}

export async function getWorkspaceKnowledgeStatus(
  workspaceId: string
): Promise<KiroKnowledgeWorkspaceState | null> {
  return getKnowledgeWorkspaceState(workspaceId);
}

/** best effort：只更新已存在的 state；未建立索引时不创建假 state */
export async function markWorkspaceKnowledgeDirty(workspaceId: string): Promise<void> {
  const state = await getKnowledgeWorkspaceState(workspaceId);
  if (!state) return;
  await putKnowledgeWorkspaceState({ ...state, dirty: true });
}

/** 本地查询（不触碰 filesystem）：返回带评分拆分的候选（权限过滤由 executor 侧执行） */
export async function queryWorkspaceKnowledge(input: {
  workspaceId: string;
  query: string;
  rootIds?: string[];
  maxResults?: number;
}): Promise<Array<KiroKnowledgeScoredCandidate & { snippet?: string }>> {
  const files = await listKnowledgeFiles(input.workspaceId);
  const chunks = await listKnowledgeChunks(input.workspaceId);
  const chunksByFile = new Map<string, KiroKnowledgeChunkRecord[]>();
  for (const c of chunks) {
    const list = chunksByFile.get(c.fileKey) ?? [];
    list.push(c);
    chunksByFile.set(c.fileKey, list);
  }
  const rootFilter = input.rootIds ? new Set(input.rootIds) : null;
  const fileByLocation = new Map(files.map((f) => [`${f.rootId}\u0000${f.relativePath}`, f]));
  const candidates = files
    .filter((f) => (rootFilter ? rootFilter.has(f.rootId) : true))
    .map((file) => ({ file, chunks: chunksByFile.get(file.key) ?? [] }));
  const scored = rankKnowledgeCandidates(candidates, input.query);
  const tokens = Array.from(new Set(tokenizeKnowledgeText(input.query)));
  return scored.map((c) => {
    const file = fileByLocation.get(`${c.result.rootId}\u0000${c.result.path}`);
    const candidateChunks = file ? chunksByFile.get(file.key) ?? [] : [];
    return {
      ...c,
      snippet: c.metadataScore > 0 || c.contentScore > 0 ? buildKnowledgeSnippet(candidateChunks, tokens) : undefined,
    };
  });
}

export { clearWorkspaceKnowledge };
