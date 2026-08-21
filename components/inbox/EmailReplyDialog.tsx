"use client";

import React, { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Sparkles, Mail } from "lucide-react";
import { useToastStore } from "@/store/useToastStore";
import { useKiroReplyDraft } from "@/hooks/useKiroReplyDraft";
import { ChannelBrandIcon } from "@/components/icons/ChannelBrandIcon";
import { Button } from "@/components/ui/Button";

interface EmailReplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: { id: string; source: string; senderDisplay?: string; text: string; subject?: string; conversationId?: string; replyContextId?: string; sourceAccountId?: string } | null;
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

function channelLabel(source: string): string {
  if (source === "gmail") return "Gmail";
  if (source === "qq-mail") return "QQ 邮箱";
  return source;
}

export function EmailReplyDialog({ open, onOpenChange, item, onSent }: EmailReplyDialogProps) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [approval, setApproval] = useState<{ approvalId: string; expiresAt: number; preview: { channel: string; conversationType: string; text: string } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tone, setTone] = useState<"natural" | "concise" | "formal" | "friendly">("natural");
  const [draftGenerated, setDraftGenerated] = useState(false);
  const currentDialogItemIdRef = React.useRef<string | null>(null);
  const pushToast = useToastStore((s) => s.pushToast);
  const { generateDraft, cancel: cancelDraft, loading: draftLoading, error: draftError } = useKiroReplyDraft();

  React.useEffect(() => {
    cancelDraft();
    setText("");
    setApproval(null);
    setError(null);
    setConfirmOpen(false);
    setDraftGenerated(false);
    setTone("natural");
    currentDialogItemIdRef.current = open && item ? item.id : null;
    return () => cancelDraft();
  }, [open, item?.id, cancelDraft]);

  if (!item) return null;

  const handlePrepare = async () => {
    if (!item.replyContextId) {
      setError("此邮件来自旧版本，无法直接回复");
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
        pushToast({ message: `已回复到 ${channelLabel(item.source)}`, type: "success" });
        onOpenChange(false);
        onSent?.();
        setApproval(null);
        setConfirmOpen(false);
      }
    } catch (e) {
      const raw = (e as { code?: string; message?: string })?.message ?? String(e);
      const code = (e as { code?: string })?.code ?? "";
      if (code === "EMAIL_SEND_REJECTED") {
        setError("邮件发送被拒绝，请检查发件人地址与线程。");
      } else if (code === "EMAIL_SEND_UNCERTAIN") {
        setError("发送结果不确定，请先检查“已发送”，避免重复发送。");
      } else if (code === "EMAIL_REPLY_CONTEXT_INVALID") {
        setError("邮件回复上下文无效，请重新同步后重试。");
      } else if (code === "GMAIL_AUTH_FAILED") {
        setError("账号授权失效，请重新连接。");
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

  const label = channelLabel(item.source);

  return (
    <>
      <Dialog open={open && !confirmOpen} onOpenChange={onOpenChange} overlayId="email-reply" aria-label={`回复到 ${label}`} className="w-[min(600px,calc(100vw-24px))] bg-surface border border-line rounded-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-pastel-mint border border-line flex items-center justify-center">
            <ChannelBrandIcon source={item.source as never} size={18} />
          </div>
          <div>
            <h4 className="text-sm font-bold text-charcoal">回复到 {label}</h4>
            <p className="text-[11px] text-sandrift">仅回复发件人 · {item.senderDisplay ?? "未知"} · {label}</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="bg-surface-soft border border-line rounded-lg p-3">
            <p className="text-[11px] font-bold text-sandrift mb-1">回复至</p>
            <p className="text-xs text-charcoal flex items-center gap-1.5"><Mail className="w-3 h-3" /> {item.senderDisplay ?? "发件人"} · 仅回复发件人（不支持抄送/群发）</p>
          </div>
          {item.subject && (
            <div className="bg-surface-soft border border-line rounded-lg p-3">
              <p className="text-[11px] font-bold text-sandrift mb-1">原主题</p>
              <p className="text-xs text-charcoal font-bold truncate">Re: {item.subject.startsWith("Re:") ? item.subject.slice(3).trim() : item.subject}</p>
            </div>
          )}
          <div className="bg-surface-soft border border-line rounded-lg p-3">
            <p className="text-[11px] font-bold text-sandrift mb-1">原邮件正文（安全纯文本）</p>
            <p className="text-xs text-charcoal whitespace-pre-wrap line-clamp-4">{item.text.slice(0, 400)}</p>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-charcoal">回复正文 *</label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={async () => {
                  if (!item) return;
                  const requestedItemId = item.id;
                  const result = await generateDraft({ inboxItemId: item.id, message: `主题：${item.subject ?? "(无主题)"}\n\n${item.text}`, senderDisplay: item.senderDisplay, tone, source: item.source });
                  if (!result || currentDialogItemIdRef.current !== requestedItemId) return;
                  setText(result.draft);
                  setDraftGenerated(true);
                }}
                disabled={draftLoading}
                data-testid="email-reply-generate"
                className="h-7 px-3 bg-white border border-line text-charcoal text-xs font-bold rounded-lg hover:bg-alabaster flex items-center gap-1 disabled:opacity-60"
              >
                <Sparkles className="w-3 h-3" />
                {draftGenerated ? "重新生成" : "Kiro 生成草稿"}
              </button>
              <select value={tone} onChange={(e) => setTone(e.target.value as never)} data-testid="email-reply-tone" className="h-7 px-2 bg-white border border-line rounded-lg text-xs">
                <option value="natural">自然</option>
                <option value="concise">简洁</option>
                <option value="formal">正式</option>
                <option value="friendly">友好</option>
              </select>
            </div>
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="输入回复内容（纯文本）..." rows={6} maxLength={2000} data-testid="email-reply-text" className="mt-1 w-full p-3 bg-white border border-line rounded-lg text-sm resize-none focus:outline-none focus:border-charcoal" />
          <p className="text-[11px] text-sandrift mt-1">{text.length}/2000 · 纯文本回复，自动保持原线程 {draftLoading ? "· 生成中..." : draftGenerated ? "· AI 草稿，可继续编辑" : ""}</p>
          {draftError && <p className="text-[11px] text-danger mt-1">{draftError}</p>}
        </div>

        {error && <p className="text-xs font-bold text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex items-center gap-2">
          <div className="flex-1" />
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="primary" size="sm" loading={saving} disabled={!text.trim()} onClick={handlePrepare} data-testid="email-reply-prepare">继续</Button>
        </div>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!o) handleCancelPrepare(); }} overlayId="email-reply-confirm" aria-label={`确认发送到 ${label}`} className="w-[min(480px,calc(100vw-24px))] bg-surface border border-line rounded-2xl p-5 space-y-4">
        <h4 className="text-sm font-bold text-charcoal">确认发送到 {label}？</h4>
        {approval && (
          <div className="space-y-2">
            <p className="text-xs text-sandrift">发送至：{item.senderDisplay ?? "发件人"} · 仅回复发件人 · 将在原邮件会话中回复。</p>
            <div className="bg-surface-soft border border-line rounded-lg p-3">
              <p className="text-xs text-charcoal whitespace-pre-wrap">{approval.preview.text}</p>
            </div>
            <p className="text-[11px] text-sandrift">一次审批对应一次发送，不会自动重试。如果发送结果不确定，请先检查“已发送”，避免重复发送。</p>
          </div>
        )}
        {error && <p className="text-xs font-bold text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex items-center gap-2">
          <div className="flex-1" />
          <Button variant="secondary" size="sm" onClick={handleCancelPrepare}>取消</Button>
          <Button variant="primary" size="sm" loading={saving} loadingLabel="发送中..." onClick={handleConfirm} data-testid="email-reply-confirm">确认发送</Button>
        </div>
      </Dialog>
    </>
  );
}
