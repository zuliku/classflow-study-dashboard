"use client";

import React from "react";
import { Share2, MoreHorizontal, Plus, History as HistoryIcon, Expand, Copy, FileDown, Trash2 } from "lucide-react";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { KiroMenuPanel, KiroMenuItem, KiroMenuDivider, useKiroPopover } from "@/components/kiro/KiroMenu";
import { KiroShareSheet } from "@/components/kiro/KiroShareSheet";
import {
  buildTranscriptMarkdown,
  buildTranscriptText,
  copyTextToClipboard,
  downloadMarkdownFile,
} from "@/lib/ai/share";

/**
 * 会话级操作（Share + More）：Workspace / Sidecar Header 共用。
 * 层级：会话级（Share / More）在 Header；Panel 级（Expand / Close）由 Sidecar 持有；
 * Message 级与 Composer 级分别在各层。不混层。
 * More 只展示真实支持的操作（无 Archive / Persistence 不放假按钮）。
 */
export function KiroSessionActions({
  variant,
  onNewChat,
  onOpenHistory,
  onExpand,
}: {
  variant: "workspace" | "sidecar";
  /** 自定义新对话行为（如同时关闭 History Panel）；缺省使用 session.newChat() */
  onNewChat?: () => void;
  onOpenHistory?: () => void;
  onExpand?: () => void;
}) {
  const session = useKiroSession();
  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const share = useKiroPopover();
  const more = useKiroPopover();
  const hasMessages = session.chat.messages.length > 0;

  const copyAll = async () => {
    const ok = await copyTextToClipboard(buildTranscriptText(session.chat.messages));
    if (ok) pushToast({ message: "已复制" });
    more.close();
  };

  const exportMarkdown = () => {
    downloadMarkdownFile("kiro-conversation.md", buildTranscriptMarkdown(session.chat.messages));
    pushToast({ message: "已导出 Markdown" });
    more.close();
  };

  const newChat = () => {
    if (onNewChat) onNewChat();
    else session.newChat();
    more.close();
  };

  const clearConversation = () => {
    more.close();
    confirmRequest({
      title: "清空当前对话？",
      description: "仅清除当前会话中的消息，不影响你的 ClassFlow 数据。",
      confirmLabel: "清空",
      danger: true,
      onConfirm: () => {
        session.newChat();
      },
    });
  };

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {/* Share（会话级） */}
      <div ref={share.ref} className="relative">
        <button
          onClick={share.toggle}
          disabled={!hasMessages}
          aria-label="分享对话"
          aria-expanded={share.open}
          title={hasMessages ? "分享对话" : "暂无对话可分享"}
          className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Share2 className="w-4 h-4" />
        </button>
        {share.open && (
          <KiroMenuPanel dir="down" className="w-[290px] p-3">
            <KiroShareSheet onClose={share.close} />
          </KiroMenuPanel>
        )}
      </div>

      {/* More（会话级） */}
      <div ref={more.ref} className="relative">
        <button
          onClick={more.toggle}
          aria-label="更多操作"
          aria-expanded={more.open}
          title="更多"
          className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {more.open && (
          <KiroMenuPanel dir="down">
            {variant === "workspace" ? (
              <>
                <KiroMenuItem icon={Plus} label="新对话" onClick={newChat} />
                <KiroMenuItem
                  icon={HistoryIcon}
                  label="历史记录"
                  onClick={() => {
                    onOpenHistory?.();
                    more.close();
                  }}
                />
              </>
            ) : (
              <>
                <KiroMenuItem icon={Plus} label="新对话" onClick={newChat} />
                <KiroMenuItem
                  icon={Expand}
                  label="打开完整 Kiro 工作区"
                  onClick={() => {
                    onExpand?.();
                    more.close();
                  }}
                />
              </>
            )}
            <KiroMenuDivider />
            <KiroMenuItem icon={Copy} label="复制全部对话" disabled={!hasMessages} onClick={copyAll} />
            <KiroMenuItem icon={FileDown} label="导出 Markdown" disabled={!hasMessages} onClick={exportMarkdown} />
            <KiroMenuDivider />
            <KiroMenuItem
              icon={Trash2}
              label="清空当前对话"
              danger
              disabled={!hasMessages}
              onClick={clearConversation}
            />
          </KiroMenuPanel>
        )}
      </div>
    </div>
  );
}
