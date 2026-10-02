"use client";

import React, { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { useDesktopSessionPreviewStore } from "@/store/useDesktopSessionPreviewStore";
import { cn } from "@/lib/utils";

/**
 * Computer Session Preview（P5 §19/§28/§29/§30）— 「最近画面」。
 *
 * 契约：
 * - 只展示 Agent **已经真实执行过的观察**（observe_desktop / action 后自动 re-observe）
 *   产生的截图证据；绝不主动调用 bridge.observe（不改变 Session 状态、不消耗 observations、
 *   不产生新 observationId、不影响 Agent loop）；
 * - 无 evidence → 不显示按钮（等待 Kiro 下一次查看界面）；
 * - preview.sessionId 必须与当前 session 精确匹配，否则完全忽略（旧 session 截图绝不闪现）；
 * - 只读展示：截图 pointer-events-none / draggable=false，不可点击、拖拽、输入；
 * - 只允许本组件订阅 preview store（Conversation / Composer / Navigator 绝不订阅 screenshot）。
 */
export function KiroComputerSessionPreview({ sessionId }: { sessionId: string }) {
  const preview = useDesktopSessionPreviewStore((s) => s.preview);
  const [open, setOpen] = useState(false);

  const matching = preview && preview.sessionId === sessionId ? preview : null;
  const [imgReady, setImgReady] = useState(false);
  // 新截图到达回到骨架态（解码完成前定高占位，布局不跳）
  useEffect(() => {
    setImgReady(false);
  }, [matching?.dataUrl]);
  // §30：没有 evidence 就不显示「查看画面」——绝不为了预览主动 observe
  if (!matching) return null;

  return (
    <div className="pl-3.5 space-y-1.5 min-w-0">
      <button
        type="button"
        data-testid="computer-session-preview-toggle"
        aria-expanded={open}
        aria-controls="kiro-computer-session-preview-panel"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 text-[10px] font-semibold text-sandrift hover:text-charcoal transition-colors"
      >
        最近画面
        <ChevronDown
          className={cn(
            "w-3 h-3 transition-transform duration-[var(--motion-fast)]",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>

      <DisclosureRegion open={open} id="kiro-computer-session-preview-panel" innerClassName="pb-0.5">
        <div
          data-testid="computer-session-preview"
          className="rounded-xl border border-line bg-white px-2 py-1.5 space-y-1 max-w-[420px]"
        >
          <p className="text-[10px] text-sandrift truncate">
            {matching.windowTitle ? `${matching.appName} · ${matching.windowTitle}` : matching.appName}
          </p>
          {/* 只读：不可 focus / 不可交互（Interactive Computer Canvas 属于后续阶段）；
              解码前 skeleton 定高占位（图片尺寸未知，加载完成前后不跳变） */}
          <div className="min-h-[120px]">
            {!imgReady && (
              <div aria-hidden="true" className="ux-skeleton h-[120px] rounded-lg bg-alabaster/60" />
            )}
            <img
              key={matching.dataUrl}
              src={matching.dataUrl}
              alt="Kiro 最近一次桌面观察"
              draggable={false}
              onLoad={() => setImgReady(true)}
              className="block max-w-full max-h-[240px] object-contain rounded-lg pointer-events-none select-none"
            />
          </div>
          <p className="text-[10px] text-sandrift">最近一次查看</p>
        </div>
      </DisclosureRegion>
    </div>
  );
}
