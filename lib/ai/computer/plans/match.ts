/**
 * plan-approve 模式 — 偏离门匹配（纯函数，可单测）。
 * 执行侧每发起一次 mutation 工具调用，先用本模块判定是否落在已批准计划内：
 * 命中未完成步骤 → 正常放行（由调用方标记 done）；未命中 → 强制回审批（deviation）。
 *
 * 诚实边界：
 * - schema 解析失败的输入返回 null（fail-open：executor 本就会拒绝非法输入，不执行 IO）；
 * - 非 mutation 工具返回 null（计划只约束改写操作）；
 * - 无锚点步骤永不匹配（propose 期已拒绝；防御旧数据）；
 * - handle 延续类工具（write_terminal_input 等）无命令可验：归属到计划内任一
 *   shell 步骤（不消费），延续的是已匹配/已批准命令的会话。
 */
import { COMPUTER_TOOLS } from "@/lib/ai/computer/tools/registry";
import { deriveStepCapability } from "@/lib/ai/computer/plans/propose";
import type { ComputerCapability } from "@/lib/ai/computer/types";
import type { PersistedExecutionPlan, PersistedPlanStep } from "@/lib/ai/computer/plans/types";

export interface PlanCallFacts {
  toolName: string;
  capability: ComputerCapability;
  rootId?: string;
  /** 涉及的相对路径（源 + 目标），已归一 */
  paths: string[];
  /** 终端命令原文（trim 后） */
  command?: string;
  artifactId?: string;
  /** desktop_action 动作名 */
  action?: string;
}

/** 路径归一（trim + 反斜杠 + 前导 ./ + 尾部斜杠；仅用于计划匹配相等比较） */
export function normalizePlanPath(p: string): string {
  let s = p.trim().replace(/\\/g, "/");
  while (s.startsWith("./")) s = s.slice(2);
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

/**
 * 从 tool input 抽取匹配事实（registry schema 为唯一解析源）。
 * 非 mutation / 未知工具 / 解析失败 → null（门放行，executor 照常校验执行）。
 */
export function extractPlanCallFacts(toolName: string, toolInput: unknown): PlanCallFacts | null {
  const def = COMPUTER_TOOLS.find((t) => t.name === toolName);
  if (!def || !def.mutation) return null;
  const parsed = def.schema.safeParse(toolInput);
  if (!parsed.success) return null;
  const args = parsed.data as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim().length > 0 ? v : undefined;
  const paths: string[] = [];
  for (const key of ["path", "destinationPath"]) {
    const v = str(args[key]);
    if (v) paths.push(normalizePlanPath(v));
  }
  // upload_file 的工作区文件同样是匹配锚点
  let fileRootId: string | undefined;
  const fileObj = args["file"];
  if (typeof fileObj === "object" && fileObj !== null) {
    const file = fileObj as Record<string, unknown>;
    const filePath = str(file["path"]);
    if (filePath) paths.push(normalizePlanPath(filePath));
    fileRootId = str(file["rootId"]);
  }
  const rootId = str(args["rootId"]) ?? str(args["destinationRootId"]) ?? fileRootId;
  const command = str(args["command"]);
  const artifactId = str(args["artifactId"]);
  const action = str(args["action"]);
  return {
    toolName,
    capability: def.capability,
    ...(rootId ? { rootId } : {}),
    paths,
    ...(command ? { command: command.trim() } : {}),
    ...(artifactId ? { artifactId } : {}),
    ...(action ? { action } : {}),
  };
}

/** handle 延续类工具：无命令可验，归属计划内 shell 步骤（不消费） */
const HANDLE_CONTINUATION_TOOLS = new Set([
  "write_terminal_input",
  "wait_terminal_command",
  "write_terminal_session_input",
  "close_terminal_session",
]);

/**
 * 匹配已批准计划中的首个未完成步骤（顺序无关；out-of-order 允许）。
 * 返回匹配步骤 id；null = 偏离（调用方强制回审批）。
 */
export function matchPlanStep(
  plan: PersistedExecutionPlan,
  facts: PlanCallFacts
): { matchedStepId: string | null } {
  if (HANDLE_CONTINUATION_TOOLS.has(facts.toolName)) {
    // 步骤未写 capability 时按 toolName 派生再比较（模型通常只写 toolName）
    const shellStep = plan.steps.find((s) => {
      if (s.done) return false;
      const cap: ComputerCapability | undefined =
        s.capability ?? (s.toolName ? deriveStepCapability(s.toolName) ?? undefined : undefined);
      return cap === "shell.execute" || s.toolName === facts.toolName;
    });
    if (shellStep) return { matchedStepId: shellStep.id };
    // 计划内无 shell 步骤却出现会话延续 → 偏离（fail-closed：延续必有所属）
    return { matchedStepId: null };
  }
  for (const step of plan.steps) {
    if (step.done) continue;
    if (step.toolName && step.toolName !== facts.toolName) continue;
    if (step.capability && step.capability !== facts.capability) continue;
    if (step.rootId && step.rootId !== facts.rootId) continue;
    if (step.artifactId && step.artifactId !== facts.artifactId) continue;
    if (step.action && step.action !== facts.action) continue;
    // 锚点：至少需要一个匹配维度（path/pathPrefix/commandPrefix 之一）；
    // 纯 capability/root 步骤对文件/终端类调用不算命中（防宽泛计划放行一切）
    const needsAnchor =
      facts.capability === "shell.execute" ||
      facts.capability.startsWith("fs.") ||
      facts.capability.startsWith("document.");
    let anchored = !needsAnchor;
    if (step.path) {
      if (!facts.paths.includes(normalizePlanPath(step.path))) continue;
      anchored = true;
    }
    if (step.pathPrefix) {
      const prefix = normalizePlanPath(step.pathPrefix);
      if (!facts.paths.some((p) => p === prefix || p.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`))) continue;
      anchored = true;
    }
    if (step.commandPrefix) {
      if (!facts.command || !facts.command.startsWith(step.commandPrefix.trim())) continue;
      anchored = true;
    }
    if (step.artifactId) anchored = true;
    if (!anchored) continue;
    return { matchedStepId: step.id };
  }
  return { matchedStepId: null };
}
