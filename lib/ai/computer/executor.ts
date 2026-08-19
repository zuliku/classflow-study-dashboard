import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import {
  ComputerPermissionRule,
  KiroWorkspaceMeta,
  LogicalComputerResource,
  ComputerCapability,
  ComputerPermissionEffect,
  KiroWorkspaceRootMeta,
} from "@/lib/ai/computer/types";
import { ComputerError } from "@/lib/ai/computer/errors";
import { normalizeRelativeComputerPath, resolveToolRootId } from "@/lib/ai/computer/workspace/resolver";
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
import { executeKiroTerminalCommand, writeKiroTerminalInput, startKiroTerminalCommand, waitKiroTerminalCommand } from "@/lib/ai/computer/terminal/executor";
import { createKiroPtySession, runKiroPtySessionCommand, writeKiroPtySessionInput, closeKiroPtySession } from "@/lib/ai/computer/terminal/ptyAgent";
import { TerminalActivityInit } from "@/lib/ai/computer/terminal/activity";
import { DesktopTerminalEvent } from "@/lib/desktop/types";
import { getComputerAdapterForAdapterRef } from "@/lib/ai/computer/adapters/factory";
import {
  applyReadBounds,
  searchFiles,
  grepFiles,
  applyExactPatches,
  normalizeScopePath,
} from "@/lib/ai/computer/filesystem/search";
import { renderMarkdown } from "@/lib/ai/computer/documents/markdown";
import { renderDocx } from "@/lib/ai/computer/documents/docx";
import { verifyMarkdownWritten, verifyDocxBytes, verifyRenderedDocx, inspectDocumentFacts } from "@/lib/ai/computer/documents/verify";
import { mergeDocumentStyleForUpdate } from "@/lib/ai/computer/documents/styles/resolve";
import { parseDocumentAuthoringInput } from "@/lib/ai/computer/documents/authoring/compat";
import { CURRENT_DOCUMENT_AUTHORING_VERSION } from "@/lib/ai/computer/documents/authoring/protocol";
import { isKiroDocument } from "@/lib/ai/computer/documents/types";
import { isStructuredBinaryPath } from "@/lib/ai/computer/filesystem/fileTypes";
import { performFileDeletion } from "@/lib/ai/computer/filesystem/deleteFile";
import {
  registerCreatedArtifact,
  adoptWorkspaceArtifact,
  findArtifactByLocation,
  updateArtifactLocation,
  getEditableArtifactRevisionState,
  commitArtifactRevision,
  getArtifactSource,
  commitGenericArtifactRevision,
} from "@/lib/ai/computer/artifacts/service";
import { KiroArtifact } from "@/lib/ai/computer/artifacts/types";
import { DocumentFileSnapshot } from "@/lib/ai/computer/checkpoints";
import { relocateFile } from "@/lib/ai/computer/filesystem/relocate";
import { GENERIC_ARTIFACT_PATCH_UNDO_LIMIT_BYTES } from "@/lib/ai/computer/genericArtifactPatchUndo";
import { markWorkspaceKnowledgeDirty, refreshWorkspaceKnowledge, getWorkspaceKnowledgeStatus, queryWorkspaceKnowledge } from "@/lib/ai/computer/knowledge/service";
import { retrieveWorkspaceContext } from "@/lib/ai/computer/knowledge/retrieval";
import {
  KIRO_KNOWLEDGE_SEARCH_DEFAULT_RESULTS,
  KIRO_KNOWLEDGE_SEARCH_MAX_RESULTS,
  KiroKnowledgeContentType,
  KiroKnowledgeIndexState,
  KiroKnowledgeSearchResult,
} from "@/lib/ai/computer/knowledge/types";
import { KiroComputerChange } from "@/lib/ai/computer/task";
import { ComputerInverseOperation } from "@/lib/ai/computer/checkpoints";

export const COMPUTER_READ_LIMIT_PER_TURN = 12;
// V2.7.2：6 → 10（一次真实任务如「整理工作区/删除多个旧文件」常需连续写操作；
// 上限仍保证单轮有界，超限拒绝带计数、可审计）
export const COMPUTER_MUTATION_LIMIT_PER_TURN = 10;

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** V2 Part 2：文档结构化更新上限（保证 exact 回滚/Undo 快照有界） */
export const COMPUTER_DOCUMENT_REVISION_LIMIT_BYTES = 5 * 1024 * 1024;

/** Patch Undo before-text 上限（超限 → canUndo=false，不保留 checkpoint 快照） */
export const COMPUTER_PATCH_UNDO_LIMIT_BYTES = GENERIC_ARTIFACT_PATCH_UNDO_LIMIT_BYTES;

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
  /** Desktop Terminal V1：独立预算（git status ≠ filesystem read；npm test ≠ mutation） */
  terminalCount: number;
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
 * Document 结构校验失败 → 版本感知的有界错误（V2.3）。
 * 只给模型「当前 Tool Contract 的字段路径 + 期望类型」（最多 3 条）；
 * 不提 IR / Canonical / 内部转换（模型只需要遵守当前 Tool Contract，不应自我诊断实现）。
 */
