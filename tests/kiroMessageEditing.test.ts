import { describe, it, expect } from "vitest";
import {
  getUserMessageEditBlockReason,
  messageHasMutatingToolCalls,
  truncateBeforeEditedUserMessage,
} from "@/lib/ai/history/messageEditing";

const part = (type: string) => ({ type });

interface Msg {
  id: string;
  parts: { type: string }[];
}

const noParts = (id: string): Msg => ({ id, parts: [] });

describe("messageHasMutatingToolCalls", () => {
  it("business write / change set / memory write → true", () => {
    expect(messageHasMutatingToolCalls({ parts: [part("tool-create_assignment")] })).toBe(true);
    expect(messageHasMutatingToolCalls({ parts: [part("tool-apply_change_set")] })).toBe(true);
    expect(messageHasMutatingToolCalls({ parts: [part("tool-save_memory")] })).toBe(true);
    expect(messageHasMutatingToolCalls({ parts: [part("tool-start_focus_session")] })).toBe(true);
  });

  it("read / 纯文本 → false", () => {
    expect(messageHasMutatingToolCalls({ parts: [part("tool-get_upcoming_assignments")] })).toBe(false);
    expect(messageHasMutatingToolCalls({ parts: [part("tool-list_reminders")] })).toBe(false);
    expect(messageHasMutatingToolCalls({ parts: [{ type: "text", text: "hi" }] })).toBe(false);
  });
});

describe("getUserMessageEditBlockReason", () => {
  const check = (patch: Partial<Parameters<typeof getUserMessageEditBlockReason>[0]>) =>
    getUserMessageEditBlockReason({
      target: { text: "原消息", hasAttachments: false },
      suffixAssistantMessages: [],
      restoredWriteMessageIds: [],
      streaming: false,
      ...patch,
    });

  it("read-only suffix → 可以编辑（null）", () => {
    expect(
      check({
        suffixAssistantMessages: [noParts("a1"), noParts("a2")],
      })
    ).toBeNull();
  });

  it("suffix 后面任意位置出现 write → write-suffix（不能只查目标后第一条 assistant）", () => {
    expect(
      check({
        suffixAssistantMessages: [
          noParts("a1"),
          { id: "a2", parts: [part("tool-set_assignment_priority")] },
        ],
      })
    ).toBe("write-suffix");
    expect(
      check({
        suffixAssistantMessages: [{ id: "a3", parts: [part("tool-create_reminder")] }],
      })
    ).toBe("write-suffix");
  });

  it("target 有附件 → attachments", () => {
    expect(check({ target: { text: "x", hasAttachments: true } })).toBe("attachments");
  });

  it("streaming → turn-in-flight（优先级高于其它）", () => {
    expect(
      check({ streaming: true, suffixAssistantMessages: [{ id: "a", parts: [part("tool-delete_assignment")] }] })
    ).toBe("turn-in-flight");
  });

  it("restored action suffix → write-suffix；restored 无 action → 可编辑", () => {
    expect(
      check({
        suffixAssistantMessages: [noParts("r1"), noParts("r2")],
        restoredWriteMessageIds: ["r2"],
      })
    ).toBe("write-suffix");
    // restored 但无 action（纯文本历史对话）→ 允许编辑
    expect(
      check({
        suffixAssistantMessages: [noParts("r1")],
        restoredWriteMessageIds: [],
      })
    ).toBeNull();
  });

  it("target 不存在 → message-not-found", () => {
    expect(check({ target: null })).toBe("message-not-found");
  });
});

describe("truncateBeforeEditedUserMessage", () => {
  it("返回目标之前的所有消息（目标自己也被删除，稍后重新发送）", () => {
    const messages = [noParts("m1"), noParts("m2"), noParts("m3"), noParts("m4")];
    expect(truncateBeforeEditedUserMessage(messages, "m3")!.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(truncateBeforeEditedUserMessage(messages, "m1")).toEqual([]);
  });

  it("找不到目标 → null；不 mutate 输入", () => {
    const messages = [noParts("m1")];
    const copy = [...messages];
    expect(truncateBeforeEditedUserMessage(messages, "ghost")).toBeNull();
    expect(messages).toEqual(copy);
  });
});
