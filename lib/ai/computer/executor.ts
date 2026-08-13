import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import {
  ComputerPermissionRule,
  KiroWorkspaceMeta,
  LogicalComputerResource,
} from "@/lib/ai/computer/types";
import { ComputerError } from "@/lib/ai/computer/errors";
import { normalizeRelativeComputerPath } from "@/lib/ai/computer/workspace/resolver";
import { prepareComputerTool } from "@/lib/ai/computer/prepare";
import { COMPUTER_TOOLS } from "@/lib/ai/computer/tools/registry";
import { ComputerActionFact } from "@/lib/ai/computer/types";
import {
  sandboxListDirectory,
  sandboxStat,
  sandboxReadText,
  sandboxReadBytes,
  sandboxCreateDirectory,
  sandboxWriteText,
  sandboxWriteBytes,
} from "@/lib/ai/computer/adapters/sandbox";
import {
  browserListDirectory,
  browserStat,
  browserReadText,
  browserReadBytes,
  browserCreateDirectory,
  browserWriteText,
  browserWriteBytes,
} from "@/lib/ai/computer/adapters/browser";
import {
  applyReadBounds,
  searchFiles,
  grepFiles,
  applyExactPatches,
  normalizeScopePath,
} from "@/lib/ai/computer/filesystem/search";
import { renderMarkdown } from "@/lib/ai/computer/documents/markdown";
import { renderDocx } from "@/lib/ai/computer/documents/docx";
import { verifyMarkdownWritten, verifyDocxBytes, inspectDocumentFacts } from "@/lib/ai/computer/documents/verify";
import { isKiroDocument } from "@/lib/ai/computer/documents/types";

export const COMPUTER_READ_LIMIT_PER_TURN = 12;
export const COMPUTER_MUTATION_LIMIT_PER_TURN = 6;

export interface ComputerExecutorContext {
  turnSnapshot: KiroComputerTurnSnapshot;
  liveWorkspaces: KiroWorkspaceMeta[];
  livePermissionRules: ComputerPermissionRule[];
}

export type ComputerToolResult =
  | { ok: true; data: unknown; actionFact?: ComputerActionFact }
  | { ok: false; code: string; message: string };

export interface ComputerCounterState {
  readCount: number;
  mutationCount: number;
}

/** 按 adapterRef 构造统一 IO 接口（browser / sandbox runtime） */
function adapterFor(adapterRef: string): ComputerAdapterIO {
  const isSandbox = adapterRef === "sandbox-default" || adapterRef.startsWith("sandbox");
  if (isSandbox) {
    return {
      list: (p) => sandboxListDirectory(adapterRef, p).then((items) => items.map((i) => ({ name: i.name, kind: i.entry.kind, size: i.entry.size }))),
      stat: (p) => sandboxStat(adapterRef, p).then((e) => (e ? { kind: e.kind, size: e.size, type: e.type } : null)),
      readText: (p) => sandboxReadText(adapterRef, p),
      readBytes: (p) => sandboxReadBytes(adapterRef, p),
      createDirectory: (p) => sandboxCreateDirectory(adapterRef, p),
      writeText: (p, c, t) => sandboxWriteText(adapterRef, p, c, t),
      writeBytes: (p, c, t) => sandboxWriteBytes(adapterRef, p, c, t),
    };
  }
  return {
    list: (p) => browserListDirectory(adapterRef, p),
    stat: (p) => browserStat(adapterRef, p),
    readText: (p) => browserReadText(adapterRef, p),
    readBytes: (p) => browserReadBytes(adapterRef, p),
    createDirectory: (p) => browserCreateDirectory(adapterRef, p),
    writeText: (p, c) => browserWriteText(adapterRef, p, c),
    writeBytes: (p, c) => browserWriteBytes(adapterRef, p, c),
  };
}

function resolveSnapshotWorkspace(snapshot: KiroComputerTurnSnapshot, liveWorkspaces: KiroWorkspaceMeta[]) {
  if (!snapshot.enabled) throw new ComputerError("COMPUTER_DISABLED", "Computer Agent 未启用");
  const ws = liveWorkspaces.find((w) => w.id === snapshot.workspaceId);
  if (!ws) throw new ComputerError("WORKSPACE_NOT_FOUND", "当前 Workspace 不存在");
  return ws;
}

