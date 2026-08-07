"use client";

import React, { useEffect } from "react";
import { Search, X, BookOpen, ClipboardList, ArrowRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

export function GlobalSearchModal() {
  const {
    isSearchModalOpen,
    setSearchModalOpen,
    searchQuery,
    setSearchQuery,
    courses,
    assignments,
    setSelectedCourseId,
    setSelectedAssignmentId,
  } = useAppStore();

  // Keyboard shortcut listener (Cmd+K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchModalOpen(!isSearchModalOpen);
      }
      if (e.key === "Escape" && isSearchModalOpen) {
        setSearchModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSearchModalOpen, setSearchModalOpen]);

  if (!isSearchModalOpen) return null;

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
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center pt-20 p-4 animate-in fade-in">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-drawer border border-[#E7E3DD] overflow-hidden flex flex-col">
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-[#F0EBE1] bg-[#F7F5F5]">
          <Search className="w-4 h-4 text-[#A48F82] shrink-0 mr-3" />
          <input
            type="text"
            placeholder="输入课程名称、代码、教师或作业关键词..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-sm bg-transparent border-none focus:outline-none text-charcoal placeholder-[#8C827A]"
            autoFocus
          />
          <button
            onClick={() => setSearchModalOpen(false)}
            className="p-1 rounded-lg text-[#8C827A] hover:bg-[#E0D7C6] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results Area */}
        <div className="p-4 max-h-[400px] overflow-y-auto space-y-4">
          {!searchQuery.trim() ? (
            <div className="py-8 text-center text-xs text-[#8C827A]">
              输入关键词，全量检索课程、讲师与作业 DDL
            </div>
          ) : (
            <>
              {/* Courses Results */}
              {filteredCourses.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[11px] font-bold text-[#8C827A] uppercase tracking-wider">
                    课程结果 ({filteredCourses.length})
                  </h4>
                  {filteredCourses.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => {
                        setSelectedCourseId(c.id);
                        setSearchModalOpen(false);
                      }}
                      className="p-3 bg-[#F7F5F5] hover:bg-[#F0EBE1] border border-[#E7E3DD] rounded-xl flex items-center justify-between text-xs cursor-pointer transition-colors group"
                    >
                      <div className="flex items-center space-x-3">
                        <BookOpen className="w-4 h-4 text-[#A48F82]" />
                        <div>
                          <span className="font-semibold text-charcoal group-hover:underline">
                            {c.name}
                          </span>
                          <span className="text-[10px] text-[#8C827A] ml-2 font-mono">
                            {c.code} · {c.teacher}
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-[#8C827A] group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  ))}
                </div>
              )}

              {/* Assignments Results */}
              {filteredAssignments.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[11px] font-bold text-[#8C827A] uppercase tracking-wider">
                    作业结果 ({filteredAssignments.length})
                  </h4>
                  {filteredAssignments.map((a) => (
                    <div
                      key={a.id}
                      onClick={() => {
                        setSelectedAssignmentId(a.id);
                        setSearchModalOpen(false);
                      }}
                      className="p-3 bg-[#F7F5F5] hover:bg-[#F0EBE1] border border-[#E7E3DD] rounded-xl flex items-center justify-between text-xs cursor-pointer transition-colors group"
                    >
                      <div className="flex items-center space-x-3">
                        <ClipboardList className="w-4 h-4 text-[#A48F82]" />
                        <div>
                          <span className="font-semibold text-charcoal group-hover:underline">
                            {a.title}
                          </span>
                          <span className="text-[10px] text-[#8C827A] ml-2">
                            进度: {a.progress}%
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-[#8C827A] group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  ))}
                </div>
              )}

              {filteredCourses.length === 0 && filteredAssignments.length === 0 && (
                <div className="py-8 text-center text-xs text-[#8C827A]">
                  未搜寻到相关的课程或作业
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
