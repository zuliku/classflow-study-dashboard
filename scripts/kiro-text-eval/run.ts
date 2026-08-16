/**
 * Kiro Text Eval V1.1 —— Live Text Agent Baseline Runner（DeepSeek V4 Flash）。
 * 固定 profile：provider=deepseek / model=deepseek-v4-flash（KIRO_TEXT_BASELINE）；
 * 只在 DEEPSEEK_TEST_API_KEY 存在时运行（CI 默认 skip）。
 * 复用生产：KIRO_SYSTEM_PROMPT / buildKiroResponsePreferenceContext(balanced) /
 * buildClassFlowContextSection / buildKiroMemoryIndexSection / getKiroToolsForRequest({}) /
 * wrapLanguageModel + addToolInputExamplesMiddleware / executeKiroReadTool /
 * executeKiroWriteTool / executeChangeSet / AI.CHAT_MAX_OUTPUT_TOKENS / Final Answer Boundary helpers。
 * 不复制 useKiroChat；不通过 UI 驱动。
 * 每 Scenario 独立 fresh world clone（mutation 只作用于 ephemeral in-memory state）。
 * Sequential Entity Provenance Ledger：写操作按其发生当时已解析实体快照检查（后续 Read 不能回溯清除违规）。
 * 输出 .tmp/kiro-text-eval/deepseek__deepseek-v4-flash/report.json + report.md；绝不记录 key。
 */
import { streamText, convertToModelMessages, wrapLanguageModel, addToolInputExamplesMiddleware } from "ai";
import { getKiroToolsForRequest } from "@/lib/ai/tools";
import { KIRO_SYSTEM_PROMPT, AI } from "@/lib/ai/config";
import { buildKiroResponsePreferenceContext } from "@/lib/ai/responsePreference";
import { buildClassFlowContextSection } from "@/lib/ai/prompts/classFlowContextSection";
import { buildKiroMemoryIndexSection } from "@/lib/ai/prompts/memoryIndexSection";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import { AIProviderId } from "@/lib/ai/providers/types";
import { executeKiroReadTool } from "@/lib/ai/tools/read/executor";
import { executeReadMaterial } from "@/lib/ai/tools/read/material";
import { executeKiroWriteTool } from "@/lib/ai/tools/write/executor";
import { KIRO_WRITE_TOOL_NAMES } from "@/lib/ai/tools/write/registry";
import { KiroWriteApi } from "@/lib/ai/tools/write/types";
import { KiroWriteToolName } from "@/lib/ai/tools/write/schemas";
import { executeChangeSet } from "@/lib/ai/transactions/executor";
import { ChangeSetActionInput } from "@/lib/ai/transactions/types";
import {
  KIRO_FINAL_ANSWER_TOOL_NAME,
  KiroRoundEvent,
  classifyKiroRoundEvents,
  isKiroFinalAnswerToolName,
  kiroFinalAnswerBoundarySeen,
} from "@/lib/ai/tools/finalAnswer";
import { KIRO_EVAL_SCENARIOS, KiroEvalScenario } from "@/lib/ai/eval/kiroScenarios";
import {
  createFreshKiroTextWorld,
  KIRO_TEXT_BASE_CONTEXT,
  KIRO_TEXT_MATERIAL_CONTENT,
  KIRO_TEXT_MEMORY_INDEX,
  KIRO_TEXT_NOW,
  KIRO_TEXT_SEED_REFS,
  KIRO_TEXT_TIMEZONE,
  KiroTextWorldState,
} from "@/lib/ai/eval/kiroTextWorld";
import { scoreKiroTextScenario, KiroTextScenarioResult, KiroTextToolTraceEntry, KiroTextWriteEvent } from "@/lib/ai/eval/kiroTextScoring";
import { buildKiroTextReport, renderKiroTextMarkdown, KiroTextReport } from "@/lib/ai/eval/kiroTextScoring";
import { normalizeAIError } from "@/lib/ai/errors";
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

export const KIRO_TEXT_MAX_ROUNDS = 8;
const MAX_RUNTIME_ERROR_CHARS = 300;

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

export interface KiroTextEvalRunSnapshot {
  finalAnswer: string;
  toolTrace: KiroTextToolTraceEntry[];
  lastWriteEvent?: KiroTextWriteEvent;
  rounds: number;
}

export interface KiroTextAgentRun extends KiroTextEvalRunSnapshot {
  scenarioId: string;
  runtimeError?: { type: "provider" | "harness" | "unknown"; message: string };
}

