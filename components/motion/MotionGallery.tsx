"use client";

import React, { useState } from "react";
import { usePresence } from "@/lib/usePresence";
import { MOTION_EXIT_MS, MOTION_MS, EASE } from "@/lib/motion";
import { shouldShowMotionGallery, isMotionDev } from "@/lib/motionDev";
import { cn } from "@/lib/utils";

/**
 * Motion Gallery（Motion V3 收尾，dev-only 预览）：
 * - 仅 development 构建 + ?motion-gallery=1 可见（production 永不渲染）；
 * - fixed overlay，不触碰 activeTab 路由与任何业务 store；
 * - 全部演示只引用 Motion Contract token（时长/easing/stagger/skeleton），
 *   本身即「体系正确用法」的活文档；关闭后 replaceState 清掉 query。
 */

const DURATION_ROWS: { label: string; ms: number; token: string; exit?: boolean }[] = [
  { label: "snap（press/即时反馈）", ms: MOTION_MS.snap, token: "--motion-snap" },
  { label: "fast（popover/tooltip）", ms: MOTION_MS.fast, token: "--motion-fast" },
  { label: "base（disclosure/列表进入）", ms: MOTION_MS.base, token: "--motion-base" },
  { label: "overlay（Dialog/Drawer 进入）", ms: MOTION_MS.overlay, token: "--motion-overlay" },
  { label: "panel（App Chrome morph）", ms: MOTION_MS.panel, token: "--motion-panel" },
  { label: "page（Tab 切换）", ms: MOTION_MS.page, token: "--motion-page" },
  { label: "data（progress/chart）", ms: MOTION_MS.data, token: "--motion-data" },
  { label: "exit-fast", ms: MOTION_EXIT_MS.fast, token: "--motion-exit-fast", exit: true },
  { label: "exit-base", ms: MOTION_EXIT_MS.base, token: "--motion-exit-base", exit: true },
  { label: "exit-panel", ms: MOTION_EXIT_MS.panel, token: "--motion-exit-panel", exit: true },
];

const EASE_ROWS: { label: string; token: string; value: string }[] = [
  { label: "standard（进入/常驻）", token: "--ease-standard", value: EASE.standard },
  { label: "emphasized（品牌/intro）", token: "--ease-emphasized", value: EASE.emphasized },
  { label: "enter（新代码进入首选）", token: "--ease-enter", value: EASE.enter },
  { label: "exit（退出加速离场）", token: "--ease-exit", value: EASE.exit },
  { label: "spring（大位移 morph）", token: "--ease-spring", value: EASE.spring },
];

function PresenceDemo() {
  const [open, setOpen] = useState(true);
  const { mounted, visible } = usePresence(open, MOTION_EXIT_MS.fast);
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-charcoal">Presence（usePresence + ux-inline）</p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ux-press rounded-lg bg-alabaster px-2 py-1 text-[11px] font-bold text-charcoal transition-colors duration-[var(--motion-fast)] hover:bg-pastel-mint"
        >
          {open ? "关闭" : "打开"}
        </button>
      </div>
      <div className="mt-2 flex h-12 items-center justify-center rounded-lg bg-background">
        {mounted ? (
          <div
            data-testid="motion-gallery-presence-box"
            className={cn(
              "rounded-lg bg-pastel-mint px-3 py-1.5 text-[11px] font-bold text-charcoal ux-inline",
              visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1 pointer-events-none"
            )}
          >
            mounted={String(mounted)} visible={String(visible)}
          </div>
        ) : (
          <span className="text-[11px] text-sandrift">已卸载（unmounted）</span>
        )}
      </div>
    </div>
  );
}

