import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import {
  ComputerPermissionRule,
  KiroWorkspaceMeta,
  LogicalComputerResource,
  ComputerCapability,
} from "@/lib/ai/computer/types";
import { ComputerError } from "@/lib/ai/computer/errors";
import { normalizeRelativeComputerPath } from "@/lib/ai/computer/workspace/resolver";
import { prepareComputerTool } from "@/lib/ai/computer/prepare";
import { COMPUTER_TOOLS } from "@/lib/ai/computer/tools/registry";
import {
  ComputerExecutionAttempt,
  ComputerToolResult,
  ComputerRuntimeMutation,
} from "@/lib/ai/computer/result";
import {
  ComputerOneShotApproval,
  buildApprovalRequest,
  oneShotApprovalMatches,
} from "@/lib/ai/computer/approval";
import {
  sandboxListDirectory,
  sandboxStat,
  sandboxReadText,
  sandboxReadBytes,
  sandboxCreateDirectory,
  sandboxWriteText,
  sandboxWriteBytes,
  sandboxRemove,
} from "@/lib/ai/computer/adapters/sandbox";
import {
  browserListDirectory,
  browserStat,
  browserReadText,
  browserReadBytes,
  browserCreateDirectory,
  browserWriteText,
  browserWriteBytes,
  browserRemove,
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
import { KiroComputerChange } from "@/lib/ai/computer/task";
import { ComputerInverseOperation } from "@/lib/ai/computer/checkpoints";

export const COMPUTER_READ_LIMIT_PER_TURN = 12;
export const COMPUTER_MUTATION_LIMIT_PER_TURN = 6;

/** Patch Undo before-text 上限（超限 → canUndo=false，不保留 checkpoint 快照） */
export const COMPUTER_PATCH_UNDO_LIMIT_BYTES = 1024 * 1024;

export interface ComputerExecutorContext {
  turnSnapshot: KiroComputerTurnSnapshot;
  liveWorkspaces: KiroWorkspaceMeta[];
  livePermissionRules: ComputerPermissionRule[];
  /** Part 3：Approval Request 携带的 Task 标识（useKiroChat 传入） */
  taskId?: string;
}

export interface ComputerCounterState {
  readCount: number;
  mutationCount: number;
}

/** 按 adapterRef 构造统一 IO 接口（browser / sandbox runtime；Part 3 导出供 Undo 复用） */
export function getComputerAdapterForAdapterRef(adapterRef: string): ComputerAdapterIO {
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
      remove: (p, k) => sandboxRemove(adapterRef, p, k),
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
    remove: (p, k) => browserRemove(adapterRef, p, k),
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

function newApprovalId(): string {
  return `approval-${crypto.randomUUID()}`;
}

/**
 * Computer Tool 唯一执行入口（Part 3）：
 * schema → enabled → workspace/root → path sandbox → policy → (ask → approval-required / deny → fail)
 * → one-shot 或已批准 → grant → adapter → execute → verify → completed。
 *
 * - ask 绝不执行 IO、绝不产生 mutation 计数、绝不返回 Tool Output（approval-required）。
 * - Approval 只能满足 ask；deny / hard deny / read-only root / PATH_OUTSIDE_SANDBOX / missing grant 不可绕过。
 * - Model 不能选择 approval 持久化（no permission/approval/remember/force/unsafe/skipCheck schema 字段）。
 */
export async function executeKiroComputerTool(request: {
  toolName: string;
  toolCallId: string;
  toolInput: unknown;
  context: ComputerExecutorContext;
  counters: ComputerCounterState;
  /** Part 3：本会话 allow-once 集合（approval 后由 useKiroChat 注入；exact 匹配即消费） */
  oneShotApprovals?: ComputerOneShotApproval[];
}): Promise<ComputerExecutionAttempt> {
  const { toolName, toolCallId, toolInput, context, counters, oneShotApprovals } = request;
  const { turnSnapshot, liveWorkspaces, livePermissionRules } = context;

  const definition = COMPUTER_TOOLS.find((t) => t.name === toolName);
  if (!definition) {
    return {
      kind: "completed",
      output: { ok: false, code: "PERMISSION_DENIED", message: `未知 Computer 工具：${toolName}` },
    };
  }

  // 调用限制（独立于总工具计数；ask 不消耗，resume 执行时才计入）
  if (definition.mutation) {
    if (counters.mutationCount >= COMPUTER_MUTATION_LIMIT_PER_TURN) {
      return {
        kind: "completed",
        output: { ok: false, code: "PERMISSION_DENIED", message: "本轮修改操作已达上限" },
      };
    }
  } else if (counters.readCount >= COMPUTER_READ_LIMIT_PER_TURN) {
    return {
      kind: "completed",
      output: { ok: false, code: "PERMISSION_DENIED", message: "本轮读取操作已达上限" },
    };
  }

  // schema 校验
  const parsed = definition.schema.safeParse(toolInput);
  if (!parsed.success) {
    return {
      kind: "completed",
      output: { ok: false, code: "INVALID_INPUT", message: "输入不合法" },
    };
  }
  const args = parsed.data as Record<string, unknown>;

  const ws = resolveSnapshotWorkspace(turnSnapshot, liveWorkspaces);

  try {
    // 无资源工具：list_workspace_roots
    if (toolName === "list_workspace_roots") {
      counters.readCount += 1;
      return {
        kind: "completed",
        output: {
          ok: true,
          data: {
            workspaceId: ws.id,
            workspaceLabel: ws.name,
            roots: ws.roots.map((r) => ({ id: r.id, label: r.label, access: r.access })),
          },
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

    // deny：approval 绝不能绕过（policy effect 权威；Part 2 guided patch 特判已删除）
    if (policy.effect === "deny") {
      return {
        kind: "completed",
        output: { ok: false, code: "PERMISSION_DENIED", message: policy.reason },
      };
    }

    // ask：无匹配 allow-once → approval-required（NO IO / NO mutation count / NO Tool Output）
    if (policy.effect === "ask") {
      if (oneShotApprovals && oneShotApprovals.length > 0) {
        const idx = oneShotApprovals.findIndex((o) =>
          oneShotApprovalMatches(o, {
            toolCallId,
            capability: definition.capability,
            workspaceId: resource.workspaceId,
            rootId: resource.rootId,
            relativePath: normalized,
          })
        );
        if (idx !== -1) {
          oneShotApprovals.splice(idx, 1); // 一次消费
        } else {
          return {
            kind: "approval-required",
            request: buildApprovalRequest({
              id: newApprovalId(),
              toolCallId,
              taskId: context.taskId ?? "",
              capability: definition.capability,
              workspaceId: ws.id,
              workspaceLabel: ws.name,
              rootId: root.id,
              rootLabel: root.label,
              relativePath: normalized,
              resourceLabel: normalized.split("/").pop() ?? normalized,
              description: mutationDescription(toolName, normalized),
            }),
          };
        }
      } else {
        return {
          kind: "approval-required",
          request: buildApprovalRequest({
            id: newApprovalId(),
            toolCallId,
            taskId: context.taskId ?? "",
            capability: definition.capability,
            workspaceId: ws.id,
            workspaceLabel: ws.name,
            rootId: root.id,
            rootLabel: root.label,
            relativePath: normalized,
            resourceLabel: normalized.split("/").pop() ?? normalized,
            description: mutationDescription(toolName, normalized),
          }),
        };
      }
    }

    const adapter = getComputerAdapterForAdapterRef(root.adapterRef);

    // ---- READ TOOLS ----
    if (toolName === "list_directory") {
      counters.readCount += 1;
      const items = await adapter.list(normalized);
      return { kind: "completed", output: { ok: true, data: { path: normalized, items } } };
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
      return { kind: "completed", output: { ok: true, data: result } };
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
      return { kind: "completed", output: { ok: true, data: result } };
    }
    if (toolName === "get_file_metadata") {
      counters.readCount += 1;
      const meta = await adapter.stat(normalized);
      return { kind: "completed", output: { ok: true, data: { path: normalized, meta } } };
    }
    if (toolName === "read_text") {
      counters.readCount += 1;
      const content = await adapter.readText(normalized);
      const bounded = applyReadBounds(content, {
        startLine: args.startLine as number | undefined,
        endLine: args.endLine as number | undefined,
        maxChars: args.maxChars as number | undefined,
      });
      return { kind: "completed", output: { ok: true, data: { path: normalized, ...bounded } } };
    }
    if (toolName === "inspect_document") {
      counters.readCount += 1;
      const bytes = await adapter.readBytes(normalized);
      const raw = await adapter.readText(normalized);
      const ext = normalized.split(".").pop()?.toLowerCase();
      const format = ext === "docx" ? ("docx" as const) : ext === "md" ? ("markdown" as const) : null;
      if (!format) {
        return {
          kind: "completed",
          output: { ok: false, code: "UNSUPPORTED_FILE_TYPE", message: "仅支持 Markdown / DOCX 检查" },
        };
      }
      if (format === "markdown") {
        const lines = raw.split("\n");
        return {
          kind: "completed",
          output: {
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
          },
        };
      }
      return {
        kind: "completed",
        output: {
          ok: true,
          data: {
            format,
            characters: raw.length,
            bytes: bytes.byteLength,
          },
        },
      };
    }

    // ---- MUTATION TOOLS ----
    if (toolName === "create_directory") {
      counters.mutationCount += 1;
      const outcome = await adapter.createDirectory(normalized);
      const meta = await adapter.stat(normalized);
      if (!meta) throw new ComputerError("VERIFICATION_FAILED", "创建目录后无法验证");
      const runtime = buildMutationRuntime({
        toolName,
        toolCallId,
        operation: "create",
        resourceType: "directory",
        snapshot: turnSnapshot,
        workspaceLabel: ws.name,
        root,
        relativePath: normalized,
        review: { kind: "create" },
        inverse: {
          type: "remove-created",
          workspaceId: ws.id,
          rootId: root.id,
          relativePath: normalized,
          resourceType: "directory",
        },
      });
      return {
        kind: "completed",
        output: {
          ok: true,
          data: { path: normalized, outcome: outcome === "created" ? "created" : "exists", verified: true },
        },
        runtime,
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
      const runtime = buildMutationRuntime({
        toolName,
        toolCallId,
        operation: "create",
        resourceType: "text",
        snapshot: turnSnapshot,
        workspaceLabel: ws.name,
        root,
        relativePath: normalized,
        size: new TextEncoder().encode(content).byteLength,
        review: { kind: "create", preview: content.slice(0, 2000) },
        inverse: {
          type: "remove-created",
          workspaceId: ws.id,
          rootId: root.id,
          relativePath: normalized,
          resourceType: "file",
        },
      });
      return {
        kind: "completed",
        output: { ok: true, data: { path: normalized, verified: true } },
        runtime,
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
      const canUndo = current.length <= COMPUTER_PATCH_UNDO_LIMIT_BYTES;
      const runtime = buildMutationRuntime({
        toolName,
        toolCallId,
        operation: "modify",
        resourceType: "text",
        snapshot: turnSnapshot,
        workspaceLabel: ws.name,
        root,
        relativePath: normalized,
        changeCount,
        review: {
          kind: "text-patch",
          edits: edits.map((e) => ({ before: e.oldText, after: e.newText })),
        },
        inverse: canUndo
          ? {
              type: "restore-text",
              workspaceId: ws.id,
              rootId: root.id,
              relativePath: normalized,
              beforeText: current,
            }
          : undefined,
      });
      return {
        kind: "completed",
        output: { ok: true, data: { path: normalized, changeCount, verified: true } },
        runtime,
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
        const runtime = buildMutationRuntime({
          toolName,
          toolCallId,
          operation: "create",
          resourceType: "document",
          snapshot: turnSnapshot,
          workspaceLabel: ws.name,
          root,
          relativePath: normalized,
          format: "markdown",
          size: new TextEncoder().encode(markdown).byteLength,
          review: {
            kind: "document",
            title: facts.title,
            headings: documentHeadings(document),
            paragraphs: facts.paragraphs,
            lists: facts.lists,
            tables: facts.tables,
            codeBlocks: facts.codeBlocks,
            characters: facts.characters,
          },
          inverse: {
            type: "remove-created",
            workspaceId: ws.id,
            rootId: root.id,
            relativePath: normalized,
            resourceType: "file",
          },
        });
        return {
          kind: "completed",
          output: { ok: true, data: { path: normalized, format: "markdown", verified: true } },
          runtime,
        };
      }
      if (ext === "docx") {
        const existing = await adapter.stat(normalized);
        if (existing) throw new ComputerError("RESOURCE_ALREADY_EXISTS", `文件已存在：${normalized}`);
        const bytes = await renderDocx(document);
        await adapter.writeBytes(
          normalized,
          bytes,
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        const readBack = await adapter.readBytes(normalized);
        if (!(await verifyDocxBytes(readBack))) {
          throw new ComputerError("VERIFICATION_FAILED", "DOCX 校验失败");
        }
        const facts = inspectDocumentFacts(document, "docx");
        const runtime = buildMutationRuntime({
          toolName,
          toolCallId,
          operation: "create",
          resourceType: "document",
          snapshot: turnSnapshot,
          workspaceLabel: ws.name,
          root,
          relativePath: normalized,
          format: "docx",
          size: bytes.byteLength,
          review: {
            kind: "document",
            title: facts.title,
            headings: documentHeadings(document),
            paragraphs: facts.paragraphs,
            lists: facts.lists,
            tables: facts.tables,
            codeBlocks: facts.codeBlocks,
            characters: facts.characters,
          },
          inverse: {
            type: "remove-created",
            workspaceId: ws.id,
            rootId: root.id,
            relativePath: normalized,
            resourceType: "file",
          },
        });
        return {
          kind: "completed",
          output: { ok: true, data: { path: normalized, format: "docx", verified: true } },
          runtime,
        };
      }
      return {
        kind: "completed",
        output: { ok: false, code: "UNSUPPORTED_FILE_TYPE", message: "仅支持 .md / .docx 文档" },
      };
    }

    return {
      kind: "completed",
      output: { ok: false, code: "PERMISSION_DENIED", message: `未实现的 Computer 工具：${toolName}` },
    };
  } catch (err) {
    if (err instanceof ComputerError) {
      return { kind: "completed", output: { ok: false, code: err.code, message: err.message } };
    }
    return {
      kind: "completed",
      output: {
        ok: false,
        code: "UNKNOWN",
        message: err instanceof Error ? err.message : "未知错误",
      },
    };
  }
}

function mutationDescription(toolName: string, path: string): string {
  switch (toolName) {
    case "create_text_file":
      return `创建文件 ${path}`;
    case "create_directory":
      return `创建目录 ${path}`;
    case "patch_text_file":
      return `修改文件 ${path}`;
    case "create_document":
      return `生成文档 ${path}`;
    default:
      return path;
  }
}

/** 从 Document IR 收集 heading 文本（review 结构事实；runtime 侧，非模型总结） */
function documentHeadings(document: Parameters<typeof renderMarkdown>[0]): string[] {
  const out: string[] = [];
  for (const block of document.blocks) {
    if (block.type === "heading") {
      out.push(block.content?.map((r) => r.text).join("") ?? "");
    }
  }
  return out;
}

/** 构建 verified mutation 的 runtime-only 事实（change + inverse）；inverse 缺失 → canUndo=false */
function buildMutationRuntime(input: {
  toolName: string;
  toolCallId: string;
  operation: "create" | "modify";
  resourceType: "directory" | "text" | "document";
  snapshot: KiroComputerTurnSnapshot;
  workspaceLabel: string;
  root: { id: string; label: string };
  relativePath: string;
  format?: "markdown" | "docx";
  size?: number;
  changeCount?: number;
  review: KiroComputerChange["review"];
  inverse?: ComputerInverseOperation;
}): ComputerRuntimeMutation {
  const change: KiroComputerChange = {
    id: `change-${crypto.randomUUID()}`,
    toolCallId: input.toolCallId,
    operation: input.operation,
    resourceType: input.resourceType,
    workspaceId: input.snapshot.workspaceId ?? "",
    workspaceLabel: input.workspaceLabel,
    rootId: input.root.id,
    rootLabel: input.root.label,
    relativePath: input.relativePath,
    displayName: input.relativePath.split("/").pop() ?? input.relativePath,
    format: input.format,
    size: input.size,
    changeCount: input.changeCount,
    verification: "passed",
    review: input.review,
  };
  return {
    change,
    inverse: input.inverse,
  };
}
