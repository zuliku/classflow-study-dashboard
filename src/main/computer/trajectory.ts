/**
 * Computer Use V2.6 — 桌面轨迹 → Skill 草稿（纯函数，Main 侧）。
 *
 * 安全契约：
 * - 轨迹只记录结构化事实：动作类型 / 目标语义标签 / 风险等级 / 验证结果 / 时间
 * - 绝不记录：输入文本、剪贴板内容、绝对路径、截图、native 标识、坐标细节
 * - 生成的 Skill 草稿（desktop-<app>-<task>）同样不含上述敏感信息，可安全落盘为用户 Skill
 */
import type { DesktopGuiActionType, DesktopGuiRiskLevel } from "@/lib/desktop/types";
import type { SkillDraft } from "@/lib/ai/skills/types";
import { SKILL_NAME_PATTERN } from "@/lib/ai/skills/types";

export interface DesktopTrajectoryStep {
  index: number;
  action: DesktopGuiActionType;
  /** 目标语义标签（如 `Button「发送」`；≤64 字符，已清洗） */
  targetLabel: string;
  risk: DesktopGuiRiskLevel;
  /** 该步的 expect 验证结果（null = 未配置） */
  verificationPassed: boolean | null;
  at: number;
}

export type DesktopTrajectoryResult = "in-progress" | "completed" | "failed" | "cancelled";

export interface DesktopTrajectory {
  appName: string | null;
  appLabel: string | null;
  goal: string | null;
  steps: DesktopTrajectoryStep[];
  result: DesktopTrajectoryResult;
  startedAt: number;
}

/** 单会话轨迹上限（超出丢弃最旧步骤） */
export const MAX_TRAJECTORY_STEPS = 40;
/** 生成 Skill 草稿所需的最小步骤数 */
export const MIN_TRAJECTORY_STEPS_FOR_SKILL = 3;
const MAX_TARGET_LABEL_LENGTH = 64;

/** 目标标签清洗（控制字符 → 空格；折叠空白；截断） */
export function sanitizeTrajectoryTargetLabel(label: unknown): string {
  if (typeof label !== "string") return "";
  return label
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TARGET_LABEL_LENGTH);
}

/** 目标标签 → 短动作短语（Skill 指令中的步骤文案） */
export function describeTrajectoryStep(step: DesktopTrajectoryStep): string {
  const label = step.targetLabel || "当前焦点";
  switch (step.action) {
    case "click":
      return `点击 ${label}`;
    case "double_click":
      return `双击 ${label}`;
    case "focus":
      return `聚焦 ${label}`;
    case "type":
      return `在 ${label} 输入内容（真实内容按任务填写，不要复用固定值）`;
    case "key":
      return `按键（组合键）`;
    case "scroll":
      return `滚动 ${label}`;
    case "hover":
      return `悬停 ${label}`;
    case "right_click":
      return `右键 ${label}`;
    case "drag":
      return `拖拽 ${label}`;
    case "clipboard_read":
      return `读取剪贴板（需要用户确认）`;
    case "clipboard_write":
      return `写入剪贴板（需要用户确认，会覆盖）`;
    case "upload_file":
      return `在文件对话框填入工作区文件路径`;
    case "wait":
      return `等待界面响应`;
    default:
      return `操作 ${label}`;
  }
}

function slugify(input: string, maxLength: number): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // 中文保留在描述里；名称必须是 SKILL_NAME_PATTERN（仅 a-z0-9-）
  const ascii = slug.replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
  return ascii.slice(0, maxLength).replace(/-+$/g, "");
}

/** 从目标生成 name 片段（中文目标 → 回退到动作序列摘要） */
function taskSlug(trajectory: DesktopTrajectory): string {
  const goal = trajectory.goal ?? "";
  const fromGoal = slugify(goal, 32);
  if (fromGoal.length >= 3) return fromGoal;
  const actions = trajectory.steps
    .map((step) => step.action)
    .filter((action, index, list) => list.indexOf(action) === index)
    .slice(0, 3)
    .join("-");
  return slugify(actions, 32) || "task";
}

function appSlug(trajectory: DesktopTrajectory): string {
  const base = trajectory.appLabel ?? trajectory.appName ?? "desktop";
  const slug = slugify(base, 16);
  return slug || "desktop";
}

/** 生成 Skill 名称（desktop-<app>-<task>；满足 SKILL_NAME_PATTERN） */
export function buildDesktopSkillName(trajectory: DesktopTrajectory): string {
  const name = `desktop-${appSlug(trajectory)}-${taskSlug(trajectory)}`
    .slice(0, 64)
    .replace(/-+$/g, "");
  if (SKILL_NAME_PATTERN.test(name)) return name;
  return "desktop-task-recipe";
}

/** 轨迹 → 确定性 Skill 草稿（无 AI；模型只需在运行时按当前界面重新定位元素） */
export function buildDesktopSkillDraft(
  trajectory: DesktopTrajectory,
  sourceTurnId: string
): SkillDraft {
  const appLabel = trajectory.appLabel ?? trajectory.appName ?? "桌面应用";
  const goal = trajectory.goal ?? "完成桌面任务";
  const steps = trajectory.steps.slice(0, MAX_TRAJECTORY_STEPS);
  const stepLines = steps.map(
    (step, index) =>
      `${index + 1}. ${describeTrajectoryStep(step)}` +
      (step.verificationPassed === false ? "（上次未通过验证：必须重新观察后再操作）" : "")
  );
  const risky = steps.filter((step) => step.risk !== "normal").length;

  const instructions = [
    `# ${appLabel}：${goal}`,
    "",
    "## 适用场景",
    `- 在「${appLabel}」中完成「${goal}」这类任务（本配方来自一次成功轨迹，共 ${steps.length} 步）。`,
    "",
    "## 步骤（每次都必须先 observe_desktop，用当前界面重新定位元素；不要复用旧 elementId）",
    ...stepLines,
    "",
    "## 验证",
    "- 每个关键动作提供 desktop_action.expect（elementAppears / textAppears / titleContains），并依据 verification 结果决定是否继续。",
    "- verification.passed=false 时必须重新 observe_desktop / find_desktop_element，并更新计划；不要重复同一动作。",
    "",
    "## 安全",
    `- 本轨迹包含 ${risky} 个需要确认的动作（发送 / 提交 / 删除 / 剪贴板等）：执行前必须逐次获得用户确认。`,
    "- 密码、API Key、Token、Secret 绝不可作为 text 输入；受保护应用（密码管理器 / 银行支付）会被直接拒绝。",
  ].join("\n");

  return {
    name: buildDesktopSkillName(trajectory),
    description: `在 ${appLabel} 上完成「${goal}」的桌面操作流程（${steps.length} 步，含验证与安全门控）`,
    instructions,
    parameters: [],
    requiredTools: ["observe_desktop", "find_desktop_element", "desktop_action", "desktop_session"],
    requiredPermissions: [],
    requiredCapabilities: ["ui.interact"],
    examples: [],
    sourceTurnId,
    triggers: [appLabel, ...(trajectory.appName ? [trajectory.appName] : [])].slice(0, 4),
  };
}
