"use client";

import type { KiroSidecarMode } from "@/components/kiro/KiroSessionProvider";
import { KiroChatSurface } from "@/components/kiro/KiroChatSurface";
import { KiroSidecarShell } from "@/components/kiro/sidecar/KiroSidecarShell";
import { KiroSidecarMinimized } from "@/components/kiro/sidecar/KiroSidecarMinimized";
import { usePresence } from "@/lib/usePresence";

/**
 * Kiro Sidecar（UX V2 + Capsule V1 Final Closure）：单实例持久挂载，Presence 单 ownership。
 * - host 唯一负责 closed 的 mount/unmount（usePresence），Shell 不再重复
 * - open：Full visible，Capsule hidden
 * - minimized：Full hidden+inert，Capsule visible
 * - closed：hostVisible false → Full 保持 hidden，Capsule exit，160ms 后 host unmount
 */
export function KiroSidecar({ mode }: { mode: KiroSidecarMode }) {
  const { mounted, visible: hostVisible } = usePresence(mode !== "closed", 160);
  if (!mounted) return null;

  const fullVisible = mode === "open" && hostVisible;
  const capsuleVisible = mode === "minimized" && hostVisible;

  return (
    <>
      <div data-testid="kiro-sidecar-host" data-mode={mode} data-visible={hostVisible ? "true" : "false"}>
        <KiroSidecarShell mode={mode} present={hostVisible}>
          <KiroChatSurface variant="sidecar" />
        </KiroSidecarShell>
      </div>
      <KiroSidecarMinimized visible={capsuleVisible} />
    </>
  );
}
export type { KiroSidecarMode };
