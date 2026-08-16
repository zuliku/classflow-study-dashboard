/**
 * Visual Intake Eval V1 —— Live Vision Benchmark Runner（Layer B）。
 * 只在显式配置 KIRO_VISUAL_EVAL_PROVIDER / KIRO_VISUAL_EVAL_MODEL / KIRO_VISUAL_EVAL_API_KEY 时运行。
 * 复用生产代码：KIRO_SYSTEM_PROMPT / getKiroToolsForRequest / executeKiroReadTool / 生产 Visual Guard。
 * 不复制 useKiroChat；不通过 UI/Playwright 驱动。
 * 输出 .tmp/visual-intake-eval/report.json + report.md；绝不记录 API Key / reasoning / CoT。
 */
import { streamText, convertToModelMessages } from "ai";
import { getKiroToolsForRequest } from "@/lib/ai/tools";
import { KIRO_SYSTEM_PROMPT } from "@/lib/ai/config";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import { getModelCapabilities } from "@/lib/ai/providers/capabilities";
import { AIProviderId } from "@/lib/ai/providers/types";
import { executeKiroReadTool, ReadToolState } from "@/lib/ai/tools/read/executor";
import { VISUAL_EVAL_WORLD, VISUAL_INTAKE_EVAL_SCENARIOS, VisualIntakeEvalScenario } from "@/lib/ai/eval/visualIntakeScenarios";
import { scoreVisualIntakeScenario, ToolTraceEntry, VisualEvalScenarioResult } from "@/lib/ai/eval/visualIntakeScoring";
import { buildVisualEvalReport, renderVisualEvalMarkdown, VisualEvalReport } from "@/lib/ai/eval/visualIntakeReport";
import { renderScreenshot } from "@/scripts/visual-intake-eval/renderScreenshot";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

/** 最小 UIMessage 形状（与生产 client continuation 一致：dynamic-tool part） */
interface EvalUiMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  parts: (
    | { type: "text"; text: string }
    | { type: "image"; image: Uint8Array }
    | {
        type: "dynamic-tool";
        state: string;
        toolCallId: string;
        toolName: string;
        input: unknown;
        output?: unknown;
      }
  )[];
}

export const VISUAL_EVAL_ENV = {
  provider: process.env.KIRO_VISUAL_EVAL_PROVIDER ?? "",
  model: process.env.KIRO_VISUAL_EVAL_MODEL ?? "",
  apiKey: process.env.KIRO_VISUAL_EVAL_API_KEY ?? "",
};

export function visualEvalEnabled(): boolean {
  return Boolean(VISUAL_EVAL_ENV.provider && VISUAL_EVAL_ENV.model && VISUAL_EVAL_ENV.apiKey);
}

export const VISUAL_EVAL_MAX_ROUNDS = 6;
export const VISUAL_EVAL_MAX_READ_CALLS = 12;
export const VISUAL_EVAL_MAX_WRITE_ATTEMPTS = 8;

export interface VisualEvalAgentRun {
  scenarioId: string;
  finalAnswer: string;
  toolTrace: ToolTraceEntry[];
  directWriteAttempts: string[];
  proposalData: { proposal: import("@/lib/ai/visual/types").VisualActionProposal } | null;
  preflightRejectedCode?: string;
  rounds: number;
}

interface UiToolPart {
  type: string;
  state: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  output: unknown;
}

/**
 * VisualEvalAgentRunner：真实模型 ↔ 生产 Tool Runtime。
 * 生产 Visual Guard 全量生效：图片 Turn 直接 Write → VISUAL_PROPOSAL_REQUIRED（同时记录 directWriteAttempt）。
 */
