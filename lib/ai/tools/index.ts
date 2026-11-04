import { tool, ToolSet } from "ai";
import { z } from "zod";
import { KIRO_READ_TOOLS } from "@/lib/ai/tools/read/registry";
import { KIRO_WRITE_TOOLS } from "@/lib/ai/tools/write/registry";
import { KIRO_MEMORY_TOOLS } from "@/lib/ai/memory/tools";
import { COMPUTER_TOOLS, getComputerToolsForMode, ComputerToolDefinition } from "@/lib/ai/computer/tools/registry";
import { ComputerActionFact } from "@/lib/ai/computer/types";
import {
  KIRO_FINAL_ANSWER_TOOL_NAME,
  KIRO_FINAL_ANSWER_TOOL_DESCRIPTION,
} from "@/lib/ai/tools/finalAnswer";
import { resolveDocumentAuthoringVersion, DocumentAuthoringVersion } from "@/lib/ai/computer/documents/authoring/protocol";
import { resolveTerminalCapability, TerminalCapabilityState } from "@/lib/ai/computer/terminalCapability";
import {
  resolveDesktopObservationCapability,
  DesktopObservationCapabilityState,
} from "@/lib/ai/computer/desktopObservationCapability";
import {
  resolveGuiControlCapability,
  GuiControlCapabilityState,
} from "@/lib/ai/computer/gui/capability";
import {
  KIRO_UPDATE_AGENT_PLAN_TOOL_NAME,
  kiroUpdateAgentPlanInputSchema,
  normalizeAgentPlan,
} from "@/lib/ai/agent/plan";
import {
  KIRO_ASK_USER_TOOL_NAME,
  kiroAskUserInputSchema,
  normalizeUserQuestion,
} from "@/lib/ai/agent/ask";

/**
 * Kiro Agent Superpowers（Plan / Ask）：
 * 纯控制信号，execute 零 IO，仅把规范化结果回传给 Browser 渲染。
 * 不写 Store、不执行工具、不提升权限；不属于 mutation / audit。
 */
const AGENT_CONTROL_TOOLS = {
  [KIRO_UPDATE_AGENT_PLAN_TOOL_NAME]: tool({
    description:
      "提交/更新本轮执行计划（可见 checklist）。仅在任务需要 3 个以上独立步骤、跨工具/跨阶段时使用。" +
      "steps 用简短可执行标题；同一时间只允许一个 in_progress；开始一步时标记 in_progress，完成并验证后标记 completed。" +
      "单步任务、纯问答、简单读取不要调用。该工具零 IO，不等于执行结论。",
    inputSchema: kiroUpdateAgentPlanInputSchema,
    execute: async (input) => {
      const plan = normalizeAgentPlan(input);
      if (!plan) {
        return { ok: false as const, code: "INVALID_PLAN", message: "执行计划至少需要一个有效步骤。" };
      }
      return { ok: true as const, data: { plan: { ...plan, updatedAt: Date.now() } } };
    },
  }),
  [KIRO_ASK_USER_TOOL_NAME]: tool({
    description:
      "在必须由用户决定、且无法从上下文/工具推断时，提出一个结构化问题（2–5 个具体选项，可允许自由输入）。" +
      "只问一个决定性问题，不要用泛泛的“是否需要我继续”。调用后必须立即 begin_final_answer，并用一句话请用户选择；" +
      "不得假设用户答案继续执行，也不得通过本工具请求权限提升。",
    inputSchema: kiroAskUserInputSchema,
    execute: async (input) => {
      const question = normalizeUserQuestion(input);
      if (!question) {
        return { ok: false as const, code: "INVALID_QUESTION", message: "问题至少需要 2 个有效选项。" };
      }
      return { ok: true as const, data: { question } };
    },
  }),
};

