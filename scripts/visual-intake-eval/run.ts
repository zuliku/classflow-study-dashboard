/**
 * Visual Intake Eval —— Live Vision Benchmark Runner（Layer B，production parity）。
 * 通用生产同构 Runner：provider/model/apiKey 由 KIRO_VISUAL_EVAL_* 环境变量指定
 * （正式 baseline 的 promotion/snapshot/provenance 属后续 Eval V1.3）。
 * 复用生产代码：KIRO_SYSTEM_PROMPT / buildClassFlowContextSection / getKiroToolsForRequest({})（完整生产工具面）/
 * executeKiroReadTool / 生产 Visual Guard（isClassFlowMutationTool + VISUAL_PROPOSAL_REQUIRED_*）。
 * 不复制 useKiroChat；不通过 UI/Playwright 驱动。
 * 输出 .tmp/visual-intake-eval/<provider>__<model>/report.json + report.md；绝不记录 API Key / reasoning / CoT。
 */
import { streamText, convertToModelMessages } from "ai";
import { getKiroToolsForRequest } from "@/lib/ai/tools";
import { KIRO_SYSTEM_PROMPT } from "@/lib/ai/config";
import { buildClassFlowContextSection } from "@/lib/ai/prompts/classFlowContextSection";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import { getModelCapabilities } from "@/lib/ai/providers/capabilities";
import { AIProviderId } from "@/lib/ai/providers/types";
import { executeKiroReadTool, ReadToolState } from "@/lib/ai/tools/read/executor";
import {
  isClassFlowMutationTool,
  VISUAL_PROPOSAL_REQUIRED_CODE,
  VISUAL_PROPOSAL_REQUIRED_MESSAGE,
} from "@/lib/ai/visual/guard";
import {
  VISUAL_EVAL_BASE_CONTEXT,
  VISUAL_EVAL_NOW,
  VISUAL_EVAL_TIMEZONE,
  VISUAL_EVAL_WORLD,
  VISUAL_INTAKE_EVAL_SCENARIOS,
  VisualIntakeEvalScenario,
} from "@/lib/ai/eval/visualIntakeScenarios";
import { scoreVisualIntakeScenario, ToolTraceEntry, VisualEvalScenarioResult, VisualProposalAttempt } from "@/lib/ai/eval/visualIntakeScoring";
import {
  buildVisualEvalReport,
  renderVisualEvalMarkdown,
  VisualEvalReport,
  evaluateVisualEvalSafetyGates,
  evaluateVisualEvalValidity,
} from "@/lib/ai/eval/visualIntakeReport";
import { renderScreenshot } from "@/scripts/visual-intake-eval/renderScreenshot";
import { proposeVisualActionsInputSchema } from "@/lib/ai/visual/schemas";
import { normalizeAIError } from "@/lib/ai/errors";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * 通用生产同构 Live Eval Runner：provider / model / apiKey 全部由环境变量指定
 * （正式 baseline 的 promotion/snapshot/provenance 属于后续 Eval V1.3，不在此硬编码）。
 */
export const VISUAL_EVAL_ENV = {
  provider: process.env.KIRO_VISUAL_EVAL_PROVIDER ?? "",
  model: process.env.KIRO_VISUAL_EVAL_MODEL ?? "",
  apiKey: process.env.KIRO_VISUAL_EVAL_API_KEY ?? "",
};

/** provider / model / apiKey 三者完整才运行（Runner 必须知道本次评估哪个模型） */
export function visualEvalEnabled(): boolean {
  return Boolean(VISUAL_EVAL_ENV.provider && VISUAL_EVAL_ENV.model && VISUAL_EVAL_ENV.apiKey);
}

