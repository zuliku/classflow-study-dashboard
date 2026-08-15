"use client";

import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { KiroChatSurface } from "@/components/kiro/KiroChatSurface";
import { KiroSidecarShell } from "@/components/kiro/sidecar/KiroSidecarShell";

/**
 * Kiro Sidecar（UX V2）：非模态、可调尺寸、圆角浮动聊天面板。
 * 与 KiroWorkspace 共享同一个 Persistent Session（同一 Runtime / 附件 / Undo）。
 * Shell 负责：定位 / 尺寸 / 动画 / resize / Esc；KiroChatSurface 提供对话与 Composer。
 */
export function KiroSidecar({ open }: { open: boolean }) {
  useKiroSession(); // 确保在 Provider 内
  return (
    <KiroSidecarShell open={open}>
      <KiroChatSurface variant="sidecar" />
    </KiroSidecarShell>
  );
}
