import { tool, ToolSet } from "ai";
import { z } from "zod";
import { KIRO_READ_TOOLS } from "@/lib/ai/tools/read/registry";
import { KIRO_WRITE_TOOLS } from "@/lib/ai/tools/write/registry";
import { KIRO_MEMORY_TOOLS } from "@/lib/ai/memory/tools";
import { COMPUTER_TOOLS, getComputerToolsForMode } from "@/lib/ai/computer/tools/registry";
import { ComputerActionFact } from "@/lib/ai/computer/types";
import {
  KIRO_FINAL_ANSWER_TOOL_NAME,
  KIRO_FINAL_ANSWER_TOOL_DESCRIPTION,
} from "@/lib/ai/tools/finalAnswer";

/** Kiro 全部基础工具（Read + Write + Memory）：Server 提供 schema，Client 按同名执行 */
export const KIRO_TOOLS = {
  ...KIRO_READ_TOOLS,
  ...KIRO_WRITE_TOOLS,
  ...KIRO_MEMORY_TOOLS,
  // Final Answer Boundary（Streaming UX V3）：内部控制信号工具。
  // Client onToolCall 直接回填 ok:true（不执行、不计数、不进 worklog/audit）；
  // server 在收到含该信号的续跑请求时关闭业务工具（toolChoice none）。
  [KIRO_FINAL_ANSWER_TOOL_NAME]: tool({
    description: KIRO_FINAL_ANSWER_TOOL_DESCRIPTION,
    inputSchema: z.object({}),
  }),
};

export type KiroToolSet = typeof KIRO_TOOLS;

/** Computer 工具 → AI SDK tool set（schema 注册；client 端同名执行；V2.2：inputExamples 用于指导复杂参数） */
export function buildComputerToolSet(mode: "plan" | "guided" | "workspace-auto"): ToolSet {
  const set: ToolSet = {};
  for (const def of getComputerToolsForMode(mode)) {
    set[def.name] = tool({
      description: def.description,
      inputSchema: def.schema,
      ...(def.inputExamples && def.inputExamples.length > 0 ? { inputExamples: def.inputExamples } : {}),
    });
  }
  return set;
}

/**
 * 请求级工具域组装（Kiro Computer Agent V1 Part 2）：
 * Computer 工具按 turn snapshot 条件加入（Computer OFF → 0 个；plan → 只读；guided/auto → read + mutation）。
 * server 过滤不是安全边界——Browser Executor 仍独立 policy 求值。
 */
export function getKiroToolsForRequest(input: {
  computerSnapshot?: {
    enabled: boolean;
    agentMode: "plan" | "guided" | "workspace-auto";
  };
}): ToolSet {
  const base = { ...KIRO_TOOLS } as ToolSet;
  const snap = input.computerSnapshot;
  if (!snap?.enabled) return base;
  return { ...base, ...buildComputerToolSet(snap.agentMode) };
}

export { COMPUTER_TOOLS };
export type { ComputerActionFact };
