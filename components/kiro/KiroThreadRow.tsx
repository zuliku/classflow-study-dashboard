"use client";

import React, { useState } from "react";
import { MoreHorizontal, PencilLine, Trash2, Check, Loader2 } from "lucide-react";
import { useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { useToastStore } from "@/store/useToastStore";
import { formatHistoryTime } from "@/lib/ai/history/sanitize";
import { KiroConversationRecord } from "@/lib/ai/history/types";
import { cn } from "@/lib/utils";
import { KiroMenuPanel } from "@/components/kiro/KiroMenu";

/**
 * Kiro Thread Row（Thread Rail 与 History Panel 共用）：
 * 单行结构（标题 + 右侧时间 + 当前徽标 + hover 菜单），时间不再独占第二行造成整列重复噪音；
 * 标题 + 更新时间 + 当前 Thread active + hover 菜单（重命名 / 删除）+ 行内重命名。
 */
export const KiroThreadRow = React.memo(function KiroThreadRow({
  record,
  isCurrent,
  onOpen,
  disabled,
  transitioning = false,
}: {
  record: KiroConversationRecord;
  isCurrent: boolean;
  onOpen: (id: string) => void;
  /** Task 7B：会话切换进行中禁用打开 */
  disabled?: boolean;
  transitioning?: boolean;
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

  // P0：删除加确认（此前 More→删除误触即永久丢失，无 Undo；与删项目/清空全部同语言）
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteRow = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setMenuOpen(false);
    setConfirmingDelete(false);
    void session.deleteConversation(record.id);
    pushToast({ message: "对话已删除" });
  };

  // 行内重命名：编辑态挂载淡入（view 侧常驻，无需 key；高度相近，只盖挂载硬切）
  if (editing) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 ux-fade">
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
      onClick={() => {
        if (disabled) return;
        onOpen(record.id);
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled ? "true" : undefined}
      aria-current={isCurrent ? "true" : undefined}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter") onOpen(record.id);
      }}
      className={cn(
        "group flex items-center gap-1.5 px-2 h-9 rounded-lg transition-colors",
        disabled
          ? "opacity-50 cursor-not-allowed"
          : isCurrent
            ? "bg-pastel-mint cursor-pointer"
            : "hover:bg-alabaster/70 cursor-pointer"
      )}
    >
      <p className={cn("min-w-0 flex-1 truncate text-xs font-semibold", isCurrent ? "text-charcoal" : "text-satin-grey group-hover:text-charcoal")}>
        {record.title}
      </p>
      <span className="shrink-0 text-[10px] text-sandrift tabular-nums">
        {transitioning ? "正在切换" : formatHistoryTime(record.updatedAt)}
      </span>
      {isCurrent && (
        <span className="shrink-0 text-[9px] font-bold text-charcoal bg-pastel-mint/70 rounded-full px-1.5 py-0.5">
          当前
        </span>
      )}
      {transitioning && (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-sandrift shrink-0" aria-label="正在切换" />
      )}
      {/* Row Menu：hover 显示（触屏常驻） */}
      <div className={cn(
        "relative shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity",
        transitioning && "hidden"
      )}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
            setConfirmingDelete(false);
          }}
          aria-label={`对话 ${record.title} 更多操作`}
          aria-expanded={menuOpen}
          className="p-1 rounded-lg text-sandrift hover:bg-white hover:text-charcoal transition-colors"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
        {/* 常挂载受控菜单（外层硬条件会截断退出；dismiss 语义保持现状：选项点击关闭） */}
        <KiroMenuPanel open={menuOpen} placement="bottom-end" className="w-32 p-1 text-xs">
            <button
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                setConfirmingDelete(false);
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
              aria-label={confirmingDelete ? `确认删除对话 ${record.title}（不可恢复）` : `删除对话 ${record.title}`}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left font-semibold text-danger hover:bg-danger-bg transition-colors whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              {confirmingDelete ? "确认删除？" : "删除"}
            </button>
        </KiroMenuPanel>
      </div>
    </div>
  );
});
