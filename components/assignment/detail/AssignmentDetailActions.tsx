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
 * - Workflow UX V14：日程受 planning eligibility gate（todo/doing 才可安排）——
 *   资格由父级（AssignmentDrawer）计算传入，本组件只负责 presentation；
 *   disabled 保留按钮位置（不隐藏，避免 Action Bar 布局跳动），
 *   「在时间表查看」（View existing schedule）是独立语义，不受此影响
 */
export function AssignmentDetailActions({
  completed,
  onComplete,
  onReopen,
  onSchedule,
  scheduleDisabled = false,
  scheduleDisabledTitle,
  onReminder,
  onEdit,
  className,
}: {
  completed: boolean;
  onComplete: () => void;
  onReopen: () => void;
  onSchedule: () => void;
  /** Workflow UX V14：submitted / completed → true（planning terminal） */
  scheduleDisabled?: boolean;
  scheduleDisabledTitle?: string;
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
      <Button
        variant="secondary"
        size="sm"
        onClick={onSchedule}
        disabled={scheduleDisabled}
        aria-label={
          scheduleDisabled
            ? `日程：${scheduleDisabledTitle ?? "当前状态无需继续安排学习时间"}`
            : undefined
        }
        className="h-8 px-2.5"
      >
        <CalendarPlus className="h-3.5 w-3.5" />
        日程
      </Button>
      <Button variant="secondary" size="sm" onClick={onReminder} className="h-8 px-2.5">
        <Bell className="h-3.5 w-3.5" />
        提醒
      </Button>
      <Button variant="secondary" size="sm" onClick={onEdit} className="h-8 px-2.5">
        <Edit3 className="h-3.5 w-3.5" />
        编辑
      </Button>
    </div>
  );
}
