"use client";

import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import type { KiroSidecarMode } from "@/components/kiro/KiroSessionProvider";
import { KiroChatSurface } from "@/components/kiro/KiroChatSurface";
import { KiroSidecarShell } from "@/components/kiro/sidecar/KiroSidecarShell";
import { KiroSidecarMinimized } from "@/components/kiro/sidecar/KiroSidecarMinimized";
import { usePresence } from "@/lib/usePresence";

/**
 * Kiro Sidecar（UX V2 + Capsule V1）：单实例持久挂载。
 * - mode !== "closed" 期间保持 host mounted，KiroChatSurface 唯一实例不卸载
 * - open：Full Sidecar visible，Capsule hidden
 * - minimized：Full Sidecar visual hidden + inert，Capsule visible（仅 md+）
 * - closed：先播 exit motion 再 unmount 整个 subtree
 *
 * Minimize 只改变 Presentation，不改变 Session Lifecycle（不 stop/clear/切换 conversation）。
 */
export function KiroSidecar({ mode }: { mode: KiroSidecarMode }) {
  useKiroSession(); // 确保在 Provider 内
  const { mounted, visible } = usePresence(mode !== "closed", 160);
  if (!mounted) return null;

  const isMinimized = mode === "minimized";

  // host 存在即代表 sidecar 非 closed；内部 Full 与 Capsule 的显隐由 mode 驱动的 CSS 过渡完成，不卸载 ChatSurface
  // visible 来自 usePresence（closed → 退出动画）；open↔minimized 切换无需经过 unmount，立即切换
  return (
    <>
      {/* 持久宿主：mode 变化不卸载 ChatSurface；Full Shell 在 minimized 时视觉隐藏但仍 mounted */}
      <div
        data-testid="kiro-sidecar-host"
        data-mode={mode}
        data-visible={visible ? "true" : "false"}
      >
        <KiroSidecarShell mode={mode}>
          <KiroChatSurface variant="sidecar" />
        </KiroSidecarShell>
      </div>
      <KiroSidecarMinimized visible={isMinimized} />
    </>
  );
}
export type { KiroSidecarMode };
