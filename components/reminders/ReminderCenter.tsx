"use client";

import React, { useEffect, useRef, useState } from "react";
import { Bell, Plus, Trash2, X, PencilLine, Check } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useReminderCenterStore } from "@/store/useReminderCenterStore";
import { Reminder } from "@/types";
import { combineLocalDateTime, parseLocalDDL } from "@/lib/ddl";
import { formatLocalDateTime } from "@/lib/reminders/reminderDomain";
import { getReminderCenterGroups, formatReminderCenterTime } from "@/lib/reminders/reminderCenterView";
import { cn } from "@/lib/utils";

const TARGET_LABELS: Record<Reminder["targetType"], string> = {
  assignment: "任务",
  studyBlock: "学习计划",
  calendarMark: "日程",
  standalone: "独立提醒",
};

function metaLine(r: Reminder): string {
  if (r.targetType === "standalone") return "自定义时间 · 独立提醒";
  const target = TARGET_LABELS[r.targetType];
  if (r.timingMode === "absolute") return `自定义时间 · ${target}`;
  const offset = r.offsetMinutes ?? 0;
  if (offset === 0) return `到期时 · ${target}`;
  const abs = Math.abs(offset);
  const unit =
    abs % 1440 === 0 && abs > 0
      ? `${abs / 1440} 天`
      : abs % 60 === 0 && abs > 0
        ? `${abs / 60} 小时`
        : `${abs} 分钟`;
  return `提前 ${unit} · ${target}`;
}

interface StandaloneDraft {
  title: string;
  date: string;
  time: string;
  note: string;
}

/**
 * Reminder Center（Task 7G-A3a）：Global Action 浮动面板（非 Workspace / NavTab）。
 * - Desktop：Sidebar 右侧展开（md left-16 / xl left-56，w-[380px]）
 * - Mobile：全宽 sheet（BottomNav More → 提醒）
 * - 分区：即将提醒（scheduled 升序）/ 已提醒（fired+skipped 最近优先）
 * - 打开即 markAllFiredRemindersRead（铃铛小点消失）
 * - standalone CRUD：Panel 内联 editor（仅 scheduled 可编辑；fired/skipped 只展示历史）
 */
