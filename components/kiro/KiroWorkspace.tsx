"use client";

import React, { useState } from "react";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { KiroHeader } from "@/components/kiro/KiroHeader";
import { KiroChatSurface } from "@/components/kiro/KiroChatSurface";
import { KiroHistoryPanel } from "@/components/kiro/KiroHistoryPanel";
import { KiroThreadRail } from "@/components/kiro/KiroThreadRail";
import { KiroProjectPanel, ProjectPanelMode } from "@/components/kiro/KiroProjectPanel";
import { InboxPanel } from "@/components/inbox/InboxPanel";
import { useInboxStore } from "@/store/useInboxStore";
import { Inbox } from "lucide-react";

/**
 * Kiro Workspace（Codex-style Agent Workspace）：
 * - Floating Thread Rail（仅 Workspace，md+；展开为 overlay，不重排聊天宽度）
 * - Floating Project Rail（右侧；expanded/collapsed/closed，纯 UI 状态由 Workspace 持有）
 * - Thread Header（当前 Thread 标题 + Share/More）
 * - 历史主入口 = Thread Rail；<768 移动端保留 History Sheet（More 菜单内）
 * Chat Runtime / Context / Attachments / Undo 全部来自 Persistent Session。
 */
export function KiroWorkspace() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  // Kiro Projects V1：Panel 开关状态（expanded/collapsed/closed）——纯 UI，不建 Store
  const [projectPanelMode, setProjectPanelMode] = useState<ProjectPanelMode>("collapsed");
  const session = useKiroSession();
  const unreadCount = useInboxStore((s) => s.items.filter((it) => it.status === "unread").length);

  const newChat = () => {
    session.newChat();
    setHistoryOpen(false);
  };

  return (
    <div data-testid="kiro-workspace" className="relative flex-1 min-h-0 flex">
      {/* Floating Thread Rail（Sidecar 不渲染此组件）；左侧提供项目 launcher */}
      <KiroThreadRail onOpenProjects={() => setProjectPanelMode("expanded")} />

      {/* 主内容区：md 下为 Rail 预留左侧空间（lg+ 聊天居中不受影响）；
          移动端 pb-24 为固定底部导航（BottomNav，h-14 + safe-area）预留空间，避免遮挡 Composer 发送按钮。
          Project Panel 为纯悬浮层（expanded/collapsed 都不改变聊天宽度） */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden px-4 md:pr-6 md:pl-[72px] lg:px-6 pt-4 md:pt-6 pb-24 md:pb-6">
        <div className="flex items-center justify-end gap-2 pb-2">
          <button
            type="button"
            onClick={() => setInboxOpen(true)}
            data-testid="kiro-inbox-button"
            className="h-8 px-3 bg-white border border-line rounded-lg text-xs font-bold text-charcoal hover:bg-alabaster flex items-center gap-1.5"
          >
            <Inbox className="w-4 h-4" />
            收件箱 {unreadCount > 0 ? ` ${unreadCount}` : ""}
          </button>
        </div>
        <KiroHeader onNewChat={newChat} onOpenHistory={() => setHistoryOpen(true)} />
        <KiroChatSurface variant="workspace" />
      </div>

      {/* Floating Project Rail（右侧，md+） */}
      <KiroProjectPanel
        mode={projectPanelMode}
        onSetMode={setProjectPanelMode}
        onOpenConversation={session.loadConversation}
      />

      <InboxPanel open={inboxOpen} onOpenChange={setInboxOpen} />

      {/* Mobile History Sheet（<768；Rail 不显示） */}
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
