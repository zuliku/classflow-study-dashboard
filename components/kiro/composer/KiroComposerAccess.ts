/**
 * Kiro Composer P3 — Access（访问范围）纯逻辑。
 *
 * 语义：Composer 的 Access 只控制两件事 —— Computer 总开关 + Agent Mode（执行级别）。
 * 细粒度权限（终端 / 查看桌面 / 操作电脑 / 剪贴板）只做状态摘要，修改入口在设置。
 */
import type { KiroAgentMode } from "@/lib/ai/computer/types";

export type KiroComposerAccessMode = "chat" | "plan" | "guided" | "workspace-auto";

export const COMPOSER_ACCESS_MODES: KiroComposerAccessMode[] = [
  "chat",
  "plan",
  "guided",
  "workspace-auto",
];

export interface KiroComposerAccessCopy {
  label: string;
  description: string;
}

export const COMPOSER_ACCESS_COPY: Record<KiroComposerAccessMode, KiroComposerAccessCopy> = {
  chat: { label: "仅对话", description: "不使用 Computer 工具" },
  plan: { label: "仅规划", description: "读取和分析，不执行修改" },
  guided: { label: "受控访问", description: "执行关键操作时请求确认" },
  "workspace-auto": { label: "自动执行", description: "在授权范围内自动工作" },
};

/** 真实状态 → Access 模式（Computer OFF 时忽略 agentMode） */
export function resolveComposerAccessState(input: {
  computerEnabled: boolean;
  agentMode: KiroAgentMode;
}): KiroComposerAccessMode {
  if (!input.computerEnabled) return "chat";
  if (input.agentMode === "plan") return "plan";
  if (input.agentMode === "workspace-auto") return "workspace-auto";
  return "guided";
}

/** 一级按钮文案（Spec §45 契约：resolveComposerAccessLabel(false, "guided") → 仅对话） */
export function resolveComposerAccessLabel(computerEnabled: boolean, agentMode: KiroAgentMode): string {
  return COMPOSER_ACCESS_COPY[resolveComposerAccessState({ computerEnabled, agentMode })].label;
}

export function composerAccessDescription(mode: KiroComposerAccessMode): string {
  return COMPOSER_ACCESS_COPY[mode].description;
}

/** workspace-auto 使用克制的 danger semantic（与既有 AgentModeMenu 语义一致；不闪烁/不动画） */
export function isComposerAccessDanger(mode: KiroComposerAccessMode): boolean {
  return mode === "workspace-auto";
}

/** 该模式是否需要 Computer 开启（chat 需要关闭，其余需要开启） */
export function composerAccessRequiresComputer(mode: KiroComposerAccessMode): boolean {
  return mode !== "chat";
}

/** 该模式对应的 Agent Mode（chat → null：关闭 Computer 时不写入 mode） */
export function composerAccessAgentMode(mode: KiroComposerAccessMode): KiroAgentMode | null {
  switch (mode) {
    case "plan":
      return "plan";
    case "guided":
      return "guided";
    case "workspace-auto":
      return "workspace-auto";
    default:
      return null;
  }
}