function buildDocumentProtocolMismatchMessage(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  const lines: string[] = [];
  for (const issue of issues.slice(0, 3)) {
    const path = issue.path.map((p) => String(p)).join(".");
    lines.push(`${path || "document"}: ${issue.message}`);
  }
  return `文档结构不符合当前创建协议：${lines.join("；")}。请严格使用当前 create_document 工具提供的字段格式；最多允许一次结构修正。`;
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
  /** Terminal V2 streaming：活动注册 + sanitized 事件（UI-only） */
  onTerminalActivityInit?: (init: TerminalActivityInit) => void;
  onTerminalEvent?: (event: DesktopTerminalEvent) => void;
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

  // Desktop Terminal V1/V2：独立预算（terminalCount；不走 filesystem read/mutation 计数）
  if (toolName === "run_terminal_command") {
    return executeKiroTerminalCommand({
      toolCallId,
      toolInput: (toolInput ?? {}) as Record<string, unknown>,
      snapshot: turnSnapshot,
      liveWorkspaces,
      livePermissionRules,
      counters: counters as ComputerCounterState,
      oneShotApprovals: oneShotApprovals ?? [],
      taskId: context.taskId ?? "",
      onTerminalActivityInit: request.onTerminalActivityInit,
      onTerminalEvent: request.onTerminalEvent,
    });
  }

  // Desktop Terminal V2（Phase 3）：受控 stdin write（不启动新进程；不消耗 terminalCount）
  if (toolName === "write_terminal_input") {
    return writeKiroTerminalInput({
      toolCallId,
      toolInput: (toolInput ?? {}) as Record<string, unknown>,
      snapshot: turnSnapshot,
      liveWorkspaces,
      livePermissionRules,
      counters: counters as ComputerCounterState,
      oneShotApprovals: oneShotApprovals ?? [],
      taskId: context.taskId ?? "",
    });
  }

  if (toolName === "start_terminal_command") {
    return startKiroTerminalCommand({
      toolCallId,
      toolInput: (toolInput ?? {}) as Record<string, unknown>,
      snapshot: turnSnapshot,
      liveWorkspaces,
      livePermissionRules,
      counters: counters as ComputerCounterState,
      oneShotApprovals: oneShotApprovals ?? [],
      taskId: context.taskId ?? "",
      onTerminalActivityInit: request.onTerminalActivityInit,
      onTerminalEvent: request.onTerminalEvent,
    });
  }

  if (toolName === "wait_terminal_command") {
    return waitKiroTerminalCommand({
      toolCallId,
      toolInput: (toolInput ?? {}) as Record<string, unknown>,
      snapshot: turnSnapshot,
      liveWorkspaces,
      livePermissionRules,
      counters: counters as ComputerCounterState,
      oneShotApprovals: oneShotApprovals ?? [],
      taskId: context.taskId ?? "",
    });
  }

  if (toolName === "create_terminal_session") {
    return createKiroPtySession({
      toolCallId,
      toolInput: (toolInput ?? {}) as Record<string, unknown>,
      snapshot: turnSnapshot,
      liveWorkspaces,
      livePermissionRules,
      counters: counters as ComputerCounterState,
      oneShotApprovals: oneShotApprovals ?? [],
      taskId: context.taskId ?? "",
    });
  }

  if (toolName === "run_terminal_session_command") {
    return runKiroPtySessionCommand({
      toolCallId,
      toolInput: (toolInput ?? {}) as Record<string, unknown>,
      snapshot: turnSnapshot,
      liveWorkspaces,
      livePermissionRules,
      counters: counters as ComputerCounterState,
      oneShotApprovals: oneShotApprovals ?? [],
      taskId: context.taskId ?? "",
    });
  }

  if (toolName === "write_terminal_session_input") {
    return writeKiroPtySessionInput({
      toolCallId,
      toolInput: (toolInput ?? {}) as Record<string, unknown>,
      snapshot: turnSnapshot,
      liveWorkspaces,
      livePermissionRules,
      counters: counters as ComputerCounterState,
      oneShotApprovals: oneShotApprovals ?? [],
      taskId: context.taskId ?? "",
    });
  }

  if (toolName === "close_terminal_session") {
    return closeKiroPtySession({
      toolCallId,
      toolInput: (toolInput ?? {}) as Record<string, unknown>,
      snapshot: turnSnapshot,
      liveWorkspaces,
      livePermissionRules,
      counters: counters as ComputerCounterState,
      oneShotApprovals: oneShotApprovals ?? [],
      taskId: context.taskId ?? "",
    });
  }

  // 调用限制（独立于总工具计数；ask 不消耗，resume 执行时才计入）
  if (definition.mutation) {
    if (counters.mutationCount >= COMPUTER_MUTATION_LIMIT_PER_TURN) {
      return {
        kind: "completed",
        output: {
          ok: false,
          code: "PERMISSION_DENIED",
          message: `本轮修改操作已达上限（${COMPUTER_MUTATION_LIMIT_PER_TURN}/${COMPUTER_MUTATION_LIMIT_PER_TURN}），请分步进行或开启新对话`,
        },
      };
    }
  } else if (counters.readCount >= COMPUTER_READ_LIMIT_PER_TURN) {
    return {
      kind: "completed",
      output: { ok: false, code: "PERMISSION_DENIED", message: "本轮读取操作已达上限" },
    };
  }

  // V2.3：Text-file 工具结构化二进制守卫（runtime 第二层；schema refine 是 model-facing 第一层）。
  // 返回权威 code UNSUPPORTED_FILE_TYPE —— 模型绝不能用文本工具伪造 DOCX/PDF/XLSX/PPTX。
  if (
    (toolName === "create_text_file" || toolName === "patch_text_file") &&
    typeof (toolInput as { path?: unknown } | null)?.path === "string" &&
    isStructuredBinaryPath(String((toolInput as { path?: unknown }).path))
  ) {
    return {
      kind: "completed",
      output: {
        ok: false,
        code: "UNSUPPORTED_FILE_TYPE",
        message: "该格式不能通过文本文件工具创建或修改。Word 文档必须使用 create_document / update_document。",
      },
    };
  }

  // schema 校验（V2.3：document 类工具的 runtime schema 只校验 path/artifactId 外层，
  // document 由 create/update 分支的 parseDocumentAuthoringInput 严格双兼容校验）
  const parsed = definition.schema.safeParse(toolInput);
  if (!parsed.success) {
    const message =
      toolName === "create_document" || toolName === "update_document"
        ? buildDocumentProtocolMismatchMessage(parsed.error.issues as { path: PropertyKey[]; message: string }[])
        : "输入不合法";
    return {
      kind: "completed",
      output: { ok: false, code: "INVALID_INPUT", message },
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

    // ---- V3 Part 1：search_workspace_knowledge（multi-root read tool；专用 branch）----
    if (toolName === "search_workspace_knowledge") {
      const query = String(args.query);
      const maxResults = args.maxResults === undefined ? KIRO_KNOWLEDGE_SEARCH_DEFAULT_RESULTS : Number(args.maxResults);
      // 1. requested roots（缺省 = frozen snapshot roots 顺序）；必须同时存在于 frozen snapshot 与 live Workspace
      const requestedRootIds =
        Array.isArray(args.rootIds) && args.rootIds.length > 0
          ? (args.rootIds as string[])
          : turnSnapshot.roots.map((r) => r.id);
      for (const rootId of requestedRootIds) {
        const inSnapshot = turnSnapshot.roots.some((r) => r.id === rootId);
        const inLive = ws.roots.some((r) => r.id === rootId);
        if (!inSnapshot || !inLive) {
          return {
            kind: "completed",
            output: { ok: false, code: "ROOT_NOT_FOUND", message: `知识索引 root 不存在：${rootId}` },
          };
        }
      }
      // 2-6. 每个 requested root 评估当前 fs.search policy（root scope "."）
      for (const rootId of requestedRootIds) {
        const policy = prepareComputerTool({
          mode: turnSnapshot.agentMode,
          rules: livePermissionRules,
          workspace: ws,
          capability: "fs.search",
          resource: { workspaceId: ws.id, rootId, path: "" },
        });
        if (policy.effect === "deny") {
          return {
            kind: "completed",
            output: { ok: false, code: "PERMISSION_DENIED", message: policy.reason },
          };
        }
        if (policy.effect === "ask") {
          const matchedOneShot =
            oneShotApprovals && oneShotApprovals.length > 0
              ? oneShotApprovals.findIndex((o) =>
                  oneShotApprovalMatches(o, {
                    toolCallId,
                    capability: "fs.search",
                    workspaceId: ws.id,
                    rootId,
                    relativePath: "",
                  })
                )
              : -1;
          if (matchedOneShot === -1) {
            return {
              kind: "approval-required",
              request: buildApprovalRequest({
                id: newApprovalId(),
                toolCallId,
                taskId: context.taskId ?? "",
                capability: "fs.search",
                workspaceId: ws.id,
                workspaceLabel: ws.name,
                rootId,
                rootLabel: ws.roots.find((r) => r.id === rootId)?.label ?? rootId,
                relativePath: "",
                resourceLabel: ws.roots.find((r) => r.id === rootId)?.label ?? rootId,
                description: `搜索工作区知识（root: ${rootId}）`,
              }),
            };
          }
          oneShotApprovals!.splice(matchedOneShot, 1);
        }
      }

      // 真正开始执行搜索：readCount 恰好 +1（内部 refresh/扫描不额外计数）
      counters.readCount += 1;

      // 7-8. 首次无索引 → bounded initial refresh；dirty → bounded incremental refresh
      const state = await getWorkspaceKnowledgeStatus(ws.id);
      let indexState: KiroKnowledgeIndexState;
      let partial = false;
      if (!state) {
        try {
          const refreshed = await refreshWorkspaceKnowledge({
            workspace: ws,
            mode: "incremental",
            agentMode: turnSnapshot.agentMode,
            permissionRules: livePermissionRules,
            getAdapter: getComputerAdapterForAdapterRef,
          });
          indexState = refreshed.partial ? "partial" : "ready";
          partial = refreshed.partial;
        } catch {
          indexState = "unavailable";
        }
      } else {
        if (state.dirty) {
          try {
            const refreshed = await refreshWorkspaceKnowledge({
              workspace: ws,
              mode: "incremental",
              agentMode: turnSnapshot.agentMode,
              permissionRules: livePermissionRules,
              getAdapter: getComputerAdapterForAdapterRef,
            });
            indexState = refreshed.partial ? "partial" : "ready";
            partial = refreshed.partial;
          } catch {
            indexState = "stale"; // 有旧缓存
          }
        } else {
          indexState = state.partial ? "partial" : "ready";
          partial = state.partial;
        }
      }

      // 9. 本地查询
      let candidates: Array<{ result: KiroKnowledgeSearchResult; metadataScore: number; contentScore: number; snippet?: string }>;
      try {
        const scored = await queryWorkspaceKnowledge({
          workspaceId: ws.id,
          query,
          rootIds: requestedRootIds,
          maxResults: KIRO_KNOWLEDGE_SEARCH_MAX_RESULTS,
        });
        candidates = scored;
      } catch {
        candidates = [];
        if (indexState === "ready" || indexState === "partial") indexState = "stale";
      }
      if (indexState === "unavailable" && candidates.length === 0) {
        return {
          kind: "completed",
          output: { ok: false, code: "UNSUPPORTED_BROWSER", message: "知识索引暂不可用" },
        };
      }

      // 10. current-access filtering：每个候选重新计算 exact-file fs.read
      const results: Array<{
        rootId: string;
        path: string;
        title?: string;
        type: KiroKnowledgeContentType;
        snippet?: string;
        score: number;
        matchReasons: string[];
      }> = [];
      for (const candidate of candidates) {
        const root = ws.roots.find((r) => r.id === candidate.result.rootId);
        if (!root) continue;
        const readPolicy = prepareComputerTool({
          mode: turnSnapshot.agentMode,
          rules: livePermissionRules,
          workspace: ws,
          capability: "fs.read",
          resource: { workspaceId: ws.id, rootId: root.id, path: candidate.result.path },
        });
        if (readPolicy.effect === "allow") {
          results.push({
            rootId: candidate.result.rootId,
            path: candidate.result.path,
            title: candidate.result.title,
            type: candidate.result.type,
            snippet: candidate.snippet,
            score: candidate.metadataScore + candidate.contentScore,
            matchReasons: candidate.result.matchReasons,
          });
        } else {
          // ask/deny：去掉正文 evidence；仅 metadataScore
          const metadataReasons = candidate.result.matchReasons.filter(
            (r) => r === "filename" || r === "path" || r === "title"
          );
          if (candidate.metadataScore <= 0 || metadataReasons.length === 0) continue; // 隐藏正文匹配不泄露
          results.push({
            rootId: candidate.result.rootId,
            path: candidate.result.path,
            title: candidate.result.title,
            type: candidate.result.type,
            snippet: undefined,
            score: candidate.metadataScore,
            matchReasons: metadataReasons,
          });
        }
        if (results.length >= Math.min(maxResults, KIRO_KNOWLEDGE_SEARCH_MAX_RESULTS)) break;
      }

      return {
        kind: "completed",
        output: {
          ok: true,
          data: {
            results,
            indexState,
            partial,
          },
        },
      };
    }

    // ---- V3 Part 2：retrieve_workspace_context（Grounded Retrieval；search + live read）----
    if (toolName === "retrieve_workspace_context") {
      const query = String(args.query);
      const maxFiles = args.maxFiles === undefined ? undefined : Number(args.maxFiles);
      const maxChars = args.maxChars === undefined ? undefined : Number(args.maxChars);
      // root 校验：必须同时存在于 frozen snapshot 与 live Workspace
      const requestedRootIds =
        Array.isArray(args.rootIds) && args.rootIds.length > 0
          ? (args.rootIds as string[])
          : turnSnapshot.roots.map((r) => r.id);
      for (const rootId of requestedRootIds) {
        const inSnapshot = turnSnapshot.roots.some((r) => r.id === rootId);
        const inLive = ws.roots.some((r) => r.id === rootId);
        if (!inSnapshot || !inLive) {
          return {
            kind: "completed",
            output: { ok: false, code: "ROOT_NOT_FOUND", message: `检索 root 不存在：${rootId}` },
          };
        }
      }
      // 候选发现权限：逐 requested root 评估 fs.search（ask → 现有 approval lifecycle，零 quota/零 IO）
      for (const rootId of requestedRootIds) {
        const policy = prepareComputerTool({
          mode: turnSnapshot.agentMode,
          rules: livePermissionRules,
          workspace: ws,
          capability: "fs.search",
          resource: { workspaceId: ws.id, rootId, path: "" },
        });
        if (policy.effect === "deny") {
          return {
            kind: "completed",
            output: { ok: false, code: "PERMISSION_DENIED", message: policy.reason },
          };
        }
        if (policy.effect === "ask") {
          const matchedOneShot =
            oneShotApprovals && oneShotApprovals.length > 0
              ? oneShotApprovals.findIndex((o) =>
                  oneShotApprovalMatches(o, {
                    toolCallId,
                    capability: "fs.search",
                    workspaceId: ws.id,
                    rootId,
                    relativePath: "",
                  })
                )
              : -1;
          if (matchedOneShot === -1) {
            return {
              kind: "approval-required",
              request: buildApprovalRequest({
                id: newApprovalId(),
                toolCallId,
                taskId: context.taskId ?? "",
                capability: "fs.search",
                workspaceId: ws.id,
                workspaceLabel: ws.name,
                rootId,
                rootLabel: ws.roots.find((r) => r.id === rootId)?.label ?? rootId,
                relativePath: "",
                resourceLabel: ws.roots.find((r) => r.id === rootId)?.label ?? rootId,
                description: `检索工作区上下文（root: ${rootId}）`,
              }),
            };
          }
          oneShotApprovals!.splice(matchedOneShot, 1);
        }
      }

      // 真正执行：readCount 恰好 +1（内部候选/文件读取不单独计数）
      counters.readCount += 1;

      const pack = await retrieveWorkspaceContext({
        workspace: ws,
        agentMode: turnSnapshot.agentMode,
        permissionRules: livePermissionRules,
        getAdapter: getComputerAdapterForAdapterRef,
        query,
        rootIds: requestedRootIds,
        maxFiles,
        maxChars,
      });
      return {
        kind: "completed",
        output: {
          ok: true,
          data: pack,
        },
      };
    }

    // ---- V2.5+V2.8：delete_file（在 resource 构造之前拦截：root 安全解析 + 两阶段删除语义）----
    // rootId 可选：single-root Workspace 可省略；multi-root 省略 → ROOT_REQUIRED（绝不默认 roots[0]）。
    if (toolName === "delete_file") {
      const normalized = normalizeRelativeComputerPath(String(args.path ?? "")).path;
      const resolvedRoot = resolveToolRootId({
        rootId: typeof args.rootId === "string" && args.rootId.trim() ? args.rootId : undefined,
        snapshotRoots: turnSnapshot.roots,
        workspace: ws,
      });
      const deleteRoot = ws.roots.find((r) => r.id === resolvedRoot.rootId);
      if (!deleteRoot) throw new ComputerError("ROOT_NOT_FOUND", `工作区根不存在：${resolvedRoot.rootId}`);

      const policy = prepareComputerTool({
        mode: turnSnapshot.agentMode,
        rules: livePermissionRules,
        workspace: ws,
        capability: "fs.delete",
        resource: { workspaceId: ws.id, rootId: deleteRoot.id, path: normalized },
      });
      if (policy.effect === "deny") {
        return { kind: "completed", output: { ok: false, code: "PERMISSION_DENIED", message: policy.reason } };
      }
      if (policy.effect === "ask") {
        const matchedOneShot =
          oneShotApprovals && oneShotApprovals.length > 0
            ? oneShotApprovals.findIndex((o) =>
                oneShotApprovalMatches(o, {
                  toolCallId,
                  capability: "fs.delete",
                  workspaceId: ws.id,
                  rootId: deleteRoot.id,
                  relativePath: normalized,
                })
              )
            : -1;
        if (matchedOneShot === -1) {
          return {
            kind: "approval-required",
            request: buildApprovalRequest({
              id: newApprovalId(),
              toolCallId,
              taskId: context.taskId ?? "",
              capability: "fs.delete",
              workspaceId: ws.id,
              workspaceLabel: ws.name,
              rootId: deleteRoot.id,
              rootLabel: deleteRoot.label,
              relativePath: normalized,
              resourceLabel: normalized.split("/").pop() ?? normalized,
              description: `删除文件 ${normalized}（删除后无法通过 Kiro 撤销）`,
            }),
          };
        }
        oneShotApprovals!.splice(matchedOneShot, 1); // 一次消费（resume 时重新评估 policy）
      }

      // 即将开始真实 filesystem mutation：只在此计数一次
      counters.mutationCount += 1;

      // 两阶段删除：filesystem core mutation 成功 = 删除成功（ok:true）；
      // Artifact/Knowledge post-sync 失败 → warning（绝不把成功删除报告成未删除）
      const deletion = await performFileDeletion({
        workspace: ws,
        rootId: deleteRoot.id,
        relativePath: normalized,
      });

      // destructive / no Undo（不注册 inverse；Approval 已明确「删除后无法通过 Kiro 撤销」）
      const runtime = buildMutationRuntime({
        toolName,
        toolCallId,
        operation: "delete",
        resourceType: "text",
        snapshot: turnSnapshot,
        workspaceLabel: ws.name,
        root: deleteRoot,
        relativePath: normalized,
        review: { kind: "create" },
      });
      const outputData: Record<string, unknown> = {
        path: normalized,
        verified: true,
        fileDeleted: true,
        rootId: deleteRoot.id,
      };
      if (deletion.warnings && deletion.warnings.length > 0) {
        outputData.warnings = deletion.warnings;
      }
      return { kind: "completed", output: { ok: true, data: outputData }, runtime };
    }

    // 资源工具：workspace/root/path
    const resource: LogicalComputerResource = {
      workspaceId: ws.id,
      rootId: String(args.rootId ?? ws.roots[0]?.id ?? ""),
      path: String(args.path ?? ""),
    };
    if (!resource.rootId) throw new ComputerError("ROOT_NOT_FOUND", "未指定工作区根目录");
    const root = findRoot(ws, resource);

    // ---- V2 Relocation：rename_file / move_file（双资源 policy：source + destination 各自评估）----
    if (toolName === "rename_file" || toolName === "move_file") {
      const sourcePath = normalizeRelativeComputerPath(resource.path).path;
      let destRoot: KiroWorkspaceRootMeta;
      let destinationPath: string;
      if (toolName === "rename_file") {
        destRoot = root;
        const newName = String(args.newName);
        if (!isValidRenameBasename(newName)) {
          return {
            kind: "completed",
            output: {
              ok: false,
              code: "INVALID_INPUT",
              message: "newName 必须是合法文件名（不允许路径分隔符、. / .. 或系统保留名）。",
            },
          };
        }
        destinationPath = buildRenameTargetPath(sourcePath, newName);
      } else {
        destinationPath = normalizeRelativeComputerPath(String(args.destinationPath)).path;
        const destinationRootId = String(args.destinationRootId);
        const foundDestRoot = ws.roots.find((r) => r.id === destinationRootId);
        if (!foundDestRoot) throw new ComputerError("ROOT_NOT_FOUND", `目标根目录不存在：${destinationRootId}`);
        destRoot = foundDestRoot;
      }

      // 双资源 policy：source（fs.move @ source root/path）+ destination（fs.move @ dest root/path）。
      // 任意 deny → deny（destination deny 不能被 source allow 绕过）；否则任意 ask → ask；否则 allow。
      const sourcePolicy = prepareComputerTool({
        mode: turnSnapshot.agentMode,
        rules: livePermissionRules,
        workspace: ws,
        capability: "fs.move",
        resource: { ...resource, path: sourcePath },
      });
      const destPolicy = prepareComputerTool({
        mode: turnSnapshot.agentMode,
        rules: livePermissionRules,
        workspace: ws,
        capability: "fs.move",
        resource: { workspaceId: ws.id, rootId: destRoot.id, path: destinationPath },
      });
      const combined = combineRelocationPolicies(sourcePolicy, destPolicy);

      if (combined === "deny") {
        return {
          kind: "completed",
          output: {
            ok: false,
            code: "PERMISSION_DENIED",
            message: sourcePolicy.effect === "deny" ? sourcePolicy.reason : destPolicy.reason,
          },
        };
      }
      if (combined === "ask") {
        const matchedOneShot =
          oneShotApprovals && oneShotApprovals.length > 0
            ? oneShotApprovals.findIndex((o) =>
                oneShotApprovalMatches(o, {
                  toolCallId,
                  capability: "fs.move",
                  workspaceId: resource.workspaceId,
                  rootId: resource.rootId,
                  relativePath: sourcePath,
                })
              )
            : -1;
        if (matchedOneShot === -1) {
          const description =
            toolName === "rename_file"
              ? `重命名 ${sourcePath} → ${destinationPath}`
              : `移动 ${sourcePath} → ${destinationPath}`;
          return {
            kind: "approval-required",
            request: buildApprovalRequest({
              id: newApprovalId(),
              toolCallId,
              taskId: context.taskId ?? "",
              capability: "fs.move",
              workspaceId: ws.id,
              workspaceLabel: ws.name,
              rootId: root.id,
              rootLabel: root.label,
              relativePath: sourcePath,
              resourceLabel: sourcePath.split("/").pop() ?? sourcePath,
              description,
            }),
          };
        }
        oneShotApprovals!.splice(matchedOneShot, 1); // 一次消费（resume 时重新评估双 policy）
      }

      // Artifact：relocation 前按源位置查找（filesystem 是事实来源；找不到也允许移动）
      const artifact = await findArtifactByLocation(ws.id, root.id, sourcePath);
      const sourceAdapter = getComputerAdapterForAdapterRef(root.adapterRef);
      const destAdapter = getComputerAdapterForAdapterRef(destRoot.adapterRef);
      // 只在真正开始 filesystem relocation 前计数一次（approval/preflight 不消耗；resume 也不重复）
      counters.mutationCount += 1;
      if (root.adapterRef === destRoot.adapterRef) {
        await sourceAdapter.move(sourcePath, destinationPath);
      } else {
        await relocateFile({
          source: sourceAdapter,
          sourcePath,
          destination: destAdapter,
          destinationPath,
        });
      }
      // filesystem verify 成功后同步 Artifact 位置（保持 id 与 revision）
      let artifactId: string | undefined;
      if (artifact) {
        try {
          const updated = await updateArtifactLocation(artifact.id, destRoot.id, destinationPath);
          artifactId = updated.id;
        } catch {
          throw new ComputerError("VERIFICATION_FAILED", "文件已移动，但 Artifact Registry 同步失败。");
        }
      }
      const operation = toolName === "rename_file" ? "rename" : "move";
      const runtime = buildMutationRuntime({
        toolName,
        toolCallId,
        operation,
        resourceType: "text",
        snapshot: turnSnapshot,
        workspaceLabel: ws.name,
        root: destRoot,
        relativePath: destinationPath,
        artifactId,
        fromRootId: root.id,
        fromRootLabel: root.label,
        fromRelativePath: sourcePath,
        review: { kind: "relocation" },
        inverse: {
          type: "move-back",
          workspaceId: ws.id,
          fromRootId: root.id,
          fromPath: sourcePath,
          toRootId: destRoot.id,
          toPath: destinationPath,
          artifactId,
        },
      });
      return {
        kind: "completed",

        output: { ok: true, data: { fromPath: sourcePath, path: destinationPath, verified: true } },
        runtime,
      };
    }

    // ---- V2 Part 2：update_document（artifactId → Registry → 正常 resolver/sandbox/policy/grant 链）----
    if (toolName === "update_document") {
      const artifactId = String(args.artifactId);
      const expectedRevision = Number(args.expectedRevision);

      // V2.3：双兼容 parser（Draft V2 → normalize；Canonical V1 → passthrough；都失败 → bounded INVALID_INPUT）
      const parsedDocument = parseDocumentAuthoringInput(args.document);
      if (!parsedDocument.ok) {
        return { kind: "completed", output: { ok: false, code: "INVALID_INPUT", message: buildDocumentProtocolMismatchMessage(parsedDocument.issues) } };
      }
      const document = parsedDocument.value.document;

      // 每次执行都重读 Registry（Approval resume 时 useKiroChat 会用 frozen input 重跑本函数 → 自然重检 revision/location）
      const { artifact, source: previousSource } = await getEditableArtifactRevisionState(artifactId, expectedRevision);

      // Document Engine V2：effective Document IR = previous style + incoming（style 保持语义）。
      // commitArtifactRevision 存储 effective merged IR（不是 raw input）；Undo 继续保存 previous Source IR。
      const effectiveDocument = mergeDocumentStyleForUpdate(
        (previousSource?.document as Parameters<typeof renderMarkdown>[0]) ?? {},
        document
      );
      if (artifact.workspaceId !== ws.id) {
        return {
          kind: "completed",
          output: { ok: false, code: "PERMISSION_DENIED", message: "Artifact 不属于当前 Workspace" },
        };
      }
      const artifactRoot = ws.roots.find((r) => r.id === artifact.rootId);
      if (!artifactRoot) {
        return {
          kind: "completed",
          output: { ok: false, code: "ROOT_NOT_FOUND", message: `Artifact 根目录不存在：${artifact.rootId}` },
        };
      }
      const artifactPath = normalizeRelativeComputerPath(artifact.relativePath).path;

      // 正常 document.modify policy（Plan deny / Guided ask / Workspace Auto allow；explicit deny 权威）
      const policy = prepareComputerTool({
        mode: turnSnapshot.agentMode,
        rules: livePermissionRules,
        workspace: ws,
        capability: "document.modify",
        resource: { workspaceId: ws.id, rootId: artifactRoot.id, path: artifactPath },
      });
      if (policy.effect === "deny") {
        return { kind: "completed", output: { ok: false, code: "PERMISSION_DENIED", message: policy.reason } };
      }
      if (policy.effect === "ask") {
        const matchedOneShot =
          oneShotApprovals && oneShotApprovals.length > 0
            ? oneShotApprovals.findIndex((o) =>
                oneShotApprovalMatches(o, {
                  toolCallId,
                  capability: "document.modify",
                  workspaceId: resource.workspaceId,
                  rootId: artifactRoot.id,
                  relativePath: artifactPath,
                })
              )
            : -1;
        if (matchedOneShot === -1) {
          return {
            kind: "approval-required",
            request: buildApprovalRequest({
              id: newApprovalId(),
              toolCallId,
              taskId: context.taskId ?? "",
              capability: "document.modify",
              workspaceId: ws.id,
              workspaceLabel: ws.name,
              rootId: artifactRoot.id,
              rootLabel: artifactRoot.label,
              relativePath: artifactPath,
              resourceLabel: artifactPath.split("/").pop() ?? artifactPath,
              description: `更新文档 ${artifactPath.split("/").pop() ?? artifactPath}（v${expectedRevision} → v${expectedRevision + 1}）`,
            }),
          };
        }
        oneShotApprovals!.splice(matchedOneShot, 1);
      }

      // 修改前 exact snapshot（runtime-only；≤ 5 MiB 保证回滚/Undo 有界）
      const adapter = getComputerAdapterForAdapterRef(artifactRoot.adapterRef);
      const stat = await adapter.stat(artifactPath);
      if (!stat || stat.kind !== "file") {
        return {
          kind: "completed",
          output: { ok: false, code: "RESOURCE_NOT_FOUND", message: `Artifact 文件不存在：${artifactPath}` },
        };
      }
      if (stat.size > COMPUTER_DOCUMENT_REVISION_LIMIT_BYTES) {
        return {
          kind: "completed",
          output: { ok: false, code: "FILE_TOO_LARGE", message: "文档超过 5 MiB，暂不支持结构化更新" },
        };
      }
      const snapshot: DocumentFileSnapshot =
        artifact.type === "markdown"
          ? { format: "markdown", text: await adapter.readText(artifactPath) }
          : { format: "docx", bytes: await adapter.readBytes(artifactPath) };

      // PHASE：PURE RENDER（不写文件、不计数、不回滚；render 失败 → 直接 DOCUMENT_RENDER_FAILED）
      let rendered: RenderedDocumentWrite;
      try {
        rendered =
          artifact.type === "markdown"
            ? { format: "markdown", text: renderMarkdown(effectiveDocument) }
            : { format: "docx", bytes: await renderDocx(effectiveDocument) };
      } catch {
        return {
          kind: "completed",
          output: { ok: false, code: "DOCUMENT_RENDER_FAILED", message: "文档渲染失败" },
        };
      }

      // 即将开始真实 filesystem mutation：只在此计数一次
      counters.mutationCount += 1;

      // PHASE：write → verify（格式由 artifact.type 决定，模型不能选择）；失败走 exact rollback
      try {
        if (rendered.format === "markdown") {
          await adapter.writeText(artifactPath, rendered.text, "text/markdown");
          const readBack = await adapter.readText(artifactPath);
          if (!(await verifyMarkdownWritten(rendered.text, readBack))) {
            throw new ComputerError("VERIFICATION_FAILED", "Markdown 校验失败");
          }
        } else {
          await adapter.writeBytes(
            artifactPath,
            rendered.bytes,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          );
          const readBack = await adapter.readBytes(artifactPath);
          // Document Engine V2：package 有效 + Mammoth round-trip 与 Source IR 一致
          if (!(await verifyRenderedDocx(readBack, effectiveDocument))) {
            throw new ComputerError("VERIFICATION_FAILED", "DOCX 校验失败");
          }
        }
      } catch (err) {
        // 新文件校验失败 → 恢复 exact 快照；回滚失败 → VERIFICATION_FAILED（状态需人工检查）
        try {
          await rollbackDocumentFile(adapter, artifactPath, snapshot);
        } catch {
          return {
            kind: "completed",
            output: {
              ok: false,
              code: "VERIFICATION_FAILED",
              message: "文档更新失败且回滚未完成，文件/Artifact 状态可能需要人工检查。",
            },
          };
        }
        if (err instanceof ComputerError) {
          return { kind: "completed", output: { ok: false, code: err.code, message: err.message } };
        }
        return { kind: "completed", output: { ok: false, code: "VERIFICATION_FAILED", message: "文档更新失败" } };
      }

      // 文件验证通过后才 commit（原子 metadata + effective Source IR；conflict 也回滚文件）
      let updatedArtifact: KiroArtifact;
      try {
        updatedArtifact = await commitArtifactRevision({ artifactId, expectedRevision, document: effectiveDocument });
      } catch (err) {
        try {
          await rollbackDocumentFile(adapter, artifactPath, snapshot);
        } catch {
          return {
            kind: "completed",
            output: {
              ok: false,
              code: "VERIFICATION_FAILED",
              message: "文档已写入但版本登记失败且回滚未完成，文件/Artifact 状态可能需要人工检查。",
            },
          };
        }
        if (err instanceof ComputerError) {
          return { kind: "completed", output: { ok: false, code: err.code, message: err.message } };
        }
        return {
          kind: "completed",
          output: { ok: false, code: "VERIFICATION_FAILED", message: "Artifact revision 提交失败" },
        };
      }

      // runtime facts（review 来自真实 IR 结构；inverse 供 Undo 精确恢复）
      const format = artifact.type === "markdown" ? ("markdown" as const) : ("docx" as const);
      const facts = inspectDocumentFacts(effectiveDocument, format);
      const runtime = buildMutationRuntime({
        toolName,
        toolCallId,
        operation: "modify",
        resourceType: "document",
        snapshot: turnSnapshot,
        workspaceLabel: ws.name,
        root: artifactRoot,
        relativePath: artifactPath,
        artifactId,
        format,
        revision: updatedArtifact.revision,
        review: {
          kind: "document",
          title: facts.title,
          headings: documentHeadings(effectiveDocument),
          paragraphs: facts.paragraphs,
          lists: facts.lists,
          tables: facts.tables,
          codeBlocks: facts.codeBlocks,
          characters: facts.characters,
        },
        inverse: {
          type: "restore-document-revision",
          workspaceId: ws.id,
          rootId: artifactRoot.id,
          relativePath: artifactPath,
          artifactId,
          previousRevision: expectedRevision,
          expectedCurrentRevision: updatedArtifact.revision,
          previousDocument: previousSource.document,
          snapshot,
        },
      });
      return {
        kind: "completed",
        output: {
          ok: true,
          data: { artifactId, path: artifactPath, format, revision: updatedArtifact.revision, verified: true },
        },
        runtime,
      };
    }

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
      // V2.8：返回 root identity——模型把 list_directory 结果带入 delete/move 时无需猜测 rootId
      return {
        kind: "completed",
        output: { ok: true, data: { rootId: root.id, rootLabel: root.label, path: normalized, items } },
      };
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
      return { kind: "completed", output: { ok: true, data: { rootId: root.id, rootLabel: root.label, ...result } } };
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
      return { kind: "completed", output: { ok: true, data: { rootId: root.id, rootLabel: root.label, ...result } } };
    }
    if (toolName === "get_file_metadata") {
      counters.readCount += 1;
      const meta = await adapter.stat(normalized);
      // V2.8：带 root identity（read → rename/delete 上下文不丢失）
      return { kind: "completed", output: { ok: true, data: { rootId: root.id, rootLabel: root.label, path: normalized, meta } } };
    }
    if (toolName === "read_text") {
      counters.readCount += 1;
      const content = await adapter.readText(normalized);
      const bounded = applyReadBounds(content, {
        startLine: args.startLine as number | undefined,
        endLine: args.endLine as number | undefined,
        maxChars: args.maxChars as number | undefined,
      });
      return {
        kind: "completed",
        output: { ok: true, data: { rootId: root.id, rootLabel: root.label, path: normalized, ...bounded } },
      };
    }
    if (toolName === "inspect_document") {
      counters.readCount += 1;
      const bytes = await adapter.readBytes(normalized);
      const ext = normalized.split(".").pop()?.toLowerCase();
      const format = ext === "docx" ? ("docx" as const) : ext === "md" ? ("markdown" as const) : null;
      if (!format) {
        return {
          kind: "completed",
          output: { ok: false, code: "UNSUPPORTED_FILE_TYPE", message: "仅支持 Markdown / DOCX 检查" },
        };
      }
      if (format === "markdown") {
        const raw = await adapter.readText(normalized);
        const lines = raw.split("\n");
        return {
          kind: "completed",
          output: {
            ok: true,
            data: {
              rootId: root.id,
              rootLabel: root.label,
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
      // DOCX（V2 Part 3）：绝不 readText 二进制；Mammoth raw-text 提取 + 结构事实（优先 Source IR）
      const { extractDocx } = await import("@/lib/ai/attachments/docx");
      let extracted: { text: string; truncated: boolean };
      try {
        extracted = await extractDocx(
          new Blob([bytes.slice().buffer as ArrayBuffer], {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          })
        );
      } catch {
        return {
          kind: "completed",
          output: { ok: false, code: "UNSUPPORTED_FILE_TYPE", message: "无法读取 DOCX 正文" },
        };
      }
      const text = extracted.text.slice(0, 12000);
      const truncated = extracted.truncated || extracted.text.length > 12000;
      const artifact = await findArtifactByLocation(ws.id, root.id, normalized);
      const source = artifact ? await getArtifactSource(artifact.id) : null;
      let facts: { title?: string; headings: number; paragraphs: number; lists: number; tables: number; codeBlocks: number; characters: number };
      if (artifact && source && source.revision === artifact.revision) {
        const inspected = inspectDocumentFacts(source.document, "docx");
        facts = {
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
        facts = {
          title: artifact?.title ?? normalized.split("/").pop() ?? normalized,
          headings: 0,
          paragraphs,
          lists: 0,
          tables: 0,
          codeBlocks: 0,
          characters: text.length,
        };
      }
      return {
        kind: "completed",
        output: {
          ok: true,
          data: {
            rootId: root.id,
            rootLabel: root.label,
            format,
            ...facts,
            bytes: bytes.byteLength,
            text,
            truncated,
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
      void markKnowledgeDirtyBestEffort(ws.id);
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
      // V2：verified create 登记 Artifact（.md → markdown；其它 → text；不保存 Document IR）
      let artifactId: string | undefined;
      try {
        const artifact = await registerCreatedArtifact({
          workspaceId: ws.id,
          rootId: root.id,
          relativePath: normalized,
          type: normalized.toLowerCase().endsWith(".md") ? "markdown" : "text",
          sourceTaskId: context.taskId,
        });
        artifactId = artifact.id;
      } catch {
        // V2.9：事务语义——metadata 登记失败 → 回滚刚创建的文件（绝不留 invisible file）
        let rollbackOk = false;
        try {
          await adapter.remove(normalized, "file");
          const after = await adapter.stat(normalized);
          rollbackOk = after === null;
        } catch {
          rollbackOk = false;
        }
        if (rollbackOk) {
          return {
            kind: "completed",
            output: {
              ok: false,
              code: "VERIFICATION_FAILED",
              message: "文件创建未完成，已回滚，没有留下不可见文件。",
            },
          };
        }
        return {
          kind: "completed",
          output: {
            ok: false,
            code: "VERIFICATION_FAILED",
            message: "文件创建未完成且回滚未完成，文件状态需要重新检查。",
            data: { fileMayExist: true, artifactRegistered: false },
          },
        };
      }
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
          artifactId,
        },
        artifactId,
      });
      return {
        kind: "completed",

        output: { ok: true, data: { path: normalized, verified: true } },
        runtime,
      };
    }
    if (toolName === "patch_text_file") {
      const current = await adapter.readText(normalized);
      const edits = (args.edits as { oldText: string; newText: string }[]).map((e) => ({
        oldText: e.oldText,
        newText: e.newText,
      }));
      // V2 Part 3：Artifact 一致性
      // - Kiro 结构化文档（有匹配 Source IR）→ 拒绝 raw patch，引导 update_document（不计数、不写）
      // - generic 已登记 Artifact（无 Source IR）→ patch 后 Artifact revision +1（原子 metadata）
      const registeredArtifact = await findArtifactByLocation(ws.id, root.id, normalized);
      let artifactId: string | undefined;
      let artifactRevision: number | undefined;
      if (registeredArtifact) {
        artifactId = registeredArtifact.id;
        artifactRevision = registeredArtifact.revision;
        const source = await getArtifactSource(registeredArtifact.id);
        if (source) {
          if (source.revision !== registeredArtifact.revision) {
            return {
              kind: "completed",
              output: { ok: false, code: "ARTIFACT_REVISION_CONFLICT", message: "Artifact 元数据与文档源版本不一致" },
            };
          }
          return {
            kind: "completed",
            output: {
              ok: false,
              code: "ARTIFACT_UNSUPPORTED_OPERATION",
              message: "该文件是 Kiro 结构化文档，请使用 update_document 更新，不能使用原始文本 patch。",
            },
          };
        }
      }
      // 内存中完全计算 patch（写前；不消耗 quota）
      const { content: patched, changeCount } = applyExactPatches(current, edits);
      // 即将开始真实 filesystem mutation
      counters.mutationCount += 1;
      await adapter.writeText(normalized, patched);
      // Verify：read-back exact
      const readBack = await adapter.readText(normalized);
      if (readBack !== patched) throw new ComputerError("VERIFICATION_FAILED", "修改校验失败");

      // generic Artifact：文件验证后提交 metadata revision（+1）；失败 → exact rollback
      let newRevision: number | undefined;
      if (artifactId && artifactRevision !== undefined) {
        try {
          const updated = await commitGenericArtifactRevision({
            artifactId,
            expectedRevision: artifactRevision,
          });
          newRevision = updated.revision;
        } catch (err) {
          try {
            await adapter.writeText(normalized, current);
            const rollbackRead = await adapter.readText(normalized);
            if (rollbackRead !== current) {
              throw new ComputerError("VERIFICATION_FAILED", "Artifact 版本回滚校验失败");
            }
          } catch {
            return {
              kind: "completed",
              output: {
                ok: false,
                code: "VERIFICATION_FAILED",
                message: "文件已修改但 Artifact 版本登记失败且回滚未完成，文件/Artifact 状态可能需要人工检查。",
              },
            };
          }
          if (err instanceof ComputerError) {
            return { kind: "completed", output: { ok: false, code: err.code, message: err.message } };
          }
          return {
            kind: "completed",
            output: { ok: false, code: "VERIFICATION_FAILED", message: "Artifact 版本登记失败" },
          };
        }
      }

      // V2 closeout：Undo 快照边界用 UTF-8 bytes（string.length 不是 bytes；避免 checkpoint 创建
      // 与 runtime stat.size 判定不一致——多字节文本必须按 1 MiB bytes 判定）
      const undoSnapshotBytes = new TextEncoder().encode(current).byteLength;
      const canUndo = undoSnapshotBytes <= COMPUTER_PATCH_UNDO_LIMIT_BYTES;
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
        artifactId,
        revision: newRevision,
        review: {
          kind: "text-patch",
          edits: edits.map((e) => ({ before: e.oldText, after: e.newText })),
        },
        inverse: canUndo
          ? artifactId && artifactRevision !== undefined && newRevision !== undefined
            ? {
                type: "restore-generic-artifact-revision",
                workspaceId: ws.id,
                rootId: root.id,
                relativePath: normalized,
                artifactId,
                previousRevision: artifactRevision,
                expectedCurrentRevision: newRevision,
                beforeText: current,
              }
            : {
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
      // V2.9 Delivery Integrity：bounded stage diagnostic（dev only；不含正文/raw JSON）
      const stage = (s: string, code?: string) => {
        if (process.env.NODE_ENV === "development") {
          console.info(
            `[Kiro create_document stage] toolCallId=${toolCallId} stage=${s}` +
              (code ? ` code=${code}` : "") +
              ` protocol=${CURRENT_DOCUMENT_AUTHORING_VERSION} workspaceId=${ws.id} rootId=${root.id} path=${normalized}`
          );
        }
      };
      stage("model-input");
      // V2.3：双兼容 parser（Draft V2 → normalize；Canonical V1 → passthrough；都失败 → bounded INVALID_INPUT）
      const parsedDocument = parseDocumentAuthoringInput(args.document);
      if (!parsedDocument.ok) {
        stage("runtime-parse", "INVALID_INPUT");
        return { kind: "completed", output: { ok: false, code: "INVALID_INPUT", message: buildDocumentProtocolMismatchMessage(parsedDocument.issues) } };
      }
      const document = parsedDocument.value.document;
      if (!isKiroDocument(document)) throw new ComputerError("INVALID_INPUT", "文档 IR 不合法");
      stage("runtime-parse");
      const ext = normalized.split(".").pop()?.toLowerCase();
      if (ext !== "md" && ext !== "docx") {
        return { kind: "completed", output: { ok: false, code: "UNSUPPORTED_FILE_TYPE", message: "仅支持 .md / .docx 文档" } };
      }

      // ---- preflight existing（不计数）----
      // Case A：filesystem + Artifact 都存在 → 正常占用；Case B：filesystem 存在但 Artifact 缺失
      //（orphan / workspace-existing）→ adopt 恢复可见性（绝不覆盖、不伪造 Source IR）
      const existingStat = await adapter.stat(normalized);
      if (existingStat) {
        stage("preflight", "RESOURCE_ALREADY_EXISTS");
        const existingArtifact = await findArtifactByLocation(ws.id, root.id, normalized);
        if (existingArtifact) {
          return {
            kind: "completed",
            output: {
              ok: false,
              code: "RESOURCE_ALREADY_EXISTS",
              message: `文件已存在：${normalized}，请勿重复创建同一路径`,
              data: { existingFile: true, artifactRegistered: true },
            },
          };
        }
        let artifactRecovered = false;
        try {
          await adoptWorkspaceArtifact({
            workspaceId: ws.id,
            rootId: root.id,
            relativePath: normalized,
            type: ext === "docx" ? "docx" : "markdown",
            title: normalized.split("/").pop() ?? normalized,
          });
          artifactRecovered = true;
        } catch {
          // adopt 失败不阻断错误返回（文件仍存在，Recent Files 会在 reconciliation 时兜底）
        }
        return {
          kind: "completed",
          output: {
            ok: false,
            code: "RESOURCE_ALREADY_EXISTS",
            message: `文件已存在：${normalized}${artifactRecovered ? "（已恢复为工作区已有文件）" : ""}，请勿重复创建同一路径`,
            data: { existingFile: true, artifactRecovered },
          },
        };
      }

      // ---- PURE RENDER（不写文件、不计数；任何异常 → 稳定 DOCUMENT_RENDER_FAILED）----
      let rendered: { format: "markdown"; text: string } | { format: "docx"; bytes: Uint8Array };
      try {
        rendered =
          ext === "md"
            ? { format: "markdown", text: renderMarkdown(document) }
            : { format: "docx", bytes: await renderDocx(document) };
      } catch {
        stage("render", "DOCUMENT_RENDER_FAILED");
        return {
          kind: "completed",
          output: { ok: false, code: "DOCUMENT_RENDER_FAILED", message: "文档渲染失败，本轮停止文档创建。" },
        };
      }
      stage("render");

      // 即将开始真实 filesystem mutation：只在此计数一次（parse/preflight/render 失败不消耗 quota）
      counters.mutationCount += 1;

      // ---- write → read-back verify ----
      if (rendered.format === "markdown") {
        await adapter.writeText(normalized, rendered.text, "text/markdown");
        const readBack = await adapter.readText(normalized);
        if (!(await verifyMarkdownWritten(rendered.text, readBack))) {
          stage("verify", "VERIFICATION_FAILED");
          throw new ComputerError("VERIFICATION_FAILED", "Markdown 校验失败");
        }
      } else {
        await adapter.writeBytes(normalized, rendered.bytes, DOCX_MIME);
        const readBack = await adapter.readBytes(normalized);
        if (!(await verifyRenderedDocx(readBack, document))) {
          stage("verify", "VERIFICATION_FAILED");
          throw new ComputerError("VERIFICATION_FAILED", "DOCX 校验失败");
        }
      }
      stage("write");
      stage("verify");

      // ---- Artifact 原子登记（metadata + Source IR 同一事务；失败 → 回滚刚创建的文件）----
      const facts = inspectDocumentFacts(document, rendered.format);
      let artifactId: string;
      try {
        const artifact = await registerCreatedArtifact({
          workspaceId: ws.id,
          rootId: root.id,
          relativePath: normalized,
          type: rendered.format === "docx" ? "docx" : "markdown",
          title: facts.title,
          sourceTaskId: context.taskId,
          document,
        });
        artifactId = artifact.id;
      } catch {
        stage("artifact-register", "VERIFICATION_FAILED");
        // 事务语义：create 前已确认路径不存在 → 回滚本轮刚创建的文件是安全的
        let rollbackOk = false;
        try {
          await adapter.remove(normalized, "file");
          const after = await adapter.stat(normalized);
          rollbackOk = after === null;
        } catch {
          rollbackOk = false;
        }
        if (rollbackOk) {
          return {
            kind: "completed",
            output: {
              ok: false,
              code: "VERIFICATION_FAILED",
              message: "文档创建未完成，已回滚，没有留下不可见文件。",
            },
          };
        }
        return {
          kind: "completed",
          output: {
            ok: false,
            code: "VERIFICATION_FAILED",
            message: "文档创建未完成且回滚未完成，文件状态需要重新检查。",
            data: { fileMayExist: true, artifactRegistered: false },
          },
        };
      }
      stage("artifact-register");

      const runtime = buildMutationRuntime({
        toolName,
        toolCallId,
        operation: "create",
        resourceType: "document",
        snapshot: turnSnapshot,
        workspaceLabel: ws.name,
        root,
        relativePath: normalized,
        format: rendered.format,
        size: rendered.format === "docx" ? rendered.bytes.byteLength : new TextEncoder().encode(rendered.text).byteLength,
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
          artifactId,
        },
        artifactId,
      });
      if (rendered.format === "docx") void markKnowledgeDirtyBestEffort(ws.id);
      stage("done");
      return {
        kind: "completed",
        output: { ok: true, data: { path: normalized, format: rendered.format, verified: true } },
        runtime,
      };
    }

    return {
      kind: "completed",
      output: { ok: false, code: "PERMISSION_DENIED", message: `未实现的 Computer 工具：${toolName}` },
    };
  } catch (err) {
    // V2.8 dev diagnostic：delete_file 失败时输出 bounded 记录（区分 INVALID_INPUT /
    // ROOT_REQUIRED / ROOT_NOT_FOUND / RESOURCE_NOT_FOUND / PERMISSION_DENIED /
    // VERIFICATION_FAILED / 其它异常）；绝不含 native path / handle / grant / 文件正文
    if (toolName === "delete_file" && process.env.NODE_ENV === "development") {
      console.info("[Kiro delete_file failed]");
      console.info(`code=${err instanceof ComputerError ? err.code : "UNKNOWN"}`);
      console.info(`rootId=${typeof args?.rootId === "string" ? args.rootId : "(omitted)"}`);
      console.info(`path=${String(args?.path ?? "")}`);
      console.info(`workspaceId=${ws.id}`);
      console.info(`agentMode=${turnSnapshot.agentMode}`);
    }
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

/** 双资源 policy 合并：任意 deny → deny；否则任意 ask → ask；否则 allow */
function combineRelocationPolicies(
  source: { effect: ComputerPermissionEffect },
  destination: { effect: ComputerPermissionEffect }
): ComputerPermissionEffect {
  if (source.effect === "deny" || destination.effect === "deny") return "deny";
  if (source.effect === "ask" || destination.effect === "ask") return "ask";
  return "allow";
}

/** update_document 渲染产物（纯 pre-write 阶段生成；不落库/不进模型） */
type RenderedDocumentWrite =
  | { format: "markdown"; text: string }
  | { format: "docx"; bytes: Uint8Array };

const WINDOWS_RESERVED_BASENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** rename 的 newName 必须是 basename：无 / \\、非 . ..、无 control chars、非 Windows 保留名 */
export function isValidRenameBasename(name: string): boolean {
  if (!name || name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  if (WINDOWS_RESERVED_BASENAME.test(name)) return false;
  return true;
}

/** dirname(source) + newName → 完整目标路径（重新走 path sandbox 归一） */
function buildRenameTargetPath(sourcePath: string, newName: string): string {
  const dir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1) : "";
  return normalizeRelativeComputerPath(`${dir}${newName}`).path;
}

/** post-write 失败时恢复 exact 快照（Markdown exact text / DOCX exact bytes）；回滚本身失败 → 抛 VERIFICATION_FAILED */
async function rollbackDocumentFile(
  adapter: ComputerAdapterIO,
  path: string,
  snapshot: DocumentFileSnapshot
): Promise<void> {
  if (snapshot.format === "markdown") {
    await adapter.writeText(path, snapshot.text);
    const readBack = await adapter.readText(path);
    if (readBack !== snapshot.text) {
      throw new ComputerError("VERIFICATION_FAILED", "文档回滚校验失败");
    }
    return;
  }
  await adapter.writeBytes(path, snapshot.bytes);
  const readBack = await adapter.readBytes(path);
  if (!bytesEqual(readBack, snapshot.bytes)) {
    throw new ComputerError("VERIFICATION_FAILED", "文档回滚校验失败");
  }
}

/** V3 Part 1：verified filesystem mutation 后 best-effort 标记 Knowledge dirty（失败绝不改变已验证结果） */
async function markKnowledgeDirtyBestEffort(workspaceId: string): Promise<void> {
  try {
    await markWorkspaceKnowledgeDirty(workspaceId);
  } catch {
    // Knowledge cache failure cannot retroactively fail verified filesystem work.
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** 构建 verified mutation 的 runtime-only 事实（change + inverse）；inverse 缺失 → canUndo=false */
function buildMutationRuntime(input: {
  toolName: string;
  toolCallId: string;
  operation: "create" | "modify" | "move" | "rename" | "delete";
  resourceType: "directory" | "text" | "document";
  snapshot: KiroComputerTurnSnapshot;
  workspaceLabel: string;
  root: { id: string; label: string };
  relativePath: string;
  artifactId?: string;
  fromRootId?: string;
  fromRootLabel?: string;
  fromRelativePath?: string;
  format?: "markdown" | "docx";
  size?: number;
  changeCount?: number;
  revision?: number;
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
    artifactId: input.artifactId,
    fromRootId: input.fromRootId,
    fromRootLabel: input.fromRootLabel,
    fromRelativePath: input.fromRelativePath,
    format: input.format,
    size: input.size,
    changeCount: input.changeCount,
    revision: input.revision,
    verification: "passed",
    review: input.review,
  };
  return {
    change,
    inverse: input.inverse,
  };
}
