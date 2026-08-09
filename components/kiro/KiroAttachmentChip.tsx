"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon, Loader2, MoreHorizontal, X, BookmarkPlus, RotateCcw } from "lucide-react";
import { KiroAttachmentView } from "@/lib/ai/attachments/types";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

/** 稳定文件类型标签（UI 层由 kind/扩展名推导，不改数据模型） */
function typeLabel(a: KiroAttachmentView): string {
  const ext = (a.name.split(".").pop() ?? "").toUpperCase();
  if (a.kind === "image") {
    return ["PNG", "JPG", "JPEG", "WEBP"].includes(ext) ? ext : "图片";
  }
  if (a.kind === "pdf") return "PDF";
  if (a.kind === "docx") return ext === "DOC" ? "DOC" : "DOCX";
  return ext === "MD" ? "MD" : "TXT";
}

/** 文件大小：<1MB 用 KB，否则 MB */
function sizeLabel(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Kiro Attachment Chip（紧凑单行对象）：
 * 图标 24px + 名称 + 元数据行（类型 · 大小 / 课程资料 / 状态）。
 * Ready 不显示「已就绪」；课程资料用浅 pastel-mint 区分；
 * 「保存到课程资料」菜单经 Portal 渲染（不被 Attachment Tray 的 overflow 裁切）。
 */
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
  const courses = useAppStore((s) => s.courses);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  usePortalMenuClose(menuOpen, () => setMenuOpen(false), [menuBtnRef, menuRef]);

  const isImage = attachment.kind === "image";
  const isMaterial = attachment.source === "material";
  const failed = attachment.status === "error" || attachment.status === "unsupported";
  const scanned = attachment.visionRequired === true;
  const Icon = isImage ? ImageIcon : FileText;

  const meta =
    attachment.status === "processing"
      ? "正在读取…"
      : failed
        ? (attachment.error ?? "读取失败")
        : scanned
          ? `PDF · 扫描件 · ${attachment.pageCount ?? "?"} 页`
          : isMaterial
            ? `${attachment.courseName ? `${attachment.courseName} · ` : ""}课程资料`
            : [typeLabel(attachment), sizeLabel(attachment.size)].filter(Boolean).join(" · ");

  // Portal 菜单位置：基于触发按钮 rect，向上展开（Chip 在底部 Composer 内）
  const menuRect = (() => {
    const el = menuBtnRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.right, top: r.top };
  })();

  return (
    <span
      data-testid="kiro-attachment-chip"
      className={cn(
        "inline-flex items-center gap-1.5 pl-1 pr-1 h-10 rounded-xl border text-[11px] font-semibold shrink-0 max-w-[220px]",
        failed
          ? "bg-danger-bg border-danger-border text-danger"
          : isMaterial
            ? "bg-pastel-mint/15 border-line text-charcoal"
            : "bg-surface border-line text-charcoal"
      )}
    >
      {isImage && attachment.thumbnail ? (
        <img
          src={attachment.thumbnail}
          alt=""
          className="w-7 h-7 rounded-lg object-cover border border-line-soft shrink-0"
        />
      ) : (
        <span className="w-7 h-7 rounded-lg bg-alabaster border border-line-soft flex items-center justify-center shrink-0">
          {attachment.status === "processing" ? (
            <Loader2 className="w-3 h-3 animate-spin text-sandrift" />
          ) : (
            <Icon className="w-3 h-3 text-sandrift" />
          )}
        </span>
      )}

      <span className="min-w-0 flex flex-col leading-tight">
        <span className="truncate max-w-[130px] text-[11px]">{attachment.name}</span>
        <span className={cn("truncate max-w-[140px] text-[9px] font-medium", failed ? "text-danger/80" : "text-sandrift")}>
          {meta}
        </span>
      </span>

      {failed && onRetry && (
        <button
          onClick={() => onRetry(attachment.id)}
          aria-label={`重试 ${attachment.name}`}
          title="重试"
          className="p-1 rounded text-sandrift hover:text-charcoal transition-colors shrink-0"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      )}

      {attachment.source === "local" && attachment.status === "ready" && onSaveToCourse && (
        <>
          <button
            ref={menuBtnRef}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={`${attachment.name} 更多操作`}
            aria-expanded={menuOpen}
            title="保存到课程资料"
            className="p-1 rounded text-sandrift hover:text-charcoal transition-colors shrink-0"
          >
            <MoreHorizontal className="w-3 h-3" />
          </button>
          {menuOpen &&
            menuRect &&
            createPortal(
              <div
                ref={menuRef}
                role="menu"
                className="fixed z-50 w-56 bg-surface border border-line-strong rounded-2xl shadow-card p-1 ux-inline"
                style={{ left: menuRect.left - 224, top: menuRect.top - 8, transform: "translateY(-100%)" }}
              >
                <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold text-sandrift">保存到课程资料</p>
                {courses.length === 0 && <p className="px-2.5 py-2 text-[10px] text-sandrift">暂无课程，请先创建课程。</p>}
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
              </div>,
              document.body
            )}
        </>
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

/** Portal 菜单外部点击 / Esc 关闭（组件挂载期间生效） */
export function usePortalMenuClose(open: boolean, onClose: () => void, excludeRefs: React.RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (excludeRefs.some((r) => r.current?.contains(target))) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onClose, excludeRefs]);
}
