/**
 * Kiro Computer Agent Native V1 —— Native Workspace 授权生命周期（纯逻辑；Settings/Store 共用）。
 *
 * authorizeLocalFolder() 是 Settings UI 的唯一入口：
 * - Desktop Runtime 可用 → Native Bridge picker（grantId 永远 opaque）
 * - 否则 File System Access 可用 → Browser picker（现有行为）
 * - 都不可用 → null（保持现有 unsupported UX）
 *
 * 安全约束：
 * - pickDirectory 只能由显式用户手势调用（Agent tool / 后台 effect 禁止）。
 * - grantId 必须通过 isValidNativeGrantId（非法 → 拒绝创建 Workspace）。
 * - 重新授权不假设选择同一个真实路径：新 grant 只在新选择完成后替换 root adapterRef。
 * - forgetGrant 只删除授权映射，绝不删除真实目录内容。
 */
import { KiroWorkspaceMeta, KiroWorkspaceRootMeta } from "@/lib/ai/computer/types";
import {
  getClassFlowDesktopBridge,
  isClassFlowDesktopRuntime,
  isValidNativeGrantId,
  nativeGrantIdFromAdapterRef,
  isNativeAdapterRef,
} from "@/lib/desktop/bridge";
import { DesktopGrantStatus, ClassFlowDesktopGrantAccess } from "@/lib/desktop/types";
import {
  chooseBrowserWorkspaceDirectory,
  queryBrowserGrant,
  supportsFileSystemAccess,
} from "@/lib/ai/computer/workspace/grants";
import { DEFAULT_SANDBOX_ADAPTER_REF } from "@/lib/ai/computer/workspace/management";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";

/** Native root 的运行时可用性（runtime facts；绝不写进 Workspace persisted metadata） */
export type WorkspaceRootAvailability =
  | "available"
  | "permission-required"
  | "runtime-unavailable"
  | "missing-grant";

/**
 * 统一 root 状态 resolver（browser / sandbox / native 三路）。
 * - native + bridge 缺失 → runtime-unavailable（「仅可在桌面版访问」）
 * - native grant missing/denied → missing-grant / permission-required
 * - browser prompt/denied → permission-required；missing → missing-grant
 * - sandbox / granted → available
 */
export async function resolveWorkspaceRootAvailability(root: KiroWorkspaceRootMeta): Promise<WorkspaceRootAvailability> {
  if (isNativeAdapterRef(root.adapterRef)) {
    const bridge = getClassFlowDesktopBridge();
    if (!bridge) return "runtime-unavailable";
    const grantId = nativeGrantIdFromAdapterRef(root.adapterRef);
    if (!grantId) return "missing-grant";
    let status: DesktopGrantStatus;
    try {
      const r = await bridge.filesystem.getGrantStatus({ grantId });
      status = r.status;
    } catch {
      return "permission-required";
    }
    if (status === "granted") return "available";
    if (status === "denied") return "permission-required";
    return "missing-grant";
  }
  if (root.adapterRef === DEFAULT_SANDBOX_ADAPTER_REF || root.adapterRef.startsWith("sandbox")) {
    return "available";
  }
  // legacy browser
  const status = await queryBrowserGrant(root.adapterRef);
  if (status === "granted") return "available";
  if (status === "prompt" || status === "denied") return "permission-required";
  return "missing-grant";
}

/** Native Bridge picker（显式用户手势）：用户取消 → null；grantId 非法 → null（拒绝创建） */
export async function pickNativeWorkspaceDirectory(
  access: ClassFlowDesktopGrantAccess = "read-write"
): Promise<{ grantId: string; displayName: string; access: ClassFlowDesktopGrantAccess } | null> {
  const bridge = getClassFlowDesktopBridge();
  if (!bridge) return null;
  try {
    const grant = await bridge.filesystem.pickDirectory({ access });
    if (!grant) return null;
    if (!isValidNativeGrantId(grant.grantId)) return null;
    return {
      grantId: grant.grantId,
      displayName: String(grant.displayName ?? "本地文件夹").slice(0, 80) || "本地文件夹",
      access: grant.access === "read-only" ? "read-only" : "read-write",
    };
  } catch {
    return null; // bridge 异常 → 视为取消/不可用（不抛给 UI）
  }
}