/** Kiro 全部基础工具（Read + Write + Memory + Agent control）：Server 提供 schema，Client 按同名执行 */
export const KIRO_TOOLS = {
  ...KIRO_READ_TOOLS,
  ...KIRO_WRITE_TOOLS,
  ...KIRO_MEMORY_TOOLS,
  ...AGENT_CONTROL_TOOLS,

  // Final Answer Boundary（Streaming UX V3 + V4.1）：内部控制信号工具。
  // V4.1：begin_final_answer 是纯 Server control tool——execute 立即成功（无 Browser 状态 /
  // Workspace / IndexedDB / 用户确认），结果直接随同一 UI stream 到 Browser，
  // 不再需要 Browser → Server 的额外 roundtrip。不计 quota / 不进 audit / 不属 mutation。
  // server 在收到含该信号的续跑请求（legacy）或 in-stream step（V4.1）时关闭业务工具。
  [KIRO_FINAL_ANSWER_TOOL_NAME]: tool({
    description: KIRO_FINAL_ANSWER_TOOL_DESCRIPTION,
    inputSchema: z.object({}),
    execute: async () => ({ ok: true, data: {} }),
  }),
};

export type KiroToolSet = typeof KIRO_TOOLS;

/**
 * Computer 工具 → AI SDK tool set（schema 注册；client 端同名执行；V2.2 inputExamples）。
 * V2.3：Model Contract 按 Document Authoring Protocol Version 协商——
 * 普通工具保持默认 contract；create_document / update_document 按版本暴露对应 schema/description/examples。
 * 模型每次只能看到一种文档格式（绝不 text/content 同时暴露）。
 */
export function buildComputerToolSet(
  mode: "plan" | "guided" | "workspace-auto",
  documentAuthoringVersion?: unknown
): ToolSet {
  const version: DocumentAuthoringVersion = resolveDocumentAuthoringVersion(documentAuthoringVersion);
  const set: ToolSet = {};
  for (const def of getComputerToolsForMode(mode)) {
    const modelContract = def.modelContracts?.[version];
    const description = modelContract?.description ?? def.description;
    const schema = modelContract?.schema ?? def.schema;
    const inputExamples = modelContract?.inputExamples ?? def.inputExamples;
    set[def.name] = tool({
      description,
      inputSchema: schema,
      ...(inputExamples && inputExamples.length > 0 ? { inputExamples } : {}),
    });
  }
  return set;
}

/** 供测试 / route 使用的版本化工具集（与 buildComputerToolSet 同一协商路径） */
export function computerToolContractForVersion(
  def: ComputerToolDefinition,
  documentAuthoringVersion?: unknown
): { description: string; schema: z.ZodType; inputExamples?: Array<{ input: Record<string, unknown> }> } {
  const version = resolveDocumentAuthoringVersion(documentAuthoringVersion);
  const modelContract = def.modelContracts?.[version];
  return {
    description: modelContract?.description ?? def.description,
    schema: modelContract?.schema ?? def.schema,
    inputExamples: modelContract?.inputExamples ?? def.inputExamples,
  };
}

/**
 * 请求级工具域组装（Kiro Computer Agent V1 Part 2 + V2.3 protocol negotiation）：
 * Computer 工具按 turn snapshot 条件加入（Computer OFF → 0 个；plan → 只读；guided/auto → read + mutation）。
 * documentAuthoringVersion：缺失 → legacy V1（Canonical schema）；2 → Draft schema。
 * Desktop Terminal V1（Part 14）：run_terminal_command 只在前三者同时满足时暴露——
 * terminalEnabled（偏好）+ terminalAvailable（Desktop Terminal Bridge）+ hasNativeRoot（冻结 workspace）。
 * 普通 Web：server-facing tool list 本身不存在 terminal（不是暴露后 runtime deny）。
 * server 过滤不是安全边界——Browser Executor 仍独立 policy 求值。
 */
