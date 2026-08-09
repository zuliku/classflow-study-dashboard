"use client";

import React from "react";
import { ClipboardCopy, FileCode2, Share2 } from "lucide-react";
import { useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { useToastStore } from "@/store/useToastStore";
import {
  buildTranscriptMarkdown,
  buildTranscriptText,
  copyTextToClipboard,
} from "@/lib/ai/share";

/**
 * Share Sheet（本地分享第一版）：无云端 / 无公共链接，不伪造 /share/xxxxx。
 * - 复制对话（纯文本 transcript）
 * - 复制 Markdown（完整 markdown transcript）
 * - 系统分享：navigator.share 可用时显示；不可用时自动回退为复制
 * 内容边界：仅用户可见消息 + Kiro 回答 + Action Result 摘要。
 */
export function KiroShareSheet({ onClose }: { onClose: () => void }) {
  const sessionActions = useKiroSessionActions();
  const pushToast = useToastStore((s) => s.pushToast);
  // 打开 Sheet 时读取一次 transcript（不订阅 streaming messages）
  const messages = sessionActions.getCurrentMessages();

  const copyDialog = async () => {
    const ok = await copyTextToClipboard(buildTranscriptText(messages));
    if (ok) pushToast({ message: "已复制" });
    onClose();
  };

  const copyMarkdown = async () => {
    const ok = await copyTextToClipboard(buildTranscriptMarkdown(messages));
    if (ok) pushToast({ message: "已复制" });
    onClose();
  };

  const systemShare = async () => {
    const text = buildTranscriptMarkdown(messages);
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "ClassFlow · Kiro 对话", text });
      } catch {
        // 用户取消分享：不提示
      }
      onClose();
      return;
    }
    // Web Share API 不可用 → 回退为复制
    const ok = await copyTextToClipboard(text);
    if (ok) pushToast({ message: "已复制" });
    onClose();
  };

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-xs font-bold text-charcoal">分享对话</h3>
        <p className="text-[10px] text-sandrift mt-1 leading-relaxed">
          仅分享当前对话中可见的内容（消息、回答与操作结果），不包含内部数据。
        </p>
      </div>
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={copyDialog}
          className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-left text-xs font-semibold text-satin-grey hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <ClipboardCopy className="w-4 h-4 text-sandrift shrink-0" />
          <span>
            复制对话
            <span className="block text-[10px] font-normal text-sandrift mt-0.5">纯文本 transcript</span>
          </span>
        </button>
        <button
          type="button"
          onClick={copyMarkdown}
          className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-left text-xs font-semibold text-satin-grey hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <FileCode2 className="w-4 h-4 text-sandrift shrink-0" />
          <span>
            复制 Markdown
            <span className="block text-[10px] font-normal text-sandrift mt-0.5">保留格式与公式源码</span>
          </span>
        </button>
        <button
          type="button"
          onClick={systemShare}
          className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-left text-xs font-semibold text-satin-grey hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <Share2 className="w-4 h-4 text-sandrift shrink-0" />
          <span>
            系统分享
            <span className="block text-[10px] font-normal text-sandrift mt-0.5">
              不支持 Web Share 时自动复制
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
