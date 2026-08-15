"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Settings as SettingsIcon, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { SettingsView } from "@/components/settings/SettingsView";
import { SettingsSection } from "@/types";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/Dialog";

/**
 * 设置中心 Modal：居中弹层，固定宽高（桌面 ≈1040×740）。
 * Header 只保留标题 + 关闭；搜索输入常驻左侧 Sidebar（SettingsView 内），
 * Cmd/Ctrl+F 聚焦搜索框，Modal 打开期间阻止浏览器默认 find。
 * Esc 行为：搜索框有 query 时先清空 query，再按一次才关闭 Modal。
 * 脏状态保护：Profile / Semester 有未保存草稿时，X / Esc / backdrop 关闭都需要显式确认丢弃；
 * 确认后通过 discardToken 通知各 section 丢弃本地草稿（不引入全局 settings-dirty store）。
 */
export function SettingsModal() {
  const isOpen = useAppStore((s) => s.isSettingsModalOpen);
  const setSettingsModalOpen = useAppStore((s) => s.setSettingsModalOpen);
  const confirmRequest = useConfirmStore((s) => s.confirm);

  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [dirtySections, setDirtySections] = useState<ReadonlySet<SettingsSection>>(new Set());
  const [discardToken, setDiscardToken] = useState(0);

  const isDirty = dirtySections.size > 0;

  const handleDirtyChange = useCallback((section: SettingsSection, dirty: boolean) => {
    setDirtySections((prev) => {
      const next = new Set(prev);
      if (dirty) next.add(section);
      else next.delete(section);
      return next;
    });
  }, []);

  // 打开时清空陈旧脏标记（关闭后 section 已卸载，重开时重新上报）
  useEffect(() => {
    if (isOpen) setDirtySections(new Set());
  }, [isOpen]);

  // Cmd/Ctrl+F：聚焦侧栏搜索框（Modal 打开期间拦截浏览器默认 find）
  useEffect(() => {
    if (!isOpen) return;
    const focusSearch = () => {
      const stored = searchInputRef.current;
      if (stored && stored.offsetParent !== null) {
        stored.focus();
        return;
      }
      // 尺寸切换后 ref 可能指向隐藏输入框：回退查找当前可见的搜索框
      const visible = document.querySelector<HTMLInputElement>('input[aria-label="搜索设置"]');
      if (visible && visible.offsetParent !== null) visible.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        requestAnimationFrame(focusSearch);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // 关闭 Modal 时重置搜索
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
    }
  }, [isOpen]);

  /** 统一关闭入口：有脏草稿 → 显式确认丢弃；确认后丢弃并关闭 */
  const requestClose = useCallback(() => {
    if (dirtySections.size === 0) {
      setSettingsModalOpen(false);
      return;
    }
    confirmRequest({
      title: "放弃未保存的更改？",
      description: "个人资料或学期设置还有未保存的修改，关闭设置后将丢失。",
      confirmLabel: "放弃更改",
      onConfirm: () => {
        // 通知各 section 丢弃本地草稿（Modal 仍在退出动画期间，effect 可执行）
        setDiscardToken((t) => t + 1);
        setSettingsModalOpen(false);
      },
    });
  }, [dirtySections, setSettingsModalOpen, confirmRequest]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) setSettingsModalOpen(false);
      }}
      overlayId="settings-modal"
      stackZ={50}
      closeOnBackdrop={!isDirty}
      onEscapeKeyDown={(event) => {
        // 搜索框有 query 时：第一次 Esc 只清空搜索，不关闭 Modal
        if (searchQuery.trim().length > 0) {
          event.preventDefault();
          setSearchQuery("");
          return;
        }
        // 无搜索内容：Esc 走统一关闭入口（脏草稿时弹确认）
        event.preventDefault();
        requestClose();
      }}
      aria-label="设置"
      className={cn(
        "w-full h-full max-w-none flex flex-col",
        "md:w-[min(1040px,calc(100vw-48px))] md:h-[min(740px,calc(100dvh-48px))]",
        "rounded-none md:rounded-2xl"
      )}
    >
      {/* Modal Header：设置标题 + 关闭 */}
      <div className="shrink-0 px-4 md:px-5 py-3 border-b border-[#F0EBE1] bg-[#F7F5F5] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <SettingsIcon className="w-4 h-4 text-[#A48F82] shrink-0" />
          <h2 className="text-sm font-bold text-charcoal leading-tight">设置</h2>
        </div>
        <button
          onClick={requestClose}
          className="p-1.5 rounded-lg text-sandrift hover:bg-alba hover:text-charcoal transition-colors shrink-0"
          aria-label="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 设置中心内容：Modal 固定高度内，仅右侧 detail 独立滚动 */}
      <SettingsView
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onClearSearch={() => setSearchQuery("")}
        searchInputRef={searchInputRef}
        onDirtyChange={handleDirtyChange}
        discardToken={discardToken}
      />
    </Dialog>
  );
}
