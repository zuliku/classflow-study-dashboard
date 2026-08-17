/**
 * Kiro Computer Agent V1 — Workspace Management helpers（纯逻辑；Settings/Store 共用）。
 * 默认 Kiro Sandbox 只能有一个（canonical）；adapterRef 共享检测用于删除时的清理安全。
 */
import { KiroWorkspaceMeta } from "@/lib/ai/computer/types";

export const DEFAULT_SANDBOX_ADAPTER_REF = "sandbox-default";

export function isDefaultSandboxWorkspace(workspace: KiroWorkspaceMeta): boolean {
  return workspace.roots.some((r) => r.adapterRef === DEFAULT_SANDBOX_ADAPTER_REF);
}

/** 删除 Workspace 前判断某 adapterRef 是否仍被其它 Workspace 引用（shared adapter 不误清理） */
export function adapterRefStillReferenced(workspaces: KiroWorkspaceMeta[], adapterRef: string): boolean {
  return workspaces.some((w) => w.roots.some((r) => r.adapterRef === adapterRef));
}
