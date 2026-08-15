"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, MoreHorizontal, FileDown, Copy, Trash2, ChevronLeft, History as HistoryIcon, FolderKanban } from "lucide-react";
import { useKiroSessionMeta, useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";
import { KiroThreadRow } from "@/components/kiro/KiroThreadRow";
import { KiroMenuPanel, KiroMenuItem, KiroMenuDivider } from "@/components/kiro/KiroMenu";
import { listConversations } from "@/lib/ai/history/db";
import { KiroConversationRecord } from "@/lib/ai/history/types";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { KIRO_OUTPUT_TEXT_SIZE_LABELS, KiroOutputTextSize } from "@/lib/ai/ui/typography";
import { cn } from "@/lib/utils";

/** Soft Plate：Kiro Logo 的浅色底座 + 1px 品牌 perimeter（方案 A；hover 流光由 CSS 驱动） */
function KiroRailPlate({
  size = "md",
  active,
  className,
}: {
  size?: "sm" | "md";
  /** expanded / 当前 Thread：静态品牌细边常显 */
  active?: boolean;
  className?: string;
}) {
  const box = size === "sm" ? "w-8 h-8" : "w-10 h-10";
  const logo = size === "sm" ? "w-[18px] h-[18px]" : "w-6 h-6";
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center rounded-xl overflow-hidden kiro-rail-plate",
        active && "kiro-rail-plate-active",
        box,
        className
      )}
      aria-hidden="true"
    >
      {/* 1px 品牌 perimeter：Idle 隐藏 / hover 慢速流光 / active 静态细边 */}
      <span className="absolute inset-0 rounded-xl kiro-ring transition-opacity duration-[var(--motion-fast)]" />
      <span className="relative w-full h-full rounded-[11px] bg-surface border border-line-soft flex items-center justify-center">
        <KiroLogoIcon className={cn(logo, "relative")} />
      </span>
    </span>
  );
}

/**
 * Kiro Floating Thread Rail（Codex-style，仅完整 Kiro Workspace；Sidecar 不显示）。
 * - Collapsed：52px 浮动条（Soft Plate Logo + 新对话 + 最近 + 搜索 + 更多）
 * - Expanded：Overlay 展开（232px），max-height 防溢出、列表内部滚动，不重排聊天宽度
 * - 历史复用 listConversations + historyVersion + currentConversationId（不复制 History Runtime）
 * - Esc / 点击外部收起；Cmd/Ctrl+Shift+H toggle；不依赖 hover 展开
 */
