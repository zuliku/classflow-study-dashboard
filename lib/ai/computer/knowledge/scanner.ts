/**
 * Bounded deterministic Workspace traversal（V3 Part 1）。
 * 固定边界：2,000 files / depth 12 / 2 MiB content / 20 chunks per file /
 * 10,000 chunks per workspace。命中任何边界 → partial=true。
 * KIRO.md 不作为普通 Knowledge 记录（exact root-level）。
 */
import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";
import { KiroAgentMode, ComputerPermissionRule, KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { prepareComputerTool } from "@/lib/ai/computer/prepare";
import {
  KIRO_KNOWLEDGE_MAX_CHUNKS_PER_FILE,
  KIRO_KNOWLEDGE_MAX_CHUNKS_PER_WORKSPACE,
  KIRO_KNOWLEDGE_MAX_DEPTH,
  KIRO_KNOWLEDGE_MAX_FILES,
  KiroKnowledgeChunkRecord,
  KiroKnowledgeFileRecord,
  knowledgeFileKey,
} from "@/lib/ai/computer/knowledge/types";
import { extractFileContent } from "@/lib/ai/computer/knowledge/extract";

export interface ScanWorkspaceResult {
  files: KiroKnowledgeFileRecord[];
  chunks: KiroKnowledgeChunkRecord[];
  partial: boolean;
  unavailableRootIds: string[];
  scannedRootIds: string[];
  /** 本次成功遍历观察到的 file keys（service 据此删除陈旧记录；不可访问 root 不触发删除） */
  observedFileKeys: string[];
}

export interface WorkspaceScanInput {
  workspace: KiroWorkspaceMeta;
  agentMode: KiroAgentMode;
  permissionRules: ComputerPermissionRule[];
  getAdapter: (adapterRef: string) => ComputerAdapterIO;
  /** force：对 eligible supported content 全部重新提取；incremental：允许按指纹复用（由 service 处理） */
  force: boolean;
  /** 已有文件记录（fingerprint 复用判断；force 时不使用） */
  existingFiles: KiroKnowledgeFileRecord[];
  /** 已有 chunk 记录（fingerprint 复用时原样保留） */
  existingChunks: KiroKnowledgeChunkRecord[];
}

function fileFingerprint(rootId: string, relativePath: string, size: number, extension: string): string {
  return `${rootId}\u0000${relativePath}\u0000${size}\u0000${extension}`;
}

/** 遍历单个 root（确定性：每个 list 结果先排序） */
async function scanRoot(input: WorkspaceScanInput, root: { id: string; label: string; adapterRef: string }, state: {
  files: KiroKnowledgeFileRecord[];
  chunks: KiroKnowledgeChunkRecord[];
  discoveredFiles: number;
  workspaceChunks: number;
  partial: boolean;
  observedKeys: Set<string>;
}): Promise<void> {
  const io = input.getAdapter(root.adapterRef);
  const existingByKey = new Map(input.existingFiles.map((f) => [f.key, f]));
  const existingChunksByFile = new Map<string, KiroKnowledgeChunkRecord[]>();
  for (const c of input.existingChunks) {
    const list = existingChunksByFile.get(c.fileKey) ?? [];
    list.push(c);
    existingChunksByFile.set(c.fileKey, list);
  }

  const visit = async (dirPath: string, depth: number): Promise<void> => {
    if (depth > KIRO_KNOWLEDGE_MAX_DEPTH) {
      state.partial = true;
      return;
    }
    let entries: { name: string; kind: "file" | "directory"; size: number }[];
    try {
      entries = await io.list(dirPath);
    } catch {
      // root 级访问失败由调用方处理；子树访问失败只标 partial
      if (dirPath === "") return;
      state.partial = true;
      return;
    }
    // 确定性排序
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = dirPath ? `${dirPath}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        await visit(rel, depth + 1);
        if (state.discoveredFiles >= KIRO_KNOWLEDGE_MAX_FILES) {
          state.partial = true;
          return;
        }
        continue;
      }
      if (rel === "KIRO.md") continue; // 不作为普通 Knowledge 记录
      if (state.discoveredFiles >= KIRO_KNOWLEDGE_MAX_FILES) {
        state.partial = true;
        return;
      }
      state.discoveredFiles += 1;
      const extension = entry.name.split(".").pop()?.toLowerCase() ?? "";
      const key = knowledgeFileKey(input.workspace.id, root.id, rel);
      const fingerprint = fileFingerprint(root.id, rel, entry.size, extension);

      // 当前 exact-file fs.read policy（allow 才提取正文；ask/deny → metadata-only，不弹审批）
      const policy = prepareComputerTool({
        mode: input.agentMode,
        rules: input.permissionRules,
        workspace: input.workspace,
        capability: "fs.read",
        resource: { workspaceId: input.workspace.id, rootId: root.id, path: rel },
      });
      const readAllowed = policy.effect === "allow";

      // fingerprint 复用（clean incremental；force 时跳过）
      const existing = existingByKey.get(key);
      const reusable =
        !input.force && readAllowed && existing && existing.fingerprint === fingerprint && existing.contentStatus === "indexed"
          ? existingChunksByFile.get(key) ?? []
          : null;

      let file: KiroKnowledgeFileRecord;
      let chunks: KiroKnowledgeChunkRecord[];
      if (reusable) {
        file = existing!;
        chunks = reusable;
      } else {
        const extracted = readAllowed
          ? await extractFileContent({
              adapter: io,
              workspaceId: input.workspace.id,
              rootId: root.id,
              relativePath: rel,
              extension,
              size: entry.size,
              fileKey: key,
              maxChunksPerFile: KIRO_KNOWLEDGE_MAX_CHUNKS_PER_FILE,
            })
          : { type: "metadata" as const, contentStatus: "metadata-only" as const, chunks: [] as KiroKnowledgeChunkRecord[] };
        const remainingChunks = KIRO_KNOWLEDGE_MAX_CHUNKS_PER_WORKSPACE - state.workspaceChunks;
        if (extracted.chunks.length > remainingChunks) {
          chunks = extracted.chunks.slice(0, Math.max(0, remainingChunks));
          if (extracted.chunks.length > remainingChunks) state.partial = true;
        } else {
          chunks = extracted.chunks;
        }
        file = {
          key,
          workspaceId: input.workspace.id,
          rootId: root.id,
          relativePath: rel,
          extension,
          type: extracted.type,
          size: entry.size,
          title: extracted.title,
          fingerprint,
          contentStatus: extracted.contentStatus,
          indexedAt: new Date().toISOString(),
        };
        state.workspaceChunks += chunks.length;
        if (state.workspaceChunks >= KIRO_KNOWLEDGE_MAX_CHUNKS_PER_WORKSPACE) state.partial = true;
      }
      state.files.push(file);
      for (const c of chunks) state.chunks.push(c);
      state.observedKeys.add(key);
    }
  };

  await visit("", 1);
}

/**
 * 扫描全部 roots（按 frozen/Workspace root 顺序）；返回新索引记录集。
 * 调用方（service）负责：不可访问 root → unavailableRootIds；未再次观察到的旧文件删除。
 */
export async function scanWorkspaceKnowledge(input: WorkspaceScanInput): Promise<ScanWorkspaceResult> {
  const state = {
    files: [] as KiroKnowledgeFileRecord[],
    chunks: [] as KiroKnowledgeChunkRecord[],
    discoveredFiles: 0,
    workspaceChunks: 0,
    partial: false,
    observedKeys: new Set<string>(),
  };
  const unavailableRootIds: string[] = [];
  const scannedRootIds: string[] = [];
  for (const root of input.workspace.roots) {
    scannedRootIds.push(root.id);
    try {
      await scanRoot(input, root, state);
    } catch {
      unavailableRootIds.push(root.id);
      state.partial = true;
    }
  }
  return {
    files: state.files,
    chunks: state.chunks,
    partial: state.partial,
    unavailableRootIds,
    scannedRootIds,
    observedFileKeys: Array.from(state.observedKeys),
  };
}
