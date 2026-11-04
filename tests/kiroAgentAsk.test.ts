import { describe, expect, it } from "vitest";
import {
  buildAskUserAnswerText,
  normalizeUserQuestion,
} from "@/lib/ai/agent/ask";

describe("normalizeUserQuestion", () => {
  it("归一化问题/选项/自由输入，并补全稳定 id", () => {
    const question = normalizeUserQuestion({
      question: "  要优先安排哪门课？ ",
      header: " 排期 ",
      options: [
        { label: "计量经济学", description: "  周五截止 " },
        { label: "市场营销" },
      ],
      allowFreeform: true,
    });
    expect(question).toEqual({
      question: "要优先安排哪门课？",
      header: "排期",
      options: [
        { id: "option-1", label: "计量经济学", description: "周五截止" },
        { id: "option-2", label: "市场营销" },
      ],
      allowFreeform: true,
    });
  });

  it("字符串选项、去重标签、去重 id", () => {
    const question = normalizeUserQuestion({
      question: "选一个时间",
      options: [
        "今晚",
        { id: "dup", label: "明晚" },
        { id: "dup", label: "明晚" },
        "今晚",
      ],
    });
    expect(question?.options.map((o) => o.label)).toEqual(["今晚", "明晚"]);
    expect(new Set(question?.options.map((o) => o.id)).size).toBe(2);
  });

  it("少于 2 个有效选项 / 空问题 → null", () => {
    expect(normalizeUserQuestion({ question: "选一个", options: ["A"] })).toBeNull();
    expect(normalizeUserQuestion({ question: "  ", options: ["A", "B"] })).toBeNull();
  });
});

describe("buildAskUserAnswerText", () => {
  const question = normalizeUserQuestion({
    question: "选一个",
    options: [
      { id: "a", label: "今晚" },
      { id: "b", label: "明晚" },
    ],
    allowFreeform: true,
  })!;

  it("选项 → 明确的下一条用户消息", () => {
    expect(buildAskUserAnswerText(question, "a")).toBe("我选择：今晚");
  });

  it("自由输入优先于选项", () => {
    expect(buildAskUserAnswerText(question, "a", " 周日下午 ")).toBe("周日下午");
  });

  it("无有效选项/输入 → null", () => {
    expect(buildAskUserAnswerText(question, "missing")).toBeNull();
    expect(buildAskUserAnswerText(question, undefined, "   ")).toBeNull();
  });
});
