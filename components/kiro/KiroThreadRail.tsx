"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, MoreHorizontal, FileDown, Copy, Trash2, ChevronLeft } from "lucide-react";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";
import { KiroThreadRow } from "@/components/kiro/KiroThreadRow";
import { KiroMenuPanel, KiroMenuItem, KiroMenuDivider } from "@/components/kiro/KiroMenu";
import { listConversations } from "@/lib/ai/history/db";
import { KiroConversationRecord } from "@/lib/ai/history/types";
import { buildTranscriptText, buildTranscriptMarkdown, copyTextToClipboard, downloadMarkdownFile } from "@/lib/ai/share";
import { cn } from "@/lib/utils";

/**
 * Kiro Floating Thread Rail（Codex-style，仅完整 Kiro Workspace；Sidecar 不显示）。
 * - Collapsed：52px 浮动条（Kiro Logo 为唯一品牌点 + 新对话 + 搜索 + 更多）
 * - Expanded：Overlay 展开（232px），不重排聊天宽度
 * - 历史复用 listConversations + historyVersion + currentConversationId（不复制 History Runtime）
 * - Esc / 点击外部收起；Cmd/Ctrl+Shift+H toggle；不依赖 hover 展开
 */
export function KiroThreadRail() {
  const session = useKiroSession();
  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<KiroConversationRecord[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const railRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    void listConversations().then((list) => {
      if (alive) setRecords(list);
    });
    return () => {
      alive = false;
    };
  }, [session.historyVersion]);

  const collapse = () => {
    setExpanded(false);
    setMoreOpen(false);
    setQuery("");
  };

  // Esc 收起 / 点击外部收起 / Cmd+Shift+H toggle（expanded 或 collapsed 更多菜单打开时生效）
  useEffect(() => {
    if (!expanded && !moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") collapse();
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setExpanded((v) => !v);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (railRef.current && !railRef.current.contains(e.target as Node)) collapse();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, moreOpen, session.historyVersion]);

  const expandWithSearch = () => {
    setExpanded(true);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const newChat = () => {
    session.newChat();
    collapse();
  };

  const openThread = (id: string) => {
    void session.loadConversation(id);
    collapse();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? records.filter((r) => r.title.toLowerCase().includes(q)) : records;
  }, [records, query]);

  const hasMessages = session.chat.messages.length > 0;

  const copyAll = async () => {
    const ok = await copyTextToClipboard(buildTranscriptText(session.chat.messages));
    if (ok) pushToast({ message: "已复制" });
    setMoreOpen(false);
  };
  const exportMarkdown = () => {
    downloadMarkdownFile("kiro-conversation.md", buildTranscriptMarkdown(session.chat.messages));
    pushToast({ message: "已导出 Markdown" });
    setMoreOpen(false);
  };
  const clearConversation = () => {
    setMoreOpen(false);
    confirmRequest({
      title: "清空当前对话？",
      description: "仅清除当前会话中的消息，不影响你的 ClassFlow 数据。",
      confirmLabel: "清空",
      danger: true,
      onConfirm: () => session.newChat(),
    });
  };

  const moreMenu = (
    <KiroMenuPanel dir="up">
      <KiroMenuItem icon={Copy} label="复制全部对话" disabled={!hasMessages} onClick={copyAll} />
      <KiroMenuItem icon={FileDown} label="导出 Markdown" disabled={!hasMessages} onClick={exportMarkdown} />
      <KiroMenuDivider />
      <KiroMenuItem icon={Trash2} label="清空当前对话" danger disabled={!hasMessages} onClick={clearConversation} />
    </KiroMenuPanel>
  );

  return (
    <div
      ref={railRef}
      data-testid="kiro-thread-rail"
      className="hidden md:flex absolute left-3 top-14 z-20"
    >
      {!expanded ? (
        /* ---------- Collapsed Rail（52px） ---------- */
        <div className="w-[52px] rounded-2xl bg-surface border border-line shadow-subtle flex flex-col items-center py-3 gap-1.5">
          <button
            onClick={() => setExpanded(true)}
            aria-label="展开对话"
            aria-expanded={false}
            title="对话"
            className="w-9 h-9 flex items-center justify-center rounded-xl group/logo transition-colors"
          >
            <KiroLogoIcon className="w-6 h-6 kiro-agent-logo-active transition-opacity duration-[var(--motion-fast)] group-hover/logo:opacity-80" />
          </button>
          <div className="w-5 h-px bg-line-soft my-0.5" />
          <button
            onClick={newChat}
            aria-label="新对话"
            title="新对话"
            className="w-9 h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={expandWithSearch}
            aria-label="搜索对话"
            title="搜索对话"
            className="w-9 h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            <Search className="w-4 h-4" />
          </button>
          <div className="flex-1" />
          <div className="relative">
            <button
              onClick={() => setMoreOpen((v) => !v)}
              aria-label="对话更多操作"
              aria-expanded={moreOpen}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {moreOpen && moreMenu}
          </div>
        </div>
      ) : (
        /* ---------- Expanded Rail（Overlay，不重排聊天宽度） ---------- */
        <div
          role="dialog"
          aria-label="对话"
          className="w-[216px] lg:w-[232px] rounded-2xl bg-surface border border-line shadow-card flex flex-col overflow-hidden"
        >
          {/* Header：Logo（唯一品牌点）+ 对话 + 收起 */}
          <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2.5 border-b border-line">
            <div className="flex items-center gap-2 min-w-0">
              <KiroLogoIcon className="w-[18px] h-[18px] kiro-agent-logo-active" />
              <span className="text-xs font-bold text-charcoal">对话</span>
            </div>
            <button
              onClick={collapse}
              aria-label="收起对话"
              className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          {/* + 新对话 / 搜索 */}
          <div className="shrink-0 space-y-1.5 px-2.5 pt-2.5 pb-2">
            <button
              onClick={newChat}
              className="w-full flex items-center gap-2 px-2.5 h-8 rounded-lg text-xs font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              新对话
            </button>
            <div className="flex items-center gap-1.5 bg-[#F7F5F5] border border-line rounded-lg px-2 h-8">
              <Search className="w-3.5 h-3.5 text-sandrift shrink-0" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索对话"
                aria-label="搜索对话"
                className="w-full bg-transparent text-xs text-charcoal placeholder-sandrift focus:outline-none"
              />
            </div>
          </div>

          {/* 最近 Thread 列表 */}
          <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
            <p className="text-[10px] font-semibold text-sandrift px-1.5 pt-1 pb-1">最近</p>
            {filtered.length === 0 ? (
              <p className="text-[11px] text-sandrift text-center py-6">
                {records.length === 0 ? "暂无历史对话" : "未找到匹配对话"}
              </p>
            ) : (
              filtered.slice(0, 8).map((rec) => (
                <KiroThreadRow
                  key={rec.id}
                  record={rec}
                  isCurrent={session.currentConversationId === rec.id}
                  onOpen={openThread}
                />
              ))
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 flex items-center justify-between px-3 py-2 border-t border-line">
            <p className="text-[10px] text-sandrift">Kiro 对话仅保存在当前浏览器中。</p>
            <div className="relative">
              <button
                onClick={() => setMoreOpen((v) => !v)}
                aria-label="对话更多操作"
                aria-expanded={moreOpen}
                className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {moreOpen && moreMenu}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
