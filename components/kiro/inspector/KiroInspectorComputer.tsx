"use client";

import React from "react";
import { Circle } from "lucide-react";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useKiroSessionMeta } from "@/components/kiro/KiroSessionProvider";
import { resolveInspectorComputerState } from "@/lib/ai/ui/kiroInspector";
import { KiroInspectorSection } from "@/components/kiro/inspector/KiroInspectorSection";
import { cn } from "@/lib/utils";

/**
 * Kiro Inspector — Computer（V1，display only）。
 *
 * 只展示真实事实：用户开关 + Kiro Runtime Status（idle / thinking / computer-active / waiting-approval）
 * 与当前 Workspace 名称。
 *
 * 明确不做（当前 Runtime 没有这些事实）：
 * - 当前屏幕 / 截图缩略图 / 「正在点击 XX」/ recent GUI action
 * - tool rows / terminal stdout / task change list（这些属于 KiroWorklog / KiroAgentTaskCard）
 *
 * 未来 GUI Computer Use Phase 完成后，可在此增加 ObservationSlot（届时才有真实事实）。
 */
export function KiroInspectorComputer() {
  const meta = useKiroSessionMeta();
  const computerEnabled = useKiroComputerStore((s) => s.computerEnabled);
  const activeWorkspaceId = useKiroComputerStore((s) => s.activeWorkspaceId);
  const workspaces = useKiroComputerStore((s) => s.workspaces);

  const state = resolveInspectorComputerState({
    computerEnabled,
    runtimeStatus: meta.kiroRuntimeStatus,
  });
  if (!state.visible) return null;

  const workspaceLabel =
    workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? "Kiro 内置工作区";

  return (
    <KiroInspectorSection title="Computer" testId="kiro-inspector-computer">
      <div className="flex items-center gap-2 px-1.5 py-1" data-testid="kiro-inspector-computer-status">
        <Circle
          className={cn(
            "w-2.5 h-2.5 shrink-0",
            state.tone === "approval"
              ? "text-warning fill-warning"
              : state.tone === "active"
                ? "text-success fill-success"
                : "text-sandrift/60 fill-sandrift/30"
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            "text-[11px] font-semibold",
            state.tone === "approval" ? "text-warning" : "text-charcoal"
          )}
        >
          {state.label}
        </span>
      </div>
      <p className="px-1.5 text-[10px] text-sandrift truncate" title={workspaceLabel}>
        {workspaceLabel}
      </p>
    </KiroInspectorSection>
  );
}
