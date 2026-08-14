"use client";

import React, { useCallback, useEffect, useState } from "react";
import { History, Trash2 } from "lucide-react";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { Button } from "@/components/ui/Button";
import {
  ComputerAuditEntry,
  getRecentComputerAuditEntries,
  clearComputerAuditEntries,
} from "@/lib/ai/computer/audit";

const AUDIT_PANEL_LIMIT = 10;

const DECISION_LABELS: Record<ComputerAuditEntry["decision"], string> = {
  auto: "已执行",
  "allow-once": "已允许（一次）",
  "allow-session": "已允许（本次会话）",
  "allow-workspace": "已允许（此工作区）",
  deny: "已拒绝",
  timeout: "超时取消",
  none: "撤销",
};

/**
 * Kiro Agent Settings — 最近活动（Computer Audit，Part 3）。
 * 只读展示最近 10 条 metadata；「清除活动记录」只清 Audit，不影响 Workspace / 权限 / 文件 / 对话。
 */
export function KiroComputerAuditPanel() {
  const [entries, setEntries] = useState<ComputerAuditEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setEntries(await getRecentComputerAuditEntries(AUDIT_PANEL_LIMIT));
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleClear = async () => {
    await clearComputerAuditEntries();
    setEntries([]);
  };

  return (
    <SettingsRow
      settingId="kiro-agent-activity"
      title="最近活动"
      description="Kiro 在工作区中的文件操作与权限决策（仅元数据，不包含文件内容）。"
    >
      <div className="min-w-0 w-full flex flex-col gap-1.5" data-testid="kiro-computer-audit-panel">
        {!loaded && <span className="text-[10px] text-sandrift">加载中…</span>}
        {loaded && entries.length === 0 && (
          <span className="text-[10px] text-sandrift">暂无活动记录</span>
        )}
        {entries.map((e) => (
          <div key={e.id} className="rounded-lg border border-line bg-[#F7F5F5] px-2.5 py-1.5 space-y-0.5">
            <p className="text-[10px] text-charcoal font-semibold truncate flex items-center gap-1">
              <History className="w-3 h-3 shrink-0 text-sandrift" aria-hidden="true" />
              {DECISION_LABELS[e.decision]}
              <span className="font-normal text-satin-grey">· {formatAuditTime(e.timestamp)}</span>
            </p>
            <p className="text-[10px] text-satin-grey truncate">
              {e.outcome === "executed" ? describeChange(e) : describeOutcome(e)}
            </p>
            <p className="text-[9px] text-sandrift truncate">
              {e.workspaceLabel}
              {e.rootLabel ? ` / ${e.rootLabel}` : ""}
              {e.relativePath ? ` · ${e.relativePath}` : ""}
            </p>
          </div>
        ))}
        {entries.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-fit text-[11px]"
            onClick={() => void handleClear()}
            data-testid="kiro-audit-clear"
          >
            <Trash2 className="w-3 h-3" />
            清除活动记录
          </Button>
        )}
      </div>
    </SettingsRow>
  );
}

function describeChange(e: ComputerAuditEntry): string {
  const verb =
    e.capability === "fs.modify" || e.capability === "document.modify"
      ? "修改文件"
      : e.capability === "fs.create" || e.capability === "document.create"
        ? "创建文件"
        : "执行操作";
  const name = e.relativePath ? e.relativePath.split("/").pop() ?? e.relativePath : "";
  return `${verb}${name ? ` · ${name}` : ""}${e.verification === "passed" ? " · 已验证" : ""}`;
}

function describeOutcome(e: ComputerAuditEntry): string {
  if (e.outcome === "denied") return "已拒绝该操作";
  if (e.outcome === "undone") return "已撤销该操作";
  if (e.outcome === "undo_failed") return "撤销未完成";
  return "已执行";
}

function formatAuditTime(iso: string): string {
  const d = new Date(iso);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
