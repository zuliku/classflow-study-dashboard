"use client";

import React, { useState } from "react";
import { MoreHorizontal, PencilLine, Trash2, Check } from "lucide-react";
import { useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { useToastStore } from "@/store/useToastStore";
import { formatHistoryTime } from "@/lib/ai/history/sanitize";
import { KiroConversationRecord } from "@/lib/ai/history/types";
import { cn } from "@/lib/utils";

/**
 * Kiro Thread Row（Thread Rail 与 History Panel 共用）：
 * 标题 + 更新时间 + 当前 Thread active + hover 菜单（重命名 / 删除）+ 行内重命名。
 */
export function KiroThreadRow({
  record,
  isCurrent,
  onOpen,
}: {
  record: KiroConversationRecord;
  isCurrent: boolean;
  onOpen: (id: string) => void;
}) {
  const session = useKiroSessionActions();
  const pushToast = useToastStore((s) => s.pushToast);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(record.title);

  const commitRename = () => {
    const t = editText.trim();
    if (t && t !== record.title) {
      void session.renameConversation(record.id, t);
      pushToast({ message: "已重命名" });
    }
    setEditing(false);
  };

  const deleteRow = () => {
    setMenuOpen(false);
    void session.deleteConversation(record.id);
    pushToast({ message: "对话已删除" });
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5">
        <input
          autoFocus
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setEditing(false);
          }}
          aria-label="重命名对话"
          className="w-full bg-white border border-line-strong rounded-lg px-2 py-1 text-xs text-charcoal focus:outline-none min-w-0"
        />
        <button
          onClick={commitRename}
          aria-label="确认重命名"
          className="shrink-0 w-6 h-6 rounded-lg bg-pastel-mint hover:bg-pastel-mint text-charcoal flex items-center justify-center transition-colors"
        >
          <Check className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={() => onOpen(record.id)}
      role="button"
      tabIndex={0}
      aria-current={isCurrent ? "true" : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(record.id);
      }}
      className={cn(
        "group flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors",
        isCurrent ? "bg-pastel-mint" : "hover:bg-alabaster/70"
      )}
    >
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs font-semibold truncate", isCurrent ? "text-charcoal" : "text-satin-grey group-hover:text-charcoal")}>
          {record.title}
        </p>
        <p className="text-[10px] text-sandrift mt-0.5">
          {formatHistoryTime(record.updatedAt)}
          {isCurrent && <span className="ml-1.5 font-bold text-success">当前</span>}
        </p>
      </div>
      {/* Row Menu：hover 显示（触屏常驻） */}
      <div className="relative shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          aria-label={`对话 ${record.title} 更多操作`}
          aria-expanded={menuOpen}
          className="p-1 rounded-lg text-sandrift hover:bg-white hover:text-charcoal transition-colors"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 z-30 w-32 bg-surface border border-line-strong rounded-xl shadow-card p-1 text-xs"
          >
            <button
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                setEditing(true);
                setEditText(record.title);
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
                deleteRow();
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
  );
}
