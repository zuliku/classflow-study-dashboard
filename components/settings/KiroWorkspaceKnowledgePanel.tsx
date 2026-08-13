"use client";

import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2, FileText } from "lucide-react";
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

function formatTimeOnly(iso: string): string {
  const d = new Date(iso);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * V3 Part 1：Workspace Knowledge 设置项（V3 Part 1.1 Productization）。
 * SettingsRow 是唯一主容器；状态/计数/时间/KIRO.md 均为 inline metadata，无第二层卡片。
 * 建立/更新索引 = 用户显式 UI 操作（bounded force refresh），不消耗 Computer model tool quota。
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
    setState(await getWorkspaceKnowledgeStatus(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh, workspaceId]);

  useEffect(() => {
    // KIRO.md 已启用：exact root-level KIRO.md 存在且当前精确 fs.read policy = allow 且 adapter 可访问
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

  const runRefresh = async () => {
    const workspace = workspaces.find((w) => w.id === workspaceId);
    if (!workspace || busy) return;
    setBusy(true);
    try {
      const next = await refreshWorkspaceKnowledge({
        workspace,
        mode: "force",
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

  const primary = `${knowledgeStatusLabel(state)}${state ? ` · ${state.fileCount} 文件 · ${state.chunkCount} 片段` : ""}`;
  const secondary =
    state && !state.dirty
      ? `上次更新 ${formatTimeOnly(state.lastIndexedAt)}${kiroEnabled ? " · KIRO.md 已启用" : ""}`
      : kiroEnabled
        ? "KIRO.md 已启用"
        : "";

  return (
    <SettingsRow
      settingId="kiro-workspace-knowledge"
      title="工作区知识"
      description="本地词法索引用于查找相关文件候选；文件正文结论始终以实时读取为准。"
    >
      <div
        className="min-w-0 w-full flex flex-col gap-1"
        data-testid="kiro-workspace-knowledge-panel"
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[11px] font-semibold text-charcoal min-w-0 truncate">{primary}</p>
          <span className="flex items-center gap-1.5 shrink-0">
            {!state ? (
              <Button variant="secondary" size="sm" onClick={() => void runRefresh()} disabled={busy}>
                <RefreshCw className="w-3 h-3" />
                {busy ? "建立中…" : "建立索引"}
              </Button>
            ) : (
              <>
                <Button variant="secondary" size="sm" onClick={() => void runRefresh()} disabled={busy}>
                  <RefreshCw className="w-3 h-3" />
                  {busy ? "更新中…" : "更新"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void runClear()} disabled={busy}>
                  <Trash2 className="w-3 h-3" />
                  清除
                </Button>
              </>
            )}
          </span>
        </div>
        {secondary && (
          <p className="text-[10px] text-sandrift min-w-0 truncate">
            {secondary.includes("KIRO.md 已启用") ? (
              <>
                {secondary.replace(" · KIRO.md 已启用", "")}
                {secondary.startsWith("上次更新") && " · "}
                <span className="text-success font-semibold inline-flex items-center gap-0.5">
                  <FileText className="w-3 h-3" aria-hidden="true" />
                  KIRO.md 已启用
                </span>
              </>
            ) : (
              secondary
            )}
          </p>
        )}
      </div>
    </SettingsRow>
  );
}
