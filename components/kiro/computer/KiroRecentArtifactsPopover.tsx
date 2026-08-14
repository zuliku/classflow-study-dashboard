"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { FileClock, Eye, Download, MessagesSquare, Trash2 } from "lucide-react";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useKiroRuntime } from "@/components/kiro/KiroSessionProvider";
import { useKiroArtifactActions } from "@/hooks/useKiroArtifactActions";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import {
  listRecentArtifactEntries,
  KiroRecentArtifactEntry,
} from "@/lib/ai/computer/artifacts/access";
import { getArtifact, removeArtifactRecord } from "@/lib/ai/computer/artifacts/service";
import { KiroContextRef } from "@/lib/ai/context/types";
import { formatHistoryTime } from "@/lib/ai/history/sanitize";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = { markdown: "Markdown", docx: "Word", text: "文本" };

/**
 * 最近文件（V2 Part 3 + V2.7.1）：当前 active Workspace 最新 12 个 Artifact。
 * 打开时立即 listRecentArtifactEntries，并在打开期间轻量轮询（2s）同步文件状态——
 * Agent delete_file / Task Card 删除等外部删除发生时，已打开的列表也能自动消失，
 * 不再残留已删除文件（仅打开期间轮询本地 IndexedDB，关闭即停；无全局 watcher）。
 * Ask Kiro 只添加 Manual Context（不自动发送）；绝不切 Workspace / 不请求 Browser 授权。
 */
