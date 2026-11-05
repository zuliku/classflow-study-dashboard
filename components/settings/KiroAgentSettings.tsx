"use client";

import React, { useEffect, useState } from "react";
import { FolderOpen, HardDrive, Trash2, RefreshCw } from "lucide-react";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useToastStore } from "@/store/useToastStore";
import { KiroAgentMode, KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggle, SettingsSegmentedControl } from "@/components/settings/SettingsControls";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import {
  queryBrowserGrant,
  supportsFileSystemAccess,
  forgetBrowserWorkspaceGrant,
  BrowserGrantStatus,
} from "@/lib/ai/computer/workspace/grants";
import {
  isNativeAdapterRef,
  isClassFlowDesktopRuntime,
  hasClassFlowDesktopTerminal,
  hasClassFlowDesktopComputer,
  hasClassFlowDesktopComputerAction,
} from "@/lib/desktop/bridge";
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
    terminalEnabled,
    desktopControlEnabled,
    desktopActionEnabled,
    desktopClipboardEnabled,
    backgroundEnabled,
    workspaces,
    setComputerEnabled,
    setActiveWorkspaceId,
    setAgentMode,
    setTerminalEnabled,
    setDesktopControlEnabled,
    setDesktopActionEnabled,
    setDesktopClipboardEnabled,
    setBackgroundEnabled,
    addWorkspace,
  } = useKiroComputerStore();

  const confirmRequest = useConfirmStore((s) => s.confirm);
  const pushToast = useToastStore((s) => s.pushToast);

  // Desktop Terminal V1：仅在 Desktop runtime + terminal bridge 可用时显示（网页版完全不出现）
  const desktopTerminalAvailable = isClassFlowDesktopRuntime() && hasClassFlowDesktopTerminal();
  // Computer Use Phase 1：仅在 Desktop runtime + computer bridge 可用时显示（网页版完全不出现）
  const desktopObservationAvailable = isClassFlowDesktopRuntime() && hasClassFlowDesktopComputer();
  // Computer Use Phase 2：需要 Action Bridge（computer v2）
  const desktopActionAvailable = isClassFlowDesktopRuntime() && hasClassFlowDesktopComputerAction();
  const [grantStatus, setGrantStatus] = useState<Record<string, BrowserGrantStatus>>({});
  // Native V1：root 运行时可用性（runtime facts；不持久化）
  const [rootAvailability, setRootAvailability] = useState<Record<string, WorkspaceRootAvailability>>({});
  const [addingLocation, setAddingLocation] = useState(false);
  const [reauthorizingRoot, setReauthorizingRoot] = useState<string | null>(null);
  const [error, setError] = useState("");

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  // Terminal 是否绑定 Native Workspace（决定 run_terminal_command 当前是否实际可用）
  const terminalHasNativeRoot =
    activeWorkspace?.roots.some((r) => isNativeAdapterRef(r.adapterRef)) ?? false;
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
      setError("当前应用环境不支持本地文件夹授权，请使用 Kiro 内置工作区。");
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

  /** Desktop Terminal V1：开启需显式确认（终端拥有比普通文件工具更高的系统权限） */
  const handleToggleTerminal = (enabled: boolean) => {
    if (!enabled) {
      setTerminalEnabled(false);
      return;
    }
    confirmRequest({
      title: "允许 Kiro 使用终端？",
      description:
        "终端可修改文件、安装依赖或访问工作区外资源；高风险命令仍需确认。",
      confirmLabel: "允许",
      onConfirm: () => setTerminalEnabled(true),
    });
  };

  /**
   * 桌面观察：只读能力；操作能力是独立开关（见 handleToggleDesktopAction）。
   */
  const handleToggleDesktopObservation = (enabled: boolean) => {
    if (!enabled) {
      // 观察是操作的前提：关闭观察必须同时关闭电脑操作
      setDesktopControlEnabled(false);
      setDesktopActionEnabled(false);
      setDesktopClipboardEnabled(false);
      setBackgroundEnabled(false);
      return;
    }
    confirmRequest({
      title: "允许 Kiro 查看桌面？",
      description:
        "只读查看屏幕与界面控件，不会点击或输入；截图不保存到磁盘。",
      confirmLabel: "允许查看",
      onConfirm: () => setDesktopControlEnabled(true),
    });
  };

  /**
   * Computer Use Phase 2：开启电脑操作必须独立确认（只读观察是前提，一并开启）。
   */
  const handleToggleDesktopAction = (enabled: boolean) => {
    if (!enabled) {
      setDesktopActionEnabled(false);
      setDesktopClipboardEnabled(false);
      setBackgroundEnabled(false);
      return;
    }
    confirmRequest({
      title: "允许 Kiro 操作电脑？",
      description:
        "可在当前窗口点击、输入与按键；高风险动作逐次确认，敏感信息不由 Kiro 输入，可随时停止。",
      confirmLabel: "允许操作",
      onConfirm: () => {
        // 操作的前提是观察能力；一并开启（两者仍各自独立持久化）
        setDesktopControlEnabled(true);
        setDesktopActionEnabled(true);
      },
    });
  };

  /**
   * Computer Use V2.5：剪贴板读写默认关闭，开启必须独立确认；
   * 关闭电脑操作 / 观察时一并关闭（剪贴板只在电脑操作能力下有意义）。
   */
  const handleToggleDesktopClipboard = (enabled: boolean) => {
    if (!enabled) {
      setDesktopClipboardEnabled(false);
      return;
    }
    confirmRequest({
      title: "允许 Kiro 读写剪贴板？",
      description:
        "读取或写入剪贴板（可能含敏感信息），每次操作都需确认。",
      confirmLabel: "允许剪贴板",
      onConfirm: () => setDesktopClipboardEnabled(true),
    });
  };

  /**
   * 后台静默操作：pattern 可直调的动作可在非前台窗口执行而不抢焦点；
   * 你只能从执行记录里看到它，看不到实时界面。独立确认，默认关闭。
   */
  const handleToggleBackground = (enabled: boolean) => {
    if (!enabled) {
      setBackgroundEnabled(false);
      return;
    }
    confirmRequest({
      title: "允许 Kiro 后台操作电脑？",
      description:
        "允许在窗口未置顶时操作控件，不抢焦点；过程仅见执行记录。",
      confirmLabel: "允许后台操作",
      onConfirm: () => setBackgroundEnabled(true),
    });
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
        ? "删除此工作区的文件与记录，无法撤销。"
        : isNativeWs
          ? "将忘记此文件夹的授权，不删除电脑上的文件。"
          : "将忘记此文件夹的授权记录，不删除电脑上的文件。",
      confirmLabel: isSandboxWs ? "删除" : "移除",
      danger: true,
      onConfirm: () => void deleteWorkspace(ws),
    });
  };

  return (
    <SettingsSection
      title="Agent 与权限"
    >
      <div className="text-xs space-y-4" data-testid="settings-kiro-agent">
        <SettingsGroup title="文件操作">
          <SettingsRow
            settingId="kiro-computer-enabled"
            title="允许 Kiro 操作文件"
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
            description="删除与高风险命令仍需确认。"
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
          >
            <span className="max-w-[260px] truncate text-[11px] font-bold text-charcoal">
              {activeWorkspace ? activeWorkspace.name : "尚未配置工作区"}
            </span>
          </SettingsRow>
        </SettingsGroup>

        {/* 终端与电脑控制：与文件操作分开，逐项授权（互不绑定） */}
        <SettingsGroup
          title="终端与电脑控制"
        >
          {/* Desktop Terminal V1：仅 Desktop runtime + terminal bridge 可用时显示（网页版完全不出现） */}
          {desktopTerminalAvailable ? (
            <SettingsRow
              settingId="kiro-terminal-enabled"
              title="允许 Kiro 使用终端"
              description={
                terminalEnabled && terminalHasNativeRoot
                  ? "PowerShell / CMD · 本地工作区"
                  : terminalEnabled
                  ? "请先选择本地文件夹工作区"
                  : "执行 PowerShell / CMD 命令。"
              }
            >
              <SettingsToggle
                checked={terminalEnabled}
                onChange={handleToggleTerminal}
                label="允许 Kiro 使用终端"
              />
            </SettingsRow>
          ) : (
            <SettingsRow
              settingId="kiro-terminal-enabled"
              title="允许 Kiro 使用终端"
              description="仅桌面版支持终端操作"
            >
              <SettingsToggle
                checked={false}
                onChange={() => undefined}
                disabled
                label="允许 Kiro 使用终端"
              />
            </SettingsRow>
          )}

          {/* Computer Use Phase 1：仅 Desktop runtime + computer bridge 可用时显示（网页版完全不出现） */}
          {desktopObservationAvailable && (
            <SettingsRow
              settingId="kiro-desktop-observe-enabled"
              title="允许 Kiro 查看桌面"
              description={
                desktopControlEnabled
                  ? "只读 · 不会点击或输入"
                  : "只读查看屏幕与界面控件。"
              }
            >
              <SettingsToggle
                checked={desktopControlEnabled}
                onChange={handleToggleDesktopObservation}
                label="允许 Kiro 查看桌面"
              />
            </SettingsRow>
          )}

          {/* Computer Use Phase 2：独立于 Terminal 的电脑操作开关（仅 Desktop Runtime 可见） */}
          {desktopActionAvailable && (
            <SettingsRow
              settingId="kiro-desktop-action-enabled"
              title="允许 Kiro 操作电脑"
              description={
                desktopActionEnabled
                  ? "点击 / 输入 / 按键 / 滚动；高风险逐次确认"
                  : "在当前窗口中点击与输入。"
              }
            >
              <SettingsToggle
                checked={desktopActionEnabled}
                onChange={handleToggleDesktopAction}
                label="允许 Kiro 操作电脑"
              />
            </SettingsRow>
          )}

          {/* Computer Use V2.5：剪贴板读写（默认关闭；独立开关 + 逐次确认；随操作开关折叠进退） */}
          <DisclosureRegion open={desktopActionAvailable && desktopActionEnabled}>
            <SettingsRow
              settingId="kiro-desktop-clipboard-enabled"
              title="允许 Kiro 读写剪贴板"
              description={
                desktopClipboardEnabled
                  ? "读取 / 写入剪贴板；写入会覆盖当前内容"
                  : "读取 / 写入剪贴板需逐次确认。"
              }
            >
              <SettingsToggle
                checked={desktopClipboardEnabled}
                onChange={handleToggleDesktopClipboard}
                label="允许 Kiro 读写剪贴板"
              />
            </SettingsRow>
          </DisclosureRegion>

          {/* 后台静默操作（默认关闭；独立确认；嵌套于电脑操作之下；随操作开关折叠进退） */}
          <DisclosureRegion open={desktopActionAvailable && desktopActionEnabled}>
            <SettingsRow
              settingId="kiro-background-enabled"
              title="允许 Kiro 后台操作电脑"
              description={
                backgroundEnabled
                  ? "未置顶窗口直接操作，不抢焦点；仅执行记录可见"
                  : "未置顶窗口操作控件，不抢焦点。"
              }
            >
              <SettingsToggle
                checked={backgroundEnabled}
                onChange={handleToggleBackground}
                label="允许 Kiro 后台操作电脑"
              />
            </SettingsRow>
          </DisclosureRegion>
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
                  ? `内置工作区 · ${ws.roots
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

        <SettingsGroup
          title="权限与安全"
          description="安全边界：高风险动作逐次确认；授权范围受限，不支持 Full Access。"
        >
          {/* V3 Part 1：工作区知识（current Workspace 紧凑状态/动作） */}
          {activeWorkspace && <KiroWorkspaceKnowledgePanel workspaceId={activeWorkspace.id} />}
          {/* Part 3：Computer Audit（最近活动；只清 audit metadata） */}
          <KiroComputerAuditPanel />
        </SettingsGroup>
      </div>
    </SettingsSection>
  );
}
