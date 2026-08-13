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
  sandboxMove,
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
  browserMove,
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
import {
  registerCreatedArtifact,
  findArtifactByLocation,
  updateArtifactLocation,
  getEditableArtifactRevisionState,
  commitArtifactRevision,
} from "@/lib/ai/computer/artifacts/service";
import { KiroArtifact } from "@/lib/ai/computer/artifacts/types";
import { DocumentFileSnapshot } from "@/lib/ai/computer/checkpoints";
import { relocateFile } from "@/lib/ai/computer/filesystem/relocate";
import { KiroComputerChange } from "@/lib/ai/computer/task";
import { ComputerInverseOperation } from "@/lib/ai/computer/checkpoints";

export const COMPUTER_READ_LIMIT_PER_TURN = 12;
export const COMPUTER_MUTATION_LIMIT_PER_TURN = 6;

/** V2 Part 2：文档结构化更新上限（保证 exact 回滚/Undo 快照有界） */
export const COMPUTER_DOCUMENT_REVISION_LIMIT_BYTES = 5 * 1024 * 1024;

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
      move: (from, to) => sandboxMove(adapterRef, from, to),
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
    move: (from, to) => browserMove(adapterRef, from, to),
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

    // ---- V2 Relocation：rename_file / move_file（双资源 policy：source + destination 各自评估）----
    if (toolName === "rename_file" || toolName === "move_file") {
      counters.mutationCount += 1;
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
      counters.mutationCount += 1;
      const artifactId = String(args.artifactId);
      const expectedRevision = Number(args.expectedRevision);
      const document = args.document as Parameters<typeof renderMarkdown>[0];

      // 每次执行都重读 Registry（Approval resume 时 useKiroChat 会用 frozen input 重跑本函数 → 自然重检 revision/location）
      const { artifact, source: previousSource } = await getEditableArtifactRevisionState(artifactId, expectedRevision);
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

      // render → write → verify（格式由 artifact.type 决定，模型不能选择）
      try {
        if (artifact.type === "markdown") {
          const markdown = renderMarkdown(document);
          await adapter.writeText(artifactPath, markdown, "text/markdown");
          const readBack = await adapter.readText(artifactPath);
          if (!(await verifyMarkdownWritten(markdown, readBack))) {
            throw new ComputerError("VERIFICATION_FAILED", "Markdown 校验失败");
          }
        } else {
          const bytes = await renderDocx(document);
          await adapter.writeBytes(
            artifactPath,
            bytes,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          );
          const readBack = await adapter.readBytes(artifactPath);
          if (!(await verifyDocxBytes(readBack))) {
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

      // 文件验证通过后才 commit（原子 metadata + Source IR；conflict 也回滚文件）
      let updatedArtifact: KiroArtifact;
      try {
        updatedArtifact = await commitArtifactRevision({ artifactId, expectedRevision, document });
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
      const facts = inspectDocumentFacts(document, format);
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
          headings: documentHeadings(document),
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
        // 文件已创建并验证，但 metadata 登记失败：不谎称成功，也不删除已生成文件
        throw new ComputerError(
          "VERIFICATION_FAILED",
          "文件已创建并验证，但 Artifact 元数据登记失败；请重新检查工作区文件后再继续。"
        );
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
        // V2：verified 文档登记 Artifact（markdown type + Kiro-owned Document IR）
        let artifactId: string | undefined;
        try {
          const artifact = await registerCreatedArtifact({
            workspaceId: ws.id,
            rootId: root.id,
            relativePath: normalized,
            type: "markdown",
            title: facts.title,
            sourceTaskId: context.taskId,
            document,
          });
          artifactId = artifact.id;
        } catch {
          throw new ComputerError(
            "VERIFICATION_FAILED",
            "文件已创建并验证，但 Artifact 元数据登记失败；请重新检查工作区文件后再继续。"
          );
        }
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
          artifactId,
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
        // V2：verified 文档登记 Artifact（docx type + Kiro-owned Document IR）
        let artifactId: string | undefined;
        try {
          const artifact = await registerCreatedArtifact({
            workspaceId: ws.id,
            rootId: root.id,
            relativePath: normalized,
            type: "docx",
            title: facts.title,
            sourceTaskId: context.taskId,
            document,
          });
          artifactId = artifact.id;
        } catch {
          throw new ComputerError(
            "VERIFICATION_FAILED",
            "文件已创建并验证，但 Artifact 元数据登记失败；请重新检查工作区文件后再继续。"
          );
        }
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
          artifactId,
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

/** 双资源 policy 合并：任意 deny → deny；否则任意 ask → ask；否则 allow */
function combineRelocationPolicies(
  source: { effect: ComputerPermissionEffect },
  destination: { effect: ComputerPermissionEffect }
): ComputerPermissionEffect {
  if (source.effect === "deny" || destination.effect === "deny") return "deny";
  if (source.effect === "ask" || destination.effect === "ask") return "ask";
  return "allow";
}

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
  operation: "create" | "modify" | "move" | "rename";
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
