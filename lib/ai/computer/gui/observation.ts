/**
 * Desktop Action 审批 / 展示辅助（renderer 侧，纯函数）。
 * 只消费 Main prepareAction 返回的脱敏事实；绝不接触 native 标识。
 */
import type {
  ClassFlowDesktopComputerActionPreparation,
  DesktopGuiActionType,
} from "@/lib/desktop/types";
import type { ComputerApprovalGuiInfo } from "@/lib/ai/computer/approval";

const ACTION_LABELS: Record<DesktopGuiActionType, string> = {
  click: "点击",
  double_click: "双击",
  focus: "聚焦",
  type: "输入文本",
  key: "按键",
  scroll: "滚动",
  wait: "等待",
};

export function guiActionLabel(action: DesktopGuiActionType): string {
  return ACTION_LABELS[action];
}

/** Approval Request 的 GUI 展示字段（只含脱敏事实） */
export function buildGuiApprovalInfo(
  preparation: ClassFlowDesktopComputerActionPreparation
): ComputerApprovalGuiInfo {
  return {
    action: preparation.action,
    appName: preparation.target.appName,
    windowTitle: preparation.target.windowTitle,
    targetLabel: preparation.target.targetLabel,
    ...(preparation.textPreview ? { textPreview: preparation.textPreview } : {}),
    riskLevel:
      preparation.risk.level === "blocked"
        ? "external"
        : (preparation.risk.level as ComputerApprovalGuiInfo["riskLevel"]),
    riskReason: preparation.risk.reason,
    coordinateFallback: preparation.target.kind === "coordinates",
  };
}

/** 人类可读的动作描述（审批 / 审计用） */
export function describeGuiAction(
  preparation: ClassFlowDesktopComputerActionPreparation
): string {
  const label = guiActionLabel(preparation.action);
  const target = preparation.target.targetLabel;
  const app = preparation.target.appName ? ` · ${preparation.target.appName}` : "";
  return `${label}：${target}${app}`;
}
