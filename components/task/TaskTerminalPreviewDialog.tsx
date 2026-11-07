"use client";

import React from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, Clock, Repeat2, X } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { formatEstimatedMinutes } from "@/lib/tasks/taskSemantics";
import type { TaskTransitionPreview } from "@/lib/tasks/taskTransitions";
import { cn } from "@/lib/utils";

/**
 * Phase 0：提交/完成前的统一预览。
 * 只展示 preview 事实；确认后由调用方执行 transitionTask。
 */
export function TaskTerminalPreviewDialog({
  preview,
  taskTitle,
  onCancel,
  onConfirm,
}: {
  preview: TaskTransitionPreview;
  taskTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isSubmit = preview.toStatus === "submitted";
  const blocked = preview.blockers.length > 0;
  const release = preview.sideEffects.releaseStudyBlocks;
  const reminders = preview.sideEffects.cancelReminders;
  const recurrence = preview.sideEffects.recurrence;
  const incomplete = preview.sideEffects.incompleteSubtasks;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      overlayId="task-terminal-preview"
      stackZ={50}
      aria-label={isSubmit ? "提交任务" : "完成任务"}
      className="max-w-md"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-charcoal">{isSubmit ? "提交这个任务？" : "完成这个任务？"}</h2>
          <p className="mt-1 truncate text-[11px] text-sandrift">{taskTitle}</p>
        </div>
        <IconButton variant="ghost" size="sm" onClick={onCancel} aria-label="关闭">
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="space-y-3 px-5 py-4 text-xs">
        <div className="rounded-xl border border-line bg-[#F7F5F5]/70 p-3">
          <div className="flex items-center gap-2 text-charcoal">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span className="font-semibold">{isSubmit ? "状态将变为“等待反馈”" : "状态将变为“已完成”"}</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-satin-grey">
            {isSubmit
              ? "不再出现在今天和计划中，可在「等待反馈」里重新打开。"
              : "已安排的学习时间和提醒会一并释放。"}
          </p>
        </div>

        {(release.count > 0 || reminders.count > 0 || recurrence.willGenerate) && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-sandrift">同时</p>
            {release.count > 0 && (
              <Row
                icon={<CalendarDays className="h-3.5 w-3.5" />}
                label={`释放 ${release.count} 个未来学习计划`}
                detail={formatEstimatedMinutes(release.minutes) ?? `${release.minutes} 分钟`}
              />
            )}
            {reminders.count > 0 && (
              <Row
                icon={<Clock className="h-3.5 w-3.5" />}
                label={`取消 ${reminders.count} 个提醒`}
                detail={
                  reminders.autoCount > 0
                    ? `${reminders.manualCount} 个手动 · ${reminders.autoCount} 个自动`
                    : `${reminders.manualCount} 个手动`
                }
              />
            )}
            {recurrence.willGenerate && (
              <Row
                icon={<Repeat2 className="h-3.5 w-3.5" />}
                label="生成下一次重复任务"
                detail={recurrence.nextDdl ? `下次截止 ${recurrence.nextDdl.slice(0, 10)}` : "下一次"}
              />
            )}
          </div>
        )}

        {incomplete.count > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-bg/50 p-3 text-[11px] text-satin-grey">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span>还有 {incomplete.count} 个子任务未完成。</span>
          </div>
        )}

        {preview.blockers.includes("focus-running") && (
          <div className="flex items-start gap-2 rounded-xl border border-danger-border bg-danger-bg/60 p-3 text-[11px] text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>正在专注中，请先结束专注。</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line-soft px-5 py-3">
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button
          variant="primary"
          disabled={blocked}
          onClick={onConfirm}
          className={cn(blocked && "opacity-50")}
        >
          {isSubmit ? "确认提交" : "确认完成"}
        </Button>
      </div>
    </Dialog>
  );
}

function Row({
  icon,
  label,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line-soft bg-surface px-3 py-2">
      <span className="text-sandrift">{icon}</span>
      <span className="min-w-0 flex-1 truncate font-semibold text-charcoal">{label}</span>
      <span className="shrink-0 text-[10px] text-sandrift">{detail}</span>
    </div>
  );
}
