/**
 * Task 7B：Conversation Transition Lifecycle（纯状态机 seam）。
 * 解决 streaming/submitted 状态下切换会话（New Chat / 打开历史）时
 * persistCurrent 因 streaming 守卫直接退出、随后 messages/refs 被清空导致的保存竞态。
 *
 * 语义：IDLE → (request) → STOPPING（streaming 中：stop，不清空任何状态）
 *      → (streaming false) → SAVING（保存旧会话；pending 期间 conversationId 必须仍存在）
 *      → (外部 finish：flush → reset/load) → done → IDLE
 *
 * 无固定 timeout：只依赖真实 chat.streaming 状态。
 * 一次只允许一个 transition：pending 存在时拒绝第二次请求（无 queue）。
 */

export type PendingConversationTransition = { type: "new" } | { type: "load"; id: string } | null;

export type ConversationTransitionPhase = "idle" | "stopping" | "saving" | "switching";

export interface ConversationTransitionState {
  phase: ConversationTransitionPhase;
  /** 未完成的切换目标（非 null = transition 进行中） */
  pending: PendingConversationTransition;
}

export interface ConversationTransitionView {
  phase: "idle" | "stopping" | "saving" | "loading";
  target: "new" | string | null;
}

/** 将内部 lifecycle 投影为可安全展示的阶段；不泄露实现细节。 */
export function toConversationTransitionView(
  state: ConversationTransitionState
): ConversationTransitionView {
  const target = state.pending
    ? state.pending.type === "new"
      ? "new"
      : state.pending.id
    : null;
  return {
    phase: state.phase === "switching" ? "loading" : state.phase,
    target,
  };
}

export type ConversationTransitionEvent =
  | { type: "request"; transition: PendingConversationTransition; streaming: boolean }
  /** chat.streaming 真正变为 false（stop 完成 / generation 自然结束） */
  | { type: "stopped" }
  /** 外部 finish（flush → reset/load）完成 */
  | { type: "done" };

export const CONVERSATION_TRANSITION_IDLE: ConversationTransitionState = {
  phase: "idle",
  pending: null,
};

export function conversationTransitionReducer(
  state: ConversationTransitionState,
  event: ConversationTransitionEvent
): ConversationTransitionState {
  switch (event.type) {
    case "request": {
      // 一次只允许一个 transition：pending 存在 → 拒绝/忽略第二次请求
      if (state.pending) return state;
      const t = event.transition;
      if (!t) return state;
      // streaming/submitted → 先 stop 等待稳定；ready → 直接进入切换阶段（外部立即 finish）
      return event.streaming
        ? { phase: "stopping", pending: t }
        : { phase: "switching", pending: t };
    }
    case "stopped":
      // 只有等待稳定中的 transition 才推进到 SAVING（保存旧会话，pending 仍保留）
      if (state.phase !== "stopping" || !state.pending) return state;
      return { phase: "saving", pending: state.pending };
    case "done":
      return { phase: "idle", pending: null };
  }
}
