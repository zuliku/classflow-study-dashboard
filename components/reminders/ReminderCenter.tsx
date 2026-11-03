"use client";

import React, { useEffect, useRef, useState } from "react";
import { Bell, Plus, Trash2, X, PencilLine, Check, Clock, CalendarClock, Search } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useReminderCenterStore } from "@/store/useReminderCenterStore";
import { useToastStore } from "@/store/useToastStore";
import { useUIChromeStore } from "@/store/useUIChromeStore";
import { Reminder } from "@/types";
import { combineLocalDateTime, parseLocalDDL } from "@/lib/ddl";
import { formatLocalDateTime } from "@/lib/reminders/reminderDomain";
import { getReminderCenterGroups, formatReminderCenterTime } from "@/lib/reminders/reminderCenterView";
import { useExitPresenceList } from "@/lib/useExitPresenceList";
import { useEnterOnAdd } from "@/lib/useEnterOnAdd";
import { usePresence } from "@/lib/usePresence";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { ExitCollapse } from "@/components/ui/ExitCollapse";
import { OverlayLayer } from "@/components/ui/OverlayLayer";
import { navigateReminderTarget } from "@/lib/reminders/reminderNavigation";

const TARGET_LABELS: Record<Reminder["targetType"], string> = {
  assignment: "任务",
  studyBlock: "学习计划",
  calendarMark: "日程",
  standalone: "独立提醒",
};

