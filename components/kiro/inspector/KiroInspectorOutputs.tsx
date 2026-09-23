"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Download, FileClock, FileCode, FileText, Loader2, MessagesSquare, Trash2 } from "lucide-react";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useKiroArtifactUiStore } from "@/store/useKiroArtifactUiStore";
import { useKiroSessionMeta } from "@/components/kiro/KiroSessionProvider";
import { useKiroArtifactActions } from "@/hooks/useKiroArtifactActions";
import { useConfirmStore } from "@/store/useConfirmStore";
import {
  listArtifactEntriesForConversation,
  listRecentArtifactEntries,
  type KiroRecentArtifactEntry,
} from "@/lib/ai/computer/artifacts/access";
import { removeArtifactRecord } from "@/lib/ai/computer/artifacts/service";
import { INSPECTOR_OUTPUTS_LIMIT } from "@/lib/ai/ui/kiroInspector";
import { formatHistoryTime } from "@/lib/ai/history/sanitize";
import {
  KiroInspectorEmptyState,
  KiroInspectorRow,
  KiroInspectorSection,
} from "@/components/kiro/inspector/KiroInspectorSection";

const TYPE_LABELS: Record<string, string> = { markdown: "Markdown", docx: "Word", text: "文本" };

function typeLabel(entry: KiroRecentArtifactEntry): string {
  return TYPE_LABELS[entry.artifact.type] ?? entry.artifact.type;
}

/** Output row 第二行：类型 · revision · 时间（低权重） */
function outputMeta(entry: KiroRecentArtifactEntry): string {
  return [
    typeLabel(entry),
    entry.artifact.revision > 1 ? `v${entry.artifact.revision}` : null,
    formatHistoryTime(entry.artifact.updatedAt),
  ]
    .filter(Boolean)
    .join(" · ");
}

function RowAction({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={
        danger
          ? "p-1 rounded-md text-sandrift hover:bg-white/70 hover:text-danger transition-colors"
          : "p-1 rounded-md text-sandrift hover:bg-white/70 hover:text-charcoal transition-colors"
      }
    >
      {children}
    </button>
  );
}

/**
 * Kiro Inspector — Outputs（V1.2，Codex-style 层级）。
 *
 * 数据：Conversation-scoped Artifact（sourceConversationId === currentConversationId；真实 metadata）。
 * 刷新：conversation / workspace 变化、turn settle（conversationSourcesVersion / historyVersion）、
 *       artifact UI invalidation（删除后立即刷新）。**无 polling、无 filesystem watcher**。
 * 无本次输出时提供低权重「最近文件」fallback（按需展开才查询）。
 */