export function MotionGallery() {
  const [open, setOpen] = useState(
    () => typeof window !== "undefined" && shouldShowMotionGallery(window.location.search)
  );
  const [nonce, setNonce] = useState(0);
  if (!isMotionDev() || !open) return null;

  const close = () => {
    setOpen(false);
    try {
      const params = new URLSearchParams(window.location.search);
      params.delete("motion-gallery");
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    } catch {
      /* 忽略 */
    }
  };

  return (
    <div
      data-testid="motion-gallery"
      role="dialog"
      aria-label="Motion Gallery（开发预览）"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[calc(100dvh-48px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-drawer">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-charcoal">Motion Gallery（V3 Contract 活文档）</h2>
            <p className="text-[11px] text-sandrift">dev-only · ?motion-gallery=1 · 全部演示只引用 token</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setNonce((n) => n + 1)}
              className="ux-press rounded-lg bg-pastel-mint px-2.5 py-1.5 text-[11px] font-bold text-charcoal transition-colors duration-[var(--motion-fast)] hover:bg-alabaster"
            >
              重播
            </button>
            <button
              type="button"
              onClick={close}
              aria-label="关闭 Motion Gallery"
              className="ux-press rounded-lg bg-alabaster px-2.5 py-1.5 text-[11px] font-bold text-charcoal transition-colors duration-[var(--motion-fast)] hover:bg-pastel-mint"
            >
              关闭
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <section>
            <h3 className="text-xs font-bold text-charcoal">时长档（duration tiers）</h3>
            <div className="mt-2 space-y-1.5">
              {DURATION_ROWS.map((row) => (
                <div key={row.token} className="flex items-center gap-2">
                  <span className="w-44 shrink-0 truncate text-[11px] text-satin-grey">{row.label}</span>
                  <span className="w-14 shrink-0 text-right font-mono text-[11px] text-charcoal">{row.ms}ms</span>
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-alabaster">
                    <div
                      key={`${row.token}-${nonce}`}
                      className="animate-enter h-full rounded-full bg-sandrift"
                      style={{ width: `${Math.min(100, row.ms / 2.5)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-xs font-bold text-charcoal">缓动（easing，进出不对称）</h3>
            <div className="mt-2 space-y-1.5">
              {EASE_ROWS.map((row) => (
                <div key={row.token} className="flex items-center gap-2">
                  <span className="w-44 shrink-0 truncate text-[11px] text-satin-grey">{row.label}</span>
                  <div className="relative h-6 min-w-0 flex-1 rounded-lg bg-alabaster">
                    <div
                      key={`${row.token}-${nonce}`}
                      className="absolute top-1 h-4 w-16 rounded-md bg-charcoal transition-transform duration-[var(--motion-base)]"
                      style={{
                        transitionTimingFunction: `var(${row.token})`,
                        transform: nonce % 2 === 0 ? "translateX(0)" : "translateX(120px)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-sandrift">点「重播」切换往返方向，对比进入减速 vs 退出加速的手感。</p>
          </section>

          <section>
            <h3 className="text-xs font-bold text-charcoal">首屏编排（staged s0→s3）</h3>
            <ul key={`staged-${nonce}`} className="mt-2 space-y-1.5">
              <li className="ux-staged-s0 rounded-lg bg-alabaster px-3 py-2 text-[11px] font-semibold text-charcoal">s0 首批（55ms）</li>
              <li className="ux-staged-s1 rounded-lg bg-alabaster px-3 py-2 text-[11px] font-semibold text-charcoal">s1 次批（75ms）</li>
              <li className="ux-staged-s2 rounded-lg bg-alabaster px-3 py-2 text-[11px] font-semibold text-charcoal">s2 末批（95ms）</li>
              <li className="ux-staged-s3 rounded-lg bg-alabaster px-3 py-2 text-[11px] font-semibold text-charcoal">s3 容器（140ms）</li>
            </ul>
          </section>

          <section>
            <h3 className="text-xs font-bold text-charcoal">骨架（skeleton 扫光）</h3>
            <div className="ux-skeleton mt-2 space-y-2 rounded-xl border border-line bg-surface p-3">
              <div className="h-3 w-24 rounded bg-alabaster" />
              <div className="h-6 w-40 rounded bg-alabaster" />
              <div className="h-2.5 w-full rounded bg-alabaster" />
            </div>
          </section>

          <PresenceDemo />

          <p className="text-[10px] leading-relaxed text-sandrift">
            fps 探针：dev 下访问 ?motion-fps=1（左下角常驻 badge）。reduced-motion
            下全部演示降为静态（全局守卫），功能不受影响。
          </p>
        </div>
      </div>
    </div>
  );
}
