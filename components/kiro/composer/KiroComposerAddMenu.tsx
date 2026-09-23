"use client";

import React, { useRef, useState } from "react";
import {
  AtSign,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Globe2,
  Image as ImageIcon,
  Paperclip,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { KiroContextRef } from "@/lib/ai/context/types";
import { KiroMaterialPicker } from "@/components/kiro/KiroMaterialPicker";
import { KiroContextListView } from "@/components/kiro/KiroContextListView";
import { cn } from "@/lib/utils";

type AddMenuView = "root" | "materials" | "context";

const ROOT_ROW =
  "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-xs font-semibold text-charcoal hover:bg-alabaster transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

/**
 * Kiro Composer — Add Menu（＋）：内容与来源的唯一入口。
 *
 * 结构：上传文件 / 添加图片 / 课程资料 / ClassFlow 上下文 + 联网搜索（下一 Turn preference）。
 * - 单一 Popover shell，内部 view 切换（root → materials / context），不叠加多层 Popover
 * - scope 类条目（附件 / 课程资料 / 上下文）在 Turn 运行中禁用；联网搜索只受 next-turn preference 锁
 * - 不复制附件解析 / Context / Material 业务逻辑（复用既有 handler 与共享列表）
 */
export function KiroComposerAddMenu({
  scopeLocked,
  preferencesLocked,
  webSearchEnabled,
  onToggleWebSearch,
  onFiles,
  onAddMaterial,
  onAddContext,
  onClose,
}: {
  /** 当前 Turn scope 锁（附件 / 课程资料 / 上下文） */
  scopeLocked: boolean;
  /** 下一 Turn preference 锁（联网搜索） */
  preferencesLocked: boolean;
  webSearchEnabled: boolean;
  onToggleWebSearch: () => void;
  onFiles: (files: File[]) => void;
  onAddMaterial: (ref: { courseId: string; courseName: string; materialId: string; title: string; type: string }) => void;
  onAddContext: (ref: KiroContextRef) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<AddMenuView>("root");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const courses = useAppStore((s) => s.courses);

  const pickFiles = (accept: string, ref: React.RefObject<HTMLInputElement | null>) => {
    const input = ref.current;
    if (!input) return;
    input.accept = accept;
    input.onchange = () => {
      if (input.files) onFiles(Array.from(input.files));
      input.value = "";
    };
    input.click();
    onClose();
  };

  if (view === "materials") {
    return (
      <div
      role="menu"
      aria-label="添加"
      className="py-1"
      data-testid="kiro-composer-add-menu"
      data-kiro-composer-menu="add"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
        <button
          type="button"
          onClick={() => setView("root")}
          className="w-full flex items-center gap-1.5 px-3 py-2 rounded-lg text-left text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          课程资料
        </button>
        <KiroMaterialPicker
          onClose={() => setView("root")}
          onPick={(ref) => {
            onAddMaterial(ref);
            onClose();
          }}
        />
      </div>
    );
  }

  if (view === "context") {
    return (
      <div
        role="menu"
        aria-label="添加"
        className="py-1 max-h-[min(360px,55vh)] overflow-y-auto"
        data-testid="kiro-composer-add-menu"
      >
        <button
          type="button"
          onClick={() => setView("root")}
          className="w-full flex items-center gap-1.5 px-3 py-2 rounded-lg text-left text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          ClassFlow 上下文
        </button>
        <div className="px-1 pb-1">
          <KiroContextListView
            compact
            onPick={(ref) => {
              onAddContext(ref);
              onClose();
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      role="menu"
      aria-label="添加"
      className="py-1"
      data-testid="kiro-composer-add-menu"
      data-kiro-composer-menu="add"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        disabled={scopeLocked}
        onClick={() => pickFiles(".pdf,.docx,.txt,.md", fileRef)}
        className={ROOT_ROW}
      >
        <Paperclip className="w-4 h-4 text-sandrift shrink-0" />
        上传文件
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={scopeLocked}
        onClick={() => pickFiles("image/png,image/jpeg,image/webp,.jpg,.jpeg,.png,.webp", imageRef)}
        className={ROOT_ROW}
      >
        <ImageIcon className="w-4 h-4 text-sandrift shrink-0" />
        添加图片
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={scopeLocked || courses.length === 0}
        onClick={() => setView("materials")}
        className={ROOT_ROW}
      >
        <FolderOpen className="w-4 h-4 text-sandrift shrink-0" />
        <span className="min-w-0 flex-1 truncate">课程资料</span>
        <ChevronRight className="w-3.5 h-3.5 text-sandrift shrink-0" />
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={scopeLocked}
        onClick={() => setView("context")}
        className={ROOT_ROW}
      >
        <AtSign className="w-4 h-4 text-sandrift shrink-0" />
        <span className="min-w-0 flex-1 truncate">ClassFlow 上下文</span>
        <ChevronRight className="w-3.5 h-3.5 text-sandrift shrink-0" />
      </button>

      <div className="my-1 h-px bg-line-soft" aria-hidden="true" />

      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={webSearchEnabled}
        disabled={preferencesLocked}
        onClick={onToggleWebSearch}
        data-testid="kiro-composer-web-search"
        className={cn(ROOT_ROW, "font-semibold")}
      >
        <Globe2 className={cn("w-4 h-4 shrink-0", webSearchEnabled ? "text-charcoal" : "text-sandrift")} />
        <span className="min-w-0 flex-1 truncate">联网搜索</span>
        <span
          className={cn(
            "text-[10px] font-bold shrink-0",
            webSearchEnabled ? "text-charcoal" : "text-sandrift"
          )}
        >
          {webSearchEnabled ? "已开启" : "关闭"}
        </span>
      </button>

      <input ref={fileRef} type="file" multiple className="hidden" />
      <input ref={imageRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" />
    </div>
  );
}
