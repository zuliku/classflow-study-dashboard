/**
 * Kiro Computer Session V1（P5）— Desktop Session Presentation Domain（纯函数）。
 *
 * 契约：
 * - 只解释 Runtime fact（state / appName / windowTitle / actionLabel / plan / stepIndex /
 *   reflectionRequired / appProfile），绝不修改 Runtime、绝不 set 任何状态；
 * - 文案唯一来源（Surface / 其它消费者共用；禁止组件内各自维护一份 describeState）；
 * - 不展示：连续验证失败次数 / no-progress counter / guard 内部值 / 预算 / 原始异常。
 */
import type {
  ClassFlowDesktopComputerAppProfileInfo,
  DesktopControlSessionState,
} from "@/lib/desktop/types";

/** 视觉语义（不引入持续 motion；Rail 仍是唯一主要动画信号） */
export type DesktopSessionTone = "active" | "warning" | "muted" | "success" | "danger" | "neutral";

export interface DesktopSessionDescribeInput {
  state: DesktopControlSessionState;
  appName: string | null;
  windowTitle: string | null;
  actionLabel: string | null;
  appProfile?: ClassFlowDesktopComputerAppProfileInfo | null;
}

/** 应用名优先级：appProfile.label → appName → windowTitle → 桌面 */
export function resolveDesktopSessionApp(input: {
  appName: string | null;
  windowTitle: string | null;
  appProfile?: ClassFlowDesktopComputerAppProfileInfo | null;
}): string {
  return input.appProfile?.label || input.appName || input.windowTitle || "桌面";
}

/** 动作标签前缀 → 人类可读进行时（只读 actionLabel；不含坐标 / 元素 id） */
export function describeDesktopActionLabel(actionLabel: string | null): string {
  const label = actionLabel ?? "";
  if (label.startsWith("wait")) return "正在等待";
  if (label.startsWith("window:activate")) return "正在切换窗口";
  if (label.startsWith("app:open")) return "正在打开应用";
  if (label.startsWith("app:reveal")) return "正在定位应用";
  if (label.startsWith("double_click")) return "正在双击";
  if (label.startsWith("right_click")) return "正在右键操作";
  if (label.startsWith("click")) return "正在点击";
  if (label.startsWith("type")) return "正在输入";
  if (label.startsWith("key")) return "正在按键";
  if (label.startsWith("scroll")) return "正在滚动";
  if (label.startsWith("focus")) return "正在聚焦";
  if (label.startsWith("hover")) return "正在悬停";
  if (label.startsWith("drag")) return "正在拖拽";
  if (label.startsWith("clipboard_read")) return "正在读取剪贴板";
  if (label.startsWith("clipboard_write")) return "正在写入剪贴板";
  if (label.startsWith("upload_file")) return "正在填入文件";
  return "正在操作界面";
}

/**
 * Desktop Session 状态文案（唯一来源）。
 * 注意：approval-required 只表达「等待你的确认」——决策按钮仍在 Agent Run Inline Approval。
 */
export function describeDesktopSessionState(input: DesktopSessionDescribeInput): string {
  const app = resolveDesktopSessionApp(input);
  switch (input.state) {
    case "observing":
      return `正在查看 ${app}`;
    case "acting": {
      const prefix = describeDesktopActionLabel(input.actionLabel);
      // 窗口 / 应用级动作本身就是完整语义（不强行追加应用名）
      if (
        prefix === "正在切换窗口" ||
        prefix === "正在打开应用" ||
        prefix === "正在定位应用"
      ) {
        return prefix;
      }
      return `${prefix} · ${app}`;
    }
    case "waiting":
      return "正在等待界面响应";
    case "approval-required":
      return "等待你的确认";
    case "paused":
      return "已暂停";
    case "completed":
      return "电脑操作已完成";
    case "failed":
      return "电脑操作已停止";
    case "cancelled":
      return "已停止";
    default:
      return `正在使用 ${app}`;
  }
}

/**
 * 状态 → 视觉语义：
 * - active（observing / acting / waiting / idle）→ active
 * - approval-required → warning（不是错误）
 * - paused → muted（neutral grey；不是错误）
 * - completed → success；cancelled → neutral；failed → danger
 * - reflectionRequired（进行中）→ warning
 */
export function resolveDesktopSessionTone(input: {
  state: DesktopControlSessionState;
  reflectionRequired?: boolean;
}): DesktopSessionTone {
  switch (input.state) {
    case "observing":
    case "acting":
    case "waiting":
    case "idle":
      return input.reflectionRequired ? "warning" : "active";
    case "approval-required":
      return "warning";
    case "paused":
      return "muted";
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "cancelled":
      return "neutral";
  }
}

/** 控制可用性：approval-required 时不提供 Pause（Agent 已被审批阻塞；Stop 仍保留） */
export function resolveDesktopSessionControls(input: {
  state: DesktopControlSessionState;
}): { canPause: boolean; canResume: boolean; canStop: boolean } {
  switch (input.state) {
    case "observing":
    case "acting":
    case "waiting":
    case "idle":
      return { canPause: true, canResume: false, canStop: true };
    case "approval-required":
      return { canPause: false, canResume: false, canStop: true };
    case "paused":
      return { canPause: false, canResume: true, canStop: true };
    default:
      // terminal：不再表现成活跃控制
      return { canPause: false, canResume: false, canStop: false };
  }
}

/**
 * 计划进度（只展示当前步骤，不展开完整 Plan；Control Surface 不是第二份 Worklog）：
 * - plan 非空 → 「第 N/M 步」+ 当前步骤
 * - plan 为空 → 只显示 goal
 * - 都为空 → 只显示状态
 */
export function formatDesktopSessionProgress(input: {
  plan: string[];
  stepIndex: number;
  goal: string | null;
}): { stepLabel: string | null; currentStep: string | null } {
  if (input.plan.length > 0) {
    const index = Math.max(0, Math.min(input.stepIndex, input.plan.length - 1));
    return {
      stepLabel: `第 ${index + 1}/${input.plan.length} 步`,
      currentStep: input.plan[index] ?? null,
    };
  }
  return { stepLabel: null, currentStep: input.goal };
}

/** terminal state（UI 层判定；与 Main 语义一致，不复制 Runtime 状态机） */
export function isDesktopSessionTerminalState(state: DesktopControlSessionState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

/** 是否处于活跃控制（Surface 完整态） */
export function isDesktopSessionActiveState(state: DesktopControlSessionState): boolean {
  return !isDesktopSessionTerminalState(state);
}