/** 安全归一化（与 Visual Eval 一致：normalizeAIError + 300 chars） */
function safeRuntimeErrorMessage(err: unknown): { code?: string; message: string } {
  try {
    const aiErr = normalizeAIError(err);
    return { code: aiErr.code, message: (aiErr.message ?? aiErr.code ?? "未知错误").slice(0, MAX_RUNTIME_ERROR_CHARS) };
  } catch {
    return { message: String(err).slice(0, MAX_RUNTIME_ERROR_CHARS) };
  }
}

/**
 * Mutation 实体引用提取（只处理真实 mutation schema；Change Set 递归 actions[*].input）。
 * 只对 ClassFlow Write / apply_change_set 有意义。
 */
export function extractMutationEntityReferences(toolName: string, input: unknown): string[] {
  const refs: string[] = [];
  const collect = (obj: unknown) => {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;
    for (const field of ENTITY_REF_FIELDS) {
      const v = o[field];
      if (typeof v === "string" && v.length > 0) refs.push(`${field}=${v}`);
    }
  };
  collect(input);
  if (toolName === "apply_change_set") {
    const actions = (input as { actions?: unknown })?.actions;
    if (Array.isArray(actions)) {
      for (const a of actions) {
        const act = a as { input?: unknown };
        if (act?.input) collect(act.input);
      }
    }
  }
  return refs;
}

const ENTITY_REF_FIELDS = ["assignmentId", "courseId", "scheduleId", "reminderId", "projectId", "memberId", "taskId", "targetId"];

/** targetType=standalone 的 Reminder 无 target（targetId 不要求 resolved） */
export function isStandaloneReminder(toolName: string, input: unknown): boolean {
  if (toolName !== "create_reminder" && toolName !== "update_reminder") return false;
  const o = input as { targetType?: string };
  return o?.targetType === "standalone";
}

/** 从 Read 输出收集真实实体 ID（sequential provenance ledger 追加来源；只收集明确 ID 字段） */
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
    getState: () => world as unknown as never,
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

const READ_ASYNC_TOOLS = new Set(["read_material", "read_project_file", "read_project_visual", "query_learning_history", "summarize_learning_history", "get_learning_analytics", "get_learning_outlook"]);
const MEMORY_TOOLS = new Set(["search_memories", "save_memory", "update_memory", "delete_memory"]);

