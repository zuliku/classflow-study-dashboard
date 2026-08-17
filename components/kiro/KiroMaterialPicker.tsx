"use client";

import React, { useEffect } from "react";
import { FileText, Image as ImageIcon, FolderOpen } from "lucide-react";
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const coursesWithMaterials = courses.filter((c) => c.materials.length > 0);

  return (
    <div role="menu" aria-label="选择课程资料" className="py-1 max-h-[320px] overflow-y-auto">
      {coursesWithMaterials.length === 0 && (
        <p className="px-3 py-2 text-xs text-sandrift">暂无课程资料，请先在课程中上传。</p>
      )}
      {coursesWithMaterials.map((c) => (
        <div key={c.id} className="mb-1">
          <p className="px-3 pt-1.5 pb-1 text-[10px] font-bold text-sandrift uppercase tracking-wider">
            {c.name}
          </p>
          {c.materials.map((m) => {
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
      <p className="px-3 pt-1 text-[10px] text-sandrift">正文由 Kiro 按需读取，不会自动发送全部资料。</p>
    </div>
  );
}
