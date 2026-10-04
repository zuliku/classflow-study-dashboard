"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Plus, MessageSquare } from "lucide-react";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useToastStore } from "@/store/useToastStore";
import { KiroThreadRow } from "@/components/kiro/KiroThreadRow";
import { listConversations } from "@/lib/ai/history/db";
import { filterConversations } from "@/lib/ai/history/search";
import { KiroConversationRecord } from "@/lib/ai/history/types";
import { usePresence } from "@/lib/usePresence";
import { ExitCollapse } from "@/components/ui/ExitCollapse";
import { useExitPresenceList } from "@/lib/useExitPresenceList";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Kiro History（移动端底部 Sheet，<768；Desktop 历史入口 = Thread Rail）。
 * 列表 / 搜索 / 重命名 / 删除 与 Rail 共用 KiroThreadRow 与同一 History Runtime。
 */
export function KiroHistoryPanel({
  open,
  onClose,
  onNewChat,
}: {
  open: boolean;
  onClose: () => void;
  onNewChat: () => void;
}) {
  const session = useKiroSession();
  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const [records, setRecords] = useState<KiroConversationRecord[]>([]);
  const [query, setQuery] = useState("");
  const [requestedThreadId, setRequestedThreadId] = useState<string | null>(null);
  const [requestedTransitionStarted, setRequestedTransitionStarted] = useState(false);
  const { mounted, visible } = usePresence(open, MOTION_EXIT_MS.panel);
  // P1：标题 + 摘要 + 正文（与导航搜索同口径，此前只搜标题）
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records;
    const matched = new Set(filterConversations(records, q).map((m) => m.thread.id));
    return records.filter((r) => matched.has(r.id));
  }, [records, query]);
  // 行删除原位 collapse（搜索 query 变化走 resetKey 即时，不保留过期快照）
  const retainedFiltered = useExitPresenceList({
    items: filtered,
    getId: (r) => r.id,
    resetKey: query,
  });

  useEffect(() => {
    if (!open) return;
    if (!requestedThreadId) return;
    if (session.conversationTransitioning) {
      setRequestedTransitionStarted(true);
      return;
    }
    if (!requestedTransitionStarted) return;
    setRequestedThreadId(null);
    setRequestedTransitionStarted(false);
    onClose();
  }, [open, requestedThreadId, requestedTransitionStarted, session.conversationTransitioning, onClose]);

  useEffect(() => {
    let alive = true;
    void listConversations().then((list) => {
      if (alive) setRecords(list);
    });
    return () => {
      alive = false;
    };
  }, [session.historyVersion]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  const openThread = (id: string) => {
    // P1：切换中点第二条不再静默丢弃（此前毫无反应，用户以为没点中而反复点）
    if (session.conversationTransitioning) {
      pushToast({ message: "正在切换对话，请稍候", type: "info" });
      return;
    }
    void session.loadConversation(id);
    setRequestedThreadId(id);
    setRequestedTransitionStarted(false);
  };

  const clearAll = () => {
    confirmRequest({
      title: "清空全部历史？",
      description: "仅删除 Kiro 对话，不影响课程、任务或课程资料。",
      confirmLabel: "清空",
      danger: true,
      onConfirm: () => {
        session.clearHistory();
        pushToast({ message: "历史已清空" });
      },
    });
  };

  return (
    <>
      {/* 遮罩 */}
      <div
        className={cn(
          "absolute inset-0 z-30 bg-black/20 transition-opacity ease-[var(--ease-standard)]",
          visible
            ? "duration-[var(--motion-panel)] opacity-100"
            : "duration-[var(--motion-exit-panel)] opacity-0 pointer-events-none ease-[var(--ease-exit)]"
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* 底部 sheet */}
      <div
        role="dialog"
        aria-label="历史记录"
        data-state={open ? "open" : "closed"}
        aria-hidden={!open}
        className={cn(
          "absolute inset-x-0 bottom-0 z-40 bg-surface border-t border-line rounded-t-2xl shadow-card p-4 pb-5 max-h-[65dvh] overflow-y-auto overflow-x-clip transition-[opacity,transform] ease-[var(--ease-standard)]",
          visible
            ? "duration-[var(--motion-panel)] translate-y-0 opacity-100"
            : "duration-[var(--motion-exit-panel)] translate-y-2 opacity-0 pointer-events-none ease-[var(--ease-exit)]"
        )}
      >
        <div className="w-10 h-1 rounded-full bg-line-strong mx-auto mb-4" />
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-charcoal">最近对话</h3>
            <button
              onClick={onNewChat}
              aria-label="新对话"
              disabled={session.conversationTransitioning}
              className="flex items-center gap-1 px-2 h-8 rounded-lg text-[11px] font-bold text-satin-grey hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" />
              新对话
            </button>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题、摘要与正文"
            aria-label="搜索标题、摘要与正文"
            className="w-full bg-[#F7F5F5] border border-line rounded-xl px-3 h-9 text-xs text-charcoal placeholder-sandrift focus:outline-none"
          />
          <div className="rounded-2xl bg-[#F7F5F5] border border-line flex flex-col overflow-hidden min-h-[240px]">
            {filtered.length === 0 && retainedFiltered.every((e) => !e.exiting) ? (
              <div key="empty" className="flex-1 flex flex-col items-center justify-center text-center gap-2.5 px-6 py-10 ux-fade">
                <span className="w-10 h-10 rounded-xl bg-alabaster flex items-center justify-center shrink-0">
                  <MessageSquare className="w-[18px] h-[18px] text-sandrift" />
                </span>
                <p className="text-sm font-semibold text-charcoal">
                  {records.length === 0 ? "暂无历史对话" : "未找到匹配对话"}
                </p>
                {records.length > 0 && (
                  <p className="text-xs text-sandrift leading-relaxed max-w-[220px]">换个关键词试试。</p>
                )}
              </div>
            ) : (
              <div key="list" className="divide-y divide-line-soft ux-fade">
                {retainedFiltered.map(({ item: rec, exiting }) => (
                  <ExitCollapse key={rec.id} exiting={exiting}>
                    <KiroThreadRow
                      record={rec}
                      isCurrent={session.currentConversationId === rec.id}
                      onOpen={openThread}
                      disabled={session.conversationTransitioning}
                      transitioning={session.conversationTransition.target === rec.id}
                    />
                  </ExitCollapse>
                ))}
              </div>
            )}
          </div>
          {records.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <button onClick={clearAll} className="text-[11px] font-bold text-sandrift hover:text-danger transition-colors">
                清空全部
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