export function KiroRecentArtifactsPopover() {
  const activeWorkspaceId = useKiroComputerStore((s) => s.activeWorkspaceId);
  const workspaces = useKiroComputerStore((s) => s.workspaces);
  const computerEnabled = useKiroComputerStore((s) => s.computerEnabled);
  const setComputerEnabled = useKiroComputerStore((s) => s.setComputerEnabled);
  const { addManualContext } = useKiroRuntime();
  const { previewArtifact, downloadArtifact, deleteArtifact } = useKiroArtifactActions();
  const pushToast = useToastStore((s) => s.pushToast);
  const confirm = useConfirmStore((s) => s.confirm);

  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<KiroRecentArtifactEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!activeWorkspaceId) {
        setEntries([]);
        return;
      }
      if (!opts?.silent) setLoading(true);
      try {
        const list = await listRecentArtifactEntries({
          workspaceId: activeWorkspaceId,
          workspaces: useKiroComputerStore.getState().workspaces,
          limit: 12,
        });
        setEntries(list);
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [activeWorkspaceId]
  );

  // 打开时立即 refresh + 打开期间 2s 静默轮询（外部删除/移动/创建即时同步；关闭即停）
  useEffect(() => {
    if (!open) return;
    void refresh();
    const timer = window.setInterval(() => void refresh({ silent: true }), 2000);
    return () => window.clearInterval(timer);
  }, [open, refresh]);

  // 外部点击关闭
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (containerRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const askKiro = async (entry: KiroRecentArtifactEntry) => {
    if (entry.artifact.workspaceId !== activeWorkspaceId) {
      pushToast({ message: "该文件不属于当前工作区，无法加入上下文。", type: "error" });
      return;
    }
    // 重新读取 Registry：使用最新 root/path/revision
    const artifact = await getArtifact(entry.artifact.id);
    if (!artifact) {
      pushToast({ message: "文件记录不存在。", type: "error" });
      return;
    }
    if (artifact.workspaceId !== activeWorkspaceId) {
      pushToast({ message: "该文件不属于当前工作区，无法加入上下文。", type: "error" });
      return;
    }
    // 用户显式要求使用此工作区文件：可显式开启 Computer（绝不切 Workspace / 绝不请求 Browser 授权）
    if (!computerEnabled) {
      setComputerEnabled(true);
    }
    const ref: KiroContextRef = {
      key: `manual-artifact-${artifact.id}`,
      kind: "artifact",
      entityId: artifact.id,
      label: `文件 · ${artifact.displayName}`,
      source: "manual",
      artifact: {
        artifactId: artifact.id,
        workspaceId: artifact.workspaceId,
        rootId: artifact.rootId,
        relativePath: artifact.relativePath,
        type: artifact.type,
        revision: artifact.revision,
      },
    };
    addManualContext(ref);
    setOpen(false);
    pushToast({ message: "已添加到 Kiro 上下文" });
  };

  const removeStale = async (entry: KiroRecentArtifactEntry) => {
    await removeArtifactRecord(entry.artifact.id);
    await refresh();
  };

  /** 手动删除 available 文件：先二次确认（明确 user gesture），确认后走共享 deleteWorkspaceFile */
  const requestDelete = (entry: KiroRecentArtifactEntry) => {
    const displayName = entry.artifact.displayName;
    confirm({
      title: `删除「${displayName}」？`,
      description: "此操作会从当前 Kiro 工作区删除该文件，删除后无法通过 Kiro 撤销。",
      confirmLabel: "删除文件",
      danger: true,
      onConfirm: () => {
        void deleteArtifact(entry.artifact.id).then((ok) => {
          if (ok) void refresh();
        });
      },
    });
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="最近文件"
        aria-expanded={open}
        title="最近文件"
        className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
      >
        <FileClock className="w-4 h-4" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="最近文件"
          className="absolute right-0 top-11 z-40 w-[360px] max-w-[calc(100vw-24px)] rounded-2xl bg-surface border border-line shadow-card flex flex-col overflow-hidden animate-enter"
        >
          <div className="shrink-0 flex items-center justify-between px-3 py-2.5 border-b border-line">
            <h3 className="text-xs font-bold text-charcoal">最近文件</h3>
            <span className="text-[10px] text-sandrift">
              {activeWorkspaceId ? useKiroComputerStore.getState().workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? "" : ""}
            </span>
          </div>

          <div className="min-h-[180px] max-h-[420px] overflow-y-auto">
            {loading && entries.length === 0 && (
              <p className="p-3 text-[11px] text-sandrift">加载中…</p>
            )}
            {!loading && entries.length === 0 && (
              <p className="p-3 text-[11px] text-sandrift leading-relaxed">
                Kiro 创建或采用的文件会出现在这里
              </p>
            )}
            {entries.map((entry) => {
              const available = entry.availability === "available";
              return (
                <div
                  key={entry.artifact.id}
                  data-testid="kiro-recent-artifact-row"
                  className="px-3 py-2.5 border-b border-line-soft last:border-b-0 hover:bg-alabaster/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-charcoal truncate min-w-0 flex-1">
                      {entry.artifact.displayName}
                      {entry.artifact.revision > 1 ? ` · v${entry.artifact.revision}` : ""}
                    </p>
                    <span className="text-[10px] text-sandrift shrink-0">
                      {formatHistoryTime(entry.artifact.updatedAt)}
                    </span>
                  </div>
                  <p className="text-[10px] text-sandrift truncate mt-0.5">
                    {TYPE_LABELS[entry.artifact.type] ?? entry.artifact.type} · {entry.rootLabel}
                  </p>

                  <div className="flex items-center gap-1 mt-1.5">
                    {available ? (
                      <>
                        <ActionButton label={`预览 ${entry.artifact.displayName}`} onClick={() => previewArtifact(entry.artifact.id)}>
                          <Eye className="w-3.5 h-3.5" />
                          预览
                        </ActionButton>
                        <ActionButton label={`下载 ${entry.artifact.displayName}`} onClick={() => void downloadArtifact(entry.artifact.id)}>
                          <Download className="w-3.5 h-3.5" />
                          下载
                        </ActionButton>
                        <ActionButton
                          label={`Ask Kiro ${entry.artifact.displayName}`}
                          onClick={() => void askKiro(entry)}
                          disabled={!computerEnabled && entry.artifact.workspaceId !== activeWorkspaceId}
                        >
                          <MessagesSquare className="w-3.5 h-3.5" />
                          Ask Kiro
                        </ActionButton>
                        <ActionButton
                          label={`删除 ${entry.artifact.displayName}`}
                          onClick={() => requestDelete(entry)}
                          danger
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          删除
                        </ActionButton>
                      </>
                    ) : (
                      <span className="text-[10px] text-sandrift">
                        {entry.availability === "missing" ? "文件不存在" : entry.unavailableReason ?? "暂时无法访问"}
                      </span>
                    )}
                    {entry.availability === "missing" && (
                      <ActionButton
                        label={`移除记录 ${entry.artifact.displayName}`}
                        onClick={() => void removeStale(entry)}
                        danger
                        className="ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        移除记录
                      </ActionButton>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  danger,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1 px-2 h-6 rounded-md text-[10px] font-semibold transition-colors",
        danger ? "text-danger hover:bg-danger-bg" : "text-satin-grey hover:bg-alabaster hover:text-charcoal",
        disabled && "opacity-40 cursor-not-allowed",
        className
      )}
    >
      {children}
    </button>
  );
}
