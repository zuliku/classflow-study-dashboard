"use client";

import React, { useState } from "react";
import { FileText, Image as ImageIcon, Loader2, MoreHorizontal, X, BookmarkPlus, RotateCcw } from "lucide-react";
import { KiroAttachmentView } from "@/lib/ai/attachments/types";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

/** 附件 chip：状态（正在读取/已就绪/错误/不支持）、图片缩略图、移除、保存到课程资料 */
export function KiroAttachmentChip({
  attachment,
  onRemove,
  onRetry,
  onSaveToCourse,
}: {
  attachment: KiroAttachmentView;
  onRemove: (id: string) => void;
  onRetry?: (id: string) => void;
  onSaveToCourse?: (id: string, courseId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const courses = useAppStore((s) => s.courses);
  const isImage = attachment.kind === "image";
  const Icon = isImage ? ImageIcon : FileText;

  const statusText =
    attachment.status === "processing"
      ? "正在读取…"
      : attachment.status === "error"
      ? attachment.error ?? "读取失败"
      : attachment.status === "unsupported"
      ? attachment.error ?? "暂不支持这种文件类型"
      : attachment.source === "material"
      ? `课程资料 · ${attachment.courseName ?? ""}`
      : "已就绪";

  return (
    <span
      data-testid="kiro-attachment-chip"
      className={cn(
        "inline-flex items-center gap-2 pl-1.5 pr-1 h-10 rounded-xl border text-[11px] font-semibold",
        attachment.status === "error" || attachment.status === "unsupported"
          ? "bg-danger-bg border-danger-border text-danger"
          : "bg-[#F7F5F5] border-line text-charcoal"
      )}
    >
      {isImage && attachment.thumbnail ? (
        <img
          src={attachment.thumbnail}
          alt=""
          className="w-8 h-8 rounded-lg object-cover border border-line-soft shrink-0"
        />
      ) : (
        <span className="w-8 h-8 rounded-lg bg-alabaster border border-line-soft flex items-center justify-center shrink-0">
          {attachment.status === "processing" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-sandrift" />
          ) : (
            <Icon className="w-3.5 h-3.5 text-sandrift" />
          )}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate max-w-[140px]">{attachment.name}</span>
        <span className={cn("block text-[9px] truncate max-w-[160px]", attachment.status === "ready" ? "text-sandrift" : "")}>
          {attachment.size && attachment.source === "local" ? `${(attachment.size / 1024 / 1024).toFixed(1)} MB · ` : ""}
          {statusText}
        </span>
      </span>

      {(attachment.status === "error" || attachment.status === "unsupported") && onRetry && (
        <button
          onClick={() => onRetry(attachment.id)}
          aria-label={`重试 ${attachment.name}`}
          className="p-1 rounded text-sandrift hover:text-charcoal transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      )}

      {attachment.source === "local" && attachment.status === "ready" && onSaveToCourse && (
        <span className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={`${attachment.name} 更多操作`}
            aria-expanded={menuOpen}
            className="p-1 rounded text-sandrift hover:text-charcoal transition-colors"
          >
            <MoreHorizontal className="w-3 h-3" />
          </button>
          {menuOpen && (
            <span
              role="menu"
              className="absolute right-0 top-full mt-1 z-40 w-56 bg-surface border border-line-strong rounded-xl shadow-card p-1 ux-inline"
            >
              <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold text-sandrift">保存到课程资料</p>
              {courses.length === 0 && (
                <p className="px-2.5 py-2 text-[10px] text-sandrift">暂无课程，请先创建课程。</p>
              )}
              {courses.map((c) => (
                <button
                  key={c.id}
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onSaveToCourse(attachment.id, c.id);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-[11px] font-semibold text-charcoal hover:bg-alabaster transition-colors"
                >
                  <BookmarkPlus className="w-3.5 h-3.5 text-sandrift" />
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
            </span>
          )}
        </span>
      )}

      <button
        onClick={() => onRemove(attachment.id)}
        aria-label={`移除附件 ${attachment.name}`}
        className="p-1 rounded text-sandrift hover:text-danger transition-colors shrink-0"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