export function KiroThreadRail({ onOpenProjects }: { onOpenProjects?: () => void }) {
  const meta = useKiroSessionMeta();
  const actions = useKiroSessionActions();
  // Task 7C：Kiro 输出字号（低频 preference，仅 Expanded Rail 提供入口）
  const outputTextSize = useKiroPreferencesStore((s) => s.outputTextSize);
  const setOutputTextSize = useKiroPreferencesStore((s) => s.setOutputTextSize);
  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [records, setRecords] = useState<KiroConversationRecord[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const railRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const collapseAfterTransitionRef = useRef(false);

  // Lazy History（Task 13）：collapsed 不读取 History DB；首次展开才 list；
  // 展开期间 historyVersion 变化 → 后台刷新（collapse 后保留 cache）
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  useEffect(() => {
    if (!expandedRef.current) return; // collapsed：不读取 / 不刷新
    let alive = true;
    void listConversations().then((list) => {
      if (alive) setRecords(list);
    });
    return () => {
      alive = false;
    };
  }, [expanded, meta.historyVersion]);

  const collapse = () => {
    collapseAfterTransitionRef.current = false;
    setExpanded(false);
    setMoreOpen(false);
    setQuery("");
    setShowAll(false);
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
  }, [expanded, moreOpen, meta.historyVersion]);

  const expand = (opts?: { focusSearch?: boolean }) => {
    setExpanded(true);
    if (opts?.focusSearch) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  };

  const newChat = () => {
    if (meta.conversationTransitioning) return;
    actions.newChat();
    collapse();
  };

  const openThread = (id: string) => {
    if (meta.conversationTransitioning) return;
    collapseAfterTransitionRef.current = true;
    void actions.loadConversation(id);
  };

  useEffect(() => {
    if (!collapseAfterTransitionRef.current || meta.conversationTransitioning) return;
    collapseAfterTransitionRef.current = false;
    setExpanded(false);
    setMoreOpen(false);
    setQuery("");
    setShowAll(false);
  }, [meta.conversationTransitioning]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? records.filter((r) => r.title.toLowerCase().includes(q)) : records;
    return q || showAll ? base : base.slice(0, 8);
  }, [records, query, showAll]);

  const hasMessages = meta.hasMessages;

  const copyAll = async () => {
    await actions.copyCurrentTranscript();
    setMoreOpen(false);
  };
  const exportMarkdown = () => {
    actions.exportCurrentTranscript();
    setMoreOpen(false);
  };
  const clearConversation = () => {
    setMoreOpen(false);
    confirmRequest({
      title: "清空当前对话？",
      description: "仅清除当前会话中的消息，不影响你的 ClassFlow 数据。",
      confirmLabel: "清空",
      danger: true,
      onConfirm: () => actions.newChat(),
    });
  };

  const moreMenu = (placement: "top-end" | "right-end") => (
    <KiroMenuPanel open={moreOpen} placement={placement} className="w-[220px]">
      <KiroMenuItem icon={Copy} label="复制全部对话" disabled={!hasMessages} onClick={copyAll} />
      <KiroMenuItem icon={FileDown} label="导出 Markdown" disabled={!hasMessages} onClick={exportMarkdown} />
      <KiroMenuDivider />
      {/* Task 7D：输出字号（即时生效，不关闭菜单，可连续比较） */}
      <div className="px-2.5 py-2 space-y-1.5" role="group" aria-label="Kiro 输出字号">
        <p className="text-[10px] font-semibold text-sandrift">输出字号</p>
        <div className="flex items-center gap-0.5 bg-[#F7F5F5] p-0.5 rounded-lg w-fit">
          {(Object.keys(KIRO_OUTPUT_TEXT_SIZE_LABELS) as KiroOutputTextSize[]).map((size) => {
            const active = outputTextSize === size;
            return (
              <button
                key={size}
                type="button"
                onClick={() => setOutputTextSize(size)}
                aria-pressed={active}
                aria-label={`${KIRO_OUTPUT_TEXT_SIZE_LABELS[size]}字号`}
                className={cn(
                  "px-2.5 h-6 rounded-md text-[11px] font-semibold transition-colors",
                  active ? "bg-white text-charcoal shadow-subtle" : "text-sandrift hover:text-charcoal"
                )}
              >
                {KIRO_OUTPUT_TEXT_SIZE_LABELS[size]}
              </button>
            );
          })}
        </div>
      </div>
      <KiroMenuDivider />
      <KiroMenuItem icon={Trash2} label="清空当前对话" danger disabled={!hasMessages} onClick={clearConversation} />
    </KiroMenuPanel>
  );

  return (
    <div
      ref={railRef}
      data-testid="kiro-thread-rail"
      className="hidden md:flex absolute left-3 top-20 z-20"
    >
      {!expanded ? (
        /* ---------- Collapsed Rail（52px） ---------- */
        <div className="w-[52px] rounded-2xl bg-surface border border-line shadow-subtle flex flex-col items-center py-3 gap-1.5 max-h-[calc(100dvh-140px)]">
          <button
            onClick={() => expand()}
            aria-label="展开对话"
            aria-expanded={false}
            title="对话"
            className="group/plate rounded-xl transition-colors"
          >
            <KiroRailPlate />
          </button>
          <div className="w-5 h-px bg-line-soft my-0.5" />
          <button
            onClick={newChat}
            aria-label="新对话"
            title={meta.conversationTransitioning ? "正在切换会话…" : "新对话"}
            disabled={meta.conversationTransitioning}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-sandrift"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() => expand()}
            aria-label="最近对话"
            title="最近对话"
            className="w-9 h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            <HistoryIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => expand({ focusSearch: true })}
            aria-label="搜索对话"
            title="搜索对话"
            className="w-9 h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            onClick={() => onOpenProjects?.()}
            aria-label="打开项目"
            title="项目"
            className="w-9 h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            <FolderKanban className="w-4 h-4" />
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
            {moreMenu('right-end')}
          </div>
        </div>
      ) : (
        /* ---------- Expanded Rail（Overlay，不重排聊天宽度；max-height 防溢出） ---------- */
        <div
          role="dialog"
          aria-label="对话"
          className="w-[216px] lg:w-[232px] max-h-[calc(100dvh-120px)] rounded-2xl bg-surface border border-line shadow-card flex flex-col overflow-hidden animate-enter"
        >
          {/* Header：Soft Plate Logo + Kiro + 收起（bg-surface 极浅底，不压 Logo 原色） */}
          <div className="shrink-0 flex items-center justify-between gap-2 px-2.5 py-2.5 border-b border-line bg-surface">
            <div className="flex items-center gap-2 min-w-0 group/plate">
              <KiroRailPlate size="sm" active />
              <span className="text-xs font-semibold text-charcoal">Kiro</span>
            </div>
            <button
              onClick={collapse}
              aria-label="收起对话"
              className="p-1 rounded-lg text-sandrift hover:bg-white/70 hover:text-charcoal transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          {/* + 新对话 / 搜索（固定区） */}
          <div className="shrink-0 space-y-1.5 px-2.5 pt-2.5 pb-2">
            <button
              onClick={newChat}
              disabled={meta.conversationTransitioning}
              className="w-full flex items-center gap-2 px-2.5 h-8 rounded-lg text-xs font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
            {onOpenProjects && (
              <button
                onClick={onOpenProjects}
                aria-label="打开项目"
                className="w-full flex items-center gap-2 px-2.5 h-7 rounded-lg text-[11px] font-semibold text-satin-grey hover:bg-alabaster hover:text-charcoal transition-colors"
              >
                <FolderKanban className="w-3.5 h-3.5 text-sandrift" />
                项目
              </button>
            )}
          </div>

          {/* Thread 列表（独立滚动区） */}
          <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
            <p className="text-[10px] font-semibold text-sandrift px-1.5 pt-1 pb-1">
              {showAll ? "全部历史" : "最近"}
            </p>
            {filtered.length === 0 ? (
              <p className="text-[11px] text-sandrift text-center py-6">
                {records.length === 0 ? "暂无历史对话" : "未找到匹配对话"}
              </p>
            ) : (
              filtered.map((rec) => (
                <KiroThreadRow
                  key={rec.id}
                  record={rec}
                  isCurrent={meta.currentConversationId === rec.id}
                  onOpen={openThread}
                  disabled={meta.conversationTransitioning}
                  transitioning={meta.conversationTransition.target === rec.id}
                />
              ))
            )}
            {!showAll && records.length > 8 && (
              <button
                onClick={() => setShowAll(true)}
                className="w-full text-left px-2 py-1.5 rounded-lg text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
              >
                查看全部历史
              </button>
            )}
          </div>

          {/* Footer（固定区） */}
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
              {moreMenu('top-end')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
