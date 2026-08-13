"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Database, RefreshCw, Trash2, FileText } from "lucide-react";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { Button } from "@/components/ui/Button";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useToastStore } from "@/store/useToastStore";
import {
  getWorkspaceKnowledgeStatus,
  refreshWorkspaceKnowledge,
  clearWorkspaceKnowledge,
} from "@/lib/ai/computer/knowledge/service";
import { KiroKnowledgeWorkspaceState } from "@/lib/ai/computer/knowledge/types";
import { getComputerAdapterForAdapterRef } from "@/lib/ai/computer/executor";
import { prepareComputerTool } from "@/lib/ai/computer/prepare";

function knowledgeStatusLabel(state: KiroKnowledgeWorkspaceState | null): string {
  if (!state) return "未建立索引";
  if (state.dirty) return "需要更新";
  if (state.partial) return "部分索引";
  return "已就绪";
}

/**
 * V3 Part 1：Workspace Knowledge 紧凑状态面板（Settings → Kiro Agent → current Workspace）。
 * 只显示 counts/status/time/actions；无 Explorer / 文件树 / 编辑器。
 * 建立/更新索引 = 用户显式 UI 操作（force），不消耗 Computer model tool quota。
 */
export function KiroWorkspaceKnowledgePanel({ workspaceId }: { workspaceId: string }) {
  const workspaces = useKiroComputerStore((s) => s.workspaces);
  const agentMode = useKiroComputerStore((s) => s.agentMode);
  const permissionRules = useKiroComputerStore((s) => s.permissionRules);
  const pushToast = useToastStore((s) => s.pushToast);

  const [state, setState] = useState<KiroKnowledgeWorkspaceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [kiroEnabled, setKiroEnabled] = useState(false);

  const refresh = useCallback(async () => {
    const s = await getWorkspaceKnowledgeStatus(workspaceId);
    setState(s);
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh, workspaceId]);

  useEffect(() => {
    // KIRO.md 已启用：exact root-level KIRO.md 存在且当前精确 fs.read policy = allow
    const workspace = workspaces.find((w) => w.id === workspaceId);
    if (!workspace) {
      setKiroEnabled(false);
      return;
    }
    void (async () => {
      let enabled = false;
      for (const root of workspace.roots) {
        const policy = prepareComputerTool({
          mode: agentMode,
          rules: permissionRules,
          workspace,
          capability: "fs.read",
          resource: { workspaceId: workspace.id, rootId: root.id, path: "KIRO.md" },
        });
        if (policy.effect !== "allow") continue;
        try {
          const io = getComputerAdapterForAdapterRef(root.adapterRef);
          const stat = await io.stat("KIRO.md");
          if (stat && stat.kind === "file") {
            enabled = true;
            break;
          }
        } catch {
          // grant 不可访问 → 不算启用
        }
      }
      setKiroEnabled(enabled);
    })();
  }, [workspaceId, workspaces, agentMode, permissionRules]);

  const runRefresh = async (mode: "incremental" | "force") => {
    const workspace = workspaces.find((w) => w.id === workspaceId);
    if (!workspace || busy) return;
    setBusy(true);
    try {
      const next = await refreshWorkspaceKnowledge({
        workspace,
        mode,
        agentMode,
        permissionRules,
        getAdapter: getComputerAdapterForAdapterRef,
      });
      setState(next);
      pushToast({ message: "知识索引已更新" });
    } catch {
      pushToast({ message: "知识索引更新失败。", type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const runClear = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await clearWorkspaceKnowledge(workspaceId);
      setState(null);
      pushToast({ message: "知识索引已清除" });
    } catch {
      pushToast({ message: "知识索引清除失败。", type: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsRow
      settingId="kiro-workspace-knowledge"
      title="工作区知识"
      description="本地词法索引用于查找相关文件候选；文件正文结论始终以实时读取为准。"
    >
      <div className="min-w-0 w-full flex flex-col gap-2" data-testid="kiro-workspace-knowledge-panel">
        <div className="rounded-xl border border-line bg-[#F7F5F5] px-3 py-2.5 flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg bg-surface border border-line flex items-center justify-center shrink-0">
            <Database className="w-3.5 h-3.5 text-sandrift" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-charcoal">{knowledgeStatusLabel(state)}</p>
            <p className="text-[10px] text-sandrift truncate">
              {state
                ? `已索引 ${state.fileCount} 个文件 · ${state.chunkCount} 个片段 · ${new Date(state.lastIndexedAt).toLocaleTimeString()}`
                : "尚未建立索引"}
            </p>
          </div>
        </div>

        {kiroEnabled && (
          <p className="text-[10px] font-semibold text-success flex items-center gap-1">
            <FileText className="w-3 h-3" aria-hidden="true" />
            KIRO.md 已启用
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {!state ? (
            <Button variant="secondary" size="sm" onClick={() => void runRefresh("force")} disabled={busy}>
              <Database className="w-3 h-3" />
              {busy ? "建立中…" : "建立索引"}
            </Button>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={() => void runRefresh("force")} disabled={busy}>
                <RefreshCw className="w-3 h-3" />
                {busy ? "更新中…" : "更新索引"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void runClear()} disabled={busy}>
                <Trash2 className="w-3 h-3" />
                清除索引
              </Button>
            </>
          )}
        </div>
      </div>
    </SettingsRow>
  );
}
