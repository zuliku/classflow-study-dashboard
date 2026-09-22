"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Download, Eye, FileClock, FileText, Loader2, MessagesSquare, Trash2 } from "lucide-react";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useKiroArtifactUiStore } from "@/store/useKiroArtifactUiStore";
import { useKiroSessionMeta } from "@/components/kiro/KiroSessionProvider";
import { useKiroArtifactActions } from "@/hooks/useKiroArtifactActions";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import {
  listArtifactEntriesForConversation,
  listRecentArtifactEntries,
  type KiroRecentArtifactEntry,
} from "@/lib/ai/computer/artifacts/access";
import { removeArtifactRecord } from "@/lib/ai/computer/artifacts/service";
import { INSPECTOR_OUTPUTS_LIMIT } from "@/lib/ai/ui/kiroInspector";
import { formatHistoryTime } from "@/lib/ai/history/sanitize";
import { KiroInspectorEmptyState, KiroInspectorSection } from "@/components/kiro/inspector/KiroInspectorSection";

const TYPE_LABELS: Record<string, string> = { markdown: "Markdown", docx: "Word", text: "文本" };

function typeLabel(entry: KiroRecentArtifactEntry): string {
  return TYPE_LABELS[entry.artifact.type] ?? entry.artifact.type;
}

function RevisionMeta({ entry }: { entry: KiroRecentArtifactEntry }) {
  return (
    <p className="text-[10px] text-sandrift truncate mt-0.5">
      {typeLabel(entry)}
      {entry.artifact.revision > 1 ? ` · v${entry.artifact.revision}` : ""} ·{" "}
      {formatHistoryTime(entry.artifact.updatedAt)}
    </p>
  );
}

function OutputRow({
  entry,
  onPreview,
  onDownload,
  onAsk,
  onDelete,
  onRemoveRecord,
}: {
  entry: KiroRecentArtifactEntry;
  onPreview: () => void;
  onDownload: () => void;
  onAsk: () => void;
  onDelete: () => void;
  onRemoveRecord?: () => void;
}) {
  const available = entry.availability === "available";
  return (
    <div
      data-testid="kiro-inspector-output-row"
      data-availability={entry.availability}
      className="group/output flex items-start gap-2 px-1.5 py-1.5 rounded-lg hover:bg-alabaster/60 transition-colors"
    >
      <FileText className="w-3.5 h-3.5 shrink-0 mt-0.5 text-sandrift" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {available ? (
          <button
            type="button"
            onClick={onPreview}
            aria-label={`预览 ${entry.artifact.displayName}`}
            className="block w-full text-left"
          >
            <span className="block text-[11px] font-semibold text-charcoal truncate">
              {entry.artifact.displayName}
            </span>
            <RevisionMeta entry={entry} />
          </button>
        ) : (
          <div>
            <span className="block text-[11px] font-semibold text-charcoal truncate">
              {entry.artifact.displayName}
            </span>
            <p className="text-[10px] text-sandrift truncate mt-0.5">
              {entry.availability === "missing" ? "文件不存在" : entry.unavailableReason ?? "暂时无法访问"}
            </p>
          </div>
        )}
      </div>
      <span className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/output:opacity-100 group-focus-within/output:opacity-100 transition-opacity">
        {available ? (
          <>
            <button
              type="button"
              onClick={onDownload}
              aria-label={`下载 ${entry.artifact.displayName}`}
              className="p-1 rounded-md text-sandrift hover:bg-white/70 hover:text-charcoal transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onAsk}
              aria-label={`Ask Kiro ${entry.artifact.displayName}`}
              className="p-1 rounded-md text-sandrift hover:bg-white/70 hover:text-charcoal transition-colors"
            >
              <MessagesSquare className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label={`删除 ${entry.artifact.displayName}`}
              className="p-1 rounded-md text-sandrift hover:bg-white/70 hover:text-danger transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        ) : entry.availability === "missing" && onRemoveRecord ? (
          <button
            type="button"
            onClick={onRemoveRecord}
            aria-label={`移除记录 ${entry.artifact.displayName}`}
            className="p-1 rounded-md text-sandrift hover:bg-white/70 hover:text-danger transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        ) : (
          <Eye className="w-3.5 h-3.5 text-sandrift/40" aria-hidden="true" />
        )}
      </span>
    </div>
  );
}

/**
 * Kiro Inspector — Outputs（V1）。
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

  const removeStale = useCallback(
    async (entry: KiroRecentArtifactEntry) => {
      await removeArtifactRecord(entry.artifact.id);
      useKiroArtifactUiStore.getState().bumpArtifactUiVersion();
    },
    []
  );

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

  const ask = async (entry: KiroRecentArtifactEntry) => {
    await askKiroArtifact(entry.artifact.id);
  };

  const renderRow = (entry: KiroRecentArtifactEntry) => (
    <OutputRow
      key={entry.artifact.id}
      entry={entry}
      onPreview={() => previewArtifact(entry.artifact.id)}
      onDownload={() => void downloadArtifact(entry.artifact.id)}
      onAsk={() => void ask(entry)}
      onDelete={() => requestDelete(entry)}
      onRemoveRecord={() => void removeStale(entry)}
    />
  );

  return (
    <KiroInspectorSection
      title="输出内容"
      testId="kiro-inspector-outputs"
      action={
        entries.length > 0 ? (
          <span className="text-[10px] text-sandrift">{entries.length}</span>
        ) : undefined
      }
    >
      {loading && entries.length === 0 ? (
        <div className="flex items-center gap-1.5 px-0.5 py-1.5 text-sandrift">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
          <span className="text-[10px]">加载中…</span>
        </div>
      ) : entries.length === 0 ? (
        <>
          <KiroInspectorEmptyState
            text="暂无本次对话输出"
            hint="Kiro 在本对话创建的文件会显示在这里。"
          />
          <button
            type="button"
            onClick={() => setShowRecent((v) => !v)}
            aria-expanded={showRecent}
            className="mt-1 flex items-center gap-1 px-1.5 h-6 rounded-md text-[10px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            <FileClock className="w-3 h-3" />
            最近文件
          </button>
          {showRecent ? (
            <div className="mt-1">
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
