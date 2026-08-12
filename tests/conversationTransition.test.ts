import { describe, it, expect } from "vitest";
import {
  CONVERSATION_TRANSITION_IDLE,
  conversationTransitionReducer,
  ConversationTransitionState,
  toConversationTransitionView,
} from "@/lib/ai/history/conversationTransition";

/**
 * Task 7B 回归边界：streaming / submitted 状态下切换会话的保存竞态。
 * 状态机必须保证：stop 完成 → 保存旧会话（pending 保留，conversationId 仍在）→ 才 reset/load。
 */

const NEW = { type: "new" as const };
const LOAD_B = { type: "load" as const, id: "conv-b" };

function mk(phase: ConversationTransitionState["phase"], pending: ConversationTransitionState["pending"]): ConversationTransitionState {
  return { phase, pending };
}

describe("conversationTransitionReducer", () => {
  it("1. ready + New Chat → switching（外部立即 flush → reset；pending 保留到 done）", () => {
    const s = conversationTransitionReducer(CONVERSATION_TRANSITION_IDLE, {
      type: "request",
      transition: NEW,
      streaming: false,
    });
    expect(s.phase).toBe("switching");
    expect(s.pending).toEqual(NEW);
  });

  it("2. streaming + New Chat → stopping；pending 保留（未 immediately reset）", () => {
    const s = conversationTransitionReducer(CONVERSATION_TRANSITION_IDLE, {
      type: "request",
      transition: NEW,
      streaming: true,
    });
    expect(s.phase).toBe("stopping");
    expect(s.pending).toEqual(NEW);
  });

  it("3. streaming false（stopped）→ saving；pending 仍保留 = 保存时 old conversation 仍可定位", () => {
    let s = conversationTransitionReducer(CONVERSATION_TRANSITION_IDLE, {
      type: "request",
      transition: NEW,
      streaming: true,
    });
    s = conversationTransitionReducer(s, { type: "stopped" });
    expect(s.phase).toBe("saving");
    expect(s.pending).toEqual(NEW);
    // done 后清空
    s = conversationTransitionReducer(s, { type: "done" });
    expect(s).toEqual(CONVERSATION_TRANSITION_IDLE);
  });

  it("4. streaming + load 历史 thread → stop → 保存当前 → pending 保持 load 目标", () => {
    let s = conversationTransitionReducer(CONVERSATION_TRANSITION_IDLE, {
      type: "request",
      transition: LOAD_B,
      streaming: true,
    });
    expect(s.phase).toBe("stopping");
    s = conversationTransitionReducer(s, { type: "stopped" });
    expect(s.phase).toBe("saving");
    expect(s.pending).toEqual(LOAD_B); // 目标 ID 必须保留，禁止混写
  });

  it("5. pending 存在时第二次 transition 被拒绝（state 完全不变）", () => {
    const busy = mk("stopping", NEW);
    const s = conversationTransitionReducer(busy, {
      type: "request",
      transition: LOAD_B,
      streaming: false,
    });
    expect(s).toEqual(busy);
    // saving 阶段同样拒绝
    const saving = mk("saving", NEW);
    expect(
      conversationTransitionReducer(saving, { type: "request", transition: NEW, streaming: false })
    ).toEqual(saving);
  });

  it("6. 非 stopping 状态收到 stopped 事件不推进（防止误触发保存流程）", () => {
    expect(conversationTransitionReducer(CONVERSATION_TRANSITION_IDLE, { type: "stopped" })).toEqual(
      CONVERSATION_TRANSITION_IDLE
    );
    const switching = mk("switching", NEW);
    expect(conversationTransitionReducer(switching, { type: "stopped" })).toEqual(switching);
  });

  it("7. request(null) 不改变状态", () => {
    expect(
      conversationTransitionReducer(CONVERSATION_TRANSITION_IDLE, {
        type: "request",
        transition: null,
        streaming: true,
      })
    ).toEqual(CONVERSATION_TRANSITION_IDLE);
  });

  it("8. 完整流：streaming + New Chat → stop → save → done → 下一 transition 可正常开始", () => {
    let s = conversationTransitionReducer(CONVERSATION_TRANSITION_IDLE, {
      type: "request",
      transition: NEW,
      streaming: true,
    });
    s = conversationTransitionReducer(s, { type: "stopped" });
    s = conversationTransitionReducer(s, { type: "done" });
    expect(s).toEqual(CONVERSATION_TRANSITION_IDLE);
    // 新的 ready 请求可再次接受
    s = conversationTransitionReducer(s, { type: "request", transition: LOAD_B, streaming: false });
    expect(s.phase).toBe("switching");
    expect(s.pending).toEqual(LOAD_B);
  });
});

describe("toConversationTransitionView", () => {
  it.each([
    [mk("idle", null), { phase: "idle", target: null }],
    [mk("stopping", LOAD_B), { phase: "stopping", target: "conv-b" }],
    [mk("saving", LOAD_B), { phase: "saving", target: "conv-b" }],
    [mk("switching", LOAD_B), { phase: "loading", target: "conv-b" }],
    [mk("switching", NEW), { phase: "loading", target: "new" }],
  ] as const)("projects %j to public view %j", (state, expected) => {
    expect(toConversationTransitionView(state)).toEqual(expected);
  });
});
