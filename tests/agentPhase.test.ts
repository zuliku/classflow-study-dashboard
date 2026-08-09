import { describe, it, expect } from "vitest";
import { deriveActivity } from "@/hooks/useKiroChat";

/** UIMessage 最小形状（测试用） */
function userMsg(id: string) {
  return { id, role: "user", parts: [{ type: "text", text: "查看最近 DDL" }] };
}
function assistantMsg(id: string, parts: { type: string; state?: string }[]) {
  return { id, role: "assistant", parts };
}
const textPart = (text: string, state = "streaming") => ({ type: "text", text, state });
const toolPart = (name: string, state: "working" | "output-available" | "output-error") => ({
  type: `tool-${name}`,
  toolCallId: "c1",
  state,
  output: state === "output-available" ? { ok: true, data: {} } : undefined,
});

describe("deriveActivity phases", () => {
  it("submitted 且无任何输出 → thinking（修复发送后空白）", () => {
    const a = deriveActivity([userMsg("u1")], "submitted");
    expect(a.visible).toBe(true);
    expect(a.phase).toBe("thinking");
    expect(a.done).toBe(false);
  });

  it("submitted + 已到达 tool call → 按工具阶段展示", () => {
    const read = deriveActivity([userMsg("u1"), assistantMsg("a1", [toolPart("get_upcoming_assignments", "working")])], "submitted");
    expect(read.phase).toBe("reading");
    const write = deriveActivity([userMsg("u1"), assistantMsg("a1", [toolPart("set_assignment_ddl", "working")])], "submitted");
    expect(write.phase).toBe("acting");
  });

  it("streaming：工具全部完成但文本未开始 → composing", () => {
    const a = deriveActivity(
      [userMsg("u1"), assistantMsg("a1", [toolPart("get_upcoming_assignments", "output-available")])],
      "streaming"
    );
    expect(a.phase).toBe("composing");
    expect(a.done).toBe(false);
  });

  it("streaming：文本已开始 → 保留完成摘要（done）", () => {
    const a = deriveActivity(
      [userMsg("u1"), assistantMsg("a1", [toolPart("get_upcoming_assignments", "output-available"), textPart("这是回答")])],
      "streaming"
    );
    expect(a.visible).toBe(true);
    expect(a.phase).toBe("done");
    expect(a.done).toBe(true);
    expect(a.steps.length).toBe(1);
  });

  it("ready 且无工具 → 隐藏（不残留 Progress）", () => {
    const a = deriveActivity([userMsg("u1"), assistantMsg("a1", [textPart("你好", "complete")])], "ready");
    expect(a.visible).toBe(false);
  });

  it("ready 且有工具 → 完成摘要可见", () => {
    const a = deriveActivity([userMsg("u1"), assistantMsg("a1", [toolPart("get_week_schedule", "output-available")])], "ready");
    expect(a.visible).toBe(true);
    expect(a.phase).toBe("done");
    expect(a.steps[0].status).toBe("done");
  });

  it("error：无步骤时隐藏（交给 Error Card）；有步骤时保留 error trace", () => {
    expect(deriveActivity([userMsg("u1")], "error").visible).toBe(false);
    const withStep = deriveActivity([userMsg("u1"), assistantMsg("a1", [toolPart("get_upcoming_assignments", "output-error")])], "error");
    expect(withStep.visible).toBe(true);
    expect(withStep.phase).toBe("error");
  });

  it("旧轮 tool parts 不计入新一轮（submitted 时看当前轮）", () => {
    const a = deriveActivity(
      [
        userMsg("u1"),
        assistantMsg("a1", [toolPart("get_upcoming_assignments", "output-available"), textPart("旧回答", "complete")]),
        userMsg("u2"),
      ],
      "submitted"
    );
    expect(a.phase).toBe("thinking");
    expect(a.steps.length).toBe(0);
  });
});
