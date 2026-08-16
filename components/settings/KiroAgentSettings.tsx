"use client";

import React, { useEffect, useState } from "react";
import { FolderOpen, HardDrive, ShieldAlert, Trash2, RefreshCw } from "lucide-react";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useToastStore } from "@/store/useToastStore";
import { KiroAgentMode, KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggle, SettingsSegmentedControl } from "@/components/settings/SettingsControls";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import {
  queryBrowserGrant,
  supportsFileSystemAccess,
  forgetBrowserWorkspaceGrant,
  BrowserGrantStatus,
} from "@/lib/ai/computer/workspace/grants";
import { isNativeAdapterRef, isClassFlowDesktopRuntime } from "@/lib/desktop/bridge";
import {
  authorizeLocalFolder,
  resolveWorkspaceRootAvailability,
  reauthorizeNativeWorkspaceRoot,
  forgetNativeWorkspaceGrant,
  WorkspaceRootAvailability,
} from "@/lib/ai/computer/workspace/native";
import { clearSandboxAdapter } from "@/lib/ai/computer/adapters/sandbox";
import {
  adapterRefStillReferenced,
  isDefaultSandboxWorkspace,
} from "@/lib/ai/computer/workspace/management";
import { removeArtifactsForWorkspace } from "@/lib/ai/computer/artifacts/service";
import { clearWorkspaceKnowledge } from "@/lib/ai/computer/knowledge/db";
import { KiroComputerAuditPanel } from "@/components/settings/KiroComputerAuditPanel";
import { KiroWorkspaceKnowledgePanel } from "@/components/settings/KiroWorkspaceKnowledgePanel";

const MODE_OPTIONS: { value: KiroAgentMode; label: string }[] = [
  { value: "plan", label: "仅规划" },
  { value: "guided", label: "每次确认" },
  { value: "workspace-auto", label: "授权范围内自动" },
];

function isSandboxAdapterRef(ref: string): boolean {
  return ref === "sandbox-default" || ref.startsWith("sandbox");
}

/** Native root 状态文案（runtime facts；不在 UI 暴露 adapterRef / grantId / native 术语） */
function nativeRootStatusLabel(avail: WorkspaceRootAvailability): {
  label: string;
  tone: "ok" | "warn" | "muted";
} {
  switch (avail) {
    case "available":
      return { label: "已授权", tone: "ok" };
    case "permission-required":
      return { label: "需要重新授权", tone: "warn" };
    case "missing-grant":
      return { label: "未授权", tone: "warn" };
    case "runtime-unavailable":
      return { label: "仅桌面版可访问", tone: "muted" };
  }
}

