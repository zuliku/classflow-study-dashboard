"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { openAssignmentEditor } from "@/lib/uiEvents";
import { hasAnyOverlay } from "@/lib/overlayStack";

/** 单键快捷键守卫：输入型 target 不触发 */
export function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable
  );
}

/**
 * 全局快捷键控制器：常驻挂载（不依赖 Command Center 是否 mounted）。
 * 快捷键存在与否由它决定，而不是由弹层生命周期决定。
 *
 * 单键快捷键（N / ? / /）受 preferences.enableSingleKeyShortcuts 控制；
 * Cmd/Ctrl 组合（⌘K / ⌘,）与标准键盘操作不受影响。
 */
export function GlobalShortcutController() {
  const isSearchModalOpen = useAppStore((s) => s.isSearchModalOpen);
  const setSearchModalOpen = useAppStore((s) => s.setSearchModalOpen);
  const setSearchModalView = useAppStore((s) => s.setSearchModalView);
  const setSettingsModalOpen = useAppStore((s) => s.setSettingsModalOpen);
  const enableSingleKeyShortcuts = useAppStore(
    (s) => s.preferences.enableSingleKeyShortcuts
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl + K：切换命令中心（关闭态依然生效）
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchModalOpen(!isSearchModalOpen);
        if (!isSearchModalOpen) setSearchModalView("palette");
        return;
      }

      // Cmd/Ctrl + ,：打开设置（Input focused 时仍生效）
      // Overlay 规则：已有任何 overlay 挂载时不绕过 overlay stack
      if (mod && e.key === ",") {
        e.preventDefault();
        if (hasAnyOverlay()) return;
        setSettingsModalOpen(true);
        return;
      }

      if (e.altKey) return;

      // ---- 以下为单键快捷键：受 enableSingleKeyShortcuts 控制 ----
      if (!enableSingleKeyShortcuts) return;

      // ?：快捷键指南
      if (e.key === "?" && !mod && !isEditableTarget(e)) {
        e.preventDefault();
        setSearchModalView("guide");
        setSearchModalOpen(true);
        return;
      }

      // /：直接进入搜索
      if (e.key === "/" && !mod && !isEditableTarget(e)) {
        e.preventDefault();
        setSearchModalView("palette");
        setSearchModalOpen(true);
        return;
      }

      // N：新建任务（无输入焦点 / 无阻断 Overlay / 无拖拽进行中）
      if ((e.key === "n" || e.key === "N") && !mod && !isEditableTarget(e)) {
        if (hasAnyOverlay()) return;
        if (document.body.dataset.dragActive === "1") return;
        e.preventDefault();
        openAssignmentEditor({});
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSearchModalOpen, setSearchModalOpen, setSearchModalView, setSettingsModalOpen, enableSingleKeyShortcuts]);

  return null;
}
