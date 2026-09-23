"use client";

import React from "react";
import { Eye, Download, Trash2, RotateCcw, AlertTriangle } from "lucide-react";
import { KiroAgentTask, KiroComputerChange } from "@/lib/ai/computer/task";
import { PersistedComputerTaskView } from "@/lib/ai/history/types";
import { formatComputerTaskResultSummary, isKiroAgentRunTerminal } from "@/lib/ai/ui/kiroAgentRun";
import { useKiroArtifactActions } from "@/hooks/useKiroArtifactActions";
import { useConfirmStore } from "@/store/useConfirmStore";

/**
 * Kiro Agent Run Result（P4）：Run 结束后的低权重结果区（flat layout，无大卡片）。
 *
 * - 只在终态显示（completed / failed / cancelled / undone / undo_failed）；运行中由
 *   Header + Timeline + Inline Approval 表达，绝不再复制 task.steps；
 * - Summary 泛化（formatComputerTaskResultSummary）：Terminal 绝不称作「文件更改」；
 * - 失败 / 取消也展示真实已完成的 changes（不隐藏已验证事实）；
 * - 复用既有 Undo / Review Runtime：canUndo → [查看更改] [撤销]；undoUsed → 撤销消失；
 *   历史恢复（PersistedComputerTaskView）→ display-only（不重建 Undo 能力）；
 * - Artifact hover actions（预览 / 下载 / 删除）继续可用。
 */
export function KiroAgentRunResult({
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
      <div data-testid="kiro-agent-run-result" data-state="history" className="space-y-1.5 pt-1">
        <p className="text-[11px] font-semibold text-satin-grey">
          {formatComputerTaskResultSummary({
            status: historyTask.status,
            changes: historyTask.changes,
          })}
        </p>
        {historyTask.changes.length > 0 && (
          <ChangeList
            changes={historyTask.changes}
            onPreview={previewArtifact}
            onDownload={downloadArtifact}
            onDelete={requestDelete}
          />
        )}
        <p className="text-[10px] text-sandrift">历史记录</p>
      </div>
    );
  }

  if (!task) return null;
  // 运行中 / 等待审批：由 Agent Run 表达，绝不显示 Result 区（无重复步骤 Card）
  if (!isKiroAgentRunTerminal(taskStatusToRunStatus(task.status))) return null;

  const canUndo = task.canUndo && !task.undoUsed && task.status === "completed";

  return (
    <div data-testid="kiro-agent-run-result" data-state={task.status} className="space-y-1.5 pt-1">
      <p className="text-[11px] font-semibold text-charcoal">
        {formatComputerTaskResultSummary({ status: task.status, changes: task.changes })}
      </p>

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

      {task.changes.length > 0 && (
        <ChangeList
          changes={task.changes}
          onPreview={previewArtifact}
          onDownload={downloadArtifact}
          onDelete={requestDelete}
        />
      )}

      {task.changes.length > 0 && (
        <div className="flex items-center gap-2 pt-0.5">
          <button
            data-testid="kiro-task-review"
            onClick={() => onReview?.(task.id)}
            className="flex items-center gap-1 px-1.5 h-7 rounded-md text-[11px] font-semibold text-satin-grey hover:text-charcoal hover:bg-alabaster transition-colors"
          >
            <Eye className="w-3 h-3" aria-hidden="true" />
            查看更改
          </button>
          {canUndo && (
            <button
              data-testid="kiro-task-undo"
              onClick={() => onUndo?.(task.id)}
              className="flex items-center gap-1 px-2.5 h-7 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors"
            >
              <RotateCcw className="w-3 h-3" aria-hidden="true" />
              撤销
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** live task status → Run status（仅用于终态判定；不改变 Runtime） */
function taskStatusToRunStatus(
  status: KiroAgentTask["status"]
): "running" | "completed" | "failed" | "cancelled" {
  if (status === "running" || status === "awaiting_permission") return "running";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "completed";
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
          <li key={c.displayName + c.relativePath} className="group flex items-center gap-1.5 text-[11px] text-satin-grey">
            <span className="w-1 h-1 rounded-full bg-sandrift shrink-0" aria-hidden="true" />
            <span className="truncate min-w-0">{changeSummary(c)}</span>
            {artifactId && (
              <span className="flex items-center gap-1 shrink-0 ml-auto pl-1 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
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
