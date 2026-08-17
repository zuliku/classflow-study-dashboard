/**
 * Desktop Runtime Capability Prompt Context（Desktop Terminal V1.0.1）。
 *
 * Server-generated、受信任的动态能力声明：模型对「当前运行环境能力」的判断
 * 必须以此段为准，而不是静态身份描述或训练先验。
 *
 * 与 run_terminal_command Tool Exposure 同源（resolveTerminalCapability）。
 * 绝不包含 native absolute path / grantId / adapterRef。
 */
import { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import { resolveTerminalCapability, TerminalCapabilityState } from "@/lib/ai/computer/terminalCapability";

/** 终端能力可用时的适用场景列表（写入 Prompt） */
const TERMINAL_USE_CASES = [
  "git status / diff / log / add / commit",
  "npm / pnpm / yarn",
  "Python / pytest",
  "TypeScript / tsc",
  "ESLint / Prettier",
  "项目 build / test",
  "用户明确要求执行 CLI 命令",
];

function buildReadySection(): string {
  return [
    "# Desktop Runtime Capabilities",
    "",
    "当前运行环境提供 ClassFlow Desktop Terminal。",
    "",
    "Terminal:",
    "- Runtime: available",
    "- User permission: enabled",
    "- Native workspace: available",
    "- PowerShell / CMD command runner: available",
    "",
    "你可以使用 run_terminal_command 在当前用户已授权的本地 Workspace 中执行 PowerShell 或 CMD 命令。",
    "",
    `适合使用 Terminal 的场景包括：\n${TERMINAL_USE_CASES.map((c) => `- ${c}`).join("\n")}`,
    "",
    "Terminal 是受限的 command runner，不是无限制的系统控制权限。",
    "所有执行仍必须遵循 ClassFlow 的 Workspace、Sandbox、Policy、Approval 和安全规则。",
    "",
    "当用户询问：",
    "- “你能操作 PowerShell 吗？”",
    "- “你能运行命令行吗？”",
    "- “你可以执行 CMD 吗？”",
    "",
    "必须基于本段当前 runtime capability 回答。",
    "如果 Terminal 当前 available，不得再回答：",
    "“我不能运行 PowerShell” / “我只能生成脚本让你自己执行” / “我无法操作命令行”。",
    "除非具体请求受到当前 Policy / Approval / Sandbox 限制。",
  ].join("\n");
}

function buildPermissionDisabledSection(): string {
  return [
    "# Desktop Runtime Capabilities",
    "",
    "当前运行环境提供 ClassFlow Desktop Terminal。",
    "",
    "Terminal:",
    "- Runtime: available",
    "- User permission: disabled",
    "",
    "ClassFlow Desktop 本身支持 PowerShell / CMD，但用户当前没有开启 Kiro Terminal 权限。",
    "如果用户询问能否使用 PowerShell / CMD：应说明“桌面版支持，但当前终端权限未开启”。",
    "不得笼统说“Kiro 不支持 PowerShell”。",
    "可以自然引导用户前往：设置 → Agent 与权限 → 允许 Kiro 使用终端。",
    "不要自动开启权限。",
  ].join("\n");
}

function buildNativeWorkspaceMissingSection(): string {
  return [
    "# Desktop Runtime Capabilities",
    "",
    "当前运行环境提供 ClassFlow Desktop Terminal。",
    "",
    "Terminal:",
    "- Runtime: available",
    "- User permission: enabled",
    "- Native workspace: unavailable",
    "",
    "终端能力已经开启，但当前 Workspace 不是桌面本地授权 Workspace。",
    "run_terminal_command 当前不可用。",
    "用户询问时，应说明：“终端权限已经开启，但需要先添加或切换到本地文件夹工作区。”",
    "不要说“ClassFlow 不支持命令行”。",
  ].join("\n");
}

function buildRuntimeUnavailableSection(): string {
  return [
    "# Desktop Runtime Capabilities",
    "",
    "当前运行环境没有 Desktop Terminal Runtime（例如 Web 版 / Desktop Bridge 未加载）。",
    "",
    "Terminal:",
    "- Runtime: unavailable",
    "",
    "用户询问时可以回答：“当前运行环境没有桌面终端能力。”",
    "不要错误声称“ClassFlow Desktop 从来不支持 Terminal”。",
  ].join("\n");
}

function buildComputerDisabledSection(): string {
  return [
    "# Desktop Runtime Capabilities",
    "",
    "Computer Agent 当前没有启用（computerEnabled=false）。",
    "",
    "用户询问时，应说明当前 Computer 能力关闭，而不是静态说 Terminal 永远不可用。",
  ].join("\n");
}

/**
 * 根据当前 Turn 的 frozen snapshot 生成能力声明段。
 * snapshot 为 null 或未启用 → computer-disabled 表达（与 resolver 判定一致）。
 */
export function buildDesktopRuntimeCapabilityContext(
  snapshot: KiroComputerTurnSnapshot | null
): string {
  const capability: TerminalCapabilityState = resolveTerminalCapability(snapshot);
  switch (capability.reason) {
    case "ready":
      return buildReadySection();
    case "permission-disabled":
      return buildPermissionDisabledSection();
    case "native-workspace-required":
      return buildNativeWorkspaceMissingSection();
    case "runtime-unavailable":
      return buildRuntimeUnavailableSection();
    case "computer-disabled":
      return buildComputerDisabledSection();
  }
}

export type { TerminalCapabilityState };
