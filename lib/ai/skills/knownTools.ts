/**
 * Kiro Skill Tool References（S1 §53/§54）— 单一事实来源。
 *
 * Skill manifest 的 requiredTools 是「诊断用 Tool 引用」，不是权限、不是可执行能力。
 * 判定规则（保守）：
 * - builtin：必须真实存在于 Read / Write / Computer Tool Registry；
 * - web：canonical web tool names（web_search / read_web_source，由 web 模块动态创建）；
 * - mcp-gateway：mcp_search_tools / mcp_call_tool（MCP 调用必须经有界 gateway）；
 * - external-unverified：形如 mcp_* 的其它名字（可能来自尚未连接的 MCP server）——
 *   不判 invalid（避免「当前未连接 → 永久无效」），但明确标记为 external / unverified；
 * - unknown：其余一律 unknown（Skill Test 视为错误）。
 */
import { KIRO_READ_TOOL_NAMES } from "@/lib/ai/tools/read/registry";
import { KIRO_WRITE_TOOL_NAMES } from "@/lib/ai/tools/write/registry";
import { COMPUTER_TOOL_NAMES } from "@/lib/ai/computer/tools/registry";

export type KiroSkillToolStatus =
  | "builtin"
  | "web"
  | "mcp-gateway"
  | "external-unverified"
  | "unknown";

const CANONICAL_WEB_TOOLS = ["web_search", "web_research", "read_web_source"] as const;
const MCP_GATEWAY_TOOLS = ["mcp_search_tools", "mcp_call_tool"] as const;

const BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...(KIRO_READ_TOOL_NAMES as readonly string[]),
  ...(KIRO_WRITE_TOOL_NAMES as readonly string[]),
  ...COMPUTER_TOOL_NAMES,
]);

/** external MCP 命名约定（mcp_<server>_<tool>…；仅表示「可能是外部能力」） */
const EXTERNAL_MCP_TOOL_RE = /^mcp_[a-z0-9]+(?:_[a-z0-9]+)+$/;

export function classifyKiroSkillTool(name: string): KiroSkillToolStatus {
  if (typeof name !== "string" || name.trim().length === 0) return "unknown";
  const tool = name.trim();
  if ((MCP_GATEWAY_TOOLS as readonly string[]).includes(tool)) return "mcp-gateway";
  if ((CANONICAL_WEB_TOOLS as readonly string[]).includes(tool)) return "web";
  if (BUILTIN_TOOL_NAMES.has(tool)) return "builtin";
  if (EXTERNAL_MCP_TOOL_RE.test(tool)) return "external-unverified";
  return "unknown";
}

/** Skill Test 判定：unknown 才是错误（external 未验证 ≠ 无效） */
export function isKnownKiroSkillTool(name: string): boolean {
  return classifyKiroSkillTool(name) !== "unknown";
}

export function getKnownSkillToolNames(): string[] {
  return [
    ...[...BUILTIN_TOOL_NAMES].sort(),
    ...CANONICAL_WEB_TOOLS,
    ...MCP_GATEWAY_TOOLS,
  ];
}
