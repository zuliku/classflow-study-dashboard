"use client";

import React, { useState, useEffect } from "react";
import { Search, X, BookOpen, ClipboardList, ArrowRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { cardKeyHandler } from "@/lib/utils";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";
import { usePresence } from "@/lib/usePresence";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { cn } from "@/lib/utils";

const OVERLAY_ID = "global-search";

export function GlobalSearchModal() {
  const {
    isSearchModalOpen,
    setSearchModalOpen,
    courses,
    assignments,
    setSelectedCourseId,
    setSelectedAssignmentId,
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState("");

  const { mounted, visible } = usePresence(isSearchModalOpen, 220);
  useRestoreFocus(isSearchModalOpen);

  // Keyboard shortcut listener (Cmd+K or Ctrl+K) + Overlay 栈注册
  useEffect(() => {
    if (!mounted) return;
    pushOverlay(OVERLAY_ID, 50);
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchModalOpen(!isSearchModalOpen);
      }
      if (e.key === "Escape" && isSearchModalOpen && isTopmostOverlay(OVERLAY_ID)) {
        setSearchModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      popOverlay(OVERLAY_ID);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mounted, isSearchModalOpen, setSearchModalOpen]);

  if (!mounted) return null;

  const filteredCourses = searchQuery.trim()
    ? courses.filter(
        (c) =>
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.teacher.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  const filteredAssignments = searchQuery.trim()
    ? assignments.filter(
        (a) =>
          a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (a.description &&
            a.description.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : [];

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center pt-20 p-4",
        "ux-overlay",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      <div
        className={cn(
          "w-full max-w-xl bg-surface rounded-2xl shadow-drawer border border-line overflow-hidden flex flex-col",
          "ux-modal-panel",
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.985] translate-y-1"
        )}
      >
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-[#F0EBE1] bg-[#F7F5F5]">
          <Search className="w-4 h-4 text-[#A48F82] shrink-0 mr-3" />
          <input
            type="text"
            placeholder="搜索课程、任务或 DDL"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
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

        {/* Results Area */}
        <div className="p-4 max-h-[400px] overflow-y-auto space-y-4">
          {!searchQuery.trim() ? (
            <div className="py-8 text-center text-xs text-sandrift">
              输入关键词搜索课程、任务与 DDL
            </div>
          ) : (
            <>
              {/* Courses Results */}
              {filteredCourses.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[11px] font-bold text-sandrift uppercase tracking-wider">
                    课程 ({filteredCourses.length})
                  </h4>
                  {filteredCourses.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => {
                        setSelectedCourseId(c.id);
                        setSearchModalOpen(false);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={cardKeyHandler(() => {
                        setSelectedCourseId(c.id);
                        setSearchModalOpen(false);
                      })}
                      className="p-3 bg-[#F7F5F5] hover:bg-alabaster border border-line rounded-xl flex items-center justify-between text-xs cursor-pointer transition-colors group"
                    >
                      <div className="flex items-center space-x-3">
                        <BookOpen className="w-4 h-4 text-[#A48F82]" />
                        <div>
                          <span className="font-semibold text-charcoal ">
                            {c.name}
                          </span>
                          <span className="text-[10px] text-sandrift ml-2 font-mono">
                            {c.code} · {c.teacher}
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-sandrift transition-transform duration-[var(--motion-fast)] group-hover:translate-x-px" />
                    </div>
                  ))}
                </div>
              )}

              {/* Assignments Results */}
              {filteredAssignments.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[11px] font-bold text-sandrift uppercase tracking-wider">
                    任务 ({filteredAssignments.length})
                  </h4>
                  {filteredAssignments.map((a) => (
                    <div
                      key={a.id}
                      onClick={() => {
                        setSelectedAssignmentId(a.id);
                        setSearchModalOpen(false);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={cardKeyHandler(() => {
                        setSelectedAssignmentId(a.id);
                        setSearchModalOpen(false);
                      })}
                      className="p-3 bg-[#F7F5F5] hover:bg-alabaster border border-line rounded-xl flex items-center justify-between text-xs cursor-pointer transition-colors group"
                    >
                      <div className="flex items-center space-x-3">
                        <ClipboardList className="w-4 h-4 text-[#A48F82]" />
                        <div>
                          <span className="font-semibold text-charcoal ">
                            {a.title}
                          </span>
                          <span className="text-[10px] text-sandrift ml-2">
                            进度：{a.progress}%
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-sandrift transition-transform duration-[var(--motion-fast)] group-hover:translate-x-px" />
                    </div>
                  ))}
                </div>
              )}

              {filteredCourses.length === 0 && filteredAssignments.length === 0 && (
                <div className="py-8 text-center text-xs text-sandrift">
                  未找到相关课程或任务
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
