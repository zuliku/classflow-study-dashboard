"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Search, X, ArrowRight, Keyboard } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useShallow } from "zustand/react/shallow";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";
import { usePresence } from "@/lib/usePresence";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { cn } from "@/lib/utils";
import {
  buildPalette,
  GROUP_LABELS,
  SHORTCUT_GUIDE,
  CommandContext,
  PaletteItem,
} from "@/lib/commands";
import { NavTab, TimeSliceFilter } from "@/types";
import { createAssignmentActions } from "@/lib/assignmentActions";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useReminderCenterStore } from "@/store/useReminderCenterStore";
import { useOptionalKiroHandoff } from "@/hooks/useKiroHandoff";
import { KIRO_ICON } from "@/components/layout/navItems";

const OVERLAY_ID = "command-center";

export function CommandCenter() {
  // 选择性订阅：仅在这些 slice 变化时重渲染（弹层常驻挂载，避免全量订阅）
  const {
    isSearchModalOpen,
    setSearchModalOpen,
    searchModalView,
    courses,
    assignments,
    calendarMarks,
    groupProjects,
    semester,
    currentSemesterWeek,
    activeTab,
    selectedCourseId,
    selectedAssignmentId,
    highlightedAssignmentId,
    assignmentSelection,
    setActiveTab,
    setSelectedCourseId,
    setSelectedAssignmentId,
    setSelectedCalendarMarkId,
    setSelectedGroupProjectId,
    setPendingGroupTaskTarget,
    setAddCourseModalOpen,
    setImportScheduleModalOpen,
    setFullTimetableModalOpen,
    setAssignmentTimeSlice,
    resetToCurrentWeek,
    setSettingsModalOpen,
    setAssignmentWorkspaceView,
  } = useAppStore(
    useShallow((s) => ({
      isSearchModalOpen: s.isSearchModalOpen,
      setSearchModalOpen: s.setSearchModalOpen,
      searchModalView: s.searchModalView,
      setSearchModalView: s.setSearchModalView,
      courses: s.courses,
      assignments: s.assignments,
      calendarMarks: s.calendarMarks,
      groupProjects: s.groupProjects,
      semester: s.semester,
      currentSemesterWeek: s.currentSemesterWeek,
      activeTab: s.activeTab,
      selectedCourseId: s.selectedCourseId,
      selectedAssignmentId: s.selectedAssignmentId,
      highlightedAssignmentId: s.highlightedAssignmentId,
      assignmentSelection: s.assignmentSelection,
      setActiveTab: s.setActiveTab,
      setSelectedCourseId: s.setSelectedCourseId,
      setSelectedAssignmentId: s.setSelectedAssignmentId,
      setSelectedCalendarMarkId: s.setSelectedCalendarMarkId,
      setSelectedGroupProjectId: s.setSelectedGroupProjectId,
      setPendingGroupTaskTarget: s.setPendingGroupTaskTarget,
      setAddCourseModalOpen: s.setAddCourseModalOpen,
      setImportScheduleModalOpen: s.setImportScheduleModalOpen,
      setFullTimetableModalOpen: s.setFullTimetableModalOpen,
      setAssignmentTimeSlice: s.setAssignmentTimeSlice,
      resetToCurrentWeek: s.resetToCurrentWeek,
      setSettingsModalOpen: s.setSettingsModalOpen,
      setAssignmentWorkspaceView: s.setAssignmentWorkspaceView,
    }))
  );

  const [query, setQuery] = useState("");
  // P0 流畅度：输入即时响应光标，搜索用 deferred 值（每键全量 buildPalette 不再阻塞 keystroke）
  const deferredQuery = React.useDeferredValue(query);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<number, HTMLButtonElement>());
  /** hover 跟随武装位：键盘导航后失活，真实指针移动后恢复（防 scroll-hover 抢占） */
  const pointerActiveRef = useRef(true);
  // 焦点陷阱：Tab不出命令面板（与 Overlay Esc/关闭、焦点恢复共存）
  const trapTab = useFocusTrap(panelRef, isSearchModalOpen);

  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const openReminderCenter = useReminderCenterStore((s) => s.open);
  // 全局搜索必须永远可用：Kiro Provider 暂不可用（未挂载 / 开发期 HMR）时降级，不拖垮整个应用
  const handoff = useOptionalKiroHandoff();
  const singleKeyEnabled = useAppStore((s) => s.preferences.enableSingleKeyShortcuts);
  const contentDensity = useAppStore((s) => s.preferences.contentDensity);

  // 任务动作（与 Context Menu / Bulk Bar 同一工厂）
  const assignmentActions = useMemo(
    () =>
      createAssignmentActions({
        getAssignments: () => useAppStore.getState().assignments,
        updateAssignment: (a) => useAppStore.getState().updateAssignment(a),
        setSelectedAssignmentId: (id) => useAppStore.getState().setSelectedAssignmentId(id),
        deleteAssignment: (id) => useAppStore.getState().deleteAssignment(id),
        restoreAssignment: (snapshot) => useAppStore.getState().restoreAssignment(snapshot),
        pushToast: (t) => pushToast(t),
        confirm: (r) => confirmRequest(r),
      }),
    [pushToast, confirmRequest]
  );

  // Motion Contract：卸载窗口 MOTION_EXIT_MS.base（150）；ux-overlay/ux-modal-panel 类内
  // 是 base 档（180，兼顾进入），退场以内联时长精确对齐 exitMs（OverlayLayer BUG-070 同式），
  // 否则退出动画在 150ms 被卸载截断约两帧跳变。
  const { mounted, visible } = usePresence(isSearchModalOpen, MOTION_EXIT_MS.base);
  const exitDurationStyle = visible ? undefined : { transitionDuration: `${MOTION_EXIT_MS.base}ms` };
  useRestoreFocus(isSearchModalOpen);

  // Overlay 栈 + Esc（仅最上层）
  useEffect(() => {
    if (!isSearchModalOpen) return;
    pushOverlay(OVERLAY_ID, 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopmostOverlay(OVERLAY_ID)) {
        setSearchModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      popOverlay(OVERLAY_ID);
      window.removeEventListener("keydown", onKey);
    };
  }, [isSearchModalOpen, setSearchModalOpen]);

  // 打开时重置查询与高亮；切换视图时复位
  useEffect(() => {
    if (isSearchModalOpen) {
      setQuery("");
      setHighlighted(0);
      if (searchModalView === "palette") inputRef.current?.focus();
    }
  }, [isSearchModalOpen, searchModalView]);

  const ctx: CommandContext = useMemo(
    () => ({
      activeTab,
      selectedCourseId,
      selectedAssignmentId,
      courses,
      assignments,
      calendarMarks,
      groupProjects,
      semester,
      currentSemesterWeek,
      highlightedAssignmentId,
      assignmentSelection,
      assignmentActions,
      setActiveTab: (t: NavTab) => setActiveTab(t),
      setSettingsModalOpen: (o: boolean) => setSettingsModalOpen(o),
      setAssignmentWorkspaceView: (v) => setAssignmentWorkspaceView(v),
      openReminderCenter: () => openReminderCenter(),
      setSelectedCourseId: (id: string | null) => setSelectedCourseId(id),
      setSelectedAssignmentId: (id: string | null) => setSelectedAssignmentId(id),
      setSelectedCalendarMarkId: (id: string | null) => setSelectedCalendarMarkId(id),
      setSelectedGroupProjectId: (id: string | null) => setSelectedGroupProjectId(id),
      setPendingGroupTaskTarget: (target) => setPendingGroupTaskTarget(target),
      setAddCourseModalOpen: (o: boolean) => setAddCourseModalOpen(o),
      setImportScheduleModalOpen: (o: boolean) => setImportScheduleModalOpen(o),
      setFullTimetableModalOpen: (o: boolean) => setFullTimetableModalOpen(o),
      setAssignmentTimeSlice: (s: TimeSliceFilter) => setAssignmentTimeSlice(s),
      resetToCurrentWeek: () => resetToCurrentWeek(),
      close: () => setSearchModalOpen(false),
    }),
    [activeTab, selectedCourseId, selectedAssignmentId, highlightedAssignmentId, assignmentSelection, courses, assignments, calendarMarks, groupProjects, semester, currentSemesterWeek, assignmentActions, setActiveTab, setSelectedCourseId, setSelectedAssignmentId, setSelectedCalendarMarkId, setSelectedGroupProjectId, setPendingGroupTaskTarget, setAddCourseModalOpen, setImportScheduleModalOpen, setFullTimetableModalOpen, setAssignmentTimeSlice, resetToCurrentWeek, setSearchModalOpen, setSettingsModalOpen, setAssignmentWorkspaceView, openReminderCenter]
  );

  const items = useMemo(() => buildPalette(deferredQuery, ctx), [deferredQuery, ctx]);

  // Kiro Handoff：仅在有查询时显示（synthetic row，本地搜索主逻辑不动）
  const hasQuery = deferredQuery.trim().length > 0;
  const kiroHandoffItem: PaletteItem | null = useMemo(
    () =>
      hasQuery
        ? {
            key: "kiro-handoff",
            kind: "command",
            group: "search",
            label: "交给 Kiro",
            sub: "使用当前 ClassFlow 上下文",
            icon: KIRO_ICON,
            run: () => {
              if (!handoff) {
                pushToast({ message: "Kiro 尚未就绪，请打开 Kiro 后再试。", type: "info" });
                return;
              }
              handoff.handoffPrompt(query.trim());
              setSearchModalOpen(false);
            },
          }
        : null,
    [hasQuery, query, handoff, pushToast, setSearchModalOpen]
  );
  const displayItems = useMemo(
    () => (kiroHandoffItem ? [kiroHandoffItem, ...items] : items),
    [kiroHandoffItem, items]
  );
  // 默认高亮第一个真实匹配项（Kiro handoff 行不抢占 Enter 语义；无匹配时高亮落在 Kiro 行）
  const kiroOffset = kiroHandoffItem ? 1 : 0;

  // 结果变化时高亮回到第一个真实匹配（Kiro 行仅在有真实匹配时不抢占；无匹配时高亮落在 Kiro 行）
  useEffect(() => {
    setHighlighted(Math.min(kiroOffset, displayItems.length - 1));
  }, [deferredQuery, searchModalView, kiroOffset, displayItems.length]);

  // 高亮行滚动跟随（nearest：只在超出可视区时滚动，不抢夺页面滚动）
  // 必须在 `if (!mounted) return null` 之前声明：Hook 顺序不能随 mounted 变化
  useEffect(() => {
    const el = rowRefs.current.get(highlighted);
    if (el && typeof el.scrollIntoView === "function") {
      try {
        el.scrollIntoView({ block: "nearest" });
      } catch {
        /* jsdom / 旧环境无滚动：忽略 */
      }
    }
  }, [highlighted]);

  // displayItems key → 全局下标（此前 renderRows 内 indexOf 全量扫 = O(n²)）
  // 必须在 early-return 之前声明，否则 mounted 切换时 Hook 数量变化直接炸（Rendered more hooks）
  const displayIndexByKey = useMemo(() => {
    const m = new Map<string, number>();
    displayItems.forEach((it, i) => m.set(it.key, i));
    return m;
  }, [displayItems]);

  // 保持分组顺序（单遍分组，避免每组一次 filter = O(g·n)）；同样必须在 early-return 之前
  const renderedGroups = useMemo(() => {
    const order: string[] = [];
    const buckets = new Map<string, PaletteItem[]>();
    for (const it of items) {
      let bucket = buckets.get(it.group);
      if (!bucket) {
        bucket = [];
        buckets.set(it.group, bucket);
        order.push(it.group);
      }
      bucket.push(it);
    }
    return order.map((g) => ({ g, items: buckets.get(g) ?? [] }));
  }, [items]);

  if (!mounted) return null;

  const clampIndex = (i: number) =>
    displayItems.length === 0 ? 0 : Math.min(Math.max(i, 0), displayItems.length - 1);

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (displayItems.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      pointerActiveRef.current = false;
      setHighlighted((i) => clampIndex(i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      pointerActiveRef.current = false;
      setHighlighted((i) => clampIndex(i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      pointerActiveRef.current = false;
      setHighlighted(0);
    } else if (e.key === "End") {
      e.preventDefault();
      pointerActiveRef.current = false;
      setHighlighted(displayItems.length - 1);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      pointerActiveRef.current = false;
      setHighlighted((i) => clampIndex(i + 5));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      pointerActiveRef.current = false;
      setHighlighted((i) => clampIndex(i - 5));
    } else if (e.key === "Enter") {
      e.preventDefault();
      displayItems[highlighted]?.run();
    }
  };

  /** stationary hover（键盘滚动把行送到鼠标下，不产生 pointermove）不抢占键盘高亮：
   *  只有真实指针移动才重新武装 hover 跟随（VS Code / Linear / cmdk 同款模式） */
  const handleRowPointerMove = () => {
    pointerActiveRef.current = true;
  };
  const handleRowMouseEnter = (globalIndex: number) => () => {
    if (!pointerActiveRef.current) return;
    setHighlighted(globalIndex);
  };

  const setRowRef = (globalIndex: number) => (el: HTMLButtonElement | null) => {
    if (el) rowRefs.current.set(globalIndex, el);
    else rowRefs.current.delete(globalIndex);
  };

  // 按分组顺序渲染，组间用极淡分隔线
  // context 组按 scope 轻量分段：entity（当前对象）与 workspace（当前任务/已选任务）
  // 只有两种 scope 同时存在时才显示二级标题，单一 scope 保持简洁
  const renderGroup = (group: string, groupItems: PaletteItem[]) => {
    if (groupItems.length === 0) return null;
    const firstGlobalIndex = displayIndexByKey.get(groupItems[0]?.key ?? "") ?? 0;
    const hasEntity = groupItems.some((it) => it.contextScope === "entity");
    const hasWorkspace = groupItems.some((it) => it.contextScope === "workspace");
    const splitContext = group === "context" && hasEntity && hasWorkspace;
    const renderRows = (rows: PaletteItem[]) =>
      rows.map((item) => {
        const globalIndex = displayIndexByKey.get(item.key) ?? 0;
        const isHighlighted = globalIndex === highlighted;
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            ref={setRowRef(globalIndex)}
            role="option"
            id={`command-option-${globalIndex}`}
            aria-selected={isHighlighted}
            onPointerMove={handleRowPointerMove}
            onMouseEnter={handleRowMouseEnter(globalIndex)}
            onClick={() => item.run()}
            className={cn(
              "w-full flex items-center gap-3 px-3 rounded-xl text-left transition-colors duration-[var(--motion-fast)]",
              contentDensity === "compact" ? "py-1.5" : "py-2",
              isHighlighted ? "bg-alabaster text-charcoal" : "text-satin-grey"
            )}
          >
            <Icon
              className={cn(
                "w-4 h-4 shrink-0 transition-colors duration-[var(--motion-fast)]",
                isHighlighted ? "text-charcoal" : "text-sandrift"
              )}
            />
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-semibold truncate text-charcoal">
                {item.label}
              </span>
              {item.sub && (
                <span className="block text-[10px] text-sandrift truncate">{item.sub}</span>
              )}
            </span>
            {item.shortcut && (
              <kbd className="hidden sm:inline-block bg-white text-charcoal text-[10px] font-mono px-1.5 py-0.5 rounded border border-line-strong">
                {item.shortcut}
              </kbd>
            )}
            <ArrowRight
              className={cn(
                "w-3.5 h-3.5 shrink-0 transition-[opacity,transform] duration-[var(--motion-fast)]",
                isHighlighted ? "opacity-100 translate-x-0 text-sandrift" : "opacity-0 -translate-x-0.5"
              )}
            />
          </button>
        );
      });
    return (
      <div key={group}>
        {firstGlobalIndex > 0 && <div className="my-1 h-px bg-line-soft" />}
        <h4 className="px-3 pt-2 pb-1 text-[10px] font-bold text-sandrift uppercase tracking-wider">
          {GROUP_LABELS[group as keyof typeof GROUP_LABELS] ?? group}
        </h4>
        {splitContext ? (
          <>
            <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold text-sandrift/80">
              当前对象
            </p>
            {renderRows(groupItems.filter((it) => it.contextScope === "entity"))}
            <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-sandrift/80">
              当前任务 / 已选任务
            </p>
            {renderRows(groupItems.filter((it) => it.contextScope === "workspace"))}
          </>
        ) : (
          renderRows(groupItems)
        )}
      </div>
    );
  };

  return (
    <div
      className={cn(
        // blur 只在完全打开时保留：进退场透明度动画期间逐帧重模糊全屏是已知卡顿源
        "fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-16 md:pt-20 p-3 sm:p-4",
        visible && "backdrop-blur-sm",
        "ux-overlay",
        // 退出与 Dialog/Drawer 同式（此前 180ms standard 走满被 150ms 卸载截断两帧）
        visible ? "opacity-100" : "opacity-0 !duration-[var(--motion-exit-base)] !ease-[var(--ease-exit)]",
        !isSearchModalOpen && "pointer-events-none"
      )}
      style={exitDurationStyle}
      // 背板点击关闭（仅点中背板本身；面板内点击不关闭）
      onClick={(e) => {
        if (e.target === e.currentTarget) setSearchModalOpen(false);
      }}
    >
      <div
        data-testid="command-center"
        ref={panelRef}
        onKeyDown={trapTab}
        className={cn(
          "w-full max-w-[680px] bg-surface rounded-2xl shadow-drawer border border-line overflow-hidden flex flex-col",
          "ux-modal-panel",
          visible
            ? "opacity-100 scale-100 translate-y-0"
            : "opacity-0 scale-[0.985] translate-y-1 !duration-[var(--motion-exit-base)] !ease-[var(--ease-exit)]"
        )}
        style={exitDurationStyle}
      >
        {searchModalView === "guide" ? (
          /* ---- Shortcut Guide 子视图（BUG-G10：key 驱动 ux-fade 淡入） ---- */
          <div key="guide" className="ux-fade p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-charcoal flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-sandrift" />
                键盘快捷键
              </h3>
              <button
                onClick={() => setSearchModalOpen(false)}
                className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster transition-colors duration-[var(--motion-fast)]"
                aria-label="关闭快捷键指南"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* 单键快捷键状态提示 */}
            <p className="text-[11px] font-semibold text-charcoal bg-alabaster border border-line-strong rounded-xl px-3 py-2">
              单键快捷键：{singleKeyEnabled ? "已开启" : "已关闭"}
            </p>
            {SHORTCUT_GUIDE.map((section) => (
              <div key={section.group}>
                <h4 className="text-[10px] font-bold text-sandrift uppercase tracking-wider mb-1.5">
                  {section.group}
                </h4>
                <div className="space-y-1">
                  {section.items.map((it) => {
                    const disabled = it.singleKey && !singleKeyEnabled;
                    return (
                      <div
                        key={it.keys + it.label}
                        className={cn(
                          "flex items-center justify-between px-3 py-2 rounded-xl bg-background",
                          disabled && "opacity-50"
                        )}
                      >
                        <span className={cn("text-xs", disabled ? "text-satin-grey" : "text-satin-grey")}>
                          {it.label}
                          {disabled && (
                            <span className="block text-[9px] text-sandrift mt-0.5">
                              可在 设置 → 通用 中开启
                            </span>
                          )}
                        </span>
                        <kbd
                          className={cn(
                            "bg-white text-charcoal text-[10px] font-mono px-2 py-0.5 rounded border border-line-strong",
                            disabled && "line-through"
                          )}
                        >
                          {it.keys}
                        </kbd>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="text-[10px] text-sandrift">
              ↑↓ 选择 · Home/End 跳转 · Enter 执行 · Esc 关闭
            </p>
          </div>
        ) : (
          /* ---- Command Palette 主视图（BUG-G10：key 驱动 ux-fade 淡入） ---- */
          <div key="palette" className="ux-fade">
            {/* Input */}
            <div className="flex items-center px-4 py-3.5 border-b border-line-soft bg-background">
              <Search className="w-4 h-4 text-sandrift shrink-0 mr-3" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="搜索命令、课程、任务、资料…"
                aria-label="命令中心搜索"
                role="combobox"
                aria-expanded={displayItems.length > 0}
                aria-controls="command-results-listbox"
                aria-autocomplete="list"
                aria-activedescendant={displayItems.length > 0 ? `command-option-${highlighted}` : undefined}
                className="w-full text-sm bg-transparent border-none focus:outline-none text-charcoal placeholder-sandrift"
                autoFocus
              />
              <button
                onClick={() => setSearchModalOpen(false)}
                className="p-1.5 rounded-lg text-sandrift hover:bg-alba transition-colors"
                aria-label="关闭命令中心"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Results：单面板内部列表行，不做一堆卡片 */}
            <div
              data-testid="command-results"
              id="command-results-listbox"
              role="listbox"
              aria-label="命令搜索结果"
              className="p-2 max-h-[min(440px,60dvh)] overflow-y-auto"
            >
              <p aria-live="polite" className="sr-only">
                {displayItems.length === 0 ? "无匹配结果" : `共 ${displayItems.length} 个结果`}
              </p>
              {displayItems.length === 0 ? (
                <div className="py-10 text-center text-xs text-sandrift">
                  未找到匹配项
                </div>
              ) : (
                <>
                  {/* Kiro Handoff Row（有查询时置顶；键盘可选） */}
                  {kiroHandoffItem && (
                    <div className="pb-1">
                      <button
                        type="button"
                        ref={setRowRef(0)}
                        role="option"
                        id="command-option-0"
                        aria-selected={highlighted === 0}
                        onPointerMove={handleRowPointerMove}
                        onMouseEnter={handleRowMouseEnter(0)}
                        onClick={() => kiroHandoffItem.run()}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors duration-[var(--motion-fast)]",
                          highlighted === 0 ? "bg-alabaster text-charcoal" : "text-satin-grey"
                        )}
                      >
                        <span className="w-5 h-5 rounded-lg flex items-center justify-center shrink-0 relative overflow-hidden">
                          <span aria-hidden="true" className="absolute -inset-1/2 kiro-ring kiro-featured-flow pointer-events-none opacity-80" />
                          <span className="relative m-[1px] w-[calc(100%-2px)] h-[calc(100%-2px)] rounded-[5px] bg-background flex items-center justify-center">
                            <KIRO_ICON className="w-3 h-3" />
                          </span>
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-bold text-charcoal truncate">
                            交给 Kiro
                          </span>
                          <span className="block text-[10px] text-sandrift truncate">
                            使用当前 ClassFlow 上下文
                          </span>
                        </span>
                        <kbd className="hidden sm:inline-block bg-white text-charcoal text-[10px] font-mono px-1.5 py-0.5 rounded border border-line-strong">
                          ⏎
                        </kbd>
                      </button>
                      <div className="my-1 h-px bg-line-soft" />
                    </div>
                  )}
                  {renderedGroups.map(({ g, items: groupItems }) =>
                    renderGroup(g, groupItems)
                  )}
                </>
                )}
              </div>
          </div>
        )}
      </div>
    </div>
  );
}
