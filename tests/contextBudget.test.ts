import { describe, it, expect } from "vitest";
import { estimateTokens } from "@/lib/ai/contextBudget/estimate";
import { sanitizeMessagesForModel, segmentTurns } from "@/lib/ai/contextBudget/sanitizeMessages";
import { budgetAttachments } from "@/lib/ai/contextBudget/attachmentBudget";
import { buildKiroModelContext, DEFAULT_CONTEXT_BUDGET, shouldCompact } from "@/lib/ai/contextBudget/planner";
import { KiroPlannableMessage } from "@/lib/ai/contextBudget/types";

function msg(id: string, role: "user" | "assistant", parts: KiroPlannableMessage["parts"]): KiroPlannableMessage {
  return { id, role, parts };
}
const text = (t: string) => ({ type: "text", text: t });
const tool = (name: string, output: unknown) => ({ type: `tool-${name}`, toolCallId: "c1", output });

describe("estimateTokens", () => {
  it("单调增长；CJK 与英文混合", () => {
    expect(estimateTokens("")).toBe(0);
    const zh = estimateTokens("帮我分析这周任务安排");
    const en = estimateTokens("hello world this is a longer english sentence");
    const mix = estimateTokens("帮我分析这周任务安排 hello world this is a longer english sentence");
    expect(zh).toBeGreaterThan(0);
    expect(mix).toBeGreaterThan(en);
    expect(estimateTokens("a".repeat(300))).toBeGreaterThan(estimateTokens("a".repeat(30)));
  });
});

describe("sanitizeMessagesForModel", () => {
  const longConv: KiroPlannableMessage[] = [];
  for (let i = 0; i < 10; i++) {
    longConv.push(msg(`u${i}`, "user", [text(`第 ${i} 轮问题`)]));
    longConv.push(msg(`a${i}`, "assistant", [text(`第 ${i} 轮回答`) , tool("get_week_schedule", { big: "x".repeat(500) })]));
  }

  it("语义 Turn 切分正确", () => {
    const turns = segmentTurns(longConv);
    expect(turns.length).toBe(10);
    expect(turns[0].userMessageId).toBe("u0");
  });

  it("当前 Turn 完整保留（含 tool parts）；最近 Turn 只留文本；更早丢弃", () => {
    const current = msg("u9", "user", [text("当前问题")]);
    const toolChain = msg("a9", "assistant", [tool("search_assignments", { items: [] }), text("正在处理")]);
    const messages = [...longConv, current, toolChain];

    const plan = sanitizeMessagesForModel(messages, 6);
    // 当前 turn 完整（tool parts 保留）
    const last = plan.messages[plan.messages.length - 1];
    expect(last.id).toBe("a9");
    expect(last.parts.some((p) => p.type.startsWith("tool-"))).toBe(true);
    // 最近 turn 只有文本
    const recentTurn = plan.messages[plan.messages.length - 3]; // u8（最近 turn 的 user）
    expect(recentTurn.parts.every((p) => p.type === "text")).toBe(true);
    // 更早（u0-u3）被丢弃
    expect(plan.summarizedMessages).toBeGreaterThan(0);
    expect(plan.messages.some((m) => m.id === "u0")).toBe(false);
    // 最近 7 个 turn 保留（当前 1 + 最近 6）：u4 保留，u3 被摘要
    expect(plan.recentTurns).toBe(7);
    expect(plan.messages.some((m) => m.id === "u4")).toBe(true);
    expect(plan.messages.some((m) => m.id === "u3")).toBe(false);
  });

  it("空消息安全", () => {
    expect(sanitizeMessagesForModel([]).messages).toEqual([]);
  });
});

describe("buildKiroModelContext", () => {
  it("summary 作为首条 system 消息插入；长对话估算不超预算", () => {
    const messages: KiroPlannableMessage[] = [];
    for (let i = 0; i < 30; i++) {
      messages.push(msg(`u${i}`, "user", [text(`第 ${i} 轮问题`.repeat(20))]));
      messages.push(msg(`a${i}`, "assistant", [text(`第 ${i} 轮回答`.repeat(30)), tool("get_week_schedule", { data: "x".repeat(3000) })]));
    }
    const plan = buildKiroModelContext({
      messages,
      summaryText: "此前对话摘要（历史事件）。",
      attachments: [],
      budget: DEFAULT_CONTEXT_BUDGET,
    });
    expect(plan.messages[0].role).toBe("system");
    expect(plan.messages[0].parts[0].text).toContain("摘要");
    expect(plan.budgetReport.estimatedTokens).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET.maxInputTokens);
    expect(plan.budgetReport.summarizedMessages).toBeGreaterThan(0);
    expect(plan.budgetReport.recentTurns).toBeGreaterThanOrEqual(7);
  });

  it("aggressive：更少 turn + 附件预算减半", () => {
    const messages: KiroPlannableMessage[] = [];
    for (let i = 0; i < 12; i++) {
      messages.push(msg(`u${i}`, "user", [text(`q${i}`)]));
      messages.push(msg(`a${i}`, "assistant", [text(`a${i}`)]));
    }
    const normal = buildKiroModelContext({ messages, budget: DEFAULT_CONTEXT_BUDGET });
    const aggressive = buildKiroModelContext({ messages, budget: DEFAULT_CONTEXT_BUDGET, aggressive: true });
    expect(aggressive.budgetReport.recentTurns).toBe(4);
    expect(aggressive.budgetReport.recentTurns).toBeLessThan(normal.budgetReport.recentTurns);
  });

  it("shouldCompact 阈值（75%）", () => {
    expect(shouldCompact(DEFAULT_CONTEXT_BUDGET.maxInputTokens * 0.8, DEFAULT_CONTEXT_BUDGET)).toBe(true);
    expect(shouldCompact(DEFAULT_CONTEXT_BUDGET.maxInputTokens * 0.5, DEFAULT_CONTEXT_BUDGET)).toBe(false);
  });
});

