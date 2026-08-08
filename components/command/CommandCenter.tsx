"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Search, X, ArrowRight, Keyboard } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useShallow } from "zustand/react/shallow";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";
import { usePresence } from "@/lib/usePresence";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
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

const OVERLAY_ID = "command-center";

export function CommandCenter() {
  // 选择性订阅：仅在这些 slice 变化时重渲染（弹层常驻挂载，避免全量订阅）
  const {
    isSearchModalOpen,
    setSearchModalOpen,
    searchModalView,
    setSearchModalView,
    courses,
    assignments,
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
    setAddCourseModalOpen,
    setImportScheduleModalOpen,
    setFullTimetableModalOpen,
    setAssignmentTimeSlice,
    resetToCurrentWeek,
  } = useAppStore(
    useShallow((s) => ({
      isSearchModalOpen: s.isSearchModalOpen,
      setSearchModalOpen: s.setSearchModalOpen,
      searchModalView: s.searchModalView,
      setSearchModalView: s.setSearchModalView,
      courses: s.courses,
      assignments: s.assignments,
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
      setAddCourseModalOpen: s.setAddCourseModalOpen,
      setImportScheduleModalOpen: s.setImportScheduleModalOpen,
      setFullTimetableModalOpen: s.setFullTimetableModalOpen,
      setAssignmentTimeSlice: s.setAssignmentTimeSlice,
      resetToCurrentWeek: s.resetToCurrentWeek,
    }))
  );

  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);

  // 任务动作（与 Context Menu / Bulk Bar 同一工厂）
  const assignmentActions = useMemo(
    () =>
      createAssignmentActions({
        getAssignments: () => useAppStore.getState().assignments,
        updateAssignment: (a) => useAppStore.getState().updateAssignment(a),
        setSelectedAssignmentId: (id) => useAppStore.getState().setSelectedAssignmentId(id),
        deleteAssignment: (id) => useAppStore.getState().deleteAssignment(id),
        restoreAssignment: (a, marks) => useAppStore.getState().restoreAssignment(a, marks),
        pushToast: (t) => pushToast(t),
        confirm: (r) => confirmRequest(r),
      }),
    [pushToast, confirmRequest]
  );

  const { mounted, visible } = usePresence(isSearchModalOpen, 220);
  useRestoreFocus(isSearchModalOpen);

  // Overlay 栈 + Esc（仅最上层）
  useEffect(() => {
    if (!mounted) return;
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
  }, [mounted, setSearchModalOpen]);

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
      semester,
      currentSemesterWeek,
      highlightedAssignmentId,
      assignmentSelection,
      assignmentActions,
      setActiveTab: (t: NavTab) => setActiveTab(t),
      setSelectedCourseId: (id: string | null) => setSelectedCourseId(id),
      setSelectedAssignmentId: (id: string | null) => setSelectedAssignmentId(id),
      setAddCourseModalOpen: (o: boolean) => setAddCourseModalOpen(o),
      setImportScheduleModalOpen: (o: boolean) => setImportScheduleModalOpen(o),
      setFullTimetableModalOpen: (o: boolean) => setFullTimetableModalOpen(o),
      setAssignmentTimeSlice: (s: TimeSliceFilter) => setAssignmentTimeSlice(s),
      resetToCurrentWeek: () => resetToCurrentWeek(),
      close: () => setSearchModalOpen(false),
    }),
    [activeTab, selectedCourseId, selectedAssignmentId, highlightedAssignmentId, assignmentSelection, courses, assignments, semester, currentSemesterWeek, assignmentActions, setActiveTab, setSelectedCourseId, setSelectedAssignmentId, setAddCourseModalOpen, setImportScheduleModalOpen, setFullTimetableModalOpen, setAssignmentTimeSlice, resetToCurrentWeek, setSearchModalOpen]
  );

  const items = useMemo(() => buildPalette(query, ctx), [query, ctx]);

  // 结果变化时高亮回到第一项
  useEffect(() => {
    setHighlighted(0);
  }, [query, searchModalView]);

  if (!mounted) return null;

  const clampIndex = (i: number) =>
    items.length === 0 ? 0 : Math.min(Math.max(i, 0), items.length - 1);

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => clampIndex(i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => clampIndex(i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[highlighted]?.run();
    }
  };

  // 按分组顺序渲染，组间用极淡分隔线
  const renderGroup = (group: string, groupItems: PaletteItem[]) => {
    if (groupItems.length === 0) return null;
    const firstGlobalIndex = items.findIndex((it) => it.group === group);
    return (
      <div key={group}>
        {firstGlobalIndex > 0 && <div className="my-1 h-px bg-line-soft" />}
        <h4 className="px-3 pt-2 pb-1 text-[10px] font-bold text-sandrift uppercase tracking-wider">
          {GROUP_LABELS[group as keyof typeof GROUP_LABELS] ?? group}
        </h4>
        {groupItems.map((item) => {
          const globalIndex = items.indexOf(item);
          const isHighlighted = globalIndex === highlighted;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onMouseMove={() => setHighlighted(globalIndex)}
              onClick={() => item.run()}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors duration-[var(--motion-fast)]",
                isHighlighted ? "bg-alabaster text-charcoal" : "text-satin-grey"
              )}
            >
              <Icon
                className={cn(
                  "w-4 h-4 shrink-0 transition-colors duration-[var(--motion-fast)]",
                  isHighlighted ? "text-charcoal" : "text-[#A48F82]"
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
                  "w-3.5 h-3.5 shrink-0 transition-all duration-[var(--motion-fast)]",
                  isHighlighted ? "opacity-100 translate-x-0 text-sandrift" : "opacity-0 -translate-x-0.5"
                )}
              />
            </button>
          );
        })}
      </div>
    );
  };

  // 保持分组顺序，但组间插分隔线
  const groups: string[] = [];
  for (const it of items) if (!groups.includes(it.group)) groups.push(it.group);
  const renderedGroups = groups.map((g) => ({ g, items: items.filter((it) => it.group === g) }));

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center pt-16 md:pt-20 p-3 sm:p-4",
        "ux-overlay",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      <div
        data-testid="command-center"
        className={cn(
          "w-full max-w-[680px] bg-surface rounded-2xl shadow-drawer border border-line overflow-hidden flex flex-col",
          "ux-modal-panel",
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.985] translate-y-1"
        )}
      >
        {searchModalView === "guide" ? (
          /* ---- Shortcut Guide 子视图 ---- */
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-charcoal flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-[#A48F82]" />
                键盘快捷键
              </h3>
              <button
                onClick={() => setSearchModalOpen(false)}
                className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster transition-colors"
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {SHORTCUT_GUIDE.map((section) => (
              <div key={section.group}>
                <h4 className="text-[10px] font-bold text-sandrift uppercase tracking-wider mb-1.5">
                  {section.group}
                </h4>
                <div className="space-y-1">
                  {section.items.map((it) => (
                    <div
                      key={it.keys + it.label}
                      className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#F7F5F5]"
                    >
                      <span className="text-xs text-satin-grey">{it.label}</span>
                      <kbd className="bg-white text-charcoal text-[10px] font-mono px-2 py-0.5 rounded border border-line-strong">
                        {it.keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-[10px] text-sandrift">
              按 Esc 关闭 · 按 Cmd/Ctrl + K 快速切换
            </p>
          </div>
        ) : (
          /* ---- Command Palette 主视图 ---- */
          <>
            {/* Input */}
            <div className="flex items-center px-4 py-3.5 border-b border-[#F0EBE1] bg-[#F7F5F5]">
              <Search className="w-4 h-4 text-[#A48F82] shrink-0 mr-3" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="搜索命令、课程、任务…"
                aria-label="命令中心搜索"
                className="w-full text-sm bg-transparent border-none focus:outline-none text-charcoal placeholder-sandrift"
                autoFocus
              />
              <button
                onClick={() => setSearchModalOpen(false)}
                className="p-1.5 rounded-lg text-sandrift hover:bg-alba transition-colors"
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Results：单面板内部列表行，不做一堆卡片 */}
            <div
              data-testid="command-results"
              className="p-2 max-h-[min(440px,60dvh)] overflow-y-auto"
            >
              {items.length === 0 ? (
                <div className="py-10 text-center text-xs text-sandrift">
                  未找到匹配项
                </div>
              ) : (
                renderedGroups.map(({ g, items: groupItems }) =>
                  renderGroup(g, groupItems)
                )
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
