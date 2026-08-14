/**
 * Tool Outcome Status（V2.3）—— Worklog 与 Activity 共用同一套 outcome 规则。
 *
 * 关键修正：`state === "output-available"` 只表示「工具返回了 output」，
 * 不表示「业务成功」。output.ok === false 必须显示为 error（红色失败），
 * 而不是绿色 ✓。
 */
export type ToolOutcomeStatus = "working" | "done" | "error";

export function resolveToolOutcomeStatus(input: {
  state?: string;
  output?: unknown;
}): ToolOutcomeStatus {
  if (input.state === "output-error") {
    return "error";
  }
  if (input.state === "output-available") {
    const output = input.output as { ok?: unknown } | null;
    if (output?.ok === false) {
      return "error";
    }
    return "done";
  }
  return "working";
}
