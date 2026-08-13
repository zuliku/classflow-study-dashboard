import {
  ComputerCapability,
  ComputerPermissionRule,
  KiroAgentMode,
  KiroWorkspaceMeta,
  LogicalComputerResource,
} from "@/lib/ai/computer/types";
import { PolicyDecision, evaluateComputerPolicy } from "@/lib/ai/computer/policy";
import { normalizeRelativeComputerPath } from "@/lib/ai/computer/workspace/resolver";
import { ComputerError } from "@/lib/ai/computer/errors";

export interface PrepareComputerToolInput {
  mode: KiroAgentMode;
  rules: ComputerPermissionRule[];
  workspace: KiroWorkspaceMeta;
  capability: ComputerCapability;
  resource?: LogicalComputerResource;
}

/**
 * Computer Tool 强制 Preflight（Part 1：preflight only）。
 * 不做任何原生访问 / 写入 / 打开 / 系统 API 调用。
 *
 * 流程：workspace/root 解析 → 路径 sandbox 验证 → policy 求值。
 * 权限审批不能覆盖 PATH_OUTSIDE_SANDBOX（resolver 抛错）。
 */
export function prepareComputerTool(
  input: PrepareComputerToolInput
): PolicyDecision {
  const { mode, rules, workspace, capability, resource } = input;

  // Workspace 解析
  if (resource) {
    if (resource.workspaceId !== workspace.id) {
      throw new ComputerError("WORKSPACE_NOT_FOUND", "资源不属于当前工作区");
    }
  }

  let rootId: string | undefined;
  let rootAccess: "read-only" | "read-write" | undefined;
  let resourcePath: string | undefined;

  if (resource) {
    const root = workspace.roots.find((r) => r.id === resource.rootId);
    if (!root) {
      throw new ComputerError("ROOT_NOT_FOUND", `工作区根不存在：${resource.rootId}`);
    }
    rootId = root.id;
    rootAccess = root.access;
    // 路径 sandbox 验证（不可逃逸；抛 PATH_OUTSIDE_SANDBOX）
    // allowRoot：executor 已对 list/search/grep 归一 root scope（path=""）——这里放行 root scope，escape 一律拒绝
    resourcePath = normalizeRelativeComputerPath(resource.path, { allowRoot: true }).path;
  }

  return evaluateComputerPolicy({
    capability,
    mode,
    rules,
    workspaceId: workspace.id,
    rootId,
    rootAccess,
    resourcePath,
  });
}