describe("budgetAttachments", () => {
  it("总额不超时不截断", () => {
    const r = budgetAttachments([{ name: "a", type: "pdf", text: "短内容" }], 1000);
    expect(r.truncated).toBe(0);
  });

  it("多文件公平分配：第一份不独占；文件头保留；标记 budgetTruncated", () => {
    const big = "x".repeat(50000);
    const attachments = [
      { name: "A.pdf", type: "pdf", text: big },
      { name: "B.pdf", type: "pdf", text: big },
      { name: "C.docx", type: "docx", text: "y".repeat(5000) },
    ];
    const r = budgetAttachments(attachments, 3000);
    // 三份都还在（基础配额）
    expect(r.attachments.length).toBe(3);
    expect(r.truncated).toBeGreaterThanOrEqual(2);
    // A/B 均被截断（未独占），C 因小也可能被截断
    const a = r.attachments[0];
    const b = r.attachments[1];
    expect(a.budgetTruncated).toBe(true);
    expect(b.budgetTruncated).toBe(true);
    expect(a.text.length).toBeLessThan(20000);
    expect(b.text.length).toBeGreaterThan(1000);
    // 文件头保留
    expect(a.name).toBe("A.pdf");
    expect(a.type).toBe("pdf");
  });
});

describe("budgetAttachments page-aware（Task 11）", () => {
  const pdf = (pages: { page: number; text: string }[]) => ({
    name: "讲义.pdf",
    type: "pdf",
    text: pages.map((p) => p.text).join("\n\n"),
    pages,
  });

  it("A. 预算只够前两页：pages=[1,2]、budgetTruncated=true、text 由保留页重建", () => {
    const r = budgetAttachments(
      [pdf([{ page: 1, text: "x".repeat(1000) }, { page: 2, text: "y".repeat(1000) }, { page: 3, text: "z".repeat(1000) }])],
      500
    );
    expect(r.attachments.length).toBe(1);
    const a = r.attachments[0];
    expect(a.pages?.map((p) => p.page)).toEqual([1, 2]);
    expect(a.budgetTruncated).toBe(true);
    // text 与 pages 一致（由保留页重建，无错位）
    expect(a.text).toBe(a.pages!.map((p) => p.text).join("\n\n"));
    expect(a.text).not.toContain("z".repeat(100));
  });

  it("最后一页只留部分预算：部分页文本 + budgetTruncated（不整页丢弃）", () => {
    const r = budgetAttachments(
      [pdf([{ page: 1, text: "x".repeat(500) }, { page: 2, text: "y".repeat(1000) }])],
      300
    );
    const a = r.attachments[0];
    expect(a.pages?.map((p) => p.page)).toEqual([1, 2]);
    expect(a.pages![1].text.length).toBeGreaterThan(0);
    expect(a.pages![1].text.length).toBeLessThan(1000);
    expect(a.budgetTruncated).toBe(true);
    expect(a.text).toBe(a.pages!.map((p) => p.text).join("\n\n"));
  });

  it("预算充足：pages 原样保留，text 不变，不标记截断", () => {
    const pages = [{ page: 1, text: "a" }, { page: 2, text: "b" }];
    const r = budgetAttachments([pdf(pages)], 1000);
    expect(r.truncated).toBe(0);
    expect(r.attachments[0].pages?.map((p) => p.page)).toEqual([1, 2]);
    expect(r.attachments[0].budgetTruncated).toBeFalsy();
  });

  it("非 PDF（无 pages）：继续字符 slice（原有逻辑不变）", () => {
    const r = budgetAttachments([{ name: "课程要求.docx", type: "docx", text: "y".repeat(5000) }], 1500);
    expect(r.attachments[0].text.length).toBeLessThan(5000);
    expect(r.attachments[0].budgetTruncated).toBe(true);
  });
});