export async function runKiroTextScenario(input: {
  scenario: KiroEvalScenario;
  apiKey: string;
}): Promise<KiroTextAgentRun> {
  const { scenario, apiKey } = input;
  // 可恢复 failure path：首次 model resolve 失败 → 返回 empty snapshot + runtimeError（不伪造 safety evidence）
  let resolved;
  try {
    resolved = await resolveLanguageModel({
      provider: KIRO_TEXT_BASELINE.provider as AIProviderId,
      model: KIRO_TEXT_BASELINE.model,
      apiKey,
    });
  } catch (err) {
    // Eval V1.1：明确边界 —— resolveLanguageModel 属于 Provider 边界（不按 message 猜分类；
    // normalizeAIError 可能把 401/5xx 转成无状态码的中文消息，正则分类不可靠）
    const msg = safeRuntimeErrorMessage(err).message;
    return {
      scenarioId: scenario.id,
      finalAnswer: "",
      toolTrace: [],
      lastWriteEvent: undefined,
      rounds: 0,
      runtimeError: { type: "provider", message: msg.slice(0, MAX_RUNTIME_ERROR_CHARS) },
    };
  }
  // 生产 parity：model middleware（addToolInputExamples）与 route 一致
  const lm = wrapLanguageModel({
    model: resolved.model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: addToolInputExamplesMiddleware(),
  });

  const world = createFreshKiroTextWorld();
  const fixedNow = new Date(KIRO_TEXT_NOW);
  const seedRefs = KIRO_TEXT_SEED_REFS[scenario.id] ?? [];
  const system = `${KIRO_SYSTEM_PROMPT}${buildKiroResponsePreferenceContext("balanced")}${buildClassFlowContextSection(
    { ...KIRO_TEXT_BASE_CONTEXT },
    seedRefs
  )}${buildKiroMemoryIndexSection(KIRO_TEXT_MEMORY_INDEX)}`;

  let messages: TextUiMessage[] = [
    { id: "u0", role: "user", parts: [{ type: "text", text: scenario.userMessage }] },
  ];

  // Sequential Provenance Ledger：初始只含 trusted contextRefs；Read ok 后追加；写前快照检查
  const resolvedEntityIds = new Set<string>();
  for (const ref of seedRefs) {
    if (ref.id) resolvedEntityIds.add(ref.id);
  }

  const toolTrace: KiroTextToolTraceEntry[] = [];
  let lastWriteEvent: KiroTextWriteEvent | undefined;
  let finalAnswer = "";
  let rounds = 0;
  let boundarySeen = false;

  const emitToolResult = (tc: RawToolCall, output: unknown, entry: KiroTextToolTraceEntry) => {
    toolTrace.push(entry);
    return {
      type: "dynamic-tool" as const,
      state: "output-available" as const,
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      input: tc.input,
      output,
    };
  };

  for (; rounds < KIRO_TEXT_MAX_ROUNDS; rounds++) {
    // Final Answer Boundary（生产 prepareStep 等价）：boundary 后关闭全部业务工具，只走 Final text
    const tools = boundarySeen ? {} : getKiroToolsForRequest({});
    let roundLanes: ReturnType<typeof classifyKiroRoundEvents> | null = null;
    const streamErr = await (async () => {
      try {
        const result = streamText({
          model: lm,
          system,
          messages: await convertToModelMessages(messages as never),
          tools,
          maxOutputTokens: AI.CHAT_MAX_OUTPUT_TOKENS,
        });
        // Eval V1.1.2：按真实到达顺序收集 ordered round events（相邻 text-delta 合并；tool 间隔则分开）
        const roundEvents: KiroRoundEvent[] = [];
        let streamError: string | null = null;
        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            const last = roundEvents[roundEvents.length - 1];
            if (last && last.kind === "text") last.text += part.text;
            else roundEvents.push({ kind: "text", text: part.text });
          } else if (part.type === "tool-call") {
            roundEvents.push({ kind: "tool", toolCallId: part.toolCallId, toolName: part.toolName, input: part.input });
          } else if (part.type === "error") {
            streamError = (part.error as { message?: string } | undefined)?.message ?? String(part.error);
          }
        }
        // Lane attribution：boundary 前 text = commentary；boundary 后 text = final
        const classified = classifyKiroRoundEvents({ events: roundEvents, boundarySeenBeforeRound: boundarySeen });
        roundLanes = classified;
        boundarySeen = classified.boundarySeenAfterRound;
        // lane-aware snapshot：只有 Final lane 的已观察 text 才进入 finalAnswer（commentary 永不进入）
        if (classified.finalText.trim().length > 0) finalAnswer += classified.finalText;
        if (streamError) {
          return { kind: "provider" as const, error: streamError };
        }

        // Case C：有 Tool 事件 → 按原始事件顺序执行/回填
        const toolResultByCallId = new Map<string, TextUiMessage["parts"][number]>();
        const writeApi = createKiroTextWorldApi(world);
        for (const ev of classified.toolEvents) {
          if (ev.kind !== "tool") continue;
          const tc: RawToolCall = { toolCallId: ev.toolCallId, toolName: ev.toolName, input: ev.input };
          const { toolName, input } = tc;
          if (toolName === KIRO_FINAL_ANSWER_TOOL_NAME) {
            toolResultByCallId.set(ev.toolCallId, emitToolResult(tc, { ok: true, data: {} }, { tool: toolName, result: "ok" }));
            continue;
          }
          if (MEMORY_TOOLS.has(toolName)) {
            toolResultByCallId.set(ev.toolCallId, emitToolResult(tc, { ok: true, data: { id: "mem_eval" } }, { tool: toolName, result: "ok", input: input as Record<string, unknown> }));
            continue;
          }
          if (toolName === "apply_change_set" || (KIRO_WRITE_TOOL_NAMES as string[]).includes(toolName)) {
            // Sequential Provenance：执行前按当前 ledger 快照检查（后续 Read 不得回溯清除）
            const refs = extractMutationEntityReferences(toolName, input);
            const unresolved = refs.filter((r) => {
              const [, id] = r.split("=");
              return !resolvedEntityIds.has(id);
            });
            // standalone reminder 的 targetId 不要求 resolved
            const finalUnresolved = isStandaloneReminder(toolName, input) ? [] : unresolved;
            if (toolName === "apply_change_set") {
              const parsed = input as { actions?: ChangeSetActionInput[]; summary?: string };
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
              toolResultByCallId.set(ev.toolCallId, emitToolResult(
                tc,
                ok
                  ? { ok: true, data: { count: res.changeSet.count }, action: { tool: toolName, entityType: "change-set", entityId: tc.toolCallId, title: res.changeSet.summary, operation: "update", canUndo: true } }
                  : { ok: false, code: res.code, message: res.message, applied: res.applied },
                { tool: toolName, result: ok ? "ok" : "error", input: input as Record<string, unknown>, unresolvedEntityInputs: finalUnresolved }
              ));
              continue;
            }
            const out = executeKiroWriteTool(toolName as KiroWriteToolName, input, writeApi, tc.toolCallId);
            lastWriteEvent = { tool: toolName, ok: out.ok, input: input as Record<string, unknown> };
            toolResultByCallId.set(ev.toolCallId, emitToolResult(tc, out, { tool: toolName, result: out.ok ? "ok" : "error", input: input as Record<string, unknown>, unresolvedEntityInputs: finalUnresolved }));
            continue;
          }
          // Read / Proposal Tools（真实确定性 executor；固定时钟）
          if (READ_ASYNC_TOOLS.has(toolName)) {
            let out: { ok: boolean; code?: string; data?: unknown; message?: string };
            if (toolName === "read_material") {
              const inputObj = input as { courseId?: string; materialId?: string };
              const content = KIRO_TEXT_MATERIAL_CONTENT[inputObj.materialId ?? ""];
              out = content !== undefined
                ? { ok: true, data: { materialId: inputObj.materialId, courseId: inputObj.courseId, title: "", type: "pdf", text: content, truncated: false } }
                : await executeReadMaterial(input, world as never);
            } else {
              out = { ok: false, code: "INVALID_INPUT", message: `${toolName} 需要异步执行（Eval 未实现）。` };
            }
            const ids = out.ok ? collectEntityIdsFromOutput(out.data) : [];
            for (const id of ids) resolvedEntityIds.add(id);
            toolResultByCallId.set(ev.toolCallId, emitToolResult(tc, out, { tool: toolName, result: out.ok ? "ok" : "error", input: input as Record<string, unknown>, outputEntityIds: ids }));
            continue;
          }
          const out = executeKiroReadTool(toolName, input, world, { now: fixedNow, timezone: KIRO_TEXT_TIMEZONE });
          const ids = out.ok ? collectEntityIdsFromOutput(out.data) : [];
          for (const id of ids) resolvedEntityIds.add(id);
          toolResultByCallId.set(ev.toolCallId, emitToolResult(tc, out, { tool: toolName, result: out.ok ? "ok" : "error", input: input as Record<string, unknown>, outputEntityIds: ids }));
        }

        // assistantParts 按 Provider 原始顺序重建（text 事件保持原位，tool 事件 materialize 为 dynamic-tool）
        const assistantParts: TextUiMessage["parts"] = [];
        for (const ev of roundEvents) {
          if (ev.kind === "text") {
            if (ev.text.trim().length > 0) assistantParts.push({ type: "text", text: ev.text });
          } else {
            const part = toolResultByCallId.get(ev.toolCallId);
            if (part) assistantParts.push(part);
          }
        }
        messages = [...messages, { id: `a${rounds}`, role: "assistant", parts: assistantParts }];
        return null;
      } catch (err) {
        return { kind: "harness" as const, error: `HARNESS_THROW: ${safeRuntimeErrorMessage(err).message}` };
      }
    })();

    if (streamErr) {
      return {
        scenarioId: scenario.id,
        finalAnswer,
        toolTrace,
        lastWriteEvent,
        rounds,
        runtimeError: { type: streamErr.kind, message: streamErr.error.slice(0, MAX_RUNTIME_ERROR_CHARS) },
      };
    }

    // ---------- Stop Semantics（Eval V1.1.2；生产协议驱动） ----------
    const c = roundLanes!;
    const hasBusinessTool = c.toolEvents.some((t) => t.kind === "tool" && !isKiroFinalAnswerToolName(t.toolName));
    if (hasBusinessTool) continue; // Case C：已执行 Tool → 下一轮 continuation
    if (boundarySeen) {
      if (c.finalText.trim().length > 0) break; // Case A：boundary + Final text → done
      continue; // Case B：boundary 已到但无 Final text → 再走 final-only 轮
    }
    if (c.commentaryText.trim().length > 0) {
      // Case D：无 Tool、无 boundary、有 text、自然 stop → legacy direct-answer settled fallback
      finalAnswer = c.commentaryText;
      break;
    }
    break; // Case E：无 Tool、无 text → settled empty（scoring 判 finalEmpty）
  }

  return { scenarioId: scenario.id, finalAnswer, toolTrace, lastWriteEvent, rounds };
}

