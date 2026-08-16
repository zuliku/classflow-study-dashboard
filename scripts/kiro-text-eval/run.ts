/**
 * Kiro Text Eval V1 —— Live Text Agent Baseline Runner（DeepSeek V4 Flash）。
 * 固定 profile：provider=deepseek / model=deepseek-v4-flash（KIRO_TEXT_BASELINE）；
 * 只在 DEEPSEEK_TEST_API_KEY 存在时运行（CI 默认 skip）。
 * 复用生产：KIRO_SYSTEM_PROMPT / buildKiroResponsePreferenceContext(balanced) /
 * buildClassFlowContextSection / getKiroToolsForRequest({}) / executeKiroReadTool /
 * executeKiroWriteTool / executeChangeSet。不复制 useKiroChat；不通过 UI 驱动。
 * 每 Scenario 独立 fresh world clone（mutation 只作用于 ephemeral in-memory state）。
 * 输出 .tmp/kiro-text-eval/deepseek__deepseek-v4-flash/report.json + report.md；绝不记录 key。
 */
import { streamText, convertToModelMessages } from "ai";
import { getKiroToolsForRequest } from "@/lib/ai/tools";
import { KIRO_SYSTEM_PROMPT } from "@/lib/ai/config";
import { buildKiroResponsePreferenceContext } from "@/lib/ai/responsePreference";
import { buildClassFlowContextSection } from "@/lib/ai/prompts/classFlowContextSection";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import { AIProviderId } from "@/lib/ai/providers/types";
import { executeKiroReadTool } from "@/lib/ai/tools/read/executor";
import { executeReadMaterial } from "@/lib/ai/tools/read/material";
import { executeKiroWriteTool } from "@/lib/ai/tools/write/executor";
import { KiroWriteApi } from "@/lib/ai/tools/write/types";
import { AppState } from "@/store/useAppStore";
import { KiroWriteToolName } from "@/lib/ai/tools/write/schemas";
import { executeChangeSet } from "@/lib/ai/transactions/executor";
import { ChangeSetActionInput } from "@/lib/ai/transactions/types";
import { KIRO_FINAL_ANSWER_TOOL_NAME } from "@/lib/ai/tools/finalAnswer";
import { KIRO_EVAL_SCENARIOS, KiroEvalScenario } from "@/lib/ai/eval/kiroScenarios";
import {
  createFreshKiroTextWorld,
  KiroTextWorldState,
  KIRO_TEXT_BASE_CONTEXT,
  KIRO_TEXT_MATERIAL_CONTENT,
  KIRO_TEXT_MEMORY_INDEX,
  KIRO_TEXT_NOW,
  KIRO_TEXT_SEED_REFS,
  KIRO_TEXT_TIMEZONE,
} from "@/lib/ai/eval/kiroTextWorld";
import { scoreKiroTextScenario, KiroTextScenarioResult, KiroTextToolTraceEntry, KiroTextWriteEvent } from "@/lib/ai/eval/kiroTextScoring";
import { buildKiroTextReport, renderKiroTextMarkdown, KiroTextReport } from "@/lib/ai/eval/kiroTextScoring";
import { createId } from "@/lib/utils";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

export const KIRO_TEXT_BASELINE = {
  provider: "deepseek",
  model: "deepseek-v4-flash",
} as const;

export const KIRO_TEXT_SMOKE_SCENARIOS = [
  "today-task-list",
  "assignment-health",
  "batch-ddl-change",
  "create-reminder",
  "start-focus",
];

export function kiroTextEvalEnabled(): boolean {
  return Boolean(process.env.DEEPSEEK_TEST_API_KEY);
}

export const KIRO_TEXT_MAX_ROUNDS = 6;

