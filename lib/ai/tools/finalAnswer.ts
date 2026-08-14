/**
 * Kiro Final Answer Boundary（Streaming UX V3 Phase 1）。
 *
 * 显式内部控制信号 begin_final_answer：
 * - 模型在「已拿到足够事实、不再需要任何 Tool、下一段就是正式回答」时调用（无参数）。
 * - 它是内部协议信号：不显示在 Worklog、不产生 Action Card、不计入 Read/Write quota、
 *   不写 Audit、不属于 mutation、不进入复制摘要 / 历史可见内容（history 只存 sanitized content）。
 * - begin_final_answer 之后的 text 永久属于 Final Answer；之前的 text 永久属于 Worklog。
 * - 服务器在收到包含该信号的续跑请求时关闭业务工具（toolChoice none），
 *   客户端对 boundary 后的业务 Tool Call 返回协议错误（不执行）。
 *
 * 这取代了旧的「等 100ms 猜语义」gate：文字通道由协议决定，不再依赖时间启发。
 */

export const KIRO_FINAL_ANSWER_TOOL_NAME = "begin_final_answer";

export const KIRO_FINAL_ANSWER_TOOL_DESCRIPTION =
  "内部控制信号（Final Answer Boundary，不显示给用户）：当你已经拿到回答所需的所有事实、" +
  "不再需要任何工具、接下来要输出正式 Final Answer 时，调用它（无参数）。" +
  "调用后：其后的全部正文都属于 Final Answer（任务完成后的交付结果）；" +
  "在此之后禁止再调用任何业务工具。该调用不会显示给用户，也不需要用户确认。";

export function isKiroFinalAnswerToolName(toolName: string): boolean {
  return toolName === KIRO_FINAL_ANSWER_TOOL_NAME;
}