export function resolveTextEvalScenarios(): {
  profile: "smoke" | "full";
  coverageMode: "full" | "smoke" | "filtered";
  scenarios: KiroEvalScenario[];
} {
  const profile: "smoke" | "full" = process.env.KIRO_TEXT_EVAL_PROFILE === "full" ? "full" : "smoke";
  const filterRaw = process.env.KIRO_TEXT_EVAL_SCENARIOS ?? "";
  const hasExplicitFilter = filterRaw.trim().length > 0;
  const filter = hasExplicitFilter ? parseScenarioFilter(filterRaw) : null;
  // 显式 filter（即使列出全部 15 个 ID）→ coverageMode "filtered" → baselineEligible 恒 false
  const coverageMode: "full" | "smoke" | "filtered" = hasExplicitFilter
    ? "filtered"
    : profile === "full"
      ? "full"
      : "smoke";
  if (filter) {
    return { profile, coverageMode, scenarios: KIRO_EVAL_SCENARIOS.filter((s) => filter.includes(s.id)) };
  }
  const scenarios = profile === "full"
    ? KIRO_EVAL_SCENARIOS
    : KIRO_EVAL_SCENARIOS.filter((s) => KIRO_TEXT_SMOKE_SCENARIOS.includes(s.id));
  return { profile, coverageMode, scenarios };
}

