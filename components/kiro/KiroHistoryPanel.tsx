"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Plus, X, MessageSquare, Search, MoreHorizontal, PencilLine, Trash2 } from "lucide-react";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useToastStore } from "@/store/useToastStore";
import { listConversations } from "@/lib/ai/history/db";
import { formatHistoryTime } from "@/lib/ai/history/sanitize";
import { KiroConversationRecord } from "@/lib/ai/history/types";
import { cn } from "@/lib/utils";

/**
 * Kiro History（Task 6）：本地 IndexedDB 对话历史。
 * 列表：updatedAt DESC；标题搜索；行 hover 菜单（重命名 / 删除）；
 * 当前打开会话 active 轻量高亮；清空全部需 Confirm；底部隐私注记。
 */
export function KiroHistoryPanel({
  variant,
  onClose,
  onNewChat,
}: {
  variant: "desktop" | "mobile";
  onClose: () => void;
  onNewChat: () => void;
}) {
  const session = useKiroSession();
  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const [records, setRecords] = useState<KiroConversationRecord[]>([]);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);

  // historyVersion 变化（保存/删除/重命名/清空）→ 刷新列表
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        setMenuId(null);
        setEditingId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? records.filter((r) => r.title.toLowerCase().includes(q)) : records;
    return list;
  }, [records, query]);

  const openRow = (id: string) => {
    setMenuId(null);
    session.loadConversation(id);
    onClose();
  };

  const startRename = (rec: KiroConversationRecord) => {
    setMenuId(null);
    setEditingId(rec.id);
    setEditText(rec.title);
  };

  const commitRename = () => {
    if (editingId) {
      void session.renameConversation(editingId, editText);
      pushToast({ message: "已重命名" });
    }
    setEditingId(null);
  };

  const deleteRow = (id: string) => {
    setMenuId(null);
    void session.deleteConversation(id);
    pushToast({ message: "对话已删除" });
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

  const body = (
    <div className="space-y-3">
      {/* 搜索（仅标题） */}
      <div className="flex items-center gap-1.5 bg-[#F7F5F5] border border-line rounded-xl px-2.5 h-9">
        <Search className="w-3.5 h-3.5 text-sandrift shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索对话标题"
          aria-label="搜索对话"
          className="w-full bg-transparent text-xs text-charcoal placeholder-sandrift focus:outline-none"
        />
        {query && (
          <button onClick={() => setQuery("")} aria-label="清除搜索" className="text-sandrift hover:text-charcoal p-0.5">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* 最近对话 section */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-charcoal">最近对话</h3>
        <button
          onClick={onNewChat}
          aria-label="新对话"
          className="flex items-center gap-1 px-2 h-8 rounded-lg text-[11px] font-bold text-satin-grey hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          新对话
        </button>
      </div>

      {/* 列表容器 */}
      <div className="rounded-2xl bg-[#F7F5F5] border border-line flex flex-col overflow-hidden min-h-[240px]">
        {filtered.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-2.5 px-6 py-10">
            <span className="w-10 h-10 rounded-xl bg-alabaster flex items-center justify-center shrink-0">
              <MessageSquare className="w-[18px] h-[18px] text-sandrift" />
            </span>
            <p className="text-sm font-semibold text-charcoal">
              {query ? "未找到匹配对话" : records.length === 0 ? "暂无历史对话" : "未找到匹配对话"}
            </p>
            <p className="text-xs text-sandrift leading-relaxed max-w-[220px]">
              {records.length === 0
                ? "发送第一条消息后，对话会自动保存在本机。"
                : "换个关键词试试。"}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {filtered.map((rec) => {
              const isCurrent = session.currentConversationId === rec.id;
              const isEditing = editingId === rec.id;
              return (
                <li key={rec.id} className="relative group">
                  {isEditing ? (
                    <div className="px-3 py-2.5 flex items-center gap-2">
                      <input
                        autoFocus
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        aria-label="重命名对话"
                        className="w-full bg-white border border-line-strong rounded-lg px-2 py-1 text-xs text-charcoal focus:outline-none"
                      />
                      <button
                        onClick={commitRename}
                        aria-label="确认重命名"
                        className="shrink-0 px-2 h-7 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
                      >
                        保存
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => openRow(rec.id)}
                      role="button"
                      tabIndex={0}
                      aria-current={isCurrent ? "true" : undefined}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") openRow(rec.id);
                      }}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors",
                        isCurrent ? "bg-pastel-mint/70" : "hover:bg-alabaster/70"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-xs font-semibold truncate", isCurrent ? "text-charcoal" : "text-satin-grey group-hover:text-charcoal")}>
                          {rec.title}
                        </p>
                        <p className="text-[10px] text-sandrift mt-0.5">
                          {formatHistoryTime(rec.updatedAt)}
                          {isCurrent && <span className="ml-1.5 font-bold text-success">当前</span>}
                        </p>
                      </div>
                      {/* Row Menu：hover 显示 */}
                      <div className="relative shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuId((v) => (v === rec.id ? null : rec.id));
                          }}
                          aria-label={`对话 ${rec.title} 更多操作`}
                          className="p-1 rounded-lg text-sandrift hover:bg-white hover:text-charcoal transition-colors"
                        >
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                        {menuId === rec.id && (
                          <div
                            role="menu"
                            className="absolute right-0 top-full mt-1 z-20 w-32 bg-surface border border-line-strong rounded-xl shadow-card p-1 text-xs"
                          >
                            <button
                              role="menuitem"
                              onClick={(e) => {
                                e.stopPropagation();
                                startRename(rec);
                              }}
                              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left font-semibold text-satin-grey hover:bg-alabaster hover:text-charcoal transition-colors"
                            >
                              <PencilLine className="w-3.5 h-3.5" />
                              重命名
                            </button>
                            <button
                              role="menuitem"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteRow(rec.id);
                              }}
                              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left font-semibold text-danger hover:bg-danger-bg transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              删除
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 底部：清空全部 + 隐私注记 */}
      {records.length > 0 && (
        <div className="pt-1 flex items-center justify-between gap-2">
          <p className="text-[10px] text-sandrift">Kiro 对话仅保存在当前浏览器中。</p>
          <button
            onClick={clearAll}
            className="text-[11px] font-bold text-sandrift hover:text-danger transition-colors"
          >
            清空全部
          </button>
        </div>
      )}
      {records.length === 0 && (
        <p className="text-[10px] text-sandrift text-center">Kiro 对话仅保存在当前浏览器中。</p>
      )}
    </div>
  );

  if (variant === "mobile") {
    return (
      <>
        {/* 遮罩 */}
        <div className="absolute inset-0 z-30 bg-black/20" onClick={onClose} aria-hidden="true" />
        {/* 底部 sheet */}
        <div
          role="dialog"
          aria-label="历史记录"
          className="absolute inset-x-0 bottom-0 z-40 bg-surface border-t border-line rounded-t-2xl shadow-card p-4 pb-5 max-h-[65dvh] overflow-y-auto ux-inline"
        >
          <div className="w-10 h-1 rounded-full bg-line-strong mx-auto mb-4" />
          {body}
        </div>
      </>
    );
  }

  return (
    <div role="dialog" aria-label="历史记录" className="h-full flex flex-col">
      {/* 顶部标题区：与 Kiro Header 同一高度语言 */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-line">
        <h3 className="text-sm font-bold text-charcoal">历史记录</h3>
        <button
          onClick={onClose}
          aria-label="关闭历史记录"
          className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">{body}</div>
    </div>
  );
}