/** 来源 / 提前时间（Tertiary 信息，视觉权重低于标题与相对时间） */
function metaLine(r: Reminder): string {
  if (r.targetType === "standalone") return "独立提醒";
  const target = TARGET_LABELS[r.targetType];
  if (r.timingMode === "absolute") return `自定义时间 · ${target}`;
  const offset = r.offsetMinutes ?? 0;
  if (offset === 0) return `${target}`;
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
 * Reminder Center（ClassFlow 通知中心 + 提醒管理入口，非 Dashboard / 复杂设置页）。
 * - Bounded Floating Panel（2026-08-14）：桌面 ~400px 有界浮窗（md left-16 / xl left-56，
 *   min-h 420 / max-h min(720px, 100dvh-32px)）；移动端四周 12px 边距（min-h 360 / max-h 100dvh-24px）。
 * - Presence：OverlayLayer 生命周期——关闭先播 exit（data-state="exiting"）再 unmount；
 *   透明 backdrop 负责 outside click；Esc（topmost only）由 overlay stack 处理。
 * - 三段式：Header（shrink-0）/ Composer（shrink-0 + presence 动画）/ Groups（flex-1 min-h-0 overflow-y-auto）。
 * - 打开即 markAllFiredRemindersRead（铃铛小点消失）
 * - standalone CRUD：Panel 内联 Composer（仅 scheduled 可编辑；fired/skipped 只展示历史）
 */
export function ReminderCenter() {
  const reminders = useAppStore((s) => s.reminders);
  const isOpen = useReminderCenterStore((s) => s.isOpen);
  const close = useReminderCenterStore((s) => s.close);
  // 面板左侧呼吸间距：跟随 Sidebar 真实几何（md 强制 rail 64；xl 按折叠偏好 64/224），
  // 面板边缘不再贴着 Sidebar/内容分界线（此前写死的 md:ml-16 / xl:ml-56 在 xl 折叠态会脱离 172px）。
  const sidebarCollapsed = useUIChromeStore((s) => s.sidebarCollapsed);
  const [isXl, setIsXl] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(min-width: 1280px)").matches
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(min-width: 1280px)");
    const apply = () => setIsXl(mq.matches);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  // rail(64)/full(224) + 12px 呼吸间距；mobile 保持 mx-3 居中
  const panelMlClass = !isXl || sidebarCollapsed ? "md:ml-[76px]" : "md:ml-[76px] xl:ml-[236px]";
  const [editor, setEditor] = useState<{ mode: "create" } | { mode: "edit"; reminder: Reminder } | null>(null);
  const [draft, setDraft] = useState<StandaloneDraft>({ title: "", date: "", time: "23:59", note: "" });
  const [error, setError] = useState("");
  // Codex-style 小搜索：标题 / 备注 / 来源行过滤（分组保留；空结果给清除入口）
  const [query, setQuery] = useState("");

  // Composer presence：editor 置 null 后保留最后一个快照播 exit（纯 UI snapshot，不复制 domain 数据）。
  // Motion Contract：presence 取 exit 常量，与下方 !duration-[--motion-exit-base] 同源（此前误用 enter 档 180）。
  const composerPresence = usePresence(editor !== null, MOTION_EXIT_MS.base);
  const lastEditorRef = useRef<typeof editor>(null);
  if (editor) lastEditorRef.current = editor;
  const renderedEditor = editor ?? lastEditorRef.current;
  const composerInnerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = composerInnerRef.current;
    if (!el) return;
    // exit 帧：旧输入框不可 Tab 聚焦 / 不可交互
    if (!editor && composerPresence.mounted) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [editor, composerPresence.mounted]);

  // IM4B：全局 reminders 级 mutation retention——真删除 → exit；scheduled→fired 是 status move（id 仍在 → 不 exit）。
  // resetKey = panel session：关闭期间发生的变更不重播动画；重新打开为新会话。
  const retainedReminders = useExitPresenceList({
    items: reminders,
    getId: (r) => r.id,
    resetKey: isOpen ? "open" : "closed",
  });
  const newReminderIds = useEnterOnAdd(reminders.map((r) => r.id));
  const retainedExiting = new Map(
    retainedReminders.filter((e) => e.exiting).map((e) => [e.item.id, true])
  );
  // 分组基于 visual 列表（含 exiting 快照）→ 删除最后一条时空态不提前出现
  const searchQuery = query.trim().toLowerCase();
  const filtering = searchQuery !== "";
  const searchedItems = !filtering
    ? retainedReminders.map((e) => e.item)
    : retainedReminders
        .map((e) => e.item)
        .filter(
          (r) =>
            r.title.toLowerCase().includes(searchQuery) ||
            (r.note ?? "").toLowerCase().includes(searchQuery) ||
            metaLine(r).toLowerCase().includes(searchQuery)
        );
  const { upcoming, history } = getReminderCenterGroups(searchedItems);

  // 打开 → 统一标记 fired && !readAt 为已读（一次 set；presence exit 不触发）
  useEffect(() => {
    if (!isOpen) return;
    useAppStore.getState().markAllFiredRemindersRead(formatLocalDateTime(new Date()));
  }, [isOpen]);

  // 关闭整个 Center（Header X / Esc / outside / 任何 close() 路径）→ 结束本次 editor session：
  // editor 清零 + 清 error + 清 composer 快照 + 清搜索——重新打开绝不 stale 旧 Composer / draft。
  // 不破坏 Panel 自身 170ms exit presence（composer 随 Panel 整体淡出；重开时不闪旧 editor）。
  useEffect(() => {
    if (isOpen) return;
    setEditor(null);
    setError("");
    setQuery("");
    lastEditorRef.current = null;
  }, [isOpen]);

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

  const cancelEditor = () => {
    setEditor(null);
    setError("");
  };

  const saveDraft = () => {
    const title = draft.title.trim();
    if (!title) {
      setError("请输入提醒内容");
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
      // P2 §14：用户编辑（含 auto 转自定义 + target opt-out 由 ByUser 语义处理）
      useAppStore.getState().updateReminderByUser(editor.reminder.id, { title, note: draft.note.trim() || undefined, triggerAt });
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
    // P2 §13：用户删除（auto → 该 target opt-out 由 ByUser 语义处理）
    // 产品化：快照后删除，Toast 提供一次撤销（对齐任务删除体验）
    const snapshot = useAppStore.getState().reminders.find((r) => r.id === id);
    if (!snapshot) return;
    useAppStore.getState().deleteReminderByUser(id);
    useToastStore.getState().pushToast({
      message: "提醒已删除",
      actionLabel: "撤销",
      onAction: () => {
        useAppStore.getState().restoreReminder(snapshot);
      },
    });
  };

  const handleOpenItem = (r: Reminder) => {
    // Workflow UX V16：canonical routing 收敛到 shared navigateReminderTarget——
    // entity 目标先 close Center；standalone 保持既有语义
    //（scheduled → 就地编辑；fired / skipped 只展示历史，不重新激活）
    navigateReminderTarget(r, {
      onBeforeEntityNavigate: () => close(),
      onStandalone: (rem) => {
        if (rem.status === "scheduled") startEdit(rem);
      },
    });
  };

  const renderRow = (r: Reminder, opts: { isHistory: boolean; exiting: boolean; entering: boolean }) => {
    const { isHistory, exiting, entering } = opts;
    const editable = r.targetType === "standalone" && r.status === "scheduled";
    return (
      <ExitCollapse key={r.id} exiting={exiting}>
        <div
          role="button"
          tabIndex={0}
          aria-label={`提醒 ${r.title}`}
          onClick={() => handleOpenItem(r)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            // 焦点在行内按钮（编辑/删除）上时只执行按钮动作：按钮 click 已 stopPropagation，
            // 但 keydown 会继续冒泡到行，不判 target 会同时触发打开详情
            if ((e.target as HTMLElement | null)?.closest?.("button")) return;
            // Space 会滚动页面：仅行级 Space 激活时阻止默认
            if (e.key === " ") e.preventDefault();
            handleOpenItem(r);
          }}
          className={cn(
            "cv-list-item-compact w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-alabaster/60 transition-colors",
            isHistory && "opacity-75",
            entering && "animate-enter"
          )}
        >
        {/* 状态 icon：upcoming = 时钟；history = 已提醒勾 */}
        <span
          className={cn(
            "w-6 h-6 rounded-full flex items-center justify-center shrink-0",
            isHistory ? "bg-pastel-mint/60 text-success" : "bg-alabaster text-sandrift"
          )}
        >
          {isHistory ? (
            <Check className="w-3 h-3" />
          ) : (
            <Clock className="w-3 h-3" />
          )}
        </span>

        {/* 信息层级：Primary title / Secondary 相对时间 / Tertiary 来源·提前 */}
        <div className="flex-1 min-w-0">
          <p className={cn("flex items-center gap-1.5 text-xs font-bold truncate", isHistory ? "text-satin-grey" : "text-charcoal")}>
            <span className="truncate">{r.title}</span>
            {/* P3 provenance：自动提醒轻量标签（克制；manual 不显示；用户编辑后已转 custom） */}
            {r.source === "auto" && (
              <span className="shrink-0 px-1 py-px rounded bg-alabaster border border-line text-[9px] font-semibold text-sandrift">
                自动
              </span>
            )}
          </p>
          <p className="text-[10px] text-sandrift mt-0.5 truncate">
            {formatReminderCenterTime(r.triggerAt, formatLocalDateTime(new Date()))}
            <span className="text-satin-grey/80"> · {metaLine(r)}</span>
            {isHistory && r.status === "skipped" ? <span className="text-satin-grey/80"> · 已跳过</span> : null}
          </p>
        </div>

        {/* 行操作：编辑（ghost）/ 删除（danger） */}
        <div className="flex items-center gap-0.5 shrink-0">
          {editable && (
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={`编辑提醒 ${r.title}`}
              onClick={(e) => {
                e.stopPropagation();
                startEdit(r);
              }}
            >
              <PencilLine className="w-3.5 h-3.5" />
            </IconButton>
          )}
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={`删除提醒 ${r.title}`}
            className="hover:bg-danger-bg hover:text-danger"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(r.id);
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </IconButton>
        </div>
        </div>
      </ExitCollapse>
    );
  };

  return (
    <OverlayLayer
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      overlayId="reminder-center"
      stackZ={80}
      exitMs={MOTION_EXIT_MS.panel}
      scrimTone="soft"
      closeOnBackdrop
      className="fixed inset-x-0 bottom-0 top-[var(--titlebar-h)] flex items-center"
    >
      {({ visible }) => (
        <div
          role="dialog"
          aria-label="提醒中心"
          data-testid="reminder-center"
          data-state={isOpen ? (visible ? "open" : "entering") : "exiting"}
          className={cn(
            "pointer-events-auto flex flex-col overflow-hidden bg-surface border border-line shadow-drawer",
            // Mobile：四周 12px 边距、content-responsive、圆角 18px
            "w-[calc(100vw-24px)] mx-3 min-h-[min(360px,calc(100dvh-24px))] max-h-[calc(100dvh-24px)] rounded-[18px]",
            // Desktop：Sidebar 右侧 400px 浮窗（左侧偏移见 panelMlClass：跟随 rail/full 真实几何 + 12px 呼吸）
            "md:w-[400px] md:min-h-[min(420px,calc(100dvh-32px))] md:max-h-[min(720px,calc(100dvh-32px))] md:rounded-2xl",
            panelMlClass,
            // Motion（三态非对称）：mobile 轻浮起（translateY）/ desktop 从 Sidebar 展开（translateX）；
            // entering 用 enter 偏移（-6px / 6px, scale .992/.985），exiting 用更轻的 exit 偏移
            // （-4px / 4px, scale .994/.99）；enter ~200ms（standard），exit ~160ms 加速离场（exit）
            "transition-[opacity,transform] ease-[var(--ease-emphasized)]",
            isOpen
              ? visible
                ? "opacity-100 translate-y-0 scale-100 md:translate-x-0 ![duration:var(--motion-overlay)]"
                : "opacity-0 translate-y-1.5 scale-[0.985] md:translate-y-0 md:-translate-x-1.5 md:scale-[0.992] ![duration:var(--motion-overlay)]"
              : "opacity-0 translate-y-1 scale-[0.99] md:translate-y-0 md:-translate-x-1 md:scale-[0.994] ![duration:var(--motion-exit-panel)] !ease-[var(--ease-exit)]"
          )}
        >
          {/* Header：Bell + 标题 + 数量 badge | 新建提醒 + 关闭（shrink-0 不滚动） */}
          <div
            data-testid="reminder-center-header"
            className="flex items-center justify-between px-4 h-12 border-b border-line shrink-0 bg-[#F7F5F5]"
          >
            <h2 className="flex items-center gap-2 text-sm font-bold text-charcoal min-w-0">
              <Bell className="w-4 h-4 text-[#A48F82] shrink-0" />
              <span className="truncate">提醒</span>
              {upcoming.length > 0 && (
                <span className="text-[10px] font-bold text-white bg-charcoal px-1.5 py-0.5 rounded-full shrink-0">
                  {upcoming.length}
                </span>
              )}
            </h2>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button variant="primary" size="sm" onClick={startCreate}>
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">新建提醒</span>
                <span className="sm:hidden">新建</span>
              </Button>
              <IconButton variant="ghost" size="sm" aria-label="关闭提醒中心" onClick={close}>
                <X className="w-4 h-4" />
              </IconButton>
            </div>
          </div>

          {/* 搜索：标题 / 备注 / 来源行；分组保留，空结果给清除入口 */}
          <div className="px-3 pt-2 shrink-0">
            <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line-soft bg-background focus-within:border-line-strong transition-colors">
              <Search className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索提醒..."
                aria-label="搜索提醒"
                className="flex-1 min-w-0 bg-transparent text-xs text-charcoal placeholder:text-sandrift/70 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="清空搜索"
                  className="p-0.5 rounded text-sandrift hover:text-charcoal transition-colors shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* New Reminder Composer（presence-aware：enter grid 展开 / exit grid 折叠 + fade；不跟列表滚动） */}
          {composerPresence.mounted && renderedEditor && (
            <div
              data-testid="reminder-composer"
              data-state={editor ? (composerPresence.visible ? "open" : "entering") : "exiting"}
              className={cn(
                "grid shrink-0 transition-[grid-template-rows,opacity,transform] duration-[var(--motion-base)] ease-[var(--ease-standard)]",
                composerPresence.visible
                  ? "grid-rows-[1fr] opacity-100 translate-y-0"
                  : "grid-rows-[0fr] opacity-0 -translate-y-1 !duration-[var(--motion-exit-base)] !ease-[var(--ease-exit)]"
              )}
            >
              <div ref={composerInnerRef} className="min-h-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-line bg-alabaster/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-charcoal">
                      {renderedEditor.mode === "edit" ? "编辑提醒" : "新建提醒"}
                    </p>
                    <IconButton variant="ghost" size="sm" aria-label="关闭编辑器" onClick={cancelEditor}>
                      <X className="w-3.5 h-3.5" />
                    </IconButton>
                  </div>
                  <Field label="提醒内容" required>
                    <Input
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      placeholder="提醒内容"
                      aria-label="提醒内容"
                      autoFocus
                      invalid={!!error && !draft.title.trim()}
                    />
                  </Field>
                  <Field label="提醒时间">
                    <div className="flex items-center gap-2">
                      <Input
                        type="date"
                        value={draft.date}
                        onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                        aria-label="提醒日期"
                        className="flex-1 min-w-0"
                      />
                      <Input
                        type="time"
                        value={draft.time}
                        onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                        aria-label="提醒时间"
                        className="w-28"
                      />
                    </div>
                  </Field>
                  <Field label="备注">
                    <Textarea
                      rows={2}
                      value={draft.note}
                      onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                      placeholder="备注（可选）"
                      aria-label="提醒备注"
                    />
                  </Field>
                  {error && (
                    <InlineErrorState className="border-0 bg-transparent px-0 py-0 text-[10px]">
                      {error}
                    </InlineErrorState>
                  )}
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="secondary" onClick={cancelEditor}>
                      取消
                    </Button>
                    <Button variant="primary" onClick={saveDraft}>
                      <Check className="w-3 h-3" />
                      保存
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sections：即将提醒 / 历史提醒（唯一滚动区域） */}
          <div
            data-testid="reminder-center-list"
            className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4"
          >
            {/* 搜索无结果：隐藏分组，给清除入口（分组空态的新建引导只在非过滤时出现） */}
            {filtering && upcoming.length === 0 && history.length === 0 ? (
              <div className="flex flex-col items-center text-center gap-1.5 px-4 py-10">
                <Search className="w-7 h-7 text-sandrift" aria-hidden="true" />
                <p className="text-xs font-bold text-charcoal">无匹配提醒</p>
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="mt-1 px-3 h-7 rounded-lg text-[11px] font-bold text-satin-grey bg-alabaster border border-line hover:text-charcoal hover:border-line-strong transition-colors"
                >
                  清除搜索
                </button>
              </div>
            ) : (
              <>
            {/* Upcoming Group（过滤时空组隐藏） */}
            {(!filtering || upcoming.length > 0) && (
            <section className="rounded-xl border border-line overflow-hidden bg-surface">
              <div className="flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-line-soft bg-[#F7F5F5]/60">
                <h3 className="text-[11px] font-bold text-charcoal">即将提醒</h3>
                <span className="text-[10px] font-semibold text-sandrift bg-alabaster px-1.5 py-0.5 rounded border border-line">
                  {upcoming.length}
                </span>
              </div>
              {/* 空↔列表双挂载交叉折叠（此前旧分支瞬卸，新分支硬现，高度差大时跳变） */}
              <ExitCollapse exiting={upcoming.length !== 0}>
                {upcoming.length === 0 && (
                <div className="flex flex-col items-center text-center gap-1.5 px-4 py-7 ux-fade">
                  <CalendarClock className="w-7 h-7 text-sandrift" />
                  <p className="text-xs font-bold text-charcoal">暂时没有即将提醒</p>
                  <p className="text-[10px] text-sandrift leading-relaxed">
                    任务、DDL 与提醒
                    <br />
                    会出现在这里
                  </p>
                  <Button variant="primary" size="sm" className="mt-2" onClick={startCreate}>
                    <Plus className="w-3.5 h-3.5" />
                    新建提醒
                  </Button>
                </div>
                )}
              </ExitCollapse>
              <ExitCollapse exiting={upcoming.length === 0}>
                {upcoming.length !== 0 && (
                <div className="divide-y divide-line-soft">
                  {upcoming.map((r) =>
                    renderRow(r, {
                      isHistory: false,
                      exiting: retainedExiting.has(r.id) ?? false,
                      entering: newReminderIds.has(r.id),
                    })
                  )}
                </div>
                )}
              </ExitCollapse>
            </section>
            )}

            {/* History Group（视觉权重低于 Upcoming；过滤时空组隐藏） */}
            {(!filtering || history.length > 0) && (
            <section className="rounded-xl border border-line overflow-hidden bg-surface">
              <div className="flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-line-soft bg-[#F7F5F5]/60">
                <h3 className="text-[11px] font-bold text-charcoal">历史提醒</h3>
                <span className="text-[10px] font-semibold text-sandrift bg-alabaster px-1.5 py-0.5 rounded border border-line">
                  {history.length}
                </span>
              </div>
              <ExitCollapse exiting={history.length !== 0}>
                {history.length === 0 && (
                <div className="px-4 py-3.5 text-center ux-fade">
                  <p className="text-[10px] text-sandrift">还没有提醒记录</p>
                  <p className="text-[9px] text-satin-grey mt-0.5">触发过的提醒会保留在这里</p>
                </div>
                )}
              </ExitCollapse>
              <ExitCollapse exiting={history.length === 0}>
                {history.length !== 0 && (
                <div className="divide-y divide-line-soft">
                  {history.map((r) =>
                    renderRow(r, {
                      isHistory: true,
                      exiting: retainedExiting.has(r.id) ?? false,
                      entering: false,
                    })
                  )}
                </div>
                )}
              </ExitCollapse>
            </section>
            )}
              </>
            )}
          </div>
        </div>
      )}
    </OverlayLayer>
  );
}