export function KiroInspectorOutputs() {
  const meta = useKiroSessionMeta();
  const activeWorkspaceId = useKiroComputerStore((s) => s.activeWorkspaceId);
  const workspaces = useKiroComputerStore((s) => s.workspaces);
  const artifactUiVersion = useKiroArtifactUiStore((s) => s.artifactUiVersion);
  const { previewArtifact, downloadArtifact, deleteArtifact, askKiroArtifact } = useKiroArtifactActions();
  const confirm = useConfirmStore((s) => s.confirm);

  const conversationId = meta.currentConversationId;
  const [entries, setEntries] = useState<KiroRecentArtifactEntry[]>([]);
  const [recentEntries, setRecentEntries] = useState<KiroRecentArtifactEntry[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const [loading, setLoading] = useState(false);

  // Conversation Artifact：低频 invalidation 驱动（无 polling）
  useEffect(() => {
    if (!activeWorkspaceId || !conversationId) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void listArtifactEntriesForConversation({
      workspaceId: activeWorkspaceId,
      conversationId,
      workspaces,
      limit: INSPECTOR_OUTPUTS_LIMIT,
    })
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeWorkspaceId,
    conversationId,
    workspaces,
    meta.conversationSourcesVersion,
    meta.historyVersion,
    artifactUiVersion,
  ]);

  // Workspace 最近文件（fallback；只有用户展开时才查询）
  useEffect(() => {
    if (!showRecent || !activeWorkspaceId) return;
    let cancelled = false;
    void listRecentArtifactEntries({ workspaceId: activeWorkspaceId, workspaces, limit: 6 })
      .then((list) => {
        if (!cancelled) setRecentEntries(list);
      })
      .catch(() => {
        if (!cancelled) setRecentEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showRecent, activeWorkspaceId, workspaces, meta.conversationSourcesVersion, artifactUiVersion]);

  const removeStale = useCallback(async (entry: KiroRecentArtifactEntry) => {
    await removeArtifactRecord(entry.artifact.id);
    useKiroArtifactUiStore.getState().bumpArtifactUiVersion();
  }, []);

  const requestDelete = (entry: KiroRecentArtifactEntry) => {
    confirm({
      title: `删除「${entry.artifact.displayName}」？`,
      description: "此操作会从当前 Kiro 工作区删除该文件，删除后无法通过 Kiro 撤销。",
      confirmLabel: "删除文件",
      danger: true,
      onConfirm: () => {
        void deleteArtifact(entry.artifact.id);
      },
    });
  };

  const renderRow = (entry: KiroRecentArtifactEntry) => {
    const available = entry.availability === "available";
    const icon =
      entry.artifact.type === "markdown" ? (
        <FileCode className="w-3.5 h-3.5" aria-hidden="true" />
      ) : (
        <FileText className="w-3.5 h-3.5" aria-hidden="true" />
      );
    return (
      <KiroInspectorRow
        key={entry.artifact.id}
        testId="kiro-inspector-output-row"
        icon={icon}
        className="data-[availability=missing]:opacity-80"
        {...(available
          ? {
              onClick: () => previewArtifact(entry.artifact.id),
              ariaLabel: `预览 ${entry.artifact.displayName}`,
            }
          : {})}
        actions={
          available ? (
            <>
              <RowAction label={`下载 ${entry.artifact.displayName}`} onClick={() => void downloadArtifact(entry.artifact.id)}>
                <Download className="w-3.5 h-3.5" />
              </RowAction>
              <RowAction label={`Ask Kiro ${entry.artifact.displayName}`} onClick={() => void askKiroArtifact(entry.artifact.id)}>
                <MessagesSquare className="w-3.5 h-3.5" />
              </RowAction>
              <RowAction label={`删除 ${entry.artifact.displayName}`} onClick={() => requestDelete(entry)} danger>
                <Trash2 className="w-3.5 h-3.5" />
              </RowAction>
            </>
          ) : entry.availability === "missing" ? (
            <RowAction label={`移除记录 ${entry.artifact.displayName}`} onClick={() => void removeStale(entry)} danger>
              <Trash2 className="w-3.5 h-3.5" />
            </RowAction>
          ) : null
        }
      >
        <span className="block text-xs font-semibold text-charcoal truncate">{entry.artifact.displayName}</span>
        <span className="block text-[10px] text-sandrift truncate">
          {available ? outputMeta(entry) : entry.availability === "missing" ? "文件不存在" : entry.unavailableReason ?? "暂时无法访问"}
        </span>
      </KiroInspectorRow>
    );
  };

  return (
    <KiroInspectorSection
      title="输出内容"
      count={entries.length}
      testId="kiro-inspector-outputs"
    >
      {loading && entries.length === 0 ? (
        <div className="flex items-center gap-1.5 px-1.5 py-2 text-sandrift">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
          <span className="text-[10px]">加载中…</span>
        </div>
      ) : entries.length === 0 ? (
        <>
          <KiroInspectorEmptyState
            icon={<FileClock className="w-3.5 h-3.5" />}
            text="暂无本次对话输出"
            hint="Kiro 在本对话创建的文件会显示在这里。"
          />
          <button
            type="button"
            onClick={() => setShowRecent((v) => !v)}
            aria-expanded={showRecent}
            className="mt-0.5 flex w-full items-center gap-1.5 px-1.5 h-7 rounded-lg text-[11px] font-semibold text-satin-grey hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            <FileClock className="w-3.5 h-3.5" />
            最近文件
          </button>
          {showRecent ? (
            <div className="mt-0.5">
              {recentEntries.length === 0 ? (
                <KiroInspectorEmptyState text="暂无最近文件" />
              ) : (
                recentEntries.map((entry) => renderRow(entry))
              )}
            </div>
          ) : null}
        </>
      ) : (
        <div className="space-y-0.5">{entries.map((entry) => renderRow(entry))}</div>
      )}
    </KiroInspectorSection>
  );
}