export async function runVisualEvalScenario(input: {
  scenario: VisualIntakeEvalScenario;
  world?: ReadToolState;
  provider: string;
  model: string;
  apiKey: string;
}): Promise<VisualEvalAgentRun> {
  const { scenario, provider, model, apiKey } = input;
  const world = input.world ?? VISUAL_EVAL_WORLD;

  const { model: lm, definition } = await resolveLanguageModel({
    provider: provider as AIProviderId,
    model,
    apiKey,
  });
  const caps = getModelCapabilities({ provider: provider as AIProviderId, model });
  if (!caps.vision || !definition.capabilities.vision) {
    throw new Error("Selected model does not support vision.");
  }

  const { png } = renderScreenshot(scenario.screenshot);
  // 本 Turn 图片（synthetic runtime attachment id；Guard 依据 = 图片来源存在）
  const turnImageAttachmentIds = ["eval_att_1"];

  // 用户消息：截图 + prompt（与生产一致：图片作为原生 image part）
  const userParts = [
    { type: "text" as const, text: scenario.userPrompt },
    { type: "image" as const, image: new Uint8Array(png) },
  ];

  let messages: EvalUiMessage[] = [
    { id: "u0", role: "user", parts: userParts },
  ];

  const toolTrace: ToolTraceEntry[] = [];
  const directWriteAttempts: string[] = [];
  let proposalData: { proposal: import("@/lib/ai/visual/types").VisualActionProposal } | null = null;
  let preflightRejectedCode: string | undefined;
  let finalAnswer = "";
  let readCalls = 0;
  let writeAttempts = 0;
  let rounds = 0;

  for (; rounds < VISUAL_EVAL_MAX_ROUNDS; rounds++) {
    const result = streamText({
      model: lm,
      system: KIRO_SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages as never),
      tools: getKiroToolsForRequest({}),
      maxOutputTokens: 1024,
      temperature: 0,
    });

    const toolCalls: { toolCallId: string; toolName: string; input: unknown }[] = [];
    let text = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") text += part.text;
      if (part.type === "tool-call") {
        toolCalls.push({ toolCallId: part.toolCallId, toolName: part.toolName, input: part.input });
      }
    }
    finalAnswer = text;

    if (toolCalls.length === 0) {
      // assistant 直接回答（澄清提问 / no-action 结论 / final）
      break;
    }

    // 执行 tool calls（生产 executor + 生产 Guard）
    const assistantParts = toolCalls.map((tc) => ({
      type: "dynamic-tool" as const,
      state: "output-available" as const,
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      input: tc.input,
    }));
    const toolResultParts: UiToolPart[] = [];

    for (const tc of toolCalls) {
      const { toolName, input } = tc;
      // 生产 Visual Turn Mutation Guard：图片来源 Turn 直接 Write → 拒绝 + 记录
      if (isWriteToolName(toolName)) {
        writeAttempts += 1;
        directWriteAttempts.push(toolName);
        toolTrace.push({ tool: toolName, result: "error" });
        toolResultParts.push({
          type: "dynamic-tool", state: "output-available", toolCallId: tc.toolCallId, toolName,
          input,
          output: { ok: false, code: "VISUAL_PROPOSAL_REQUIRED", message: "该回合包含图片来源。请先使用 propose_visual_actions 生成用户可预览的修改方案，不要直接写入 ClassFlow。" },
        });
        if (writeAttempts >= VISUAL_EVAL_MAX_WRITE_ATTEMPTS) break;
        continue;
      }

      // Read / Proposal Tools（生产确定性 executor）
      if (toolName === "propose_visual_actions") {
        readCalls += 1;
        const out = executeKiroReadTool(toolName, input, world, {
          visualSourceAttachmentIds: turnImageAttachmentIds,
        });
        toolTrace.push({ tool: toolName, result: out.ok ? "ok" : "error" });
        if (out.ok) {
          proposalData = out.data as { proposal: import("@/lib/ai/visual/types").VisualActionProposal };
        } else if (out.code === "CONFLICT" || (out.code ?? "").startsWith("TRANSACTION_")) {
          preflightRejectedCode = out.code;
        }
        toolResultParts.push({ type: "dynamic-tool", state: "output-available", toolCallId: tc.toolCallId, toolName, input, output: out });
        continue;
      }

      // 其余 Read Tools（生产确定性 executor）
      readCalls += 1;
      const out = executeKiroReadTool(toolName, input, world);
      toolTrace.push({ tool: toolName, result: out.ok ? "ok" : "error" });
      toolResultParts.push({ type: "dynamic-tool", state: "output-available", toolCallId: tc.toolCallId, toolName, input, output: out });
      if (readCalls >= VISUAL_EVAL_MAX_READ_CALLS) break;
    }

    messages = [
      ...messages,
      { id: `a${rounds}`, role: "assistant", parts: assistantParts as EvalUiMessage["parts"] },
      { id: `t${rounds}`, role: "tool", parts: toolResultParts as EvalUiMessage["parts"] },
    ];

    if (proposalData) {
      // Proposal 已生成：再给模型一轮 final（有 tool call 也无妨，下一轮自然结束）
      continue;
    }
  }

  return {
    scenarioId: scenario.id,
    finalAnswer,
    toolTrace,
    directWriteAttempts,
    proposalData,
    preflightRejectedCode,
    rounds,
  };
}

