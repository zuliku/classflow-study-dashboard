"use client";

import React, { useState } from "react";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { KiroHeader } from "@/components/kiro/KiroHeader";
import { KiroChatSurface } from "@/components/kiro/KiroChatSurface";
import { KiroHistoryPanel } from "@/components/kiro/KiroHistoryPanel";

/**
 * Kiro Workspace（Task 5）：完整 Kiro Surface 的展示层。
 * Chat Runtime / Context / Attachments / Undo 全部来自 Persistent Session（useKiroSession）。
 * Full-bleed shell：main 对该 Tab 已去掉 page padding，gutter 由本组件内部提供（px/pt），
 * 因此 Desktop History Panel 作为 flex sibling 从 Header 下沿连续延伸到 Workspace 底部（无断线），
 * 且打开 History 时主内容自动为其预留 320px（不覆盖 Composer / Conversation）。
 */
export function KiroWorkspace() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const session = useKiroSession();

  const newChat = () => {
    session.newChat();
    setHistoryOpen(false);
  };

  return (
    <div data-testid="kiro-workspace" className="relative flex-1 min-h-0 flex">
      {/* 主内容区：History 打开时收缩预留宽度；底部留白由本组件提供（main 对 Kiro 已去 padding） */}
      <div className="flex-1 min-w-0 flex flex-col px-4 md:px-6 pt-4 md:pt-6 pb-4 md:pb-6">
        <KiroHeader onNewChat={newChat} onOpenHistory={() => setHistoryOpen(true)} />
        <KiroChatSurface variant="workspace" />
      </div>

      {/* Desktop History：full-height docked secondary panel（border-l 连续） */}
      {historyOpen && (
        <div className="hidden md:block w-[320px] shrink-0 border-l border-line bg-surface overflow-hidden">
          <KiroHistoryPanel variant="desktop" onClose={() => setHistoryOpen(false)} onNewChat={newChat} />
        </div>
      )}

      {/* Mobile History：底部 sheet */}
      {historyOpen && (
        <div className="md:hidden">
          <KiroHistoryPanel variant="mobile" onClose={() => setHistoryOpen(false)} onNewChat={newChat} />
        </div>
      )}
    </div>
  );
}