export function getKiroToolsForRequest(input: {
  computerSnapshot?: {
    enabled: boolean;
    agentMode: "plan" | "guided" | "workspace-auto";
    terminalEnabled?: boolean;
    terminalAvailable?: boolean;
    hasNativeRoot?: boolean;
    desktopControlEnabled?: boolean;
    desktopControlAvailable?: boolean;
    desktopActionEnabled?: boolean;
    desktopActionAvailable?: boolean;
  };
  documentAuthoringVersion?: unknown;
}): ToolSet {
  const base = { ...KIRO_TOOLS } as ToolSet;
  const snap = input.computerSnapshot;
  if (!snap?.enabled) return base;
  const set = { ...base, ...buildComputerToolSet(snap.agentMode, input.documentAuthoringVersion) };
  // Desktop Terminal V1.0.1：Tool Exposure 与 Capability Prompt 同源（统一 resolver）。
  // ready ⇔ run_terminal_command 暴露；任何一道 Gate false → 不暴露。
  const terminalCapability = resolveTerminalCapability(snap as never);
  if (!terminalCapability.available) {
    delete (set as Record<string, unknown>)["run_terminal_command"];
  }
  // Computer Use Phase 1：observe_desktop 与桌面观察 Capability 同源。
  // Web runtime（没有 Desktop Computer Bridge）→ desktopControlAvailable=false → 工具不存在。
  const desktopObservationCapability = resolveDesktopObservationCapability(snap as never);
  if (!desktopObservationCapability.available) {
    delete (set as Record<string, unknown>)["observe_desktop"];
    delete (set as Record<string, unknown>)["list_desktop_windows"];
    delete (set as Record<string, unknown>)["find_desktop_element"];
    delete (set as Record<string, unknown>)["desktop_session"];
  }
  // Computer Use Phase 2+3：desktop_action / activate_window / open_application 与 GUI 操作
  // Capability 同源。Plan（只读）/ 未开启「允许 Kiro 操作电脑」/ 无 Action Bridge → 工具整体不存在。
  const desktopActionCapability = resolveGuiControlCapability(snap as never);
  if (!desktopActionCapability.available) {
    delete (set as Record<string, unknown>)["desktop_action"];
    delete (set as Record<string, unknown>)["activate_window"];
    delete (set as Record<string, unknown>)["open_application"];
  }
  return set;
}

/** 供 chat route / diagnostics 读取本请求的 Terminal Capability（与 Tool Exposure 同源） */
export function resolveKiroTerminalCapability(input: {
  computerSnapshot?: {
    enabled: boolean;
    agentMode: "plan" | "guided" | "workspace-auto";
    terminalEnabled?: boolean;
    terminalAvailable?: boolean;
    hasNativeRoot?: boolean;
  };
}): TerminalCapabilityState {
  return resolveTerminalCapability(input.computerSnapshot as never);
}

/** 供 chat route / diagnostics 读取本请求的 Desktop Observation Capability（与 observe_desktop 暴露同源） */
export function resolveKiroDesktopObservationCapability(input: {
  computerSnapshot?: {
    enabled: boolean;
    agentMode: "plan" | "guided" | "workspace-auto";
    desktopControlEnabled?: boolean;
    desktopControlAvailable?: boolean;
  };
}): DesktopObservationCapabilityState {
  return resolveDesktopObservationCapability(input.computerSnapshot as never);
}

/** 供 chat route / diagnostics 读取本请求的 GUI Control Capability（与 desktop_action 暴露同源） */
export function resolveKiroGuiControlCapability(input: {
  computerSnapshot?: {
    enabled: boolean;
    agentMode: "plan" | "guided" | "workspace-auto";
    desktopControlEnabled?: boolean;
    desktopControlAvailable?: boolean;
    desktopActionEnabled?: boolean;
    desktopActionAvailable?: boolean;
  };
}): GuiControlCapabilityState {
  return resolveGuiControlCapability(input.computerSnapshot as never);
}

export { COMPUTER_TOOLS };
export type { ComputerActionFact };
