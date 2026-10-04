/**
 * Computer Approval Presentation（P4）— request → 展示文案的单一 formatter。
 *
 * 契约：
 * - UI 只解释 request（已由 Runtime/Main 脱敏 + 定级），绝不重新决定风险 / Policy；
 * - 只消费安全字段：appName / windowTitle / action / targetLabel / textPreview /
 *   riskLevel / riskReason / coordinateFallback / shell / relativePath / commandPreview /
 *   workspaceLabel / rootLabel / resourceLabel / capability / terminalRisk；
 * - 绝不展示 elementId / observationId / windowId / HWND / PID / native path / toolCallId / taskId；
 * - Inline Approval 与 fallback Dialog 共用同一 formatter，避免两份文案漂移。
 */
import {
  ComputerApprovalDecision,
  ComputerApprovalRequest,
} from "@/lib/ai/computer/approval";
import { guiActionLabel } from "@/lib/ai/computer/gui/observation";

/** 决策按钮文案（Inline / Dialog 共用；只按 request.allowedDecisions 渲染） */
export const COMPUTER_APPROVAL_DECISION_LABELS: Record<ComputerApprovalDecision, string> = {
  deny: "拒绝",
  "allow-once": "允许这一次",
  "allow-session": "本次会话允许",
  "allow-workspace": "此 Workspace 始终允许",
};

/**
 * 决策授权范围说明（按钮下小字；用户此前不敢用“始终允许”/用了又担心敞口）。
 * - allow-once：精确绑定本次请求（终端还绑定 shell/cwd/命令指纹），换命令需重新审批
 * - allow-session：仅本次会话内同类操作有效，停止/新建对话即失效
 * - allow-workspace：此工作区内同类操作有效，可在设置中撤销
 */
export const COMPUTER_APPROVAL_DECISION_HINTS: Record<ComputerApprovalDecision, string> = {
  deny: "拒绝本次操作，任务中断，可继续对话换种方式",
  "allow-once": "仅对本次操作有效，换命令需重新审批",
  "allow-session": "仅本次会话有效，停止或新建对话后失效",
  "allow-workspace": "此工作区内同类操作有效，可在设置中撤销",
};

export interface ComputerApprovalPresentation {
  /** 「Kiro 准备执行 / 准备运行命令 / 准备修改…」 */
  title: string;
  /** 主行动行（点击「发送」/ 命令预览 / 资源名） */
  primary: string;
  /** 次要事实（应用 · 窗口 / 工作目录 / workspace 位置） */
  meta: string[];
  /** Terminal 命令原文（mono 区块；默认可见，绝不折叠） */
  command?: string;
  /** GUI 非敏感输入预览（≤80 字符，Main 已脱敏） */
  textPreview?: string;
  /** 风险提示（来自 Runtime 定级事实；UI 不改写语义） */
  warnings: string[];
  /** 高危（destructive / sensitive / external / privileged） */
  highRisk: boolean;
}

/** 高危判定：只读 Runtime 已定级的字段，不做 Policy 判断 */
export function isComputerApprovalHighRisk(request: ComputerApprovalRequest): boolean {
  if (request.risk === "destructive" || request.risk === "external") return true;
  if (request.terminalRisk === "destructive" || request.terminalRisk === "privileged") return true;
  const level = request.gui?.riskLevel;
  return level === "destructive" || level === "sensitive" || level === "external";
}

function fileOperationLabel(request: ComputerApprovalRequest): string {
  switch (request.capability) {
    case "fs.modify":
    case "document.modify":
      return "修改操作";
    case "fs.create":
    case "document.create":
      return "创建操作";
    case "fs.delete":
      return "删除操作";
    case "fs.move":
      return "移动操作";
    default:
      return "文件操作";
  }
}

function fileTitle(request: ComputerApprovalRequest): string {
  switch (request.capability) {
    case "fs.create":
    case "document.create":
      return "Kiro 准备创建";
    case "fs.delete":
      return "Kiro 准备删除";
    case "fs.move":
      return "Kiro 准备移动";
    default:
      return "Kiro 准备修改";
  }
}

/** request → 展示 formatter（纯函数） */
export function getComputerApprovalPresentation(
  request: ComputerApprovalRequest
): ComputerApprovalPresentation {
  if (request.gui) {
    const gui = request.gui;
    const app = gui.appName || "应用";
    const actionLabel = guiActionLabel(gui.action);
    const target = gui.targetLabel ? `「${gui.targetLabel}」` : "";
    const warnings: string[] = [];
    if (gui.riskLevel !== "normal" && gui.riskReason) warnings.push(gui.riskReason);
    // 定位不确定是最高频的误操作源：点名“未能精确定位”，要求目检而非泛泛确认
    if (gui.coordinateFallback) warnings.push("定位不确定：未能精确定位控件，批准前请目检目标是否正确");
    // 敏感输入：明确告知已隐藏，打消“批准会泄露密码”的顾虑
    if (gui.riskLevel === "sensitive" && !gui.textPreview) warnings.push("敏感输入已隐藏，批准不会泄露原文");
    // 后台静默模式：用户看不到实时界面（仅执行记录/审计可查），属监督缺失风险，必警告；
    // 不改变 highRisk 分级（分级只读 Runtime 定级）。
    if (request.background === true) {
      warnings.push("后台执行：窗口不会置顶，你看不到实时过程，请从执行记录确认结果");
    }
    return {
      title: "Kiro 准备执行",
      primary: `在${app}中${actionLabel}${target}`,
      meta: [
        gui.windowTitle ? `${app} · ${gui.windowTitle}` : app,
        ...(request.background === true ? ["后台静默执行"] : []),
      ],
      ...(gui.textPreview ? { textPreview: gui.textPreview } : {}),
      warnings,
      highRisk: isComputerApprovalHighRisk(request),
    };
  }

  if (request.capability === "shell.execute") {
    const warnings: string[] = [];
    // 分级解释：删/提权 impact 一句话（此前只有半句警告，小白无法决策；normal 保持零打扰）
    if (request.terminalRisk === "destructive") {
      warnings.push("此命令可能删除或不可逆修改文件，操作不可撤销，批准前请确认命令内容。");
    } else if (request.terminalRisk === "privileged") {
      warnings.push("此命令需要更高权限，执行范围超出普通文件操作，请确认命令来源可信。");
    }
    return {
      title: "Kiro 准备运行命令",
      primary: request.shell === "cmd" ? "命令提示符" : "PowerShell",
      meta: [
        request.relativePath ? `工作目录 /${request.relativePath}` : "工作目录 /",
        request.workspaceLabel,
      ].filter(Boolean),
      command: request.commandPreview ?? request.resourceLabel,
      warnings,
      highRisk: isComputerApprovalHighRisk(request),
    };
  }

  // 删除是最高频的高危误批：点名不可恢复（此前 warnings 为空，只有标题“准备删除”）
  const fileWarnings: string[] =
    request.capability === "fs.delete" ? ["删除后不可恢复，请确认文件范围无误。"] : [];
  return {
    title: fileTitle(request),
    primary: request.resourceLabel,
    meta: [
      request.rootLabel ? `${request.workspaceLabel} / ${request.rootLabel}` : request.workspaceLabel,
      fileOperationLabel(request),
    ].filter(Boolean),
    warnings: fileWarnings,
    highRisk: isComputerApprovalHighRisk(request),
  };
}
