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
import { resolveDesktopObservationCapability } from "@/lib/ai/computer/desktopObservationCapability";
import { resolveGuiControlCapability } from "@/lib/ai/computer/gui/capability";
import type { GuiControlCapabilityState } from "@/lib/ai/computer/gui/capability";

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
 * Computer Use Phase 1：Desktop Observation 能力段。
 * 只读边界必须显式声明——用户要求点击/输入时必须如实说明当前不能执行。
 */
function buildDesktopObservationSection(snapshot: KiroComputerTurnSnapshot | null): string {
  const capability = resolveDesktopObservationCapability(snapshot);
  if (capability.reason === "computer-disabled") return "";
  if (capability.reason === "permission-disabled") {
    return [
      "# Desktop Observation",
      "",
      "当前运行环境提供桌面观察能力（只读）。",
      "- Runtime: available",
      "- User permission: disabled",
      "",
      "用户询问能否看到屏幕 / 桌面时：说明桌面版本支持，但需要在 设置 → Agent 与权限 中开启「允许 Kiro 查看桌面」。",
      "不要自动开启权限，也不要笼统回答「Kiro 不支持查看屏幕」。",
    ].join("\n");
  }
  if (capability.reason === "runtime-unavailable") {
    return [
      "# Desktop Observation",
      "",
      "- Runtime: unavailable",
      "",
      "当前运行环境没有桌面观察能力（例如 Web 版 / Desktop Bridge 未加载）。",
      "不要错误声称 ClassFlow Desktop 从来不支持查看桌面。",
    ].join("\n");
  }
  const guiCapability: GuiControlCapabilityState = resolveGuiControlCapability(snapshot);
  const actionGuidance = guiCapability.available
    ? [
        "用户要求「点击这个按钮」「输入文字」「滚动页面」时：先 observe_desktop 获取 elementId，再用 desktop_action 执行，并用返回的新 observation 验证结果。",
        "不要声称已经完成尚未执行的操作，也不要使用旧 observation / 旧坐标。",
      ]
    : [
        "用户要求「点击这个按钮」「输入文字」「关掉窗口」时：",
        guiCapability.reason === "mode-read-only"
          ? "必须说明当前为仅规划模式，只能观察；如需操作需切换到「每次确认」或「授权范围内自动」。"
          : "必须明确说明当前只能观察、不能执行 GUI 操作（如需操作，请在 设置 → Agent 与权限 中开启「允许 Kiro 操作电脑」）。",
        "不要声称已完成点击或输入，也不要描述不存在的执行能力。",
      ];
  return [
    "# Desktop Observation",
    "",
    "- Runtime: available",
    "- User permission: enabled",
    "- observe_desktop（截图 + UI Automation 控件树）: available",
    "- 只观察（Observe only）: 观察本身不会执行点击、键盘输入、剪贴板或启动应用",
    "",
    "用户询问「我现在电脑上打开了什么」「当前窗口有哪些按钮」「屏幕上显示什么」时，",
    "使用 observe_desktop 读取当前活动窗口或屏幕，并基于返回的窗口标题、应用名称、窗口列表与 UI 元素作答。",
    "返回的 windowId 是唯一允许使用的逻辑窗口 id；不要猜测或使用 HWND/PID。",
    ...actionGuidance,
  ].join("\n");
}

/**
 * Computer Use Phase 2：Desktop Action 能力段（Observe → Action → Observe）。
 * 只读 / 高风险 / 敏感输入的边界必须显式声明。
 */
function buildDesktopActionSection(snapshot: KiroComputerTurnSnapshot | null): string {
  const capability = resolveGuiControlCapability(snapshot);
  if (capability.reason === "computer-disabled") return "";
  if (capability.reason === "mode-read-only") {
    return [
      "# Desktop Action",
      "",
      "- Runtime: available",
      "- Mode: plan（只读）",
      "",
      "当前为仅规划模式：只能 observe_desktop 观察，不能执行点击 / 输入 / 按键。",
      "用户要求操作界面时，说明需要切换到「每次确认」或「授权范围内自动」模式。",
    ].join("\n");
  }
  if (capability.reason === "observe-disabled") {
    return [
      "# Desktop Action",
      "",
      "- Runtime: available",
      "- User permission: disabled（桌面观察未开启）",
      "",
      "电脑操作以桌面观察为前提。用户询问时，应引导前往：设置 → Agent 与权限 → 允许 Kiro 查看桌面。",
      "不要自动开启权限。",
    ].join("\n");
  }
  if (capability.reason === "permission-disabled") {
    return [
      "# Desktop Action",
      "",
      "- Runtime: available",
      "- User permission: disabled",
      "",
      "桌面版本支持操作电脑，但用户当前没有开启「允许 Kiro 操作电脑」。",
      "用户询问时，应引导前往：设置 → Agent 与权限 → 允许 Kiro 操作电脑。不要自动开启权限。",
    ].join("\n");
  }
  if (capability.reason === "runtime-unavailable") {
    return [
      "# Desktop Action",
      "",
      "- Runtime: unavailable",
      "",
      "当前运行环境没有电脑操作能力（例如 Web 版 / Desktop Bridge 未加载）。",
      "不要错误声称 ClassFlow Desktop 从来不支持操作电脑。",
    ].join("\n");
  }
  return [
    "# Desktop Action",
    "",
    "- Runtime: available",
    "- User permission: enabled",
    "- desktop_action（click / double_click / focus / type / key / scroll / wait）: available",
    "",
    "工作流程必须是 Observe → Action → Observe：",
    "1. 先 observe_desktop，从返回元素中选择 elementId（不要猜测坐标）。",
    "2. desktop_action 的 target 优先使用 elementId；只有 UI Automation 无法定位时才使用 normalized 0~1 坐标（禁止物理像素）。",
    "3. 每次执行后工具会自动重新观察并返回新的 observationId / changedWindow / uiChanged；必须依据新 observation 验证结果，不要假设成功。",
    "4. 返回 STALE_OBSERVATION 时必须重新 observe_desktop，禁止复用旧观察或旧坐标继续操作。",
    "",
    "边界：",
    "- 发送消息、提交表单、下载、删除、修改系统设置等高风险动作会请求用户确认；用户拒绝时立即停止。",
    "- 密码、API Key、Token、Secret 等敏感信息绝不可作为 text 传入，也不要尝试绕过。",
    "- 本阶段不支持拖拽、剪贴板和文件上传；用户要求时如实说明。",
    "- 用户点击停止后不得继续任何 GUI 操作。",
  ].join("\n");
}

