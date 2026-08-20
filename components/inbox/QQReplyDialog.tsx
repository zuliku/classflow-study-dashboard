"use client";

import React, { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { MessageSquare, Sparkles } from "lucide-react";
import { useToastStore } from "@/store/useToastStore";
import { useKiroReplyDraft } from "@/hooks/useKiroReplyDraft";

interface QQReplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: { id: string; source: string; senderDisplay?: string; text: string; conversationId?: string; replyContextId?: string; sourceAccountId?: string } | null;
  onSent?: () => void;
}

function getChannelsBridge(): {
  prepareReply: (input: unknown) => Promise<{ approvalId: string; expiresAt: number; preview: { channel: string; conversationType: string; text: string } }>;
  confirmReply: (input: unknown) => Promise<{ ok: boolean; platformMessageId?: string }>;
  cancelReply: (input: unknown) => Promise<unknown>;
} | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { classflowDesktop?: { channels?: unknown } }).classflowDesktop?.channels as never;
}

export function QQReplyDialog({ open, onOpenChange, item, onSent }: QQReplyDialogProps) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [approval, setApproval] = useState<{ approvalId: string; expiresAt: number; preview: { channel: string; conversationType: string; text: string } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tone, setTone] = useState<"natural" | "concise" | "formal" | "friendly">("natural");
  const pushToast = useToastStore((s) => s.pushToast);
  const { generateDraft, cancel: cancelDraft, loading: draftLoading, error: draftError } = useKiroReplyDraft();

  React.useEffect(() => {
    if (open) {
      setText("");
      setApproval(null);
      setError(null);
      setConfirmOpen(false);
    } else {
      cancelDraft();
    }
  }, [open, item?.id, cancelDraft]);

  React.useEffect(() => {
    return () => cancelDraft();
  }, [cancelDraft]);

  if (!item) return null;

  const handlePrepare = async () => {
    if (!item.replyContextId) {
      setError("此消息来自旧版本，无法直接回复");
      return;
    }
    if (!text.trim()) {
      setError("回复正文不能为空");
      return;
    }
    if (text.length > 2000) {
      setError("回复不能超过 2000 字符");
      return;
    }
    const bridge = getChannelsBridge();
    if (!bridge) {
      setError("桌面环境不可用");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await bridge.prepareReply({ replyContextId: item.replyContextId, text: text.trim() });
      setApproval(res);
      setConfirmOpen(true);
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? String(e);
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    if (!approval) return;
    const bridge = getChannelsBridge();
    if (!bridge) {
      setError("桌面环境不可用");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await bridge.confirmReply({ approvalId: approval.approvalId });
      if (res.ok) {
        pushToast({ message: "已回复到 QQ", type: "success" });
        onOpenChange(false);
        onSent?.();
        setApproval(null);
        setConfirmOpen(false);
      }
    } catch (e) {
      const raw = (e as { code?: string; message?: string })?.message ?? String(e);
      const code = (e as { code?: string })?.code ?? "";
      if (code === "QQ_REPLY_REJECTED") {
        setError("QQ 已无法将此消息作为被动回复发送，请重新收到一条消息后再回复。");
      } else if (code === "QQ_SEND_UNCERTAIN") {
        setError("发送结果不确定，请先检查 QQ，避免重复发送。");
      } else if (code === "QQ_RATE_LIMITED") {
        setError("发送过于频繁，请稍后重试");
      } else {
        setError(raw);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancelPrepare = async () => {
    if (approval) {
      const bridge = getChannelsBridge();
      if (bridge) {
        try { await bridge.cancelReply({ approvalId: approval.approvalId }); } catch {}
      }
      setApproval(null);
    }
    setConfirmOpen(false);
  };

  return (
    <>
      <Dialog open={open && !confirmOpen} onOpenChange={onOpenChange} overlayId="qq-reply" aria-label="回复到 QQ" className="w-[min(560px,calc(100vw-24px))] bg-surface border border-line rounded-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-pastel-mint border border-line flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-charcoal" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-charcoal">回复到 QQ</h4>
            <p className="text-[11px] text-sandrift">来源：QQ · {item.senderDisplay ?? "未知"} · QQ 会话</p>
          </div>
        </div>

        <div className="bg-[#F7F5F5] border border-line rounded-lg p-3">
          <p className="text-[11px] font-bold text-sandrift mb-1">原消息</p>
          <p className="text-xs text-charcoal whitespace-pre-wrap line-clamp-3">{item.text.slice(0, 200)}</p>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-charcoal">回复正文 *</label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={async () => {
                  if (!item) return;
                  const draft = await generateDraft({ inboxItemId: item.id, message: item.text, senderDisplay: item.senderDisplay, tone });
                  if (draft) setText(draft);
                }}
                disabled={draftLoading}
                data-testid="qq-reply-generate"
                className="h-7 px-3 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster flex items-center gap-1 disabled:opacity-60"
              >
                <Sparkles className="w-3 h-3" />
                {text ? "重新生成" : "Kiro 生成草稿"}
              </button>
              <select value={tone} onChange={(e) => setTone(e.target.value as never)} data-testid="qq-reply-tone" className="h-7 px-2 bg-white border border-line rounded-lg text-xs">
                <option value="natural">自然</option>
                <option value="concise">简洁</option>
                <option value="formal">正式</option>
                <option value="friendly">友好</option>
              </select>
            </div>
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="输入回复内容..." rows={4} maxLength={2000} data-testid="qq-reply-text" className="mt-1 w-full p-3 bg-white border border-line rounded-lg text-sm resize-none focus:outline-none focus:border-charcoal" />
          <p className="text-[11px] text-sandrift mt-1">{text.length}/2000 · 单次发送，不会自动拆分 {draftLoading ? "· 生成中..." : text ? "· AI 草稿，可继续编辑" : ""}</p>
          {draftError && <p className="text-[11px] text-danger mt-1">{draftError}</p>}
        </div>

        {error && <p className="text-xs font-bold text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex items-center gap-2">
          <div className="flex-1" />
          <button type="button" onClick={() => onOpenChange(false)} className="h-8 px-4 bg-white border border-line text-charcoal text-xs font-bold rounded-lg">取消</button>
          <button type="button" onClick={handlePrepare} disabled={saving || !text.trim()} data-testid="qq-reply-prepare" className="h-8 px-5 bg-charcoal text-white text-xs font-bold rounded-lg hover:bg-black disabled:opacity-60">确认发送</button>
        </div>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!o) handleCancelPrepare(); }} overlayId="qq-reply-confirm" aria-label="确认发送到 QQ" className="w-[min(480px,calc(100vw-24px))] bg-surface border border-line rounded-2xl p-5 space-y-4">
        <h4 className="text-sm font-bold text-charcoal">确认发送到 QQ？</h4>
        {approval && (
          <div className="space-y-2">
            <p className="text-xs text-sandrift">发送对象：{item.senderDisplay ?? "未知"} · {approval.preview.conversationType === "group" ? "群聊" : "私聊"}</p>
            <div className="bg-[#F7F5F5] border border-line rounded-lg p-3">
              <p className="text-xs text-charcoal whitespace-pre-wrap">{approval.preview.text}</p>
            </div>
            <p className="text-[11px] text-sandrift">一次审批对应一次 QQ 发送，不会自动重试。</p>
          </div>
        )}
        {error && <p className="text-xs font-bold text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex items-center gap-2">
          <div className="flex-1" />
          <button type="button" onClick={handleCancelPrepare} className="h-8 px-4 bg-white border border-line text-charcoal text-xs font-bold rounded-lg">取消</button>
          <button type="button" onClick={handleConfirm} disabled={saving} data-testid="qq-reply-confirm" className="h-8 px-5 bg-charcoal text-white text-xs font-bold rounded-lg hover:bg-black disabled:opacity-60">{saving ? "发送中..." : "确认发送"}</button>
        </div>
      </Dialog>
    </>
  );
}
