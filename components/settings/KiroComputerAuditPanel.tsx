"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
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
 * 布局：SettingsGroup 内 full-width detail block（不使用 SettingsRow 两栏）；
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
    <div
      className="px-4 py-3 border-t border-line-soft"
      data-testid="kiro-computer-audit-panel"
    >
      {/* Header：标题 + 说明；清除动作为低权重 ghost action（有记录时显示） */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-xs font-bold text-charcoal">最近活动</h4>
          <p className="text-[10px] text-sandrift mt-0.5">
            Kiro 在工作区中的文件操作与权限决策（仅元数据，不包含文件内容）。
          </p>
        </div>
        {loaded && entries.length > 0 && (
          <button
            type="button"
            onClick={() => void handleClear()}
            data-testid="kiro-audit-clear"
            className="shrink-0 flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            清除活动记录
          </button>
        )}
      </div>

      {!loaded && <p className="mt-2 text-[10px] text-sandrift">加载中…</p>}
      {loaded && entries.length === 0 && (
        <p className="mt-2 text-[10px] text-sandrift">暂无活动记录</p>
      )}

      {/* Compact flat list：divide-y，无卡片套卡片；operation 主 / decision 次级 / workspace·path 最低权重 */}
      {entries.length > 0 && (
        <ul className="mt-1.5 divide-y divide-line-soft">
          {entries.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-charcoal truncate">
                  {describeOperation(e)}
                </p>
                <p className="text-[10px] text-sandrift truncate mt-0.5">
                  {DECISION_LABELS[e.decision]}
                  {e.verification === "passed" ? " · 已验证" : ""}
                  {e.workspaceLabel ? ` · ${e.workspaceLabel}` : ""}
                  {e.rootLabel ? ` / ${e.rootLabel}` : ""}
                  {e.relativePath ? ` · ${e.relativePath}` : ""}
                </p>
              </div>
              <span className="text-[10px] text-sandrift shrink-0">
                {formatAuditTime(e.timestamp)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 主行：操作（verb · 文件名）—— operation 是主要信息 */
function describeOperation(e: ComputerAuditEntry): string {
  const verb =
    e.capability === "fs.modify" || e.capability === "document.modify"
      ? "修改文件"
      : e.capability === "fs.create" || e.capability === "document.create"
        ? "创建文件"
        : e.capability === "fs.delete"
          ? "删除文件"
          : e.capability === "fs.move"
            ? "移动文件"
            : "执行操作";
  const name = e.relativePath ? e.relativePath.split("/").pop() ?? e.relativePath : "";
  return `${verb}${name ? ` · ${name}` : ""}`;
}

function formatAuditTime(iso: string): string {
  const d = new Date(iso);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
