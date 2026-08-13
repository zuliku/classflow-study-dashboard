"use client";

import React, { useEffect, useState } from "react";
import { FolderOpen, HardDrive, ShieldAlert, MonitorUp } from "lucide-react";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { KiroAgentMode, KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggle, SettingsSegmentedControl } from "@/components/settings/SettingsControls";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  chooseBrowserWorkspaceDirectory,
  queryBrowserGrant,
  supportsFileSystemAccess,
  BrowserGrantStatus,
} from "@/lib/ai/computer/workspace/grants";
import { sandboxAdapterCapabilities } from "@/lib/ai/computer/adapters/sandbox";
import { KiroComputerAuditPanel } from "@/components/settings/KiroComputerAuditPanel";

const MODE_OPTIONS: { value: KiroAgentMode; label: string }[] = [
  { value: "plan", label: "计划" },
  { value: "guided", label: "受控" },
  { value: "workspace-auto", label: "工作区自动" },
];

/** Kiro Agent 设置（独立于 Kiro 与 AI）：Computer Agent 控制平面 */
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
    updateWorkspace,
  } = useKiroComputerStore();

  const [grantStatus, setGrantStatus] = useState<Record<string, BrowserGrantStatus>>({});
  const [addingLocation, setAddingLocation] = useState(false);
  const [error, setError] = useState("");

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  // 启动 + workspaces 变化时查询各 root 的授权状态
  useEffect(() => {
    let alive = true;
    const statuses: Record<string, BrowserGrantStatus> = {};
    const refs = new Set<string>();
    for (const w of workspaces) {
      for (const r of w.roots) refs.add(r.adapterRef);
    }
    void Promise.all(
      Array.from(refs).map(async (ref) => {
        statuses[ref] = await queryBrowserGrant(ref);
      })
    ).then(() => {
      if (alive) setGrantStatus(statuses);
    });
    return () => {
      alive = false;
    };
  }, [workspaces]);

  /** 添加位置（显式用户手势）：支持 Chromium 选真实文件夹；否则仅 Sandbox 路径 */
  const handleAddBrowserLocation = async () => {
    if (!supportsFileSystemAccess()) {
      setError("当前浏览器不支持本地文件夹授权，请使用 Kiro Sandbox。");
      return;
    }
    setAddingLocation(true);
    setError("");
    try {
      const grant = await chooseBrowserWorkspaceDirectory();
      if (!grant) return; // 用户取消 → 保持现状（不自动启用 Computer）
      const now = new Date().toISOString();
      const ws: KiroWorkspaceMeta = {
        id: `ws-${crypto.randomUUID()}`,
        name: grant.label,
        roots: [
          {
            id: "root-1",
            label: grant.label,
            access: "read-write",
            adapterRef: grant.adapterRef,
          },
        ],
        createdAt: now,
        updatedAt: now,
      };
      addWorkspace(ws);
      setActiveWorkspaceId(ws.id);
      setComputerEnabled(true);
      setGrantStatus((s) => ({ ...s, [grant.adapterRef]: "granted" }));
    } finally {
      setAddingLocation(false);
    }
  };

  /** 显式使用 Kiro Sandbox（CI-friendly / 不支持 File System Access 的环境） */
  const handleUseSandbox = () => {
    const now = new Date().toISOString();
    const ws: KiroWorkspaceMeta = {
      id: `ws-${crypto.randomUUID()}`,
      name: "Kiro Sandbox",
      roots: [
        {
          id: "root-sandbox",
          label: "Sandbox（当前浏览器）",
          access: "read-write",
          adapterRef: "sandbox-default",
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    addWorkspace(ws);
    setActiveWorkspaceId(ws.id);
    setComputerEnabled(true);
    setGrantStatus((s) => ({ ...s, "sandbox-default": "granted" }));
  };

  const handleToggleEnabled = (enabled: boolean) => {
    if (!enabled) {
      setComputerEnabled(false);
      return;
    }
    // 首次开启无 workspace：必须引导授权，不能直接启用
    if (workspaces.length === 0) {
      setError("请先添加授权位置（本地文件夹或 Kiro Sandbox）。");
      return;
    }
    if (!activeWorkspaceId) {
      setActiveWorkspaceId(workspaces[0].id);
    }
    setComputerEnabled(true);
  };

  return (
    <SettingsSection
      title="Kiro Agent"
      description="Computer Agent 控制平面：工作区授权、默认权限模式与安全边界。"
    >
      <div className="text-xs space-y-4" data-testid="settings-kiro-agent">
        <SettingsGroup title="Computer Agent">
          <SettingsRow
            settingId="kiro-computer-enabled"
            title="Computer Agent"
            description="开启后 Kiro 可在授权工作区内执行受限操作（V1：不包含文件写入工具）。"
          >
            <SettingsToggle checked={computerEnabled} onChange={handleToggleEnabled} label="Computer Agent" />
          </SettingsRow>

          {error && <p className="px-1 text-[10px] font-semibold text-danger">{error}</p>}

          <SettingsRow
            settingId="kiro-agent-mode"
            title="默认权限模式"
            description="模式决定工作区内允许的操作等级；永不扩大授权目录。"
          >
            <SettingsSegmentedControl<KiroAgentMode>
              value={agentMode}
              onChange={setAgentMode}
              options={MODE_OPTIONS}
              ariaLabel="默认权限模式"
            />
          </SettingsRow>

          <SettingsRow
            settingId="kiro-agent-workspace"
            title="当前 Workspace"
            description={activeWorkspace ? activeWorkspace.name : "尚未配置工作区"}
          >
            <span className="text-[11px] font-bold text-charcoal">
              {activeWorkspace ? activeWorkspace.name : "未配置"}
            </span>
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="授权位置">
          {workspaces.length === 0 ? (
            <div className="px-1 py-2 space-y-2">
              <p className="text-[10px] text-sandrift leading-relaxed">
                还没有授权位置。选择本地文件夹（受支持浏览器）或使用 Kiro Sandbox
                （数据仅保存在当前浏览器）。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" size="sm" onClick={handleAddBrowserLocation} disabled={addingLocation}>
                  <FolderOpen className="w-3 h-3" />
                  {addingLocation ? "授权中…" : "选择本地文件夹"}
                </Button>
                <Button variant="secondary" size="sm" onClick={handleUseSandbox}>
                  <HardDrive className="w-3 h-3" />
                  使用 Kiro Sandbox
                </Button>
              </div>
            </div>
          ) : (
            <div className="px-1 space-y-1.5">
              {workspaces.map((ws) => (
                <div key={ws.id} data-testid="kiro-workspace-card" className="flex flex-col gap-1.5 rounded-xl border border-line bg-[#F7F5F5] p-2.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-bold text-charcoal truncate">{ws.name}</span>
                    <span
                      data-testid="kiro-workspace-badges"
                      className="flex items-center gap-1 flex-wrap"
                    >
                      {ws.id === activeWorkspaceId && (
                        <span className="text-[9px] font-bold text-charcoal bg-pastel-mint px-1.5 py-0.5 rounded">
                          当前
                        </span>
                      )}
                      {ws.roots.map((root) => {
                        const status = grantStatus[root.adapterRef] ?? "missing";
                        const isSandbox = root.adapterRef === "sandbox-default" || root.adapterRef.startsWith("sandbox");
                        return (
                          <span key={root.id} className="flex items-center gap-1 flex-wrap">
                            <span className="text-[9px] font-semibold text-sandrift px-1.5 py-0.5 rounded bg-white border border-line">
                              {isSandbox ? "Sandbox" : "本地"}
                            </span>
                            <span
                              className={cn(
                                "text-[9px] font-semibold px-1.5 py-0.5 rounded border",
                                root.access === "read-write"
                                  ? "text-success border-line"
                                  : "text-sandrift border-line"
                              )}
                            >
                              {root.access === "read-write" ? "读写" : "只读"}
                            </span>
                            {!isSandbox && (
                              <span
                                className={cn(
                                  "text-[9px] font-semibold px-1.5 py-0.5 rounded border",
                                  status === "granted"
                                    ? "text-success border-line"
                                    : "text-danger border-danger-border bg-danger-bg"
                                )}
                              >
                                {status === "granted" ? "已授权" : status === "missing" ? "未授权" : "需要重新授权"}
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {ws.roots.map((root) => {
                      const isSandbox = root.adapterRef === "sandbox-default" || root.adapterRef.startsWith("sandbox");
                      return (
                        <span key={root.id} className="flex items-center gap-1 text-[10px] text-satin-grey truncate">
                          {isSandbox ? (
                            <HardDrive className="w-3 h-3 shrink-0 text-sandrift" />
                          ) : (
                            <FolderOpen className="w-3 h-3 shrink-0 text-sandrift" />
                          )}
                          <span className="truncate">{root.label}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
              {/* 添加位置：独立于单个 Workspace 卡（视觉上不表示“修改当前 root”） */}
              <div className="flex flex-wrap gap-1.5 pt-1.5">
                <Button variant="secondary" size="sm" onClick={handleAddBrowserLocation} disabled={addingLocation}>
                  <FolderOpen className="w-3 h-3" />
                  添加本地位置
                </Button>
                <Button variant="secondary" size="sm" onClick={handleUseSandbox}>
                  <HardDrive className="w-3 h-3" />
                  添加 Sandbox
                </Button>
              </div>
            </div>
          )}
        </SettingsGroup>

        <SettingsGroup title="安全与能力">
          <SettingsRow
            settingId="kiro-agent-permissions"
            title="活动与安全"
            description="V1 不包含：删除文件、执行命令（shell / PowerShell / cmd）、启动应用、MCP、任意网络访问、Full Access 模式。"
          >
            <span className="text-[11px] text-satin-grey shrink-0">
              <ShieldAlert className="w-3.5 h-3.5 inline mr-1 text-sandrift" />
              受限沙箱
            </span>
          </SettingsRow>
          {/* Part 3：Computer Audit（最近活动；只清 audit metadata） */}
          <KiroComputerAuditPanel />
          <SettingsRow
            title="桌面能力"
            description="Full Access、终端与系统级操作属于未来桌面版（Tauri）能力。"
          >
            <span className="text-[11px] text-sandrift shrink-0">
              <MonitorUp className="w-3.5 h-3.5 inline mr-1" />
              桌面版后续支持
            </span>
          </SettingsRow>
        </SettingsGroup>
      </div>
    </SettingsSection>
  );
}
