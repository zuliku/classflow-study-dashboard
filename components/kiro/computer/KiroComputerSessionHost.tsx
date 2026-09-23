"use client";

import { useEffect } from "react";
import { getClassFlowDesktopComputerSessionBridge } from "@/lib/desktop/bridge";
import { useDesktopSessionStore } from "@/store/useDesktopSessionStore";
import { useDesktopSessionPreviewStore } from "@/store/useDesktopSessionPreviewStore";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { isDesktopSessionTerminalState } from "@/lib/ai/ui/kiroComputerSession";

/**
 * Kiro Computer Session Host（P5 §3）— Desktop Session subscription 的唯一 ownership。
 *
 * 职责（不渲染任何 UI）：
 * 1. Desktop Runtime capability 检测（bridge 存在性）
 * 2. subscribeSession() —— 全应用只允许一个 subscription
 * 3. sanitized session event → useDesktopSessionStore
 * 4. session 切换 → 清理旧 preview（旧 session 截图绝不闪现在新 session）
 * 5. terminal state / 受保护应用 → 清理 preview
 * 6. unmount → unsubscribe
 *
 * 挂在 KiroSessionProvider 持久根部：Workspace active / Sidecar open / minimized / closed
 * 都不影响 subscription ownership（UI 不能拥有 Runtime subscription 生命周期）。
 */
export function KiroComputerSessionHost() {
  const computerEnabled = useKiroComputerStore((s) => s.computerEnabled);
  const desktopControlEnabled = useKiroComputerStore((s) => s.desktopControlEnabled);

  useEffect(() => {
    const bridge = getClassFlowDesktopComputerSessionBridge();
    if (!bridge) return;
    const unsubscribe = bridge.subscribeSession((event) => {
      useDesktopSessionStore.getState().applyEvent(event);
      const preview = useDesktopSessionPreviewStore.getState();
      if (isDesktopSessionTerminalState(event.state) || event.appProfile?.blocked === true) {
        // terminal / 受保护应用：立即清理该 session 的 preview
        preview.clearPreview(event.sessionId);
      } else if (preview.preview && preview.preview.sessionId !== event.sessionId) {
        // 新 session：旧 preview 不再有效
        preview.clearPreview();
      }
    });
    return unsubscribe;
  }, []);

  // Computer 权限关闭 → preview 立即清理（§23）
  useEffect(() => {
    if (!computerEnabled || !desktopControlEnabled) {
      useDesktopSessionPreviewStore.getState().clearPreview();
    }
  }, [computerEnabled, desktopControlEnabled]);

  return null;
}
