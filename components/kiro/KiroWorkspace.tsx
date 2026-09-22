"use client";

import React, { useState } from "react";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { KiroHeader } from "@/components/kiro/KiroHeader";
import { KiroChatSurface } from "@/components/kiro/KiroChatSurface";
import { KiroHistoryPanel } from "@/components/kiro/KiroHistoryPanel";
import { KiroNavigator } from "@/components/kiro/navigation/KiroNavigator";
import { KiroInspector } from "@/components/kiro/inspector/KiroInspector";

/**
 * Kiro Workspace（Codex-style Agent Workspace）：
 * - Unified Kiro Navigator（左；md+；collapsed 52px ↔ expanded overlay，不重排聊天宽度）
 * - Agent Conversation（中；flexible；KiroChatSurface 继续使用同一个 Persistent Session）
 * - Kiro Inspector（右；xl+ 固定列 296px；Outputs / Sources / Computer；P2）
 * - Thread Header（当前 Thread 标题 + Share/More）
 * - 历史主入口 = Navigator；<768 移动端保留 History Sheet（More 菜单内）
 * Chat Runtime / Context / Attachments / Undo 全部来自 Persistent Session。
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
      {/* Unified Kiro Navigator（Sidecar 不渲染此组件） */}
      <KiroNavigator />

      {/* 主内容区：md 下为 Navigator 预留左侧空间（lg+ 聊天居中不受影响）；
          移动端 pb-24 为固定底部导航（BottomNav，h-14 + safe-area）预留空间，避免遮挡 Composer 发送按钮。
          Navigator 为纯悬浮层（expanded/collapsed 都不改变聊天宽度）；Inspector 为固定右列（xl+）。 */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden px-4 md:pr-6 md:pl-[72px] lg:px-6 pt-4 md:pt-6 pb-24 md:pb-6">
        <KiroHeader onNewChat={newChat} onOpenHistory={() => setHistoryOpen(true)} />
        <KiroChatSurface variant="workspace" />
      </div>

      {/* Kiro Inspector（右侧固定列；xl+ 常驻，<xl 由 Header Recent Files 兜底） */}
      <div className="hidden xl:flex pt-6 pb-6 pr-6 min-h-0">
        <KiroInspector />
      </div>

      {/* Mobile History Sheet（<768；Navigator 不显示） */}
      <div className="md:hidden">
        <KiroHistoryPanel
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onNewChat={newChat}
        />
      </div>
    </div>
  );
}