export function ReminderCenter() {
  const reminders = useAppStore((s) => s.reminders);
  const isOpen = useReminderCenterStore((s) => s.isOpen);
  const close = useReminderCenterStore((s) => s.close);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [editor, setEditor] = useState<{ mode: "create" } | { mode: "edit"; reminder: Reminder } | null>(null);
  const [draft, setDraft] = useState<StandaloneDraft>({ title: "", date: "", time: "23:59", note: "" });
  const [error, setError] = useState("");

  const { upcoming, history } = getReminderCenterGroups(reminders);

  // 打开 → 统一标记 fired && !readAt 为已读（一次 set）
  useEffect(() => {
    if (!isOpen) return;
    useAppStore.getState().markAllFiredRemindersRead(formatLocalDateTime(new Date()));
  }, [isOpen]);

  // Esc / outside click 关闭（非 modal，不拦截原事件）
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [isOpen, close]);

  if (!isOpen) return null;

  const todayStr = () => formatLocalDateTime(new Date()).slice(0, 10);

  const startCreate = () => {
    setDraft({ title: "", date: todayStr(), time: "23:59", note: "" });
    setError("");
    setEditor({ mode: "create" });
  };

  const startEdit = (r: Reminder) => {
    const t = parseLocalDDL(r.triggerAt);
    setDraft({
      title: r.title,
      date: t ? `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}` : todayStr(),
      time: r.triggerAt.slice(11, 16) || "23:59",
      note: r.note ?? "",
    });
    setError("");
    setEditor({ mode: "edit", reminder: r });
  };

  const saveDraft = () => {
    const title = draft.title.trim();
    if (!title) {
      setError("请输入提醒标题");
      return;
    }
    const triggerAt = combineLocalDateTime(draft.date, draft.time);
    const trigger = parseLocalDDL(triggerAt);
    const now = new Date();
    if (!trigger) {
      setError("请选择有效的日期和时间");
      return;
    }
    if (trigger.getTime() <= now.getTime()) {
      setError("请选择未来的提醒时间");
      return;
    }
    if (editor?.mode === "edit" && editor.reminder.status === "scheduled") {
      useAppStore.getState().updateReminder(editor.reminder.id, { title, note: draft.note.trim() || undefined, triggerAt });
    } else {
      const id = useAppStore.getState().addReminder({
        title,
        note: draft.note.trim() || undefined,
        targetType: "standalone",
        timingMode: "absolute",
        triggerAt,
        source: "manual",
      });
      if (id === null) {
        setError("提醒创建失败，请重试");
        return;
      }
    }
    setEditor(null);
    setError("");
  };

  const handleDelete = (id: string) => {
    useAppStore.getState().deleteReminder(id);
  };

  const handleOpenItem = (r: Reminder) => {
    const state = useAppStore.getState();
    if (r.targetType === "assignment" && r.targetId) {
      close();
      state.setSelectedAssignmentId(r.targetId);
    } else if (r.targetType === "studyBlock" || r.targetType === "calendarMark") {
      close();
      state.setActiveTab("timetable");
    } else if (r.targetType === "standalone") {
      if (r.status === "scheduled") startEdit(r);
      // fired / skipped：只展示历史，不重新激活
    }
  };

  const renderRow = (r: Reminder, statusNote?: string) => {
    const editable = r.targetType === "standalone" && r.status === "scheduled";
    return (
      <div
        key={r.id}
        role="button"
        tabIndex={0}
        onClick={() => handleOpenItem(r)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleOpenItem(r);
        }}
        className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left hover:bg-alabaster/70 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-charcoal truncate">{r.title}</p>
          <p className="text-[10px] text-sandrift mt-0.5">
            {formatReminderCenterTime(r.triggerAt, formatLocalDateTime(new Date()))}
          </p>
          <p className="text-[10px] text-satin-grey/80 mt-0.5">
            {metaLine(r)}
            {statusNote ? ` · ${statusNote}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {editable && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                startEdit(r);
              }}
              aria-label={`编辑提醒 ${r.title}`}
              className="p-1.5 rounded-lg text-sandrift hover:text-charcoal hover:bg-white transition-colors"
            >
              <PencilLine className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(r.id);
            }}
            aria-label={`删除提醒 ${r.title}`}
            className="p-1.5 rounded-lg text-sandrift hover:text-danger hover:bg-danger-bg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[70] pointer-events-none">
      <div
        ref={panelRef}
        data-testid="reminder-center"
        className={cn(
          "pointer-events-auto fixed inset-y-0 bg-surface border-r border-line shadow-card flex flex-col",
          "left-0 right-0 md:left-16 md:right-auto xl:left-56 md:w-[380px]"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-12 border-b border-line shrink-0">
          <h2 className="flex items-center gap-2 text-sm font-bold text-charcoal">
            <Bell className="w-4 h-4 text-[#A48F82]" />
            提醒
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={startCreate}
              aria-label="新建提醒"
              className="p-1.5 rounded-lg text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={close}
              aria-label="关闭提醒中心"
              className="p-1.5 rounded-lg text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Standalone inline editor */}
        {editor && (
          <div className="shrink-0 px-4 py-3 border-b border-line bg-[#F7F5F5]/60 space-y-2">
            <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">
              {editor.mode === "edit" ? "编辑独立提醒" : "新建独立提醒"}
            </p>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="提醒标题"
              aria-label="提醒标题"
              className="w-full px-2.5 h-9 bg-white border border-line-strong rounded-lg text-xs font-semibold text-charcoal focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                aria-label="提醒日期"
                className="flex-1 px-2 h-9 bg-white border border-line-strong rounded-lg font-mono text-[11px] focus:outline-none min-w-0"
              />
              <input
                type="time"
                value={draft.time}
                onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                aria-label="提醒时间"
                className="w-24 px-2 h-9 bg-white border border-line-strong rounded-lg font-mono text-[11px] focus:outline-none"
              />
            </div>
            <input
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              placeholder="备注（可选）"
              aria-label="提醒备注"
              className="w-full px-2.5 h-9 bg-white border border-line rounded-lg text-xs text-charcoal focus:outline-none"
            />
            {error && <p className="text-[10px] font-semibold text-danger">{error}</p>}
            <div className="flex items-center gap-2">
              <button
                onClick={saveDraft}
                className="ux-press flex items-center gap-1 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors"
              >
                <Check className="w-3 h-3" />
                保存
              </button>
              <button
                onClick={() => {
                  setEditor(null);
                  setError("");
                }}
                className="px-3 h-8 rounded-lg text-[11px] font-semibold text-satin-grey hover:bg-alabaster transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* Sections */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-4">
          <div className="space-y-0.5">
            <p className="px-2 pt-1 pb-0.5 text-[10px] font-bold text-sandrift uppercase tracking-wider">
              即将提醒 {upcoming.length > 0 && `(${upcoming.length})`}
            </p>
            {upcoming.length === 0 ? (
              <p className="px-2 py-2 text-[10px] text-sandrift">暂无即将提醒</p>
            ) : (
              upcoming.map((r) => renderRow(r))
            )}
          </div>
          <div className="space-y-0.5">
            <p className="px-2 pt-1 pb-0.5 text-[10px] font-bold text-sandrift uppercase tracking-wider">
              已提醒 {history.length > 0 && `(${history.length})`}
            </p>
            {history.length === 0 ? (
              <p className="px-2 py-2 text-[10px] text-sandrift">暂无历史提醒</p>
            ) : (
              history.map((r) => renderRow(r, r.status === "skipped" ? "已跳过" : "已提醒"))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