function findRoot(ws: KiroWorkspaceMeta, resource: LogicalComputerResource) {
  const root = ws.roots.find((r) => r.id === resource.rootId);
  if (!root) throw new ComputerError("ROOT_NOT_FOUND", `工作区根不存在：${resource.rootId}`);
  return root;
}

/**
 * Computer Tool 唯一执行入口（Part 2）：
 * schema → enabled → workspace/root → path sandbox → policy → grant → adapter → execute → verify → result。
 * useKiroChat 不得复刻这些逻辑。
 */
export async function executeKiroComputerTool(request: {
  toolName: string;
  toolInput: unknown;
  context: ComputerExecutorContext;
  counters: ComputerCounterState;
}): Promise<ComputerToolResult> {
  const { toolName, toolInput, context, counters } = request;
  const { turnSnapshot, liveWorkspaces, livePermissionRules } = context;

  const definition = COMPUTER_TOOLS.find((t) => t.name === toolName);
  if (!definition) {
    return { ok: false, code: "PERMISSION_DENIED", message: `未知 Computer 工具：${toolName}` };
  }

  // 调用限制（独立于总工具计数）
  if (definition.mutation) {
    if (counters.mutationCount >= COMPUTER_MUTATION_LIMIT_PER_TURN) {
      return { ok: false, code: "PERMISSION_DENIED", message: "本轮修改操作已达上限" };
    }
  } else if (counters.readCount >= COMPUTER_READ_LIMIT_PER_TURN) {
    return { ok: false, code: "PERMISSION_DENIED", message: "本轮读取操作已达上限" };
  }

  // schema 校验
  const parsed = definition.schema.safeParse(toolInput);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "输入不合法" };
  }
  const args = parsed.data as Record<string, unknown>;

  const ws = resolveSnapshotWorkspace(turnSnapshot, liveWorkspaces);

  try {
    // 无资源工具：list_workspace_roots
    if (toolName === "list_workspace_roots") {
      counters.readCount += 1;
      return {
        ok: true,
        data: {
          workspaceId: ws.id,
          workspaceLabel: ws.name,
          roots: ws.roots.map((r) => ({ id: r.id, label: r.label, access: r.access })),
        },
      };
    }

    // 资源工具：workspace/root/path
    const resource: LogicalComputerResource = {
      workspaceId: ws.id,
      rootId: String(args.rootId ?? ws.roots[0]?.id ?? ""),
      path: String(args.path ?? ""),
    };
    if (!resource.rootId) throw new ComputerError("ROOT_NOT_FOUND", "未指定工作区根目录");
    const root = findRoot(ws, resource);

    // path sandbox（allowRoot 仅 list/search/grep scope）
    const allowRoot =
      toolName === "list_directory" || toolName === "search_files" || toolName === "grep_files";
    const normalized = allowRoot
      ? normalizeScopePath(resource.path)
      : normalizeRelativeComputerPath(resource.path).path;

    // policy（含 hard deny / read-only / mode default / explicit rules）
    const policy = prepareComputerTool({
      mode: turnSnapshot.agentMode,
      rules: livePermissionRules,
      workspace: ws,
      capability: definition.capability,
      resource: { ...resource, path: normalized },
    });
    if (policy.effect === "deny") {
      // Guided modify → ask：Part 3 才有审批 UI；Part 2 明确不执行
      if (toolName === "patch_text_file" && turnSnapshot.agentMode === "guided") {
        return { ok: false, code: "WORKSPACE_PERMISSION_REQUIRED", message: "受控模式需要修改审批，当前版本暂不支持" };
      }
      return { ok: false, code: "PERMISSION_DENIED", message: policy.reason };
    }
    if (policy.effect === "ask") {
      return { ok: false, code: "WORKSPACE_PERMISSION_REQUIRED", message: "此操作需要用户审批" };
    }

    const adapter = adapterFor(root.adapterRef);

    // ---- READ TOOLS ----
    if (toolName === "list_directory") {
      counters.readCount += 1;
      const items = await adapter.list(normalized);
      return { ok: true, data: { path: normalized, items } };
    }
    if (toolName === "search_files") {
      counters.readCount += 1;
      const result = await searchFiles(
        { list: (p) => adapter.list(p), readText: (p) => adapter.readText(p) },
        {
          query: String(args.query),
          maxResults: args.maxResults as number | undefined,
          maxDepth: args.maxDepth as number | undefined,
        }
      );
      return { ok: true, data: result };
    }
    if (toolName === "grep_files") {
      counters.readCount += 1;
      const result = await grepFiles(
        { list: (p) => adapter.list(p), readText: (p) => adapter.readText(p) },
        {
          query: String(args.query),
          maxResults: args.maxResults as number | undefined,
          maxFiles: args.maxFiles as number | undefined,
        }
      );
      return { ok: true, data: result };
    }
    if (toolName === "get_file_metadata") {
      counters.readCount += 1;
      const meta = await adapter.stat(normalized);
      return { ok: true, data: { path: normalized, meta } };
    }
    if (toolName === "read_text") {
      counters.readCount += 1;
      const content = await adapter.readText(normalized);
      const bounded = applyReadBounds(content, {
        startLine: args.startLine as number | undefined,
        endLine: args.endLine as number | undefined,
        maxChars: args.maxChars as number | undefined,
      });
      return { ok: true, data: { path: normalized, ...bounded } };
    }
    if (toolName === "inspect_document") {
      counters.readCount += 1;
      const bytes = await adapter.readBytes(normalized);
      const raw = await adapter.readText(normalized);
      const ext = normalized.split(".").pop()?.toLowerCase();
      const format = ext === "docx" ? ("docx" as const) : ext === "md" ? ("markdown" as const) : null;
      if (!format) return { ok: false, code: "UNSUPPORTED_FILE_TYPE", message: "仅支持 Markdown / DOCX 检查" };
      // 从渲染产物回构事实（Markdown 走行统计；DOCX 走文档结构计数）
      if (format === "markdown") {
        const lines = raw.split("\n");
        return {
          ok: true,
          data: {
            format,
            headings: lines.filter((l) => /^#{1,3}\s/.test(l)).length,
            paragraphs: lines.filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("|")).length,
            lists: lines.filter((l) => /^\s*[-*] |^\s*\d+\. /.test(l)).length,
            tables: lines.filter((l) => l.startsWith("|")).length > 0 ? 1 : 0,
            codeBlocks: (raw.match(/```/g) ?? []).length / 2,
            characters: raw.length,
            bytes: bytes.byteLength,
          },
        };
      }
      // DOCX：从字节解析 XML 内容后粗统计（精确事实结构由 IR 侧提供，这里给页面级统计）
      return {
        ok: true,
        data: {
          format,
          characters: raw.length,
          bytes: bytes.byteLength,
        },
      };
    }

    // ---- MUTATION TOOLS ----
    if (toolName === "create_directory") {
      counters.mutationCount += 1;
      const outcome = await adapter.createDirectory(normalized);
      const meta = await adapter.stat(normalized);
      if (!meta) throw new ComputerError("VERIFICATION_FAILED", "创建目录后无法验证");
      return {
        ok: true,
        data: { path: normalized, outcome: outcome === "created" ? "created" : "exists", verified: true },
        actionFact: buildActionFact({
          tool: toolName,
          operation: "create",
          resourceType: "directory",
          snapshot: turnSnapshot,
          workspaceLabel: ws.name,
          rootId: root.id,
          rootLabel: root.label,
          relativePath: normalized,
          displayName: normalized.split("/").pop() ?? normalized,
        }),
      };
    }
    if (toolName === "create_text_file") {
      counters.mutationCount += 1;
      const existing = await adapter.stat(normalized);
      if (existing) throw new ComputerError("RESOURCE_ALREADY_EXISTS", `文件已存在：${normalized}`);
      const content = String(args.content);
      await adapter.writeText(normalized, content);
      // Verify：read-back exact match
      const readBack = await adapter.readText(normalized);
      if (readBack !== content) throw new ComputerError("VERIFICATION_FAILED", "写入校验失败");
      return {
        ok: true,
        data: { path: normalized, verified: true },
        actionFact: buildActionFact({
          tool: toolName,
          operation: "create",
          resourceType: "text",
          snapshot: turnSnapshot,
          workspaceLabel: ws.name,
          rootId: root.id,
          rootLabel: root.label,
          relativePath: normalized,
          displayName: normalized.split("/").pop() ?? normalized,
          size: new TextEncoder().encode(content).byteLength,
        }),
      };
    }
    if (toolName === "patch_text_file") {
      counters.mutationCount += 1;
      const current = await adapter.readText(normalized);
      const edits = (args.edits as { oldText: string; newText: string }[]).map((e) => ({
        oldText: e.oldText,
        newText: e.newText,
      }));
      const { content: patched, changeCount } = applyExactPatches(current, edits);
      await adapter.writeText(normalized, patched);
      // Verify：read-back exact
      const readBack = await adapter.readText(normalized);
      if (readBack !== patched) throw new ComputerError("VERIFICATION_FAILED", "修改校验失败");
      return {
        ok: true,
        data: { path: normalized, changeCount, verified: true },
        actionFact: buildActionFact({
          tool: toolName,
          operation: "modify",
          resourceType: "text",
          snapshot: turnSnapshot,
          workspaceLabel: ws.name,
          rootId: root.id,
          rootLabel: root.label,
          relativePath: normalized,
          displayName: normalized.split("/").pop() ?? normalized,
          changeCount,
        }),
      };
    }
    if (toolName === "create_document") {
      counters.mutationCount += 1;
      const document = args.document as Parameters<typeof renderMarkdown>[0];
      if (!isKiroDocument(document)) throw new ComputerError("INVALID_INPUT", "文档 IR 不合法");
      const ext = normalized.split(".").pop()?.toLowerCase();
      if (ext === "md") {
        const markdown = renderMarkdown(document);
        const existing = await adapter.stat(normalized);
        if (existing) throw new ComputerError("RESOURCE_ALREADY_EXISTS", `文件已存在：${normalized}`);
        await adapter.writeText(normalized, markdown, "text/markdown");
        const readBack = await adapter.readText(normalized);
        if (!(await verifyMarkdownWritten(markdown, readBack))) {
          throw new ComputerError("VERIFICATION_FAILED", "Markdown 校验失败");
        }
        const facts = inspectDocumentFacts(document, "markdown");
        return {
          ok: true,
          data: { path: normalized, format: "markdown", verified: true },
          actionFact: buildActionFact({
            tool: toolName,
            operation: "create",
            resourceType: "document",
            snapshot: turnSnapshot,
            workspaceLabel: ws.name,
            rootId: root.id,
            rootLabel: root.label,
            relativePath: normalized,
            displayName: normalized.split("/").pop() ?? normalized,
            format: "markdown",
            size: new TextEncoder().encode(markdown).byteLength,
          }),
        };
      }
      if (ext === "docx") {
        const existing = await adapter.stat(normalized);
        if (existing) throw new ComputerError("RESOURCE_ALREADY_EXISTS", `文件已存在：${normalized}`);
        const bytes = await renderDocx(document);
        await adapter.writeBytes(normalized, bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        const readBack = await adapter.readBytes(normalized);
        if (!(await verifyDocxBytes(readBack))) {
          throw new ComputerError("VERIFICATION_FAILED", "DOCX 校验失败");
        }
        const facts = inspectDocumentFacts(document, "docx");
        return {
          ok: true,
          data: { path: normalized, format: "docx", verified: true, facts },
          actionFact: buildActionFact({
            tool: toolName,
            operation: "create",
            resourceType: "document",
            snapshot: turnSnapshot,
            workspaceLabel: ws.name,
            rootId: root.id,
            rootLabel: root.label,
            relativePath: normalized,
            displayName: normalized.split("/").pop() ?? normalized,
            format: "docx",
            size: bytes.byteLength,
          }),
        };
      }
      return { ok: false, code: "UNSUPPORTED_FILE_TYPE", message: "仅支持 .md / .docx 文档" };
    }

    return { ok: false, code: "PERMISSION_DENIED", message: `未实现的 Computer 工具：${toolName}` };
  } catch (err) {
    if (err instanceof ComputerError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return { ok: false, code: "UNKNOWN", message: err instanceof Error ? err.message : "未知错误" };
  }
}

function buildActionFact(input: {
  tool: string;
  operation: "create" | "modify";
  resourceType: "text" | "document" | "directory";
  snapshot: KiroComputerTurnSnapshot;
  workspaceLabel: string;
  rootId: string;
  rootLabel: string;
  relativePath: string;
  displayName: string;
  format?: "markdown" | "docx";
  size?: number;
  changeCount?: number;
}): ComputerActionFact {
  return {
    tool: input.tool,
    operation: input.operation,
    resourceType: input.resourceType,
    workspaceId: input.snapshot.workspaceId ?? "",
    workspaceLabel: input.workspaceLabel,
    rootId: input.rootId,
    rootLabel: input.rootLabel,
    relativePath: input.relativePath,
    displayName: input.displayName,
    format: input.format,
    size: input.size,
    changeCount: input.changeCount,
    verification: "passed",
  };
}
