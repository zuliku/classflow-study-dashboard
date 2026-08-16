"use client";

import React, { useEffect, useRef } from "react";
import { Paperclip, FileText, Image as ImageIcon, FolderOpen } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

/** 附件菜单（+）：上传文件 / 添加图片 / 选择课程资料 */
export function KiroAttachmentPicker({
  onClose,
  onFiles,
  onMaterials,
}: {
  onClose: () => void;
  onFiles: (files: File[]) => void;
  onMaterials: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const courses = useAppStore((s) => s.courses);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickFiles = (accept: string, handler: (files: File[]) => void, ref: React.RefObject<HTMLInputElement | null>) => {
    const input = ref.current;
    if (!input) return;
    input.accept = accept;
    input.onchange = () => {
      if (input.files) handler(Array.from(input.files));
      input.value = "";
    };
    input.click();
    onClose();
  };

  const items = [
    {
      id: "file",
      icon: Paperclip,
      label: "上传文件",
      desc: "PDF / DOCX / TXT / MD",
      action: () => pickFiles(".pdf,.docx,.txt,.md", onFiles, fileRef),
    },
    {
      id: "image",
      icon: ImageIcon,
      label: "添加聊天截图或图片",
      desc: "班群通知、作业或调课截图 · JPG / PNG / WEBP",
      action: () => pickFiles("image/png,image/jpeg,image/webp,.jpg,.jpeg,.png,.webp", onFiles, imageRef),
    },
    {
      id: "material",
      icon: FolderOpen,
      label: "选择课程资料",
      desc: courses.length > 0 ? "从已有课程资料中引用" : "暂无课程资料",
      action: () => {
        if (courses.length > 0) onMaterials();
        onClose();
      },
    },
  ];

  return (
    <div role="menu" aria-label="添加附件" className="py-1">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <button
            key={it.id}
            role="menuitem"
            onClick={it.action}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-xs font-semibold text-charcoal hover:bg-alabaster transition-colors"
          >
            <Icon className="w-4 h-4 text-sandrift shrink-0" />
            <span className="min-w-0">
              <span className={cn("block", it.id === "material" && courses.length === 0 && "text-sandrift")}>
                {it.label}
              </span>
              <span className="block text-[10px] font-medium text-sandrift">{it.desc}</span>
            </span>
          </button>
        );
      })}
      <input ref={fileRef} type="file" multiple className="hidden" />
      <input ref={imageRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" />
    </div>
  );
}