/**
 * Computer Use Phase 3：Autonomous Desktop Agent 工作流（工具偏好 / 验证 / 循环守卫）。
 * 仅在桌面观察能力可用时注入。
 */
function buildDesktopAgentSection(snapshot: KiroComputerTurnSnapshot | null): string {
  const observation = resolveDesktopObservationCapability(snapshot);
  if (!observation.available) return "";
  return [
    "# Desktop Agent Workflow",
    "",
    "多步骤桌面任务必须遵循：Goal → Observe → Plan next action → Act → Verify → Replan → Finish。",
    "不要盲目连续点击；每次动作后先看新的 observation 再决定下一步。",
    "",
    "工具选择优先级（重要）：",
    "- 工作区文件读写：使用结构化 Filesystem / Document 工具（read_text / create_text_file / create_document / patch_text_file…），不要用鼠标在编辑器里点。",
    "- 运行开发命令：使用 Terminal（run_terminal_command），不要用 GUI 终端窗口。",
    "- 普通应用界面（浏览器浏览、微信会话、Word 界面等）：使用 Desktop GUI（observe_desktop / desktop_action）。",
    "- 不要为了演示鼠标操作，把可以安全结构化完成的操作改成 GUI 点击。",
    "",
    "多窗口工作流：",
    "- list_desktop_windows → activate_window → observe_desktop → desktop_action。",
    "- 所有 windowId 都是会话内 opaque id；切换窗口后必须重新 observe。",
    "- open_application 只接受逻辑应用名（chrome / word / wechat / notepad / explorer…）；不要传 exe 或路径。",
    "",
    "验证（必须）：",
    "- 发送消息：必须观察到消息出现在聊天记录（或明确成功状态 UI），不能以「点击了发送」作为完成依据。",
    "- 保存文档：必须观察到保存状态或使用 Filesystem / Document 工具验证文件存在与内容。",
    "- 表单提交：必须观察到提交成功状态。",
    "- 能用结构化工具验证时优先用结构化工具，而不是只看屏幕。",
    "",
    "Vision fallback（UIA 优先）：",
    "- 只有 canvas / 自绘 UI / 远程桌面 / UIA 树为空 / 控件无法语义定位时，才使用 observe_desktop(includeVision=true) 获取候选区域。",
    "- 视觉输出只是 label + 归一化候选区域（不能直接执行动作）；后续 desktop_action 使用这些候选坐标时属于坐标回退，会请求用户确认。",
    "",
    "Loop Guard：",
    "- 每个会话有动作数 / 观察数 / 时长上限；重复相同动作或无进展（界面不变）会被自动停止。",
    "- 被停止后不要继续重试同一动作；应报告当前状态并请用户介入。",
    "",
    "高风险动作（必须逐次确认，不能提前笼统授权）：",
    "- 发送 / 发布 / 删除 / 购买 / 支付 / 最终提交 / 账号与安全设置 / 权限变更 / 上传到外部服务 / 任何不可逆操作。",
    "- 可以自动填写表单，但点击「提交 / 发送 / 确认」之前必须获得 allow-once 确认。",
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
  const terminalSection = (() => {
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
  })();
  const observationSection = buildDesktopObservationSection(snapshot);
  const actionSection = buildDesktopActionSection(snapshot);
  const agentSection = buildDesktopAgentSection(snapshot);
  return [terminalSection, observationSection, actionSection, agentSection]
    .filter(Boolean)
    .join("\n\n");
}

export type { TerminalCapabilityState };
