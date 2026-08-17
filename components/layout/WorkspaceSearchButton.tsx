"use client";

import React from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAppStore } from "@/store/useAppStore";

/**
 * Workspace 全局搜索按钮：继续打开现有 Command Center palette（行为不变）。
 * 响应式内容：<768 仅图标；>=768 图标+搜索；>=1024 图标+搜索+⌘K。
 * 使用全局 Button（variant=secondary）。
 */
export function WorkspaceSearchButton() {
  const setSearchModalOpen = useAppStore((s) => s.setSearchModalOpen);
  const setSearchModalView = useAppStore((s) => s.setSearchModalView);

  const openSearch = () => {
    setSearchModalView("palette");
    setSearchModalOpen(true);
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={openSearch}
      aria-label="全局搜索"
      className="gap-1.5 px-2 text-sandrift hover:text-charcoal md:px-2.5"
    >
      <Search className="h-3.5 w-3.5 text-[#A48F82] shrink-0" aria-hidden="true" />
      <span className="hidden md:inline font-medium">搜索</span>
      <kbd className="hidden lg:inline-block bg-alabaster text-charcoal text-[10px] font-mono px-1 py-0.5 rounded border border-line-strong">
        ⌘ K
      </kbd>
    </Button>
  );
}
