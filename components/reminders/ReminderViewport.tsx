"use client";

import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useReminderDeliveryStore } from "@/store/useReminderDeliveryStore";
import { Reminder } from "@/types";
import { formatLocalDateTime } from "@/lib/reminders/reminderDomain";
import { getReminderDeliverySubtitle } from "@/lib/reminders/reminderPresentation";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";
import { cn } from "@/lib/utils";

/** 站内 Card 自动隐藏时长（仅隐藏，不 markReminderRead） */
const CARD_AUTO_HIDE_MS = 10_000;
/** 同时最多显示张数（queue 可更多，消失后下一张进入） */
const MAX_VISIBLE_CARDS = 3;

/**
 * Reminder Viewport（Task 7G-A2）：ChatGPT 风格站内通知。
 * - 左 Kiro Logo Plate（36px）/ 右 title + subtitle
 * - Desktop 右上角 / Mobile 顶部；z-[80]（高于 Toast）
 * - 自动隐藏不写 readAt（「弹出来」≠「用户看过」）；手动 × / 点击主体 → markReminderRead
 * - 点击主体按 targetType 基础导航（standalone 待 A3 Reminder Center 接入）
 */
export function ReminderViewport() {
  const queue = useReminderDeliveryStore((s) => s.queue);
  const dismiss = useReminderDeliveryStore((s) => s.dismiss);
  const reminders = useAppStore((s) => s.reminders);
  const visible = queue
    .map((id) => reminders.find((r) => r.id === id))
    .filter((r): r is Reminder => !!r)
    .slice(0, MAX_VISIBLE_CARDS);

  const handleDismiss = (reminder: Reminder, markRead: boolean) => {
    if (markRead) {
      useAppStore.getState().markReminderRead(reminder.id, formatLocalDateTime(new Date()));
    }
    dismiss(reminder.id);
  };

  const handleOpen = (reminder: Reminder) => {
    const state = useAppStore.getState();
    state.markReminderRead(reminder.id, formatLocalDateTime(new Date()));
    dismiss(reminder.id);
    if (reminder.targetType === "assignment" && reminder.targetId) {
      state.setSelectedAssignmentId(reminder.targetId);
    } else if (reminder.targetType === "studyBlock" || reminder.targetType === "calendarMark") {
      state.setActiveTab("timetable");
    }
    // standalone：A3 Reminder Center 完成后接入导航
  };

  return (
    <div
      data-testid="reminder-viewport"
      className="fixed top-3 left-3 right-3 md:left-auto md:right-4 md:top-4 z-[80] flex flex-col gap-2 pointer-events-none md:w-[400px]"
    >
      {visible.map((r) => (
        <ReminderCard
          key={r.id}
          reminder={r}
          onOpen={() => handleOpen(r)}
          onDismiss={(markRead) => handleDismiss(r, markRead)}
        />
      ))}
    </div>
  );
}

function ReminderCard({
  reminder,
  onOpen,
  onDismiss,
}: {
  reminder: Reminder;
  onOpen: () => void;
  onDismiss: (markRead: boolean) => void;
}) {
  // 自动隐藏（10s）：只从 queue 移除，绝不写 readAt
  const autoHideRef = useRef<number | null>(null);
  useEffect(() => {
    autoHideRef.current = window.setTimeout(() => onDismiss(false), CARD_AUTO_HIDE_MS);
    return () => {
      if (autoHideRef.current !== null) clearTimeout(autoHideRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="status"
      className="pointer-events-auto flex items-start gap-3 bg-surface border border-line-strong rounded-[20px] shadow-card px-4 py-3.5 ux-inline"
    >
      {/* Kiro Logo Plate */}
      <span className="w-9 h-9 shrink-0 rounded-xl bg-alabaster/70 border border-line-soft flex items-center justify-center">
        <KiroLogoIcon className="w-6 h-6" />
      </span>

      {/* Title + Subtitle */}
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 text-left"
        aria-label={`查看提醒：${reminder.title}`}
      >
        <p className="text-[13px] font-semibold text-charcoal leading-snug truncate">
          {reminder.title}
        </p>
        <p className="text-[11px] text-satin-grey mt-0.5 leading-snug line-clamp-2">
          {getReminderDeliverySubtitle(reminder)}
        </p>
      </button>

      {/* 手动关闭 = 用户明确处理 → mark read */}
      <button
        type="button"
        onClick={() => onDismiss(true)}
        aria-label={`关闭提醒 ${reminder.title}`}
        className={cn(
          "shrink-0 p-1 rounded-lg text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
        )}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
