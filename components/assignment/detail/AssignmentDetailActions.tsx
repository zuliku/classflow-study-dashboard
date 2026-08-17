"use client";

import React from "react";
import { Bell, CalendarPlus, Check, Edit3, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

/**
 * Assignment Detail Secondary Actions（Task Execution Loop V1）：
 * - 开始专注（eligible 且无 active）由 focusSlot 由父级注入（primary slot）
 * - 标记完成 / 重新打开：统一 secondary（完成态 → 重新打开）
 * - 日程 → Timeline 安排链路；提醒 → 展开 Reminder disclosure；编辑 → openAssignmentEditor
 */
export function AssignmentDetailActions({
  completed,
  onComplete,
  onReopen,
  onSchedule,
  onReminder,
  onEdit,
  className,
}: {
  completed: boolean;
  onComplete: () => void;
  onReopen: () => void;
  onSchedule: () => void;
  onReminder: () => void;
  onEdit: () => void;
  className?: string;
}) {
  return (
    <div
      data-testid="detail-primary-actions"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      {completed ? (
        <Button variant="secondary" size="sm" onClick={onReopen} className="h-8 px-3">
          <RotateCcw className="h-3.5 w-3.5" />
          重新打开
        </Button>
      ) : (
        <Button variant="secondary" size="sm" onClick={onComplete} className="h-8 px-3">
          <Check className="h-3.5 w-3.5" />
          标记完成
        </Button>
      )}
      <Button variant="secondary" size="sm" onClick={onSchedule} className="h-8 px-2.5" title="安排学习时间">
        <CalendarPlus className="h-3.5 w-3.5" />
        日程
      </Button>
      <Button variant="secondary" size="sm" onClick={onReminder} className="h-8 px-2.5" title="设置提醒">
        <Bell className="h-3.5 w-3.5" />
        提醒
      </Button>
      <Button variant="secondary" size="sm" onClick={onEdit} className="h-8 px-2.5" title="编辑任务">
        <Edit3 className="h-3.5 w-3.5" />
        编辑
      </Button>
    </div>
  );
}
