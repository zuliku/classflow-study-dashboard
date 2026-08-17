"use client";

import React from "react";
import { CheckCircle2, Eye, RotateCcw, Clock3, XCircle, AlertTriangle, Download, Trash2 } from "lucide-react";
import { KiroAgentTask, KiroComputerChange } from "@/lib/ai/computer/task";
import { PersistedComputerTaskView } from "@/lib/ai/history/types";
import { useKiroArtifactActions } from "@/hooks/useKiroArtifactActions";
import { useConfirmStore } from "@/store/useConfirmStore";
import { cn } from "@/lib/utils";

/**
 * Kiro Agent Task Card（Part 3）：渲染在 owning assistant message 内。
 * - 只展示真实 runtime 事实（steps / changes），绝不展示 chain-of-thought。
 * - completed 且 checkpoint 存在且未使用 → [查看更改] [撤销本次更改]。
 * - 历史恢复 → display-only（无 checkpoint，无按钮）。
 * - V2 Part 3：每个带 artifactId 的 change row 提供低权重 [预览]/[下载]（历史卡同样可用）。
 */
export function KiroAgentTaskCard({
  task,
  historyTask,
  onReview,
  onUndo,
}: {
  task?: KiroAgentTask;
  historyTask?: PersistedComputerTaskView;
  onReview?: (taskId: string) => void;
  onUndo?: (taskId: string) => void;
}) {
  const { previewArtifact, downloadArtifact, deleteArtifact } = useKiroArtifactActions();
  const confirm = useConfirmStore((s) => s.confirm);

  const requestDelete = (artifactId: string, displayName: string) => {
    confirm({
      title: `删除「${displayName}」？`,
      description: "此操作会从当前 Kiro 工作区删除该文件，删除后无法通过 Kiro 撤销。",
      confirmLabel: "删除文件",
      danger: true,
      onConfirm: () => {
        void deleteArtifact(artifactId);
      },
    });
  };

  if (historyTask) {
    return (
      <div
        data-testid="kiro-agent-task-card"
        className="rounded-2xl border border-line bg-[#F7F5F5] p-3 space-y-2"
      >
        <TaskHeader status={historyTask.status} changeCount={historyTask.changes.length} />
        <p className="text-xs font-bold text-charcoal truncate">{historyTask.title}</p>
        {historyTask.changes.length > 0 && (
          <ChangeList
            changes={historyTask.changes}
            onPreview={previewArtifact}
            onDownload={downloadArtifact}
            onDelete={requestDelete}
          />
        )}
        <p className="text-[10px] text-sandrift">历史记录（仅展示，不能撤销）</p>
      </div>
    );
  }
  if (!task) return null;

  const canUndo = task.canUndo && !task.undoUsed && task.status === "completed";

  return (
    <div
      data-testid="kiro-agent-task-card"
      className={cn(
        "rounded-2xl border p-3 space-y-2",
        task.status === "undo_failed"
          ? "border-danger-border bg-danger-bg"
          : "border-line bg-[#F7F5F5]"
      )}
    >
      <TaskHeader status={task.status} changeCount={task.changes.length} />
      <p className="text-xs font-bold text-charcoal truncate">{task.title}</p>

      {task.status === "awaiting_permission" && (
        <p className="text-[11px] text-satin-grey leading-relaxed">
          等待你的许可
          <span className="text-charcoal font-semibold">
            {" "}
            {task.steps.find((s) => s.status === "awaiting_permission")?.label ?? "执行操作"}
          </span>
        </p>
      )}

      {task.status === "running" && task.steps.length > 0 && (
        <ul className="space-y-1">
          {task.steps.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5 text-[11px] text-satin-grey">
              <Clock3 className="w-3 h-3" aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      {task.status === "failed" && (
        <p className="text-[11px] text-satin-grey">部分操作未完成</p>
      )}

      {task.changes.length > 0 && (
        <ChangeList
          changes={task.changes}
          onPreview={previewArtifact}
          onDownload={downloadArtifact}
          onDelete={requestDelete}
        />
      )}

      {task.status === "undone" && (
        <p className="text-[11px] font-semibold text-success flex items-center gap-1.5">
          <RotateCcw className="w-3 h-3" aria-hidden="true" />
          已撤销本次更改
        </p>
      )}
      {task.status === "undo_failed" && (
        <p className="text-[11px] font-semibold text-danger flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
          撤销未完成（部分恢复失败）
        </p>
      )}

      {canUndo && (
        <div className="flex items-center gap-2 pt-0.5">
          <button
            data-testid="kiro-task-review"
            onClick={() => onReview?.(task.id)}
            className="flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11px] font-bold text-charcoal bg-surface border border-line hover:border-line-strong transition-colors"
          >
            <Eye className="w-3 h-3" aria-hidden="true" />
            查看更改
          </button>
          <button
            data-testid="kiro-task-undo"
            onClick={() => onUndo?.(task.id)}
            className="flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            撤销本次更改
          </button>
        </div>
      )}
    </div>
  );
}

function TaskHeader({ status, changeCount }: { status: string; changeCount: number }) {
  if (status === "undone" || status === "undo_failed") {
    return (
      <p className="flex items-center gap-1.5 text-[11px] font-bold text-charcoal">
        <RotateCcw className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
        已执行撤销
      </p>
    );
  }
  if (status === "awaiting_permission") {
    return (
      <p className="flex items-center gap-1.5 text-[11px] font-bold text-charcoal">
        <Clock3 className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
        等待许可
      </p>
    );
  }
  if (status === "failed" || status === "cancelled") {
    return (
      <p className="flex items-center gap-1.5 text-[11px] font-bold text-satin-grey">
        <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        {status === "failed" ? "操作未完成" : "已取消"}
      </p>
    );
  }
  if (status === "running") {
    return (
      <p className="flex items-center gap-1.5 text-[11px] font-bold text-charcoal">
        <Clock3 className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
        正在执行
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-[11px] font-bold text-charcoal">
      <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
      已完成 {changeCount} 项文件更改
    </p>
  );
}

function ChangeList({
  changes,
  onPreview,
  onDownload,
  onDelete,
}: {
  changes: Array<KiroComputerChange | PersistedComputerTaskView["changes"][number]>;
  onPreview: (artifactId: string) => void;
  onDownload: (artifactId: string) => void;
  onDelete: (artifactId: string, displayName: string) => void;
}) {
  return (
    <ul className="space-y-1">
      {changes.map((c) => {
        const artifactId = "artifactId" in c ? c.artifactId : undefined;
        return (
          <li key={c.displayName + c.relativePath} className="flex items-center gap-1.5 text-[11px] text-satin-grey">
            <span className="w-1 h-1 rounded-full bg-sandrift shrink-0" aria-hidden="true" />
            <span className="truncate min-w-0">{changeSummary(c)}</span>
            {artifactId && (
              <span className="flex items-center gap-0.5 shrink-0 ml-auto pl-1">
                <button
                  onClick={() => onPreview(artifactId)}
                  aria-label={`预览 ${c.displayName}`}
                  title="预览"
                  className="w-6 h-6 rounded-md flex items-center justify-center text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => void onDownload(artifactId)}
                  aria-label={`下载 ${c.displayName}`}
                  title="下载"
                  className="w-6 h-6 rounded-md flex items-center justify-center text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onDelete(artifactId, c.displayName)}
                  aria-label={`删除 ${c.displayName}`}
                  title="删除文件"
                  className="w-6 h-6 rounded-md flex items-center justify-center text-sandrift hover:text-danger hover:bg-danger-bg transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function changeSummary(c: { operation: string; displayName: string; fromRelativePath?: string; relativePath: string; revision?: number }): string {
  if (c.operation === "rename") {
    return `重命名 ${c.fromRelativePath ?? c.displayName} → ${c.displayName}`;
  }
  if (c.operation === "move") {
    return `移动 ${c.fromRelativePath ?? c.displayName} → ${c.relativePath}`;
  }
  if (c.operation === "delete") {
    return `删除 ${c.displayName}`;
  }
  // Desktop Terminal V1：命令执行（displayName = 命令预览）
  if (c.operation === "execute") {
    return `运行 ${c.displayName}`;
  }
  const name = c.operation === "create" ? `创建 ${c.displayName}` : `修改 ${c.displayName}`;
  return c.revision !== undefined ? `${name} · v${c.revision}` : name;
}
