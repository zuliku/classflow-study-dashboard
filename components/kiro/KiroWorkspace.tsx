"use client";

import React, { useEffect, useRef, useState } from "react";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { KiroHeader } from "@/components/kiro/KiroHeader";
import { KiroChatSurface } from "@/components/kiro/KiroChatSurface";
import { KiroHistoryPanel } from "@/components/kiro/KiroHistoryPanel";
import { KiroNavigator } from "@/components/kiro/navigation/KiroNavigator";
import { KiroInspector } from "@/components/kiro/inspector/KiroInspector";
import { useKiroSubagentStore } from "@/store/useKiroSubagentStore";

/** Kiro Inspector 快捷键（参考 Codex 的右侧面板 toggle；Workspace 作用域） */
export const KIRO_INSPECTOR_SHORTCUT = { key: "i", shift: false } as const;

/**
 * Kiro Workspace（Codex-style Agent Workspace）：
 * - Unified Kiro Navigator（左；md+；collapsed 52px ↔ expanded overlay，不重排聊天宽度）
 * - Agent Conversation（中；flexible；KiroChatSurface 继续使用同一个 Persistent Session）
 * - Kiro Inspector（右；xl+；默认关闭，Cmd/Ctrl+I 或 Header 按钮开关；Outputs / Sources）
 * - Thread Header（当前 Thread 标题 + Share/More + Inspector 开关）
 * - 历史主入口 = Navigator；<768 移动端保留 History Sheet（More 菜单内）
 * Chat Runtime / Context / Attachments / Undo 全部来自 Persistent Session。
 */
export function KiroWorkspace() {
  const [historyOpen, setHistoryOpen] = useState(false);
  // Kiro Inspector：ephemeral presentation state（不建全局 Store；默认关闭，非常驻）
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const session = useKiroSession();
  const hasRunningSubagent = useKiroSubagentStore((s) =>
    s.order.some((id) => {
      const run = s.runs[id];
      return run?.status === "running" && run.conversationId === session.currentConversationId;
    })
  );
  const subagentAutoOpenedRef = useRef(false);

  // 子代理启动时自动展开右侧 Inspector（xl+ 可见；用户在本轮内手动关闭后不反复弹开）
  useEffect(() => {
    if (!hasRunningSubagent) {
      subagentAutoOpenedRef.current = false;
      return;
    }
    if (subagentAutoOpenedRef.current) return;
    subagentAutoOpenedRef.current = true;
    setInspectorOpen(true);
  }, [hasRunningSubagent]);

  // Cmd/Ctrl+I：切换 Inspector（与 Navigator 的 Cmd/Ctrl+Shift+H 同族；输入焦点内不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.shiftKey !== KIRO_INSPECTOR_SHORTCUT.shift) return;
      if (e.key.toLowerCase() !== KIRO_INSPECTOR_SHORTCUT.key) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          // 输入中仍允许 toggle（与 Codex 面板一致），但不吞掉编辑器自身快捷键
          if (tag === "TEXTAREA" || target.isContentEditable) return;
        }
      }
      e.preventDefault();
      setInspectorOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const newChat = () => {
    session.newChat();
    setHistoryOpen(false);
  };

  return (
    <div data-testid="kiro-workspace" className="relative flex-1 min-h-0 flex">
      {/* Unified Kiro Navigator（Sidecar 不渲染此组件） */}
      <KiroNavigator />

      {/* 主内容区：md 下为 Navigator 预留左侧空间（S4-3：--space-18 = 52 rail + 12 offset + 8 breathing；
          lg+ 聊天居中不受影响）；
          移动端 pb-24 为固定底部导航（BottomNav，h-14 + safe-area）预留空间，避免遮挡 Composer 发送按钮。
          Navigator 为纯悬浮层（expanded/collapsed 都不改变聊天宽度）；Inspector 为可开关右列（xl+）。 */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden px-4 md:pr-6 md:pl-[var(--space-18)] lg:px-6 pt-4 md:pt-6 pb-24 md:pb-6">
        <KiroHeader
          onNewChat={newChat}
          onOpenHistory={() => setHistoryOpen(true)}
          inspectorOpen={inspectorOpen}
          onToggleInspector={() => setInspectorOpen((v) => !v)}
        />
        <KiroChatSurface variant="workspace" />
      </div>

      {/* Kiro Inspector（右侧可开关面板；xl+；<xl 由 Header Recent Files 兜底） */}
      <KiroInspector open={inspectorOpen} />

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
