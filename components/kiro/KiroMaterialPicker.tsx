"use client";

import React, { useEffect, useMemo, useState } from "react";
import { FileText, Image as ImageIcon, FolderOpen, Search, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

/** 选择课程资料：列出课程及其资料（引用形式，不复制 Blob） */
export function KiroMaterialPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (ref: { courseId: string; courseName: string; materialId: string; title: string; type: string }) => void;
}) {
  const courses = useAppStore((s) => s.courses);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Codex-style 小搜索：按资料标题 / 课程名过滤（空查询不过滤）
  const q = query.trim().toLowerCase();
  const visibleCourses = useMemo(
    () =>
      courses
        .filter((c) => c.materials.length > 0)
        .map((c) => ({
          course: c,
          materials: c.materials.filter(
            (m) => !q || m.title.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
          ),
        }))
        .filter((x) => x.materials.length > 0),
    [courses, q]
  );
  const hasAnyMaterials = courses.some((c) => c.materials.length > 0);

  return (
    <div role="menu" aria-label="选择课程资料" className="py-1">
      <div className="px-2 pb-1.5">
        <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line-soft bg-background focus-within:border-line-strong transition-colors">
          <Search className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索资料..."
            aria-label="搜索课程资料"
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
      <div className="max-h-[280px] overflow-y-auto overflow-x-clip">
        {!hasAnyMaterials && <p className="px-3 py-2 text-xs text-sandrift">暂无课程资料</p>}
        {hasAnyMaterials && visibleCourses.length === 0 && (
          <p className="px-3 py-2 text-xs text-sandrift">无匹配资料</p>
        )}
        {visibleCourses.map(({ course: c, materials }) => (
          <div key={c.id} className="mb-1">
            <p className="px-3 pt-1.5 pb-1 text-[10px] font-bold text-sandrift uppercase tracking-wider">
              {c.name}
            </p>
            {materials.map((m) => {
              const Icon = m.type === "image" ? ImageIcon : m.type === "link" ? FolderOpen : FileText;
              return (
                <button
                  key={m.id}
                  role="menuitem"
                  onClick={() =>
                    onPick({
                      courseId: c.id,
                      courseName: c.name,
                      materialId: m.id,
                      title: m.title,
                      type: m.type,
                    })
                  }
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-[11px] font-semibold text-charcoal hover:bg-alabaster transition-colors"
                >
                  <Icon className="w-4 h-4 text-sandrift shrink-0" />
                  <span className="truncate">{m.title}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
