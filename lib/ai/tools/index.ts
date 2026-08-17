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

/** Kiro 全部基础工具（Read + Write + Memory）：Server 提供 schema，Client 按同名执行 */
export const KIRO_TOOLS = {
  ...KIRO_READ_TOOLS,
  ...KIRO_WRITE_TOOLS,
  ...KIRO_MEMORY_TOOLS,
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

export { COMPUTER_TOOLS };
export type { ComputerActionFact };
