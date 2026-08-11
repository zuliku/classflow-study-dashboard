"use client";

import React, { useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Copy, Pencil, RefreshCw, MoreHorizontal, Send } from "lucide-react";
import { KiroMark } from "@/components/kiro/KiroHeader";
import { KiroMarkdown } from "@/components/kiro/KiroMarkdown";
import { KiroMenuPanel, KiroMenuItem, KiroMenuDivider, useKiroPopover } from "@/components/kiro/KiroMenu";
import { useToastStore } from "@/store/useToastStore";
import { KiroAttachmentView } from "@/lib/ai/attachments/types";
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import { UserMessageEditBlockReason } from "@/lib/ai/history/messageEditing";
import { citationsToReadableText } from "@/lib/ai/citations/parser";
import { cn } from "@/lib/utils";
import {
  markdownToPlainText,
  copyTextToClipboard,
} from "@/lib/ai/share";

/**
 * Kiro 回复 Message：Kiro mark + 文档流（非左右气泡）。
 * 内容经 KiroMarkdown 渲染（真实 Markdown，不显示原始符号）。
 * Message 级操作：Copy / 重新生成（仅最后一条 assistant）/ More（复制文本 / Markdown / 结果摘要）。
 * 流式光标在 Markdown 渲染器外部显示，不拼进 Markdown source。
 * 移动端：操作常驻（不依赖 hover）；桌面 hover/focus 显示。
 */
