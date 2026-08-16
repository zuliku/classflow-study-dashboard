/**
 * Kiro Agent Turn Boundary Scope（P0 Hotfix —— finalAnswer 不得跨 User Turn 泄漏）。
 * 用户现场：历史任意 Turn 出现 begin_final_answer 后，后续所有新 User Turn 的
 * Business Tools 被永久关闭（tools={} / toolChoice=none），模型只能输出「我查一下…」文本。
 *
 * 正确 invariant：begin_final_answer 只影响【当前 User Turn】。
 * 参考：deriveDocumentFailureFuseState（同 lastUserIdx turn scoping）。
 */
import { describe, it, expect } from "vitest";
import { KIRO_FINAL_ANSWER_TOOL_NAME, kiroFinalAnswerBoundarySeenInCurrentTurn } from "@/lib/ai/tools/finalAnswer";
import { deriveDocumentFailureFuseState } from "@/lib/ai/computer/documents/failureFuse";

const BOUNDARY = `tool-${KIRO_FINAL_ANSWER_TOOL_NAME}`;

function user(id: string) {
  return { id, role: "user" as const, parts: [{ type: "text", text: "问" }] };
}
function assistant(id: string, parts: { type: string }[]) {
  return { id, role: "assistant" as const, parts };
}
const boundaryPart = () => ({ type: BOUNDARY, toolCallId: "b", toolName: KIRO_FINAL_ANSWER_TOOL_NAME, input: {}, state: "output-available" });
const businessPart = () => ({ type: "tool-search_assignments", toolCallId: "t1", toolName: "search_assignments", input: { scope: "today" }, state: "output-available" });
const finalPart = () => ({ type: "text", text: "最终答案。" });

describe("kiroFinalAnswerBoundarySeenInCurrentTurn（P0 Hotfix turn-scoped）", () => {
  it("P0-1：历史 Turn 有 boundary，最新是新 User → false（新 Turn 必须重新获得 Business Tools）", () => {
    const messages = [
      user("u0"),
      assistant("a0", [businessPart(), boundaryPart(), finalPart()]),
      user("u1"), // 新 User Turn B
    ];
    expect(kiroFinalAnswerBoundarySeenInCurrentTurn(messages)).toBe(false);
  });

  it("P0-2：当前 User Turn 内 boundary 已回填 → true（continuation 必须关闭 Business Tools）", () => {
    const messages = [
      user("u0"),
      assistant("a0", [businessPart(), boundaryPart()]),
    ];
    expect(kiroFinalAnswerBoundarySeenInCurrentTurn(messages)).toBe(true);
  });

  it("P0-3：多历史 Turn：Turn A boundary + Turn B 仅 business tool → false", () => {
    const messages = [
      user("u0"),
      assistant("a0", [boundaryPart()]),
      user("u1"),
      assistant("a1", [businessPart()]),
    ];
    expect(kiroFinalAnswerBoundarySeenInCurrentTurn(messages)).toBe(false);
  });

  it("P0-4：当前 Turn 多 Assistant message（A1 business tool, A2 boundary）→ true", () => {
    const messages = [
      user("u0"),
      assistant("a1", [businessPart()]),
      assistant("a2", [boundaryPart()]),
    ];
    expect(kiroFinalAnswerBoundarySeenInCurrentTurn(messages)).toBe(true);
  });

  it("P0-5：无 User 的异常输入 → false（不扫描整个历史猜当前 Turn）", () => {
    expect(kiroFinalAnswerBoundarySeenInCurrentTurn([assistant("a0", [boundaryPart()])])).toBe(false);
    expect(kiroFinalAnswerBoundarySeenInCurrentTurn([])).toBe(false);
  });

  it("P0-6：新 User Turn 后当前 assistant 无 boundary → false（即使历史有 boundary）", () => {
    const messages = [
      user("u0"),
      assistant("a0", [boundaryPart()]),
      user("u1"),
      assistant("a1", [businessPart(), finalPart()]),
    ];
    expect(kiroFinalAnswerBoundarySeenInCurrentTurn(messages)).toBe(false);
  });

  it("parity：与 deriveDocumentFailureFuseState 对 previous-turn 状态 + 新 User 的 turn scoping 一致", () => {
    const messages = [
      user("u0"),
      assistant("a0", [boundaryPart()]),
      user("u1"),
      assistant("a1", [businessPart()]),
    ];
    // Document Fuse：上一 Turn 无文档失败 → 新 Turn 不 blocked（不被上一 Turn 影响）
    const fuse = deriveDocumentFailureFuseState(messages as never);
    expect(fuse.blocked).toBe(false);
    // Final Answer Boundary：上一 Turn boundary → 新 Turn 仍 false（同 scoping 原则）
    expect(kiroFinalAnswerBoundarySeenInCurrentTurn(messages)).toBe(false);
  });
});
