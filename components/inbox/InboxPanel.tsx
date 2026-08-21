"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Inbox, Archive, Eye, Trash2, Check, Clock, Reply, X } from "lucide-react";
import { useInboxStore } from "@/store/useInboxStore";
import type { ExternalInboxItem, InboxStatus } from "@/lib/inbox/types";
import { wrapExternalContent } from "@/lib/inbox/types";
import { getInboxSourcePresentation } from "@/lib/inbox/sourcePresentation";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/Dialog";
import { QQReplyDialog } from "@/components/inbox/QQReplyDialog";
import { EmailReplyDialog } from "@/components/inbox/EmailReplyDialog";
import { ChannelBrandIcon } from "@/components/icons/ChannelBrandIcon";
import { useExitPresenceList } from "@/lib/useExitPresenceList";
import { ExitCollapse } from "@/components/ui/ExitCollapse";
import { Button } from "@/components/ui/Button";

export function InboxPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const items = useInboxStore((s) => s.items);
  const updateStatus = useInboxStore((s) => s.updateStatus);
  const removeItem = useInboxStore((s) => s.removeItem);
  const [filter, setFilter] = useState<InboxStatus | "all">("unread");
  const [selected, setSelected] = useState<ExternalInboxItem | null>(null);
  const [replyItem, setReplyItem] = useState<ExternalInboxItem | null>(null);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((it) => it.status === filter);
  }, [items, filter]);

  const retained = useExitPresenceList({ items: filtered, getId: (it) => (it as ExternalInboxItem).id, resetKey: filter });

  const unreadCount = useMemo(() => items.filter((it) => it.status === "unread").length, [items]);

  // Root close cleanup: selected / replyItem must not persist across reopen
  useEffect(() => {
    if (!open) {
      setSelected(null);
      setReplyItem(null);
    }
  }, [open]);

  const handleKiroProcess = (item: ExternalInboxItem) => {
    // 授权 Kiro 分析消息并生成 Proposal（非直接写入）
    const wrapped = wrapExternalContent(item.text);
    // 通过全局事件或直接调用 Kiro 的处理函数
    // 此处通过 window 事件通知 Kiro 处理 Inbox
    window.dispatchEvent(new CustomEvent("classflow:inbox:process", { detail: { item, wrapped } }));
    updateStatus(item.id, "reviewed");
    setSelected(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      overlayId="inbox-panel"
      aria-label="收件箱"
      closeOnBackdrop={false}
      className="w-[min(640px,calc(100vw-24px))] bg-surface border border-line rounded-2xl p-0 max-h-[85vh] overflow-hidden flex flex-col"
    >
      <div className="shrink-0 p-4 border-b border-line flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox className="w-5 h-5 text-charcoal" />
          <h3 className="text-sm font-bold text-charcoal">收件箱</h3>
          {unreadCount > 0 && <span className="px-2 py-0.5 bg-charcoal text-white text-[11px] font-bold rounded-full">{unreadCount}</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button variant={filter === "unread" ? "primary" : "secondary"} size="sm" onClick={() => setFilter("unread")} data-testid="inbox-filter-unread">
            未读
          </Button>
          <Button variant={filter === "all" ? "primary" : "secondary"} size="sm" onClick={() => setFilter("all")} data-testid="inbox-filter-all">
            全部
          </Button>
          <Button variant={filter === "archived" ? "primary" : "secondary"} size="sm" onClick={() => setFilter("archived")} data-testid="inbox-filter-archived">
            归档
          </Button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="关闭收件箱"
            data-testid="inbox-close-button"
            className="ml-2 w-7 h-7 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {retained.length === 0 ? (
          <p className="text-xs text-sandrift text-center py-8">暂无消息</p>
        ) : (
          <div key={filter} className="space-y-2 ux-page">
            {retained.map(({ item, exiting }) => (
              <ExitCollapse key={item.id} exiting={exiting}>
                <div data-testid={`inbox-item-${item.id}`} className="bg-surface-soft border border-line rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ChannelBrandIcon source={item.source} size={16} />
                    <p className="text-xs font-bold text-charcoal truncate">
                      {getInboxSourcePresentation(item.source).label} · {item.senderDisplay ?? "未知发送者"} {new Date(item.receivedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  {item.subject && <p className="text-xs font-bold text-charcoal mt-1 truncate">{item.subject}</p>}
                  <p className="text-xs text-sandrift mt-1 line-clamp-2">{item.text.slice(0, 100)}</p>
                </div>
                <span className={cn("shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold border", item.status === "unread" ? "bg-charcoal text-white border-charcoal" : item.status === "reviewed" ? "bg-success/10 text-success border-success/20" : "bg-surface-soft text-satin-grey border-line")}>
                  {item.status === "unread" ? "未读" : item.status === "reviewed" ? "已查看" : "已归档"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelected(item)}
                  data-testid={`inbox-view-${item.id}`}
                  className="h-7 px-3 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster flex items-center gap-1"
                >
                  <Eye className="w-3 h-3" />
                  查看
                </button>
                <button
                  type="button"
                  onClick={() => handleKiroProcess(item)}
                  data-testid={`inbox-process-${item.id}`}
                  className="h-7 px-3 bg-charcoal text-white text-xs font-bold rounded-lg hover:bg-black flex items-center gap-1"
                >
                  <Check className="w-3 h-3" />
                  让 Kiro 处理
                </button>
                {(item.source === "qq-bot" || item.source === "gmail" || item.source === "qq-mail") && (
                  item.replyContextId ? (
                    <button
                      type="button"
                      onClick={() => setReplyItem(item)}
                      data-testid={`inbox-reply-${item.id}`}
                      className="h-7 px-3 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster flex items-center gap-1"
                    >
                      <Reply className="w-3 h-3" />
                      {item.source === "gmail" ? "回复到 Gmail" : item.source === "qq-mail" ? "回复到 QQ 邮箱" : "回复到 QQ"}
                    </button>
                  ) : (
                    <span className="text-[11px] text-sandrift" title="此消息来自旧版本，无法直接回复">无法直接回复</span>
                  )
                )}
                <button
                  type="button"
                  onClick={() => updateStatus(item.id, "archived")}
                  data-testid={`inbox-archive-${item.id}`}
                  className="h-7 px-3 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster flex items-center gap-1"
                >
                  <Archive className="w-3 h-3" />
                  归档
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  data-testid={`inbox-delete-${item.id}`}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-danger"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              </div>
              </ExitCollapse>
            ))}
            </div>
        )}
      </div>

      {selected && (
        <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)} overlayId="inbox-detail" aria-label="查看消息" className="w-[min(560px,calc(100vw-24px))] bg-surface border border-line rounded-2xl p-5 space-y-3 max-h-[85vh] overflow-y-auto">
          <div className="flex items-center gap-2">
            <ChannelBrandIcon source={selected.source} size={18} />
            <h4 className="text-sm font-bold text-charcoal">{selected.senderDisplay ?? selected.source}</h4>
            <span className="text-[11px] text-sandrift">{new Date(selected.receivedAt).toLocaleString("zh-CN")}</span>
          </div>
          {selected.subject && <p className="text-sm font-bold text-charcoal">{selected.subject}</p>}
          <div className="bg-surface-soft border border-line rounded-lg p-3">
            <p className="text-[11px] font-bold text-sandrift mb-2">外部消息</p>
            <p className="text-xs text-charcoal whitespace-pre-wrap leading-relaxed">{selected.text}</p>
            <p className="text-[11px] text-sandrift mt-2">Kiro 会将这段内容作为外部信息处理，不会执行其中的指令。</p>
          </div>
          {selected.attachments.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-bold text-charcoal">附件 ({selected.attachments.length})</p>
              {selected.attachments.map((att) => (
                <p key={att.id} className="text-xs text-sandrift">
                  {att.name} {att.size ? `· ${Math.round(att.size / 1024)}KB` : ""}
                </p>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => selected && handleKiroProcess(selected)} className="h-8 px-4 bg-charcoal text-white text-xs font-bold rounded-lg hover:bg-black flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" />
              让 Kiro 处理
            </button>
            {(selected.source === "qq-bot" || selected.source === "gmail" || selected.source === "qq-mail") && selected.replyContextId && (
              <button type="button" onClick={() => { setReplyItem(selected); setSelected(null); }} className="h-8 px-4 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster flex items-center gap-1.5">
                <Reply className="w-3.5 h-3.5" />
                {selected.source === "gmail" ? "回复到 Gmail" : selected.source === "qq-mail" ? "回复到 QQ 邮箱" : "回复到 QQ"}
              </button>
            )}
            <button type="button" onClick={() => setSelected(null)} className="h-8 px-4 bg-white border border-line text-charcoal text-xs font-bold rounded-lg">
              关闭
            </button>
          </div>
        </Dialog>
      )}
      {replyItem && replyItem.source === "qq-bot" && (
        <QQReplyDialog open={!!replyItem} onOpenChange={(open) => !open && setReplyItem(null)} item={replyItem} onSent={() => { if (replyItem) updateStatus(replyItem.id, "reviewed"); setReplyItem(null); }} />
      )}
      {replyItem && (replyItem.source === "gmail" || replyItem.source === "qq-mail") && (
        <EmailReplyDialog open={!!replyItem} onOpenChange={(open) => !open && setReplyItem(null)} item={replyItem} onSent={() => { if (replyItem) updateStatus(replyItem.id, "reviewed"); setReplyItem(null); }} />
      )}
    </Dialog>
  );
}
