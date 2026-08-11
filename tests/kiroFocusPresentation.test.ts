import { describe, it, expect } from "vitest";
import { KIRO_TOOL_LABELS } from "@/lib/ai/tools/formatters";
import { actionToCardProps } from "@/components/kiro/KiroActionCard";
import { WriteToolResult } from "@/lib/ai/tools/write/types";

type FocusAction = Extract<WriteToolResult, { ok: true }>["action"];

function mkAction(tool: string, operation: "create" | "update" | "delete", after?: Record<string, unknown>, before?: Record<string, unknown>): FocusAction {
  return {
    tool,
    entityType: "focus-session",
    entityId: "fs1",
    title: "统计学作业",
    operation,
    before,
    after,
    canUndo: false,
  };
}

describe("Focus tool labels", () => {
  it("5 个 Focus tool label 正确", () => {
    expect(KIRO_TOOL_LABELS.get_focus_status).toBe("查看专注状态");
    expect(KIRO_TOOL_LABELS.start_focus_session).toBe("开始专注");
    expect(KIRO_TOOL_LABELS.pause_focus_session).toBe("暂停专注");
    expect(KIRO_TOOL_LABELS.resume_focus_session).toBe("继续专注");
    expect(KIRO_TOOL_LABELS.finish_focus_session).toBe("结束专注");
  });
});

describe("actionToCardProps focus-session", () => {
  it("start → 已开始专注；标题来自 action.title", () => {
    const card = actionToCardProps(
      mkAction("start_focus_session", "create", { plannedMinutes: 45, assignmentId: "a1", courseId: "c1" })
    );
    expect(card.variant).toBe("focus-session");
    expect(card.heading).toBe("已开始专注");
    expect(card.title).toBe("统计学作业");
    // duration 事实来自 action.after（LLM prose 不是数据来源）
    expect(card.bullets).toEqual(expect.arrayContaining(["专注 45 分钟"]));
  });

  it("pause / resume / finish → 各自 heading，事实来自 action", () => {
    const pause = actionToCardProps(mkAction("pause_focus_session", "update", { status: "paused" }));
    expect(pause.heading).toBe("已暂停专注");
    const resume = actionToCardProps(mkAction("resume_focus_session", "update", { status: "running" }));
    expect(resume.heading).toBe("已继续专注");
    const finish = actionToCardProps(
      mkAction("finish_focus_session", "delete", { status: "completed", actualActiveMs: 1_500_000 })
    );
    expect(finish.heading).toBe("已结束专注");
    expect(finish.bullets).toEqual(expect.arrayContaining(["本次 25 分钟"]));
  });

  it("标题优先 snapshot/title；无关联时回退专注会话", () => {
    const titled = actionToCardProps(
      mkAction("start_focus_session", "create", { plannedMinutes: 30, courseName: "统计学" }, undefined)
    );
    expect(titled.title).toBe("统计学作业");
    const generic = actionToCardProps({
      tool: "start_focus_session",
      entityType: "focus-session",
      entityId: "fs2",
      title: "专注会话",
      operation: "create",
      after: { plannedMinutes: 30 },
      canUndo: false,
    });
    expect(generic.title).toBe("专注会话");
  });
});
