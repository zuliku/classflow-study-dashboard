"use client";

import React, { useState } from "react";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { KiroHeader } from "@/components/kiro/KiroHeader";
import { KiroChatSurface } from "@/components/kiro/KiroChatSurface";
import { KiroHistoryPanel } from "@/components/kiro/KiroHistoryPanel";

/**
 * Kiro Workspace（Task 5）：完整 Kiro Surface 的展示层。
 * Chat Runtime / Context / Attachments / Undo 全部来自 Persistent Session（useKiroSession）。
 * 不创建第二套 Runtime —— 与 Sidecar 完全同会话。
 */
export function KiroWorkspace() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const session = useKiroSession();

  const newChat = () => {
    session.newChat();
    setHistoryOpen(false);
  };

  return (
    <div
      data-testid="kiro-workspace"
      className="relative h-[calc(100dvh-170px)] md:h-[calc(100dvh-96px)] flex flex-col"
    >
      <KiroHeader onNewChat={newChat} onOpenHistory={() => setHistoryOpen(true)} />
      <KiroChatSurface variant="workspace" />
      {historyOpen && (
        <KiroHistoryPanel onClose={() => setHistoryOpen(false)} onNewChat={newChat} />
      )}
    </div>
  );
}