/**
 * 纯函数：逗号分隔 Scenario ID（trim + dedupe 保留 first occurrence；空 → []）。
 * 未知 ID → 硬失败 INVALID_TEXT_EVAL_SCENARIO_ID（不静默跳过）。
 * 注意：返回顺序只代表「选择集合」；实际执行顺序恒为 KIRO_EVAL_SCENARIOS canonical order（见 resolveTextEvalScenarios）。
 */
export function parseScenarioFilter(raw: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const s of raw.split(",")) {
    const id = s.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  const known = new Set(KIRO_EVAL_SCENARIOS.map((sc) => sc.id));
  for (const id of ids) {
    if (!known.has(id)) throw new Error(`INVALID_TEXT_EVAL_SCENARIO_ID: ${id}`);
  }
  return ids;
}

export async function runKiroTextBenchmark(): Promise<{ report: KiroTextReport; modelDir: string }> {
  const apiKey = process.env.DEEPSEEK_TEST_API_KEY ?? "";
  const { profile, coverageMode, scenarios } = resolveTextEvalScenarios();
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
      const scored = scoreKiroTextScenario({
        scenario,
        toolTrace: run.toolTrace,
        finalAnswer: run.finalAnswer,
        lastWriteEvent: run.lastWriteEvent,
        runtimeError: run.runtimeError,
      });
      results.push(scored);
      console.log(`${scenario.id.padEnd(32)} ${scored.outcome.toUpperCase().padEnd(7)} ${scored.failures.slice(0, 2).join("; ")}`);
    } catch (err) {
      const runtimeError = { type: "unknown" as const, message: safeRuntimeErrorMessage(err).message };
      results.push({
        scenarioId: scenario.id,
        outcome: "fail",
        toolMetrics: { requiredHit: 0, requiredTotal: 0, forbiddenHits: [], unexpectedTools: [], toolOverused: false, duplicateReads: [], totalCalls: 0 },
        writeSafety: { unresolvedEntityWrites: [], transactionBypass: false, falseSuccessClaim: false, proposalFalseAppliedClaim: false },
        finalEmpty: true,
        failures: [],
        runtimeError,
      });
      console.log(`${scenario.id.padEnd(32)} ${runtimeError.type.toUpperCase()}  ${runtimeError.message.slice(0, 120)}`);
    }
  }

  const fullSuiteIds = KIRO_EVAL_SCENARIOS.map((s) => s.id);
  const requestedIds = scenarios.map((s) => s.id);
  const report = buildKiroTextReport({
    scenarios: results,
    meta: {
      timestamp: new Date().toISOString(),
      provider: KIRO_TEXT_BASELINE.provider,
      model: KIRO_TEXT_BASELINE.model,
      profile,
      coverageMode,
      fullSuiteScenarioCount: fullSuiteIds.length,
    },
    requestedScenarioIds: requestedIds,
    fullSuiteScenarioIds: fullSuiteIds,
  });
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  writeFileSync(join(dir, "report.md"), renderKiroTextMarkdown(report), "utf8");
  console.log(`\nReport written to ${dir}/report.json + report.md`);
  console.log(`Baseline eligible: ${report.validity.baselineEligible ? "yes" : "no"}`);
  return { report, modelDir: dir };
}
