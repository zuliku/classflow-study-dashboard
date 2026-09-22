/**
 * Kiro Rail Runtime Status V1 — Agent 运行状态的单一 Domain（纯函数）。
 *
 * 设计契约：
 * - 状态只能由真实 Runtime Fact 推导，绝不提供 UI 可直接 set 的 status store
 * - 优先级固定：waiting-approval > computer-active > thinking > idle
 * - 只消费低频 scalar（busy / computerActive / waitingApproval），不订阅 token / stdout / payload
 * - Navigation emphasis（expanded / current）与 Agent Runtime Status 完全解耦
 */

export type KiroRuntimeStatus = "idle" | "thinking" | "computer-active" | "waiting-approval";

export interface KiroRuntimeStatusFacts {
  /** 真实 turn 进行中（turnInFlight / streaming / send preflight claim） */
  busy: boolean;
  /** 真实 Computer Task 正在执行（Computer Agent 通用，不绑定 terminal / GUI 单一实现） */
  computerActive: boolean;
  /** 存在待用户决策的审批（Computer Approval 队列非空） */
  waitingApproval: boolean;
}

/** 固定优先级解析（waiting-approval > computer-active > thinking > idle） */
export function resolveKiroRuntimeStatus(facts: KiroRuntimeStatusFacts): KiroRuntimeStatus {
  if (facts.waitingApproval) return "waiting-approval";
  if (facts.computerActive) return "computer-active";
  if (facts.busy) return "thinking";
  return "idle";
}

/** Logo button title / aria-label 用（绝不显示内部术语） */
export const KIRO_RUNTIME_STATUS_ARIA: Record<KiroRuntimeStatus, string> = {
  idle: "Kiro",
  thinking: "Kiro · 正在思考",
  "computer-active": "Kiro · 正在操作电脑",
  "waiting-approval": "Kiro · 等待你的确认",
};

/** Expanded Rail 状态小字（idle → 不显示额外文字） */
export const KIRO_RUNTIME_STATUS_TEXT: Record<KiroRuntimeStatus, string> = {
  idle: "",
  thinking: "正在思考",
  "computer-active": "正在操作电脑",
  "waiting-approval": "等待确认",
};

export function kiroRuntimeStatusAriaLabel(status: KiroRuntimeStatus): string {
  return KIRO_RUNTIME_STATUS_ARIA[status];
}

export function kiroRuntimeStatusText(status: KiroRuntimeStatus): string {
  return KIRO_RUNTIME_STATUS_TEXT[status];
}

/** 是否存在需要视觉强调的运行状态（idle 为默认安静态） */
export function isKiroRuntimeStatusActive(status: KiroRuntimeStatus): boolean {
  return status !== "idle";
}