/** file part 的 data（{type:"base64",base64} 或 {type:"url",url: URL|string}）→ Uint8Array（image part 用） */
export function filePartToImageBytes(data: unknown): Uint8Array {
  const d = data as { type?: string; base64?: string; url?: unknown } | null;
  if (d?.type === "base64" && d.base64) {
    return new Uint8Array(Buffer.from(d.base64, "base64"));
  }
  if (d?.type === "url") {
    const href = d.url instanceof URL ? d.url.href : String(d.url);
    const b64 = href.slice(href.indexOf(",") + 1);
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  return new Uint8Array(0);
}

export const VISUAL_EVAL_MAX_ROUNDS = 6;
export const VISUAL_EVAL_MAX_READ_CALLS = 12;
export const VISUAL_EVAL_MAX_WRITE_ATTEMPTS = 8;

/**
 * Eval Toolset = 完整生产工具域（Read + Write + Memory + begin_final_answer）：
 * 与生产 Visual Intake Turn（Computer OFF / Web Search OFF）完全一致 —— 直接复用
 * getKiroToolsForRequest({})，绝不隐藏生产 Tool（包括 Reminder / Memory）。
 */
export function buildVisualEvalToolSet() {
  return getKiroToolsForRequest({});
}

/** Eval V1.2：runtime error message 安全归一化 + hard bound（绝不落 raw provider body / key / stack） */
export function safeRuntimeErrorMessage(err: unknown): { code?: string; message: string } {
  const normalized = normalizeAIError(err);
  return {
    ...(normalized?.code ? { code: normalized.code } : {}),
    message: (normalized?.message ?? "未知运行时错误").slice(0, 300),
  };
}

/** Eval V1.2.1：Runtime Failure 必须保留失败前已观察到的 Safety / Tool facts（绝不默认置空） */
export interface VisualEvalRunSnapshot {
  finalAnswer: string;
  toolTrace: ToolTraceEntry[];
  directWriteAttempts: string[];
  proposalData: VisualEvalAgentRun["proposalData"];
  proposalAttempt: VisualProposalAttempt | null;
  preflightRejectedCode?: string;
  rounds: number;
}

/** 模型 resolve / 截图 render 之前的失败：确实没有任何观察事实 */
export const EMPTY_VISUAL_EVAL_RUN_SNAPSHOT: VisualEvalRunSnapshot = {
  finalAnswer: "",
  toolTrace: [],
  directWriteAttempts: [],
  proposalData: null,
  proposalAttempt: null,
  rounds: 0,
};

export function buildRuntimeFailureRun(input: {
  scenarioId: string;
  type: "provider" | "harness" | "unknown";
  safeError: { code?: string; message: string };
  snapshot: VisualEvalRunSnapshot;
}): VisualEvalAgentRun {
  return {
    scenarioId: input.scenarioId,
    finalAnswer: input.snapshot.finalAnswer,
    toolTrace: [...input.snapshot.toolTrace],
    directWriteAttempts: [...input.snapshot.directWriteAttempts],
    proposalData: input.snapshot.proposalData,
    proposalAttempt: input.snapshot.proposalAttempt,
    preflightRejectedCode: input.snapshot.preflightRejectedCode,
    rounds: input.snapshot.rounds,
    runtimeError: { type: input.type, ...(input.safeError.code ? { code: input.safeError.code } : {}), message: input.safeError.message },
  };
}

export interface VisualEvalAgentRun {
  scenarioId: string;
  finalAnswer: string;
  toolTrace: ToolTraceEntry[];
  directWriteAttempts: string[];
  proposalData: { proposal: import("@/lib/ai/visual/types").VisualActionProposal } | null;
  /** Eval V1.1：schema-valid propose_visual_actions 意图（preflight 拒绝也存在；非生产可执行 state） */
  proposalAttempt: VisualProposalAttempt | null;
  preflightRejectedCode?: string;
  rounds: number;
  runtimeError?: { type: "provider" | "harness" | "unknown"; code?: string; message: string };
}

/** 最小 UIMessage 形状（与生产 client continuation 一致：assistant dynamic-tool part 携带 input+output） */
export interface EvalUiMessage {
  id: string;
  role: "user" | "assistant";
  parts: (
    | { type: "text"; text: string }
    | { type: "file"; mediaType: string; filename?: string; url: string }
    | {
        type: "dynamic-tool";
        state: "output-available";
        toolCallId: string;
        toolName: string;
        input: unknown;
        output?: unknown;
      }
  )[];
}

interface RawToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/** 纯函数：解析逗号分隔 Scenario ID（保留 first occurrence 去重；空 → []） */
export function parseEvalScenarioFilter(raw: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const s of raw.split(",")) {
    const id = s.trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** KIRO_VISUAL_EVAL_SCENARIOS 过滤（逗号分隔真实 scenario ID；未知 ID → INVALID_EVAL_SCENARIO_ID；
 *  重复 ID 去重（保留 first occurrence）；执行顺序始终按 canonical suite 定义顺序） */
export function resolveEvalScenarioFilter(): string[] | null {
  const raw = process.env.KIRO_VISUAL_EVAL_SCENARIOS ?? "";
  if (!raw.trim()) return null;
  const ids = parseEvalScenarioFilter(raw);
  const known = new Set(VISUAL_INTAKE_EVAL_SCENARIOS.map((s) => s.id));
  for (const id of ids) {
    if (!known.has(id)) throw new Error(`INVALID_EVAL_SCENARIO_ID: ${id}`);
  }
  return ids;
}

/**
 * VisualEvalAgentRunner：真实模型 ↔ 生产 Tool Runtime（production parity）。
 * - System = KIRO_SYSTEM_PROMPT + 生产式「# 当前 ClassFlow 上下文」section（固定 Eval Base Context）
 * - 生产 Visual Guard 全量生效（isClassFlowMutationTool / VISUAL_PROPOSAL_REQUIRED_*）
 * - tool-result continuation = assistant UIMessage dynamic-tool（input + output 同一 part；无 role:"tool"）
 * - deterministic clock：executeKiroReadTool 传固定 now/timezone
 * - propose_visual_actions ok → 立即结束该 scenario（核心测 Proposal/Pending，不是最终文案）
 */
export async function runVisualEvalScenario(input: {
  scenario: VisualIntakeEvalScenario;
  world?: ReadToolState;
  provider: string;
  model: string;
  apiKey: string;
  nowIso?: string;
  timezone?: string;
}): Promise<VisualEvalAgentRun> {
  const { scenario, provider, model, apiKey } = input;
  const world = input.world ?? VISUAL_EVAL_WORLD;
  const nowIso = input.nowIso ?? VISUAL_EVAL_NOW;
  const timezone = input.timezone ?? VISUAL_EVAL_TIMEZONE;
  const fixedNow = new Date(nowIso);

  // Eval V1.2：Runtime Error 在明确边界分类（provider = model resolve/stream；harness = screenshot/executor；
  // 无法归类 → unknown）；message 经 normalizeAIError 安全归一化 + hard bound。
  // Eval V1.2.1：失败必须 snapshot 当前已观察状态（toolTrace / direct writes / proposalAttempt 绝不默认置空）。
  const failure = (type: "provider" | "harness" | "unknown", safe: { code?: string; message: string }, snapshot: VisualEvalRunSnapshot): VisualEvalAgentRun =>
    buildRuntimeFailureRun({ scenarioId: scenario.id, type, safeError: safe, snapshot });
  const snapshotNow = (): VisualEvalRunSnapshot => ({
    finalAnswer,
    toolTrace,
    directWriteAttempts,
    proposalData,
    proposalAttempt,
    preflightRejectedCode,
    rounds,
  });

  let lm: Awaited<ReturnType<typeof resolveLanguageModel>>["model"];
  let definition: Awaited<ReturnType<typeof resolveLanguageModel>>["definition"];
  try {
    const resolved = await resolveLanguageModel({ provider: provider as AIProviderId, model, apiKey });
    lm = resolved.model;
    definition = resolved.definition;
  } catch (err) {
    return failure("provider", safeRuntimeErrorMessage(err), EMPTY_VISUAL_EVAL_RUN_SNAPSHOT);
  }
  const caps = getModelCapabilities({ provider: provider as AIProviderId, model });
  if (!caps.vision || !definition.capabilities.vision) {
    return failure("harness", { message: "Selected model does not support vision." }, EMPTY_VISUAL_EVAL_RUN_SNAPSHOT);
  }

  let png: Buffer;
  try {
    ({ png } = renderScreenshot(scenario.screenshot));
  } catch (err) {
    return failure("harness", safeRuntimeErrorMessage(err), EMPTY_VISUAL_EVAL_RUN_SNAPSHOT);
  }
  // 本 Turn 图片（synthetic runtime attachment id；Guard 依据 = 图片来源存在）
  const turnImageAttachmentIds = ["eval_att_1"];

  const userParts = [
    { type: "text" as const, text: scenario.userPrompt },
    { type: "file" as const, mediaType: "image/png", filename: "screenshot.png", url: `data:image/png;base64,${png.toString("base64")}` },
  ];

  let messages: EvalUiMessage[] = [
    { id: "u0", role: "user", parts: userParts },
  ];

  // 生产式 System：KIRO_SYSTEM_PROMPT + 固定 Base Context section（Eval 不需要 Projects/Web/Computer 等无关 section）
  const system = `${KIRO_SYSTEM_PROMPT}${buildClassFlowContextSection(VISUAL_EVAL_BASE_CONTEXT, [])}`;

  const toolTrace: ToolTraceEntry[] = [];
  const directWriteAttempts: string[] = [];
  let proposalData: { proposal: import("@/lib/ai/visual/types").VisualActionProposal } | null = null;
  let proposalAttempt: VisualProposalAttempt | null = null;
  let preflightRejectedCode: string | undefined;
  let finalAnswer = "";
  let readCalls = 0;
  let writeAttempts = 0;
  let rounds = 0;

  try {
    for (; rounds < VISUAL_EVAL_MAX_ROUNDS; rounds++) {
    // 能力感知：fileParts:false 的模型（如 Kimi K3）需要 image part（生产 Vision 链同为 image part）
    const converted = await convertToModelMessages(messages as never);
    let modelMessages = converted as unknown as { role: string; content: Array<Record<string, unknown>> }[];
    if (!definition.capabilities.fileParts) {
      modelMessages = converted.map((m) => ({
        ...m,
        content: (m.content as Array<Record<string, unknown>>).map((p) => {
          if (p.type !== "file") return p;
          return { type: "image", image: filePartToImageBytes(p.data), mediaType: p.mediaType };
        }),
      }));
    }
    const result = streamText({
      model: lm,
      system,
      messages: modelMessages as never,
      tools: buildVisualEvalToolSet(),
      maxOutputTokens: 1024,
    });

      const toolCalls: RawToolCall[] = [];
      let text = "";
      let streamError: string | null = null;
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") text += part.text;
        if (part.type === "tool-call") {
          toolCalls.push({ toolCallId: part.toolCallId, toolName: part.toolName, input: part.input });
        }
        if (part.type === "error") {
          streamError = (part.error as { message?: string } | null)?.message ?? String(part.error);
        }
      }
      finalAnswer = text;

      if (streamError) {
        // 区分 provider 错误与模型业务空响应：stream 级错误 → provider 层，保留此前已观察的 Safety / Tool facts
        return failure("provider", safeRuntimeErrorMessage(streamError), snapshotNow());
      }

    if (toolCalls.length === 0) {
      // assistant 直接回答（澄清提问 / no-action 结论 / final）；空响应也在此结束
      break;
    }

    // 执行 tool calls（生产 executor + 生产 Guard）
    const toolResultParts: EvalUiMessage["parts"] = [];

    for (const tc of toolCalls) {
      const { toolName, input } = tc;
      // begin_final_answer 是生产内部控制信号（AI SDK 服务端 execute 成功即结束工具阶段）：
      // Eval 中视为「模型结束工具调用」→ 记录 trace 并结束 scenario loop
      if (toolName === "begin_final_answer") {
        toolTrace.push({ tool: toolName, result: "ok" });
        toolResultParts.push({
          type: "dynamic-tool", state: "output-available", toolCallId: tc.toolCallId, toolName,
          input,
          output: { ok: true, data: {} },
        });
        continue;
      }
      // 生产 Visual Turn Mutation Guard（唯一来源：lib/ai/visual/guard.ts）
      if (isClassFlowMutationTool(toolName)) {
        writeAttempts += 1;
        directWriteAttempts.push(toolName);
        toolTrace.push({ tool: toolName, result: "error" });
        toolResultParts.push({
          type: "dynamic-tool", state: "output-available", toolCallId: tc.toolCallId, toolName,
          input,
          output: { ok: false, code: VISUAL_PROPOSAL_REQUIRED_CODE, message: VISUAL_PROPOSAL_REQUIRED_MESSAGE },
        });
        if (writeAttempts >= VISUAL_EVAL_MAX_WRITE_ATTEMPTS) break;
        continue;
      }

      // Read / Proposal Tools（生产确定性 executor；deterministic clock 与 Base Context 同一「现在」）
      readCalls += 1;
      let out: ReturnType<typeof executeKiroReadTool>;
      try {
        out = executeKiroReadTool(toolName, input, world, {
          visualSourceAttachmentIds: turnImageAttachmentIds,
          now: fixedNow,
          timezone,
        });
      } catch (err) {
        // Eval V1.2.1：executor 异常前先把当前 Tool 记录进 trace（harness 在哪个 Tool 失败可见；
        // 普通 Read Tool 不会被 isClassFlowMutationTool 误记成 Safety violation），随后保留全部已观察状态
        toolTrace.push({ tool: toolName, result: "error" });
        return failure("harness", safeRuntimeErrorMessage(err), snapshotNow());
      }
      toolTrace.push({ tool: toolName, result: out.ok ? "ok" : "error" });
      if (toolName === "propose_visual_actions") {
        // Eval V1.1：先用生产 schema 校验模型意图（即使 executor 随后 preflight 拒绝 / 失败，
        // schema-valid 的 attempt 也保存给 scorer；malformed input → attempt=null，不自行修复）
        const parsed = proposeVisualActionsInputSchema.safeParse(input);
        if (parsed.success) {
          proposalAttempt = {
            actions: parsed.data.actions.map((a) => ({
              tool: a.change.tool,
              // 只保存 change 事实；sourceAttachmentIds 是 Runtime-owned，绝不进入 Eval observation
              input: (a.change.input ?? {}) as Record<string, unknown>,
            })),
            pendingItems: (parsed.data.pendingItems ?? []).map((p) => ({
              reason: p.reason,
              evidence: p.evidence,
              description: p.description,
            })),
          };
        }
        if (out.ok) {
          proposalData = out.data as { proposal: import("@/lib/ai/visual/types").VisualActionProposal };
        } else if (out.code === "CONFLICT" || (out.code ?? "").startsWith("TRANSACTION_")) {
          preflightRejectedCode = out.code;
        }
      }
      toolResultParts.push({ type: "dynamic-tool", state: "output-available", toolCallId: tc.toolCallId, toolName, input, output: out });
      if (readCalls >= VISUAL_EVAL_MAX_READ_CALLS) break;
    }

    // 生产式 UIMessage continuation：assistant message 单 part 携带 input+output（无 role:"tool" workaround）
    const assistantParts: EvalUiMessage["parts"] = [];
    if (text.trim().length > 0) assistantParts.push({ type: "text", text });
    assistantParts.push(...toolResultParts);

    messages = [
      ...messages,
      { id: `a${rounds}`, role: "assistant", parts: assistantParts },
    ];

    // 核心测 Proposal/Pending：propose_visual_actions ok → 已获得 Proposal，提前结束模型 loop（节省 API）
    if (proposalData) break;
    // preflight rejection：记录即可结束（scoring 以 preflightRejectedCode 为事实，不无限续跑）
    if (preflightRejectedCode) break;
    // begin_final_answer：模型已结束工具阶段 → 结束 scenario loop
    if (toolCalls.some((t) => t.toolName === "begin_final_answer")) break;
    }
  } catch (err) {
    // Eval V1.2：model stream 层异常 → provider 层（安全归一化；保留此前已观察的 Safety / Tool facts）
    return failure("provider", safeRuntimeErrorMessage(err), snapshotNow());
  }

  return {
    scenarioId: scenario.id,
    finalAnswer,
    toolTrace,
    directWriteAttempts,
    proposalData,
    proposalAttempt,
    preflightRejectedCode,
    rounds,
  };
}

/** 运行（过滤后的）全部场景（1 run / scenario）；按环境变量指定 provider/model 分目录写 report */
export async function runVisualIntakeBenchmark(): Promise<{ report: VisualEvalReport; modelDir: string }> {
  const provider = VISUAL_EVAL_ENV.provider;
  const model = VISUAL_EVAL_ENV.model;
  const apiKey = VISUAL_EVAL_ENV.apiKey;
  const results: VisualEvalScenarioResult[] = [];
  const filter = resolveEvalScenarioFilter();
  const scenarios = filter
    ? VISUAL_INTAKE_EVAL_SCENARIOS.filter((s) => filter.includes(s.id))
    : VISUAL_INTAKE_EVAL_SCENARIOS;

  const dir = join(process.cwd(), ".tmp", "visual-intake-eval", `${provider}__${model}`);
  mkdirSync(dir, { recursive: true });

  console.log("Visual Intake live benchmark");
  console.log(`Provider: ${provider}`);
  console.log(`Model: ${model}`);
  console.log(`Scenarios: ${scenarios.length}/${VISUAL_INTAKE_EVAL_SCENARIOS.length}`);
  console.log("API key: configured");

  for (const scenario of scenarios) {
    try {
      const run = await runVisualEvalScenario({ scenario, provider, model, apiKey });
      const scored = scoreVisualIntakeScenario({
        scenario,
        proposal: run.proposalData?.proposal ?? null,
        proposalAttempt: run.proposalAttempt,
        preflightRejectedCode: run.preflightRejectedCode,
        toolTrace: run.toolTrace,
        runtimeError: run.runtimeError,
      });
      results.push(scored);
      console.log(`${scenario.id.padEnd(32)} ${scored.outcome.toUpperCase().padEnd(7)} ${scored.failures.slice(0, 2).join("; ")}`);
    } catch (err) {
      // Eval V1.2：无法在明确边界归类的意外异常 → unknown（安全归一化 message）
      const runtimeError = { type: "unknown" as const, ...safeRuntimeErrorMessage(err) };
      results.push({
        scenarioId: scenario.id,
        outcome: "fail",
        runtime: { proposalProduced: false, preflightRejected: false },
        proposedActions: [],
        proposedPending: [],
        toolTrace: [],
        metrics: { actionTP: 0, actionFP: 0, actionFN: 0, entityAccurate: 0, entityTotal: 0, timeAccurate: 0, timeTotal: 0, pendingCorrect: 0, pendingWrong: 0 },
        safety: { directWriteAttempts: [], unsafeProposal: false, unsafeReasons: [] },
        failures: [`${runtimeError.type} runtime failure: ${runtimeError.message}`],
        runtimeError,
      });
      console.log(`${scenario.id.padEnd(32)} ${runtimeError.type.toUpperCase()}  ${runtimeError.message.slice(0, 120)}`);
    }
  }

  // Eval V1.2：report 元数据显式携带 full suite / filtered / scenario identity（不硬编码 20）
  const fullSuiteScenarioIds = VISUAL_INTAKE_EVAL_SCENARIOS.map((s) => s.id);
  const report = buildVisualEvalReport({
    scenarios: results,
    meta: {
      timestamp: new Date().toISOString(),
      provider,
      model,
      fullSuiteScenarioCount: fullSuiteScenarioIds.length,
      filtered: filter !== null,
    },
    requestedScenarioIds: scenarios.map((s) => s.id),
    fullSuiteScenarioIds,
  });

  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  writeFileSync(join(dir, "report.md"), renderVisualEvalMarkdown(report), "utf8");
  console.log(`\nReport written to ${dir}/report.json + report.md`);
  // Eval V1.2：console 汇总（绝不打印 API Key / raw provider error）
  const validity = evaluateVisualEvalValidity({
    scenarios: results,
    requestedScenarioIds: scenarios.map((s) => s.id),
    fullSuiteScenarioIds,
    filtered: filter !== null,
  });
  const safety = evaluateVisualEvalSafetyGates(report);
  console.log(`\nValidity: ${validity.ok ? "PASS" : "FAIL"}`);
  console.log(`Safety: ${safety.ok ? "PASS" : "FAIL"}`);
  console.log(`Quality scenarios: ${report.summary.qualityScenarioCount}/${scenarios.length}`);
  console.log(`Baseline eligible: ${validity.baselineEligible ? "yes" : "no"}`);
  return { report, modelDir: dir };
}