/** 生产 Guard 同一集合（Write Tools + apply_change_set；Direct Write Attempt 判定与 Guard 拦截同源） */
function isWriteToolName(toolName: string): boolean {
  return (
    toolName === "apply_change_set" ||
    toolName === "create_assignment" ||
    toolName === "update_assignment" ||
    toolName === "set_assignment_ddl" ||
    toolName === "set_assignment_priority" ||
    toolName === "set_assignment_status" ||
    toolName === "set_assignment_progress" ||
    toolName === "toggle_assignment_subtask" ||
    toolName === "delete_assignment" ||
    toolName === "move_schedule" ||
    toolName === "resize_schedule" ||
    toolName === "update_schedule" ||
    toolName === "exclude_schedule_week" ||
    toolName === "delete_schedule" ||
    toolName === "create_course" ||
    toolName === "update_course" ||
    toolName === "cancel_schedule_occurrence" ||
    toolName === "move_schedule_occurrence" ||
    toolName === "create_extra_schedule_occurrence" ||
    toolName === "add_schedule_slot"
  );
}

/** 运行全部 20 个场景（1 run / scenario）；输出 report.json + report.md */
export async function runVisualIntakeBenchmark(): Promise<VisualEvalReport> {
  const { provider, model, apiKey } = VISUAL_EVAL_ENV;
  const results: VisualEvalScenarioResult[] = [];
  const dir = join(process.cwd(), ".tmp", "visual-intake-eval");

  console.log("Visual Intake live benchmark");
  console.log(`Provider: ${provider}`);
  console.log(`Model: ${model}`);
  console.log(`Scenario count: ${VISUAL_INTAKE_EVAL_SCENARIOS.length}`);
  console.log(`Estimated request count: ~${VISUAL_INTAKE_EVAL_SCENARIOS.length * 2}-${VISUAL_INTAKE_EVAL_SCENARIOS.length * 4}`);

  for (const scenario of VISUAL_INTAKE_EVAL_SCENARIOS) {
    try {
      const run = await runVisualEvalScenario({ scenario, provider, model, apiKey });
      const scored = scoreVisualIntakeScenario({
        scenario,
        proposal: run.proposalData?.proposal ?? null,
        preflightRejectedCode: run.preflightRejectedCode,
        toolTrace: run.toolTrace,
      });
      results.push(scored);
      console.log(`${scenario.id.padEnd(32)} ${scored.outcome.toUpperCase().padEnd(7)} ${scored.failures.slice(0, 2).join("; ")}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        scenarioId: scenario.id,
        outcome: "fail",
        runtime: { proposalProduced: false, preflightRejected: false },
        proposedActions: [],
        proposedPending: [],
        metrics: { actionTP: 0, actionFP: 0, actionFN: 0, entityAccurate: 0, entityTotal: 0, timeAccurate: 0, timeTotal: 0, pendingCorrect: 0, pendingWrong: 0 },
        safety: { directWriteAttempts: [], unsafeProposal: false, unsafeReasons: [] },
        failures: [`runner error: ${msg}`],
      });
      console.log(`${scenario.id.padEnd(32)} ERROR  ${msg}`);
    }
  }

  const report = buildVisualEvalReport({
    scenarios: results,
    meta: { timestamp: new Date().toISOString(), provider, model },
  });

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  writeFileSync(join(dir, "report.md"), renderVisualEvalMarkdown(report), "utf8");
  console.log(`\nReport written to ${dir}/report.json + report.md`);
  return report;
}
