"use client";

import React, { useState } from "react";
import { Bell, Check, PencilLine, Plus, Trash2, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { Assignment, Reminder } from "@/types";
import { combineLocalDateTime, getLocalDDLDate, getLocalDDLTime, parseLocalDDL } from "@/lib/ddl";
import { formatLocalDateTime } from "@/lib/reminders/reminderDomain";
import {
  formatAssignmentReminderLabel,
  getAssignmentPresetAvailability,
  getAssignmentScheduledReminders,
  hasAssignmentReminderDuplicate,
} from "@/lib/reminders/assignmentReminderView";
import { cn } from "@/lib/utils";

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Assignment Reminder Section（Task 7G-A3b）：Drawer 内多提醒管理。
 * - 只管理当前 Assignment 的 scheduled Reminder（fired/skipped 由 Reminder Center 管理）
 * - 四个 relative preset（到期时 / 提前10分钟 / 提前1小时 / 提前1天）+ 自定义 absolute
 * - relative 跟随 DDL（Store 已 reconcile）；absolute 固定时间
 * - 无 DDL → relative disabled；解析后已过期 → disabled；重复 → 已添加
 * - 编辑 / 删除直接操作同一 useAppStore.reminders（Reminder Center 自动同步）
 */
export function AssignmentReminderSection({ assignment }: { assignment: Assignment }) {
  const reminders = useAppStore((s) => s.reminders);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"presets" | "custom">("presets");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("23:59");
  const [customError, setCustomError] = useState("");

  const scheduled = getAssignmentScheduledReminders(reminders, assignment.id);
  const now = formatLocalDateTime(new Date());
  const availability = getAssignmentPresetAvailability(assignment, reminders, now, editingId ?? undefined);
  const completed = assignment.status === "completed";

  const ddlValid = !!assignment.ddl && parseLocalDDL(assignment.ddl) !== null;

  const openPicker = (mode: "presets" | "custom", editing?: Reminder) => {
    setPickerMode(mode);
    setEditingId(editing?.id ?? null);
    setCustomError("");
    // 自定义默认值（§24）：合法未来 DDL 预填 DDL 日期时间；否则今天 23:59（已过则明天 09:00）
    if (mode === "custom") {
      let date = localDateStr(new Date());
      let time = "23:59";
      if (editing) {
        const t = parseLocalDDL(editing.triggerAt);
        if (t) {
          date = localDateStr(t);
          time = editing.triggerAt.slice(11, 16) || "23:59";
        }
      } else if (ddlValid && parseLocalDDL(assignment.ddl!)!.getTime() > new Date().getTime()) {
        date = getLocalDDLDate(assignment.ddl);
        time = getLocalDDLTime(assignment.ddl) || "23:59";
      } else {
        const base = combineLocalDateTime(date, time);
        const baseDate = parseLocalDDL(base)!;
        if (baseDate.getTime() <= new Date().getTime()) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(9, 0, 0, 0);
          date = localDateStr(tomorrow);
          time = "09:00";
        }
      }
      setCustomDate(date);
      setCustomTime(time);
    }
    setPickerOpen(true);
  };

  const closePicker = () => {
    setPickerOpen(false);
    setEditingId(null);
    setCustomError("");
  };

  const applyRelative = (offsetMinutes: number) => {
    if (!ddlValid) return;
    const state = useAppStore.getState();
    if (editingId) {
      state.updateReminderByUser(editingId, {
        title: assignment.title,
        timingMode: "relative",
        offsetMinutes,
        triggerAt: assignment.ddl!,
      });
      // relative triggerAt 需要按当前 DDL 重新解析
      state.reconcileTargetReminders("assignment", assignment.id);
    } else {
      state.addReminder({
        title: assignment.title,
        targetType: "assignment",
        targetId: assignment.id,
        timingMode: "relative",
        offsetMinutes,
        triggerAt: assignment.ddl!,
        source: "manual",
      });
    }
    closePicker();
  };

  const saveCustom = () => {
    const triggerAt = combineLocalDateTime(customDate, customTime);
    const trigger = parseLocalDDL(triggerAt);
    if (!trigger) {
      setCustomError("请选择有效的日期和时间");
      return;
    }
    if (trigger.getTime() <= new Date().getTime()) {
      setCustomError("请选择未来的提醒时间");
      return;
    }
    if (
      hasAssignmentReminderDuplicate(
        reminders,
        assignment.id,
        { timingMode: "absolute", triggerAt },
        editingId ?? undefined
      )
    ) {
      setCustomError("已经存在相同时间的提醒");
      return;
    }
    const state = useAppStore.getState();
    if (editingId) {
      state.updateReminderByUser(editingId, {
        title: assignment.title,
        timingMode: "absolute",
        offsetMinutes: undefined,
        triggerAt,
      });
      // absolute 固定时间：不 reconcile
    } else {
      state.addReminder({
        title: assignment.title,
        targetType: "assignment",
        targetId: assignment.id,
        timingMode: "absolute",
        triggerAt,
        source: "manual",
      });
    }
    closePicker();
  };

  const handleDelete = (id: string) => {
    useAppStore.getState().deleteReminderByUser(id);
    if (editingId === id) closePicker();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[10px] font-bold text-sandrift uppercase tracking-wider">
          <Bell className="w-3 h-3 text-[#A48F82]" />
          提醒
          {scheduled.length > 0 && (
            <span className="text-[9px] font-bold text-satin-grey">({scheduled.length})</span>
          )}
        </h4>
        {!completed ? (
          <button
            onClick={() => openPicker("presets")}
            className="flex items-center gap-1 text-[10px] font-semibold text-satin-grey bg-white border border-line rounded-lg px-2 py-1 hover:text-charcoal hover:border-line-strong transition-colors"
          >
            <Plus className="w-3 h-3" />
            添加
          </button>
        ) : (
          <span className="text-[9px] text-sandrift">已完成任务无需新增提醒</span>
        )}
      </div>

      {scheduled.length > 0 && (
        <div className="space-y-1">
          {scheduled.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2 p-2.5 bg-[#F7F5F5] border border-line rounded-xl text-xs"
            >
              <span className="flex-1 min-w-0 font-medium text-charcoal">
                {formatAssignmentReminderLabel(r)}
              </span>
              <span className="text-[10px] font-mono text-sandrift shrink-0">
                {r.triggerAt.slice(5, 10).replace("-", "月")}日 {r.triggerAt.slice(11, 16)}
              </span>
              <button
                onClick={() => openPicker("presets", r)}
                aria-label={`编辑提醒 ${formatAssignmentReminderLabel(r)}`}
                className="p-1 rounded-lg text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors shrink-0"
              >
                <PencilLine className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleDelete(r.id)}
                aria-label={`删除提醒 ${formatAssignmentReminderLabel(r)}`}
                className="p-1 rounded-lg text-sandrift hover:text-danger hover:bg-danger-bg transition-colors shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 添加/编辑 Picker（Drawer 内内联展开，与关联资料 picker 同一语言） */}
      {pickerOpen && (
        <div data-testid="assignment-reminder-picker" className="p-2.5 bg-[#F7F5F5] border border-line rounded-xl space-y-1">
          {pickerMode === "presets" ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-sandrift">
                  {editingId ? "编辑提醒" : "添加提醒"}
                </p>
                <button
                  onClick={() => setPickerMode("custom")}
                  className="text-[10px] font-semibold text-satin-grey hover:text-charcoal transition-colors"
                >
                  自定义时间…
                </button>
              </div>
              {!ddlValid && (
                <p className="text-[10px] text-sandrift px-0.5">需要先设置截止时间</p>
              )}
              {availability.map((p) => {
                const isEditingSelf =
                  editingId !== null &&
                  reminders.find((r) => r.id === editingId)?.timingMode === "relative" &&
                  (reminders.find((r) => r.id === editingId)?.offsetMinutes ?? 0) === p.offsetMinutes;
                return (
                  <button
                    key={p.offsetMinutes}
                    onClick={() => p.available && applyRelative(p.offsetMinutes)}
                    disabled={!p.available && !isEditingSelf}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[11px] transition-colors",
                      isEditingSelf
                        ? "bg-white text-charcoal font-bold shadow-subtle"
                        : p.available
                          ? "font-medium text-charcoal hover:bg-white"
                          : "text-sandrift/70 cursor-not-allowed"
                    )}
                  >
                    <span className="flex-1">{p.label}</span>
                    {isEditingSelf ? (
                      <span className="text-[9px] font-semibold text-satin-grey">当前</span>
                    ) : p.reason === "duplicate" ? (
                      <span className="text-[9px] font-semibold text-satin-grey">已添加</span>
                    ) : p.reason === "past" ? (
                      <span className="text-[9px] font-semibold text-satin-grey">该提醒时间已过</span>
                    ) : null}
                  </button>
                );
              })}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-sandrift">自定义时间</p>
                <button
                  onClick={() => setPickerMode("presets")}
                  className="text-[10px] font-semibold text-satin-grey hover:text-charcoal transition-colors"
                >
                  ← 预设
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  aria-label="提醒日期"
                  className="flex-1 px-1.5 py-1 rounded-lg bg-white border border-line text-[11px] font-mono focus:outline-none min-w-0"
                />
                <input
                  type="time"
                  value={customTime}
                  onChange={(e) => setCustomTime(e.target.value)}
                  aria-label="提醒时间"
                  className="w-24 px-1.5 py-1 rounded-lg bg-white border border-line text-[11px] font-mono focus:outline-none"
                />
                <button
                  onClick={saveCustom}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold text-white bg-charcoal hover:bg-black disabled:opacity-50 transition-colors"
                >
                  <Check className="w-3 h-3" />
                  保存
                </button>
                <button
                  onClick={closePicker}
                  aria-label="取消"
                  className="p-1 rounded-lg text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {customError && <p className="text-[10px] font-semibold text-danger">{customError}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
