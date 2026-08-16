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

/** ordered stream event（Eval runner 与 lane attribution 用；test-only / eval-only） */
export type KiroRoundEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; toolCallId: string; toolName: string; input: unknown };

export interface KiroRoundLaneClassification {
  commentaryText: string;
  finalText: string;
  boundarySeenAfterRound: boolean;
  toolEvents: KiroRoundEvent[];
}

/**
 * Eval V1.1.2：按真实 ordered stream 事件做 lane attribution（与生产 Final Answer Boundary 一致）：
 * - boundary（begin_final_answer）之前的 text 恒为 commentary；
 * - boundary 之后的 text 恒为 Final Answer；
 * - begin_final_answer 本身是 tool event（控制信号，不产生文本）。
 * 不做任何时间 / round / “有没有 Tool” 猜测。
 */
export function classifyKiroRoundEvents(input: {
  events: KiroRoundEvent[];
  boundarySeenBeforeRound: boolean;
}): KiroRoundLaneClassification {
  let boundary = input.boundarySeenBeforeRound;
  let commentary = "";
  let finalText = "";
  const toolEvents: KiroRoundEvent[] = [];
  for (const ev of input.events) {
    if (ev.kind === "text") {
      if (boundary) finalText += ev.text;
      else commentary += ev.text;
    } else {
      if (isKiroFinalAnswerToolName(ev.toolName)) boundary = true;
      toolEvents.push(ev);
    }
  }
  return { commentaryText: commentary, finalText, boundarySeenAfterRound: boundary, toolEvents };
}

/**
 * 是否应 arm「SDK 自动续跑」标记（V4.7.2 真实验证回归）。
 * business tool output（read/write）→ 期望 SDK 自动续跑 → true；
 * begin_final_answer 是内部控制信号：
 * - boundary + Final Answer 在同一 stop 响应中返回时，SDK 不回填后不自动续跑，
 *   若 arm 标记会让 turn 永久停在 awaiting-continuation → false；
 * - boundary 单独 tool-call 响应（finish tool-calls）时 SDK 仍按 complete tool calls 自行续跑，
 *   与标记无关。
 * limitReached → 不续跑 → false。
 */
export function shouldArmAutoContinuation(toolName: string, limitReached: boolean): boolean {
  if (limitReached) return false;
  if (isKiroFinalAnswerToolName(toolName)) return false;
  return true;
}

// ---------------- Final Answer Boundary Step Policy（Production Route + Text Eval 共用） ----------------

export interface KiroFinalAnswerStepLike {
  toolCalls?: ReadonlyArray<{ toolName: string }>;
}

/** 历史 step 是否已出现 begin_final_answer（Final Answer Boundary） */
export function kiroFinalAnswerBoundarySeen(steps: ReadonlyArray<KiroFinalAnswerStepLike>): boolean {
  return steps.some((s) => (s.toolCalls ?? []).some((tc) => tc.toolName === KIRO_FINAL_ANSWER_TOOL_NAME));
}

/** Boundary 后最多再走 N 个 step（Final text）的 stopWhen（boundary 本身不消耗 business quota） */
export function kiroFinalAnswerMaxStepsStopWhen(
  maxFinalSteps = 1
): (options: { steps: unknown[] }) => boolean {
  return (options) => options.steps.length >= maxFinalSteps;
}

export interface KiroFinalAnswerStepControl {
  activeTools: [];
  toolChoice?: "none";
  stopWhen: (options: { steps: unknown[] }) => boolean;
}

/**
 * Boundary 后的 step 控制（纯规则）：关闭全部业务工具 + 最多再走 N 步（Final text）。
 * omitToolChoice：DeepSeek Thinking Mode 只关 activeTools，不发送 tool_choice（生产行为）。
 */
export function kiroFinalAnswerAfterBoundaryControl(omitToolChoice: boolean, maxFinalSteps = 1): KiroFinalAnswerStepControl {
  return {
    activeTools: [],
    ...(omitToolChoice ? {} : { toolChoice: "none" as const }),
    stopWhen: kiroFinalAnswerMaxStepsStopWhen(maxFinalSteps),
  };
}