export function KiroMessage({
  content,
  streaming,
  children,
  testid,
  canRegenerate,
  actionSummaries,
  actionsReady,
  sources,
  onRetry,
}: {
  content?: string;
  /** 流式进行中：末尾显示克制状态光标 */
  streaming?: boolean;
  children?: React.ReactNode;
  testid?: string;
  /** 允许「重新生成」：仅 live 最新 read-only turn（含 Write Tool 或历史恢复的轮次为 false） */
  canRegenerate?: boolean;
  /** Action Result 摘要文本（复制结果摘要用，仅可见事实） */
  actionSummaries?: string[];
  /** 整个 Assistant Turn 是否已完成（chat.status 回到 ready）；最后一条消息由它决定操作栏时机 */
  actionsReady?: boolean;
  /** 本消息可用的文档来源（Citation 渲染与导出用；不含正文） */
  sources?: KiroSourceMeta[];
  /** 重新生成（由 Conversation 注入稳定 callback，避免每行订阅 Session Context） */
  onRetry?: () => void;
}) {
  const pushToast = useToastStore((s) => s.pushToast);
  const more = useKiroPopover();

  const copyMarkdownSource = async () => {
    const ok = await copyTextToClipboard(citationsToReadableText(content ?? "", sources));
    if (ok) pushToast({ message: "已复制" });
  };

  const copyPlain = async () => {
    const ok = await copyTextToClipboard(markdownToPlainText(citationsToReadableText(content ?? "", sources)));
    if (ok) pushToast({ message: "已复制" });
    more.close();
  };

  const copySummary = async () => {
    const texts: string[] = [];
    if (content) texts.push(markdownToPlainText(citationsToReadableText(content, sources)));
    if (actionSummaries && actionSummaries.length > 0) texts.push(`操作结果：${actionSummaries.join("；")}`);
    const ok = await copyTextToClipboard(texts.join("\n"));
    if (ok) pushToast({ message: "已复制" });
    more.close();
  };

  const hasActions = !!actionSummaries && actionSummaries.length > 0;

  return (
    <div className="flex gap-3 group" data-testid={testid ?? "kiro-message"}>
      <KiroMark size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        {content ? (
          <>
            <KiroMarkdown content={content} sources={sources} />
            {streaming && (
              <span
                aria-hidden="true"
                className="inline-block w-[2px] h-3.5 bg-sandrift align-middle animate-pulse"
              />
            )}
            {/* Message Actions：整个 Turn 结束后常驻（不依赖 hover），低权重 inline toolbar */}
            {(actionsReady ?? true) && !streaming && (
              <div className="flex items-center gap-1 text-[11px] font-semibold text-sandrift">
                <button
                  onClick={copyMarkdownSource}
                  aria-label="复制"
                  title="复制 Markdown"
                  className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  复制
                </button>
                {canRegenerate && onRetry && (
                  <button
                    onClick={onRetry}
                    aria-label="重新生成"
                    title="重新生成"
                    className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    重新生成
                  </button>
                )}
                <div ref={more.ref} className="relative">
                  <button
                    onClick={more.toggle}
                    aria-label="消息更多操作"
                    aria-expanded={more.open}
                    title="更多"
                    className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </button>
                  {more.open && (
                    <KiroMenuPanel placement="top-end">
                      <KiroMenuItem icon={Copy} label="复制文本" onClick={copyPlain} />
                      <KiroMenuItem icon={FileText} label="复制 Markdown" onClick={copyMarkdownSource} />
                      {hasActions && (
                        <>
                          <KiroMenuDivider />
                          <KiroMenuItem icon={FileText} label="复制结果摘要" onClick={copySummary} />
                        </>
                      )}
                    </KiroMenuPanel>
                  )}
                </div>
              </div>
            )}
          </>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** 用户 Message：轻量 soft bubble，右对齐（纯文本 + 附件 chips，不显示提取全文）；hover 可复制 / 内联编辑 */
export function KiroUserMessage({
  messageId,
  content,
  attachments,
  canEdit,
  editDisabledReason,
  onEdit,
}: {
  messageId: string;
  content: string;
  attachments?: KiroAttachmentView[];
  /** Task 7：是否可编辑（attachment/history 最终绑定后计算） */
  canEdit?: boolean;
  editDisabledReason?: UserMessageEditBlockReason;
  onEdit?: (messageId: string, text: string) => Promise<boolean>;
}) {
  const pushToast = useToastStore((s) => s.pushToast);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const copy = async () => {
    const ok = await copyTextToClipboard(content);
    if (ok) pushToast({ message: "已复制" });
  };

  const startEdit = () => {
    setDraft(content);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setSubmitting(false);
  };

  // 轻量 autosize（不引入新依赖）
  useEffect(() => {
    if (!editing) return;
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [editing, draft]);

  const submit = async () => {
    const v = draft.trim();
    if (!v || submitting) return; // 空内容禁止保存
    if (v === content.trim()) {
      cancelEdit(); // 内容未变：退出编辑态，不调用模型
      return;
    }
    setSubmitting(true);
    const ok = await onEdit?.(messageId, v);
    if (ok) {
      setEditing(false);
      setSubmitting(false);
    } else {
      setSubmitting(false); // 失败：保留编辑态方便修正
    }
  };

  const editDisabledTitle = editDisabledReason
    ? {
        "write-suffix": "该消息之后包含已执行操作，无法直接编辑；请发送新的修改指令。",
        attachments: "该消息包含附件，暂不支持直接编辑；请重新发送。",
        "turn-in-flight": "Kiro 正在处理当前消息，请稍后再编辑。",
        "message-not-found": "该消息已不可编辑。",
      }[editDisabledReason]
    : undefined;

  return (
    <div className="flex justify-end group" data-testid="kiro-user-message">
      <div className="max-w-[85%] flex flex-col items-end gap-1.5">
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {attachments.map((a) => {
              const Icon = a.kind === "image" ? ImageIcon : FileText;
              return (
                <span
                  key={a.id}
                  data-testid="kiro-sent-attachment"
                  className="inline-flex items-center gap-1.5 pl-2 pr-2 h-7 rounded-lg bg-surface border border-line text-[11px] font-semibold text-satin-grey"
                >
                  <Icon className="w-3 h-3 text-sandrift shrink-0" />
                  <span className={cn("truncate max-w-[140px]")}>{a.name}</span>
                  {a.tempNotRetained && (
                    <span
                      title="这份临时附件没有保存在本机历史中，请重新添加文件。"
                      className="text-[9px] font-bold text-sandrift bg-alabaster border border-line-soft rounded px-1 py-px shrink-0"
                    >
                      临时附件未保留
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        )}
        {editing ? (
          <div className="w-full min-w-[260px] space-y-1.5">
            <textarea
              ref={taRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEdit();
                } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              aria-label="编辑消息"
              className="w-full px-3 py-2.5 bg-white border border-line-strong rounded-2xl text-xs font-medium text-charcoal focus:outline-none focus:border-charcoal resize-none whitespace-pre-wrap leading-relaxed"
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                onClick={cancelEdit}
                className="px-3 h-7 rounded-lg text-[11px] font-semibold text-satin-grey hover:bg-alabaster transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => void submit()}
                disabled={!draft.trim() || submitting}
                className="ux-press flex items-center gap-1 px-3 h-7 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black disabled:opacity-50 transition-colors"
              >
                <Send className="w-3 h-3" />
                {submitting ? "发送中…" : "保存并发送"}
              </button>
            </div>
            <p className="text-[9px] text-sandrift text-right">
              Esc 取消 · Ctrl/⌘+Enter 保存并发送 · Enter 换行
            </p>
          </div>
        ) : (
          <>
            <div className="bg-alabaster border border-line rounded-2xl rounded-br-md px-4 py-2.5 text-xs font-medium text-charcoal whitespace-pre-wrap leading-relaxed">
              {content}
            </div>
            <div className="flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
              <button
                onClick={startEdit}
                disabled={!canEdit || submitting}
                aria-disabled={!canEdit}
                title={editDisabledTitle ?? "编辑消息"}
                className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-sandrift"
              >
                <Pencil className="w-3.5 h-3.5" />
                编辑
              </button>
              <button
                onClick={copy}
                aria-label="复制"
                title="复制"
                className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-semibold text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                复制
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