/** Agent 与权限（Settings V4）：用户优先理解「能不能操作 / 能操作哪里 / 自动到什么程度」 */
export function KiroAgentSettings() {
  const {
    computerEnabled,
    activeWorkspaceId,
    agentMode,
    workspaces,
    setComputerEnabled,
    setActiveWorkspaceId,
    setAgentMode,
    addWorkspace,
  } = useKiroComputerStore();

  const confirmRequest = useConfirmStore((s) => s.confirm);
  const pushToast = useToastStore((s) => s.pushToast);

  const [grantStatus, setGrantStatus] = useState<Record<string, BrowserGrantStatus>>({});
  // Native V1：root 运行时可用性（runtime facts；不持久化）
  const [rootAvailability, setRootAvailability] = useState<Record<string, WorkspaceRootAvailability>>({});
  const [addingLocation, setAddingLocation] = useState(false);
  const [reauthorizingRoot, setReauthorizingRoot] = useState<string | null>(null);
  const [error, setError] = useState("");

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const hasCanonicalSandbox = workspaces.some(isDefaultSandboxWorkspace);

  // 启动 + workspaces 变化时查询各 root 的授权/可用性状态
  useEffect(() => {
    let alive = true;
    const statuses: Record<string, BrowserGrantStatus> = {};
    const avail: Record<string, WorkspaceRootAvailability> = {};
    const browserRefs = new Set<string>();
    const rootRefs: { ref: string; root: KiroWorkspaceMeta["roots"][number] }[] = [];
    for (const w of workspaces) {
      for (const r of w.roots) {
        rootRefs.push({ ref: r.adapterRef, root: r });
        if (!isNativeAdapterRef(r.adapterRef) && !isSandboxAdapterRef(r.adapterRef)) {
          browserRefs.add(r.adapterRef);
        }
      }
    }
    void Promise.all([
      Promise.all(
        Array.from(browserRefs).map(async (ref) => {
          statuses[ref] = await queryBrowserGrant(ref);
        })
      ),
      Promise.all(
        rootRefs.map(async ({ ref, root }) => {
          avail[ref] = await resolveWorkspaceRootAvailability(root);
        })
      ),
    ]).then(() => {
      if (alive) {
        setGrantStatus(statuses);
        setRootAvailability(avail);
      }
    });
    return () => {
      alive = false;
    };
  }, [workspaces]);

  /** 添加位置（显式用户手势）：Desktop Runtime → Native picker；否则 Chromium → Browser picker */
  const handleAddLocation = async () => {
    if (!isClassFlowDesktopRuntime() && !supportsFileSystemAccess()) {
      setError("当前浏览器不支持本地文件夹授权，请使用 Kiro 内置工作区。");
      return;
    }
    setAddingLocation(true);
    setError("");
    try {
      const ws = await authorizeLocalFolder();
      if (!ws) return; // 用户取消 → 保持现状（不自动启用 Computer）
      setRootAvailability((s) => ({ ...s }));
      pushToast({ message: `已添加《${ws.name}》` });
    } finally {
      setAddingLocation(false);
    }
  };

  /** Native root 重新授权（新 picker 完成后替换 adapterRef；不假设同一路径） */
  const handleReauthorizeNativeRoot = async (ws: KiroWorkspaceMeta, rootId: string) => {
    setReauthorizingRoot(rootId);
    setError("");
    try {
      const next = await reauthorizeNativeWorkspaceRoot(ws, rootId);
      if (!next) return; // 取消 → 原授权不变
      pushToast({ message: "已重新授权本地文件夹" });
    } finally {
      setReauthorizingRoot(null);
    }
  };

  /** 显式使用 Kiro 内置工作区（canonical：已存在则复用，绝不产生重复） */
  const handleUseSandbox = () => {
    useKiroComputerStore.getState().ensureDefaultSandboxWorkspace();
    setGrantStatus((s) => ({ ...s, "sandbox-default": "granted" }));
    setError("");
  };

  const handleToggleEnabled = (enabled: boolean) => {
    if (!enabled) {
      setComputerEnabled(false);
      return;
    }
    // 首次开启无 workspace：必须引导授权，不能直接启用
    if (workspaces.length === 0) {
      setError("请先添加可访问的位置（本地文件夹或 Kiro 内置工作区）。");
      return;
    }
    if (!activeWorkspaceId) {
      setActiveWorkspaceId(workspaces[0].id);
    }
    setComputerEnabled(true);
  };

  /**
   * 删除 Workspace（Settings 显式操作；不是 Agent capability）：
   * 先清 Artifact metadata/source → 快照 remaining → 逻辑删除 → 对 removed 的 unique adapterRef：
   * 仍被引用则不动；内置工作区 → clearSandboxAdapter；Browser → forgetBrowserWorkspaceGrant。
   * 清理失败：Workspace metadata 保持删除，只提示缓存未清理。
   */
  const deleteWorkspace = async (ws: KiroWorkspaceMeta) => {
    const remaining = useKiroComputerStore
      .getState()
      .workspaces.filter((w) => w.id !== ws.id);
    useKiroComputerStore.getState().removeWorkspace(ws.id);
    const uniqueRefs = Array.from(new Set(ws.roots.map((r) => r.adapterRef)));
    let cleanupFailed = false;
    try {
      await removeArtifactsForWorkspace(ws.id);
    } catch {
      cleanupFailed = true;
    }
    // V3 Part 1：Knowledge 记录清理（只清 classflow-kiro-knowledge-v1 中该 Workspace；绝不删真实文件）
    try {
      await clearWorkspaceKnowledge(ws.id);
    } catch {
      cleanupFailed = true;
    }
    for (const ref of uniqueRefs) {
      if (adapterRefStillReferenced(remaining, ref)) continue; // shared adapter：不清理
      try {
        if (isSandboxAdapterRef(ref)) {
          await clearSandboxAdapter(ref);
        } else if (isNativeAdapterRef(ref)) {
          // Native V1：只忘记授权映射（绝不删除真实目录内容）；Bridge 缺失时 no-op
          await forgetNativeWorkspaceGrant(ref);
        } else {
          await forgetBrowserWorkspaceGrant(ref);
        }
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) {
      pushToast({ message: "工作区已移除，但部分本地缓存未能清理。", type: "error" });
    }
  };

  const handleDeleteWorkspace = (ws: KiroWorkspaceMeta) => {
    const isSandboxWs = ws.roots.some((r) => isSandboxAdapterRef(r.adapterRef));
    const isNativeWs = ws.roots.some((r) => isNativeAdapterRef(r.adapterRef));
    confirmRequest({
      title: isSandboxWs ? "删除 Kiro 内置工作区？" : "移除本地文件夹授权？",
      description: isSandboxWs
        ? "此操作会删除该内置工作区在当前浏览器中保存的文件和工作区记录，无法撤销。"
        : isNativeWs
          ? "ClassFlow 将忘记这个文件夹的授权，但不会删除电脑上的任何文件。"
          : "ClassFlow 将忘记这个文件夹的授权记录，但不会删除电脑上的任何文件。",
      confirmLabel: isSandboxWs ? "删除" : "移除",
      danger: true,
      onConfirm: () => void deleteWorkspace(ws),
    });
  };

  return (
    <SettingsSection
      title="Agent 与权限"
      description="Kiro 能操作哪些文件、自动执行到什么程度，以及当前可以访问的位置。"
    >
      <div className="text-xs space-y-4" data-testid="settings-kiro-agent">
        <SettingsGroup title="文件操作">
          <SettingsRow
            settingId="kiro-computer-enabled"
            title="允许 Kiro 操作文件"
            description="开启后 Kiro 可在授权的工作区内读取、创建和受控修改文件；危险系统能力仍保持禁用。"
          >
            <SettingsToggle
              checked={computerEnabled}
              onChange={handleToggleEnabled}
              label="允许 Kiro 操作文件"
            />
          </SettingsRow>

          {error && <p className="px-1 text-[10px] font-semibold text-danger">{error}</p>}

          <SettingsRow
            settingId="kiro-agent-mode"
            title="自动执行级别"
            description="决定工作区内允许的操作等级；「授权范围内自动」自动执行创建、修改、移动和删除，但永不扩大授权目录、不含终端/网络等系统能力。"
          >
            <SettingsSegmentedControl<KiroAgentMode>
              value={agentMode}
              onChange={setAgentMode}
              options={MODE_OPTIONS}
              ariaLabel="自动执行级别"
            />
          </SettingsRow>

          <SettingsRow
            settingId="kiro-agent-workspace"
            title="当前工作区"
            description={activeWorkspace ? activeWorkspace.name : "尚未配置工作区"}
          >
            <span className="text-[11px] font-bold text-charcoal">
              {activeWorkspace ? activeWorkspace.name : "未配置"}
            </span>
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup
          title="可访问的位置"
          action={
            <div
              className="flex items-center gap-1.5 flex-wrap"
              data-testid="kiro-authorization-actions"
            >
              <Button variant="secondary" size="sm" onClick={handleAddLocation} disabled={addingLocation}>
                <FolderOpen className="w-3 h-3" />
                {addingLocation ? "授权中…" : "添加本地文件夹"}
              </Button>
              {!hasCanonicalSandbox && (
                <Button variant="ghost" size="sm" onClick={handleUseSandbox}>
                  <HardDrive className="w-3 h-3" />
                  使用 Kiro 内置工作区
                </Button>
              )}
            </div>
          }
        >
          <div className="px-1">
            {workspaces.length === 0 && (
              <p className="text-[10px] text-sandrift py-2.5">尚未授权任何位置。</p>
            )}

            {/* Flat Workspace List：单行紧凑、soft divide；不再卡片套卡片 */}
            <div className="divide-y divide-line-soft">
              {workspaces.map((ws) => {
                const isSandboxWs = ws.roots.every((r) => isSandboxAdapterRef(r.adapterRef));
                const metadata = isSandboxWs
                  ? `当前浏览器 · ${ws.roots
                      .map((r) => (r.access === "read-write" ? "读写" : "只读"))
                      .join(" · ")}`
                  : ws.roots
                      .map((root) => {
                        if (isNativeAdapterRef(root.adapterRef)) {
                          // Native V1：runtime 状态（仅桌面版可访问 / 已授权 / 需要重新授权）
                          const avail = rootAvailability[root.adapterRef] ?? "available";
                          const s = nativeRootStatusLabel(avail);
                          return `本地文件夹 · ${s.label}${avail === "available" ? ` · ${root.access === "read-write" ? "读写" : "只读"}` : ""}`;
                        }
                        const status = grantStatus[root.adapterRef] ?? "missing";
                        const grantLabel =
                          status === "granted" ? "已授权" : status === "missing" ? "未授权" : "需要重新授权";
                        return `本地文件夹 · ${grantLabel} · ${root.access === "read-write" ? "读写" : "只读"}`;
                      })
                      .join(" · ");
                return (
                  <div
                    key={ws.id}
                    data-testid="kiro-workspace-row"
                    data-workspace-id={ws.id}
                    className="flex items-center gap-2.5 py-2 min-w-0"
                  >
                    <span className="w-7 h-7 rounded-lg bg-alabaster flex items-center justify-center shrink-0">
                      {isSandboxWs ? (
                        <HardDrive className="w-3.5 h-3.5 text-sandrift" aria-hidden="true" />
                      ) : (
                        <FolderOpen className="w-3.5 h-3.5 text-sandrift" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold text-charcoal truncate">{ws.name}</p>
                      <p className="text-[10px] text-sandrift truncate">{metadata}</p>
                    </div>
                    {/* Native V1：需要重新授权时提供明确入口（新 grant 替换；取消则原授权不变） */}
                    {ws.roots.some(
                      (r) =>
                        isNativeAdapterRef(r.adapterRef) &&
                        (rootAvailability[r.adapterRef] === "permission-required" ||
                          rootAvailability[r.adapterRef] === "missing-grant")
                    ) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        data-testid="kiro-native-reauthorize"
                        disabled={reauthorizingRoot !== null}
                        onClick={() => {
                          const nativeRoot = ws.roots.find((r) => isNativeAdapterRef(r.adapterRef));
                          if (nativeRoot) void handleReauthorizeNativeRoot(ws, nativeRoot.id);
                        }}
                      >
                        <RefreshCw className="w-3 h-3" />
                        {reauthorizingRoot !== null ? "授权中…" : "重新授权"}
                      </Button>
                    )}
                    {ws.id === activeWorkspaceId ? (
                      <span className="text-[10px] font-bold text-charcoal bg-pastel-mint px-1.5 py-0.5 rounded shrink-0">
                        当前
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        onClick={() => setActiveWorkspaceId(ws.id)}
                      >
                        设为当前
                      </Button>
                    )}
                    <IconButton
                      variant="ghost"
                      size="sm"
                      aria-label={`删除工作区 ${ws.name}`}
                      onClick={() => handleDeleteWorkspace(ws)}
                      className="shrink-0 text-sandrift hover:text-danger"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </IconButton>
                  </div>
                );
              })}
            </div>
          </div>
        </SettingsGroup>

        <SettingsGroup title="权限与安全">
          <SettingsRow
            settingId="kiro-agent-permissions"
            title="安全边界"
            description="Kiro 不会执行：删除文件、运行命令（终端 / PowerShell）、启动应用、MCP、任意网络访问或 Full Access 模式。"
          >
            <span className="text-[11px] text-satin-grey shrink-0">
              <ShieldAlert className="w-3.5 h-3.5 inline mr-1 text-sandrift" />
              受限沙箱
            </span>
          </SettingsRow>
          {/* V3 Part 1：工作区知识（current Workspace 紧凑状态/动作） */}
          {activeWorkspace && <KiroWorkspaceKnowledgePanel workspaceId={activeWorkspace.id} />}
          {/* Part 3：Computer Audit（最近活动；只清 audit metadata） */}
          <KiroComputerAuditPanel />
        </SettingsGroup>
      </div>
    </SettingsSection>
  );
}
