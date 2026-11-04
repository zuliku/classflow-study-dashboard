"use client";

import { Globe2 } from "lucide-react";

/**
 * 首次真实联网搜索后的一次性隐私提示。
 * 只由 KiroChatSurface 在 hasUsedWebSearch && !seen 时挂载；点击「知道了」持久化。
 */
export function WebSearchPrivacyNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      data-testid="web-search-privacy-notice"
      className="mx-auto flex w-full max-w-3xl items-start gap-2 rounded-xl border border-line-soft bg-alabaster/70 px-3 py-2 text-[11px] text-sandrift"
    >
      <Globe2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 leading-relaxed">
        联网搜索会把搜索关键词发送给第三方搜索服务，不会发送文件、对话全文或本地数据；可在设置中关闭。
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-md border border-line-soft bg-surface px-2 py-0.5 text-[10px] font-bold text-satin-grey transition-colors hover:border-line-strong hover:text-charcoal"
      >
        知道了
      </button>
    </div>
  );
}