interface TextUiMessage {
  id: string;
  role: "user" | "assistant";
  parts: (
    | { type: "text"; text: string }
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

/**
 * Ephemeral World Write API：所有 mutation 只作用于当前 Scenario 的独立 clone。
 * 只实现 Text Eval 场景真正需要的语义（assignment patch / schedule replace / reminder / focus）；
 * 其余白名单方法为 noop（生产语义不进入 Eval baseline 判定，Eval 判定的是 Tool Policy 与安全事实）。
 */
export function createKiroTextWorldApi(world: KiroTextWorldState): KiroWriteApi {
  // 宽松容器访问：Eval 只做最小领域语义（assignment patch / schedule replace / reminder / focus）
  const W = world as unknown as Record<string, any>;
  const noop = () => undefined;
  const mapById = (arr: unknown, fn: (item: Record<string, unknown>) => unknown): unknown[] =>
    (arr as unknown[]).map((x) => fn(x as Record<string, unknown>));
  return {
    getState: () => world as unknown as AppState,
    addAssignment: (a) => {
      const id = createId("a");
      W.assignments = [{ ...(a as object), id }, ...(W.assignments as unknown[])];
      return id;
    },
    addAssignmentWithId: (a, id) => {
      W.assignments = [{ ...(a as object), id }, ...(W.assignments as unknown[])];
      return id;
    },
    updateAssignment: (a) => {
      W.assignments = mapById(W.assignments, (x) => (x.id === (a as { id: string }).id ? a : x));
    },
    updateAssignmentPatch: (id, patch) => {
      W.assignments = mapById(W.assignments, (x) => (x.id === id ? { ...x, ...(patch as object) } : x));
    },
    deleteAssignment: (id) => {
      const arr = W.assignments as { id: string }[];
      const found = arr.find((x) => x.id === id);
      W.assignments = arr.filter((x) => x.id !== id);
      return found ? ({ assignment: found, marks: [], studyBlocks: [], reminders: [] } as never) : null;
    },
    restoreAssignment: noop,
    updateAssignmentStatus: (id, status) => {
      W.assignments = mapById(W.assignments, (x) => (x.id === id ? { ...x, status } : x));
    },
    updateAssignmentPriority: (id, priority) => {
      W.assignments = mapById(W.assignments, (x) => (x.id === id ? { ...x, priority } : x));
    },
    updateAssignmentProgress: (id, progress) => {
      W.assignments = mapById(W.assignments, (x) => (x.id === id ? { ...x, progress } : x));
    },
    toggleSubtask: noop,
    addScheduleSlot: () => "",
    updateSchedule: (sc) => {
      W.schedules = mapById(W.schedules, (x) => (x.id === (sc as { id: string }).id ? sc : x));
    },
    deleteSchedule: (id) => {
      const arr = W.schedules as { id: string }[];
      const found = arr.find((x) => x.id === id) ?? null;
      W.schedules = arr.filter((x) => x.id !== id);
      return found as never;
    },
    restoreSchedule: noop,
    excludeWeekFromSchedule: noop,
    addCourseWithSchedule: () => "",
    updateCourse: noop,
    addGroupProject: () => "",
    updateGroupProject: noop,
    deleteGroupProject: noop,
    addGroupMember: () => "",
    updateGroupMember: noop,
    deleteGroupMember: () => ({ ok: true }),
    addGroupTask: () => "",
    updateGroupTask: noop,
    deleteGroupTask: noop,
    toggleGroupTask: noop,
    addReminder: (input) => {
      const id = createId("r");
      W.reminders = [...(W.reminders as unknown[]), { ...(input as object), id, status: "scheduled", createdAt: "", updatedAt: "", timingMode: "relative", source: "kiro" }];
      return id;
    },
    updateReminder: noop,
    deleteReminder: (id) => {
      const arr = W.reminders as { id: string }[];
      const found = arr.find((x) => x.id === id) ?? null;
      W.reminders = arr.filter((x) => x.id !== id);
      return found as never;
    },
    restoreReminder: noop,
    reconcileTargetReminders: noop,
    startFocusSession: (input, _context) => {
      const session = { ...(input as object), id: createId("fs"), status: "running", startedAt: "", elapsedMs: 0 };
      W.focusSessions = [...(W.focusSessions as unknown[]), session];
      return { ok: true, session } as never;
    },
    pauseFocusSession: () => ({ ok: true, session: null }) as never,
    resumeFocusSession: () => ({ ok: true, session: null }) as never,
    finishFocusSession: () => ({ ok: true, session: null }) as never,
    pushToast: noop,
    registerUndo: noop,
    addScheduleOccurrenceOverride: () => ({ ok: true, id: "occ_eval" }),
    addScheduleOccurrenceOverrideWithId: (_o, id) => ({ ok: true, id }),
    deleteScheduleOccurrenceOverride: () => null,
    restoreScheduleOccurrenceOverride: noop,
  };
}

/** 从 Read 输出收集真实实体 ID（unresolved-entity-write 判定；只收集明确 ID 字段） */
export function collectEntityIdsFromOutput(output: unknown): string[] {
  const ids: string[] = [];
  const walk = (v: unknown) => {
    if (v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    const o = v as Record<string, unknown>;
    for (const [k, val] of Object.entries(o)) {
      if (typeof val === "string" && /^(assignmentId|courseId|scheduleId|reminderId|projectId|memberId|taskId|id)$/.test(k)) {
        ids.push(val);
      } else if (typeof val === "object") {
        walk(val);
      }
    }
  };
  walk(output);
  return ids;
}

export interface KiroTextAgentRun {
  scenarioId: string;
  finalAnswer: string;
  toolTrace: KiroTextToolTraceEntry[];
  lastWriteEvent?: KiroTextWriteEvent;
  runtimeError?: { type: "provider" | "harness" | "unknown"; message: string };
}

const READ_ASYNC_TOOLS = new Set(["read_material", "read_project_file", "read_project_visual", "query_learning_history", "summarize_learning_history", "get_learning_analytics", "get_learning_outlook"]);
const MEMORY_TOOLS = new Set(["search_memories", "save_memory", "update_memory", "delete_memory"]);

export async function runKiroTextScenario(input: {
  scenario: KiroEvalScenario;
  apiKey: string;
}): Promise<KiroTextAgentRun> {
  const { scenario, apiKey } = input;
  const { model: lm } = await resolveLanguageModel({
    provider: KIRO_TEXT_BASELINE.provider as AIProviderId,
    model: KIRO_TEXT_BASELINE.model,
    apiKey,
  });

  // 每 Scenario 独立 fresh world + 固定时钟
  const world = createFreshKiroTextWorld();
  const fixedNow = new Date(KIRO_TEXT_NOW);
  const seedRefs = KIRO_TEXT_SEED_REFS[scenario.id] ?? [];
  const system = `${KIRO_SYSTEM_PROMPT}${buildKiroResponsePreferenceContext("balanced")}${buildClassFlowContextSection(
    { ...KIRO_TEXT_BASE_CONTEXT, memoryIndex: KIRO_TEXT_MEMORY_INDEX },
    seedRefs
  )}`;

  let messages: TextUiMessage[] = [
    { id: "u0", role: "user", parts: [{ type: "text", text: scenario.userMessage }] },
  ];

  const toolTrace: KiroTextToolTraceEntry[] = [];
  let finalAnswer = "";
  let lastWriteEvent: KiroTextWriteEvent | undefined;
  const knownEntityIds = new Set<string>();
  for (const ref of seedRefs) {
    if (ref.id) knownEntityIds.add(ref.id);
  }

  for (let round = 0; round < KIRO_TEXT_MAX_ROUNDS; round++) {
    const result = streamText({
      model: lm,
      system,
      messages: await convertToModelMessages(messages as never),
      tools: getKiroToolsForRequest({}),
      maxOutputTokens: 1024,
    });
    const toolCalls: RawToolCall[] = [];
    let text = "";
    let streamError: string | null = null;
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") text += part.text;
      if (part.type === "tool-call") toolCalls.push({ toolCallId: part.toolCallId, toolName: part.toolName, input: part.input });
      if (part.type === "error") streamError = (part.error as { message?: string } | undefined)?.message ?? String(part.error);
    }
    // finalAnswer 取「最后一个非空文本」（final 轮常无正文，不能覆盖之前的最终回答）
    if (text.trim().length > 0) finalAnswer = text;

    if (streamError) {
      return { scenarioId: scenario.id, finalAnswer: text, toolTrace, lastWriteEvent, runtimeError: { type: "provider", message: streamError } };
    }
    if (toolCalls.length === 0) break;

    const toolResultParts: TextUiMessage["parts"] = [];
    const writeApi = createKiroTextWorldApi(world);

    for (const tc of toolCalls) {
      const { toolName, input } = tc;
      // 内部控制信号：结束工具阶段
      if (toolName === KIRO_FINAL_ANSWER_TOOL_NAME) {
        toolTrace.push({ tool: toolName, result: "ok" });
        toolResultParts.push({ type: "dynamic-tool", state: "output-available", toolCallId: tc.toolCallId, toolName, input, output: { ok: true, data: {} } });
        continue;
      }
      // Memory：Node Eval 无 IndexedDB → 确定性 stub（Tool Policy 判定不受影响）
      if (MEMORY_TOOLS.has(toolName)) {
        toolTrace.push({ tool: toolName, result: "ok", input: input as Record<string, unknown> });
        toolResultParts.push({
          type: "dynamic-tool", state: "output-available", toolCallId: tc.toolCallId, toolName, input,
          output: { ok: true, data: { id: "mem_eval" } },
        });
        continue;
      }
      // apply_change_set：生产事务路径（全部合法才全部提交）作用于 ephemeral world
      if (toolName === "apply_change_set") {
        const parsed = (input as { actions?: ChangeSetActionInput[]; summary?: string });
        const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
        const res = await executeChangeSet({
          actions,
          summary: parsed.summary,
          state: world as unknown as never,
          api: writeApi,
          toolCallId: tc.toolCallId,
          confirm: async () => true,
        });
        const ok = res.ok;
        lastWriteEvent = { tool: toolName, ok, input: input as Record<string, unknown> };
        toolTrace.push({ tool: toolName, result: ok ? "ok" : "error", input: input as Record<string, unknown> });
        toolResultParts.push({
          type: "dynamic-tool", state: "output-available", toolCallId: tc.toolCallId, toolName, input,
          output: ok
            ? { ok: true, data: { count: res.changeSet.count }, action: { tool: toolName, entityType: "change-set", entityId: tc.toolCallId, title: res.changeSet.summary, operation: "update", canUndo: true } }
            : { ok: false, code: res.code, message: res.message, applied: res.applied },
        });
        continue;
      }
      // Write Tools：真实 deterministic executor（作用于 ephemeral world）
      if (isTextWriteTool(toolName)) {
        const out = executeKiroWriteTool(toolName as KiroWriteToolName, input, writeApi, tc.toolCallId);
        lastWriteEvent = { tool: toolName, ok: out.ok, input: input as Record<string, unknown> };
        toolTrace.push({ tool: toolName, result: out.ok ? "ok" : "error", input: input as Record<string, unknown> });
        toolResultParts.push({ type: "dynamic-tool", state: "output-available", toolCallId: tc.toolCallId, toolName, input, output: out });
        continue;
      }
      // Read / Proposal Tools（真实确定性 executor；固定时钟）
      if (READ_ASYNC_TOOLS.has(toolName)) {
        let out;
        if (toolName === "read_material") {
          // Node Eval 无 IndexedDB：确定性内容 stand-in（World 数据，非真实文件解析）
          const inputObj = input as { courseId?: string; materialId?: string };
          const content = KIRO_TEXT_MATERIAL_CONTENT[inputObj.materialId ?? ""];
          out = content !== undefined
            ? { ok: true, data: { materialId: inputObj.materialId, courseId: inputObj.courseId, title: "", type: "pdf", text: content, truncated: false } }
            : await executeReadMaterial(input, world);
        } else {
          out = { ok: false, code: "INVALID_INPUT" as const, message: `${toolName} 需要异步执行（Eval 未实现）。` };
        }
        const ids = collectEntityIdsFromOutput(out);
        toolTrace.push({ tool: toolName, result: out.ok ? "ok" : "error", input: input as Record<string, unknown>, outputEntityIds: ids });
        for (const id of ids) knownEntityIds.add(id);
        toolResultParts.push({ type: "dynamic-tool", state: "output-available", toolCallId: tc.toolCallId, toolName, input, output: out });
        continue;
      }
      // 其余 Read Tools（同步确定性 executor）
      const out = executeKiroReadTool(toolName, input, world, { now: fixedNow, timezone: KIRO_TEXT_TIMEZONE });
      const ids = collectEntityIdsFromOutput(out);
      toolTrace.push({ tool: toolName, result: out.ok ? "ok" : "error", input: input as Record<string, unknown>, outputEntityIds: ids });
      for (const id of ids) knownEntityIds.add(id);
      toolResultParts.push({ type: "dynamic-tool", state: "output-available", toolCallId: tc.toolCallId, toolName, input, output: out });
    }

    const assistantParts: TextUiMessage["parts"] = [];
    if (text.trim().length > 0) assistantParts.push({ type: "text", text });
    assistantParts.push(...toolResultParts);
    messages = [...messages, { id: `a${round}`, role: "assistant", parts: assistantParts }];
    if (toolCalls.some((t) => t.toolName === KIRO_FINAL_ANSWER_TOOL_NAME)) break;
  }

  return { scenarioId: scenario.id, finalAnswer, toolTrace, lastWriteEvent };
}

/** Write 工具判定（生产 KIRO_WRITE_TOOL_NAMES 同集合；apply_change_set 已单独处理） */
const TEXT_WRITE_TOOLS = new Set([
  "create_assignment", "update_assignment", "set_assignment_ddl", "set_assignment_priority",
  "set_assignment_status", "set_assignment_progress", "toggle_assignment_subtask", "delete_assignment",
  "create_schedule", "move_schedule", "resize_schedule", "update_schedule", "exclude_schedule_week",
  "cancel_schedule_occurrence", "move_schedule_occurrence", "create_extra_schedule_occurrence",
  "delete_schedule", "create_course", "update_course",
  "create_group_project", "update_group_project", "add_group_member", "update_group_member",
  "delete_group_member", "create_group_task", "update_group_task", "assign_group_task",
  "set_group_task_ddl", "toggle_group_task",
  "create_reminder", "update_reminder", "delete_reminder",
  "start_focus_session", "pause_focus_session", "resume_focus_session", "finish_focus_session",
]);

export function isTextWriteTool(toolName: string): boolean {
  return TEXT_WRITE_TOOLS.has(toolName);
}

export function resolveTextEvalScenarios(): { profile: "smoke" | "full"; scenarios: KiroEvalScenario[] } {
  const profile: "smoke" | "full" = process.env.KIRO_TEXT_EVAL_PROFILE === "full" ? "full" : "smoke";
  const filterRaw = process.env.KIRO_TEXT_EVAL_SCENARIOS ?? "";
  const filter = filterRaw.trim()
    ? filterRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  if (filter) {
    const known = new Set(KIRO_EVAL_SCENARIOS.map((s) => s.id));
    for (const id of filter) {
      if (!known.has(id)) throw new Error(`INVALID_TEXT_EVAL_SCENARIO_ID: ${id}`);
    }
    return { profile, scenarios: KIRO_EVAL_SCENARIOS.filter((s) => filter.includes(s.id)) };
  }
  const scenarios = profile === "full"
    ? KIRO_EVAL_SCENARIOS
    : KIRO_EVAL_SCENARIOS.filter((s) => KIRO_TEXT_SMOKE_SCENARIOS.includes(s.id));
  return { profile, scenarios };
}

export async function runKiroTextBenchmark(): Promise<{ report: KiroTextReport; modelDir: string }> {
  const apiKey = process.env.DEEPSEEK_TEST_API_KEY ?? "";
  const { profile, scenarios } = resolveTextEvalScenarios();
  const dir = join(process.cwd(), ".tmp", "kiro-text-eval", `${KIRO_TEXT_BASELINE.provider}__${KIRO_TEXT_BASELINE.model}`);
  mkdirSync(dir, { recursive: true });

  console.log("Kiro Text live benchmark");
  console.log(`Provider: ${KIRO_TEXT_BASELINE.provider}`);
  console.log(`Model: ${KIRO_TEXT_BASELINE.model}`);
  console.log(`Profile: ${profile} (${scenarios.length}/${KIRO_EVAL_SCENARIOS.length})`);
  console.log("API key: configured");

  const results: KiroTextScenarioResult[] = [];
  for (const scenario of scenarios) {
    try {
      const run = await runKiroTextScenario({ scenario, apiKey });
      const known = new Set<string>();
      for (const t of run.toolTrace) for (const id of t.outputEntityIds ?? []) known.add(id);
      for (const ref of KIRO_TEXT_SEED_REFS[scenario.id] ?? []) if (ref.id) known.add(ref.id);
      const scored = scoreKiroTextScenario({
        scenario,
        toolTrace: run.toolTrace,
        finalAnswer: run.finalAnswer,
        lastWriteEvent: run.lastWriteEvent,
        knownEntityIds: known,
        runtimeError: run.runtimeError,
      });
      results.push(scored);
      console.log(`${scenario.id.padEnd(32)} ${scored.outcome.toUpperCase().padEnd(7)} ${scored.failures.slice(0, 2).join("; ")}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isProvider = /401|403|429|5\d\d|rate|timeout|abort/i.test(msg);
      const runtimeError = { type: (isProvider ? "provider" : "harness") as "provider" | "harness", message: msg };
      results.push({
        scenarioId: scenario.id,
        outcome: "fail",
        toolMetrics: { requiredHit: 0, requiredTotal: scenario.requiredTools.length, forbiddenHits: [], unexpectedTools: [], toolOverused: false, duplicateReads: [], totalCalls: 0 },
        writeSafety: { unresolvedEntityWrites: [], transactionBypass: false, falseSuccessClaim: false, proposalFalseAppliedClaim: false },
        finalEmpty: true,
        failures: [`${runtimeError.type} runtime failure: ${msg}`],
        runtimeError,
      });
      console.log(`${scenario.id.padEnd(32)} ${runtimeError.type.toUpperCase()}  ${msg.slice(0, 120)}`);
    }
  }

  const baselineEligible =
    profile === "full" &&
    scenarios.length === KIRO_EVAL_SCENARIOS.length &&
    results.every((r) => !r.runtimeError);

  const report = buildKiroTextReport({
    scenarios: results,
    meta: {
      timestamp: new Date().toISOString(),
      provider: KIRO_TEXT_BASELINE.provider,
      model: KIRO_TEXT_BASELINE.model,
      profile,
      fullSuiteScenarioCount: KIRO_EVAL_SCENARIOS.length,
      baselineEligible,
    },
  });
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  writeFileSync(join(dir, "report.md"), renderKiroTextMarkdown(report), "utf8");
  console.log(`\nReport written to ${dir}/report.json + report.md`);
  console.log(`Baseline eligible: ${baselineEligible ? "yes" : "no"}`);
  return { report, modelDir: dir };
}