/**
 * 授权一个本地文件夹 → 创建 Native Workspace（一次授权一个 root）。
 * 返回 null = 用户取消 / runtime 不可用 / grant 非法。
 */
export async function authorizeNativeWorkspaceFolder(): Promise<KiroWorkspaceMeta | null> {
  const grant = await pickNativeWorkspaceDirectory("read-write");
  if (!grant) return null;
  const now = new Date().toISOString();
  const ws: KiroWorkspaceMeta = {
    id: `ws-${crypto.randomUUID()}`,
    name: grant.displayName,
    roots: [
      {
        id: "root-1",
        label: grant.displayName,
        access: grant.access,
        adapterRef: `native:${grant.grantId}`,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  const store = useKiroComputerStore.getState();
  store.addWorkspace(ws);
  store.setActiveWorkspaceId(ws.id);
  store.setComputerEnabled(true);
  return ws;
}

/**
 * 统一「添加本地文件夹」策略（Settings UI 唯一入口）：
 * Desktop Bridge → native picker；否则 File System Access → browser picker；都不可用 → null。
 * 返回已创建并激活的 Workspace（或 null）。
 */
export async function authorizeLocalFolder(): Promise<KiroWorkspaceMeta | null> {
  if (isClassFlowDesktopRuntime()) {
    return authorizeNativeWorkspaceFolder();
  }
  if (supportsFileSystemAccess()) {
    const grant = await chooseBrowserWorkspaceDirectory();
    if (!grant) return null;
    const now = new Date().toISOString();
    const ws: KiroWorkspaceMeta = {
      id: `ws-${crypto.randomUUID()}`,
      name: grant.label,
      roots: [
        { id: "root-1", label: grant.label, access: "read-write", adapterRef: grant.adapterRef },
      ],
      createdAt: now,
      updatedAt: now,
    };
    useKiroComputerStore.getState().addWorkspace(ws);
    useKiroComputerStore.getState().setActiveWorkspaceId(ws.id);
    useKiroComputerStore.getState().setComputerEnabled(true);
    return ws;
  }
  return null;
}

/**
 * Native root 重新授权：新 picker 完成后用新 grant 替换该 root 的 adapterRef。
 * 不假设选择同一个真实路径；用户明确完成选择后才替换。取消 → 原授权不变。
 * V1.1（0.2）：先更新 Store，再检查旧 adapterRef 是否仍被其它 Workspace/Root 引用；
 * 无引用才 forget 旧 grant（shared 引用绝不清理）。
 */
export async function reauthorizeNativeWorkspaceRoot(
  workspace: KiroWorkspaceMeta,
  rootId: string
): Promise<KiroWorkspaceMeta | null> {
  const root = workspace.roots.find((r) => r.id === rootId);
  if (!root || !isNativeAdapterRef(root.adapterRef)) return null;
  const oldAdapterRef = root.adapterRef;
  const grant = await pickNativeWorkspaceDirectory(root.access);
  if (!grant) return null; // 取消 → 原 adapterRef / 原 grant 全部不变
  const next: KiroWorkspaceMeta = {
    ...workspace,
    roots: workspace.roots.map((r) =>
      r.id === rootId ? { ...r, adapterRef: `native:${grant.grantId}` } : r
    ),
    updatedAt: new Date().toISOString(),
  };
  useKiroComputerStore.getState().updateWorkspace(workspace.id, { roots: next.roots });
  // V1.1：Store 更新完成后再清理旧 grant（先引用检查；shared 引用绝不 forget）
  const stillReferenced = useKiroComputerStore
    .getState()
    .workspaces.some((w) => w.roots.some((r) => r.adapterRef === oldAdapterRef));
  if (!stillReferenced) {
    await forgetNativeWorkspaceGrant(oldAdapterRef);
  }
  return next;
}

/** 忘记 Native 授权映射（只删映射；绝不删除真实目录内容）。Bridge 缺失时 no-op。 */
export async function forgetNativeWorkspaceGrant(adapterRef: string): Promise<void> {
  if (!isNativeAdapterRef(adapterRef)) return;
  const bridge = getClassFlowDesktopBridge();
  const grantId = nativeGrantIdFromAdapterRef(adapterRef);
  if (!bridge || !grantId) return;
  try {
    await bridge.filesystem.forgetGrant({ grantId });
  } catch {
    // 忘记失败不阻塞（保持移除语义完成）
  }
}
