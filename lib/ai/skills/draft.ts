/**
 * Skill Draft — 结构化对象 + Deterministic Render to SKILL.md。
 *
 * S1 契约：
 * - SKILL.md frontmatter 只写 portable 字段（name / description）；
 *   requiredTools / requiredPermissions / parameters / sourceTurnId 属于 agents/kiro.json
 *   （由 Main Skill Store 从 draft 构造 manifest 落盘），绝不写进 frontmatter metadata；
 * - draft.kind 缺省按 workflow 归一（desktop 轨迹 draft 显式 recipe）；
 * - description 是 routing contract：1–500 字符（deterministic validation，不用 LLM 改写）。
 */

import type { SkillDraft, SkillParameter, SkillExample, KiroSkillKind } from "@/lib/ai/skills/types";
import { KIRO_SKILL_MANIFEST_LIMITS, normalizeKiroSkillPermissions } from "@/lib/ai/skills/kiroManifest";

export const SKILL_DESCRIPTION_MAX_LENGTH = 500;

/** draft.kind 归一（缺省 workflow；非法值 → workflow） */
export function resolveSkillDraftKind(kind: KiroSkillKind | undefined): KiroSkillKind {
  return kind === "recipe" ? "recipe" : "workflow";
}

export function renderSkillDraftToMd(draft: SkillDraft): string {
  const lines: string[] = ["---"];
  lines.push(`name: ${draft.name}`);
  lines.push(`description: ${draft.description}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${draft.name}`);
  lines.push("");
  lines.push(draft.instructions);
  lines.push("");
  if (draft.parameters.length > 0) {
    lines.push("## Parameters");
    lines.push("");
    for (const p of draft.parameters) {
      lines.push(`- **{${p.name}}** (${p.type}${p.required ? ", required" : ""}): ${p.description}${p.example ? ` e.g. ${p.example}` : ""}`);
    }
    lines.push("");
  }
  if (draft.requiredTools.length > 0) {
    lines.push("## Required Tools");
    lines.push("");
    for (const t of draft.requiredTools) lines.push(`- ${t}`);
    lines.push("");
  }
  if (draft.requiredPermissions.length > 0) {
    lines.push("## Required Permissions");
    lines.push("");
    for (const perm of draft.requiredPermissions) lines.push(`- ${perm}`);
    lines.push("");
  }
  if (draft.examples.length > 0) {
    lines.push("## Examples");
    lines.push("");
    for (const ex of draft.examples) {
      lines.push(`### Example`);
      if (ex.description) lines.push(`${ex.description}`);
      lines.push(`Input: ${JSON.stringify(ex.input)}`);
      lines.push(`Steps: ${ex.expectedSteps.join(" -> ")}`);
      lines.push("");
    }
  }
  lines.push("> Skill cannot elevate permissions. Skill instructions provide workflow guidance only and do not grant system authority.");
  lines.push("");
  return lines.join("\n");
}

export function validateSkillDraft(draft: SkillDraft): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!draft.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.name)) errors.push("INVALID_NAME_PATTERN");
  if (!draft.description || draft.description.trim().length === 0) errors.push("MISSING_DESCRIPTION");
  if (draft.description && draft.description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    errors.push("DESCRIPTION_TOO_LONG");
  }
  if (!draft.instructions) errors.push("MISSING_INSTRUCTIONS");
  if (!draft.sourceTurnId) errors.push("MISSING_SOURCE_TURN");
  if (draft.kind !== undefined && draft.kind !== "workflow" && draft.kind !== "recipe") {
    errors.push("INVALID_KIND");
  }
  // 禁止模型自由决定文件位置或写磁盘（指令中不应包含写磁盘路径）
  if (/write.*disk|file.*position/i.test(draft.instructions)) errors.push("FORBIDDEN_FILE_WRITE");
  // 检查是否包含权限提升
  if (/grant permission|system authority/i.test(draft.instructions)) errors.push("PERMISSION_ELEVATION");
  // 权限必须落在 allowlist（非法权限永不写入 manifest）
  const normalizedPermissions = normalizeKiroSkillPermissions(draft.requiredPermissions);
  if (normalizedPermissions.length !== (draft.requiredPermissions ?? []).length) {
    errors.push("INVALID_PERMISSION");
  }
  if (draft.requiredTools.length > KIRO_SKILL_MANIFEST_LIMITS.maxRequiredTools) {
    errors.push("TOO_MANY_REQUIRED_TOOLS");
  }
  return { ok: errors.length === 0, errors };
}

export function createSkillDraftFromSanitized(
  sanitizedUserGoal: string,
  baseName: string,
  params: SkillParameter[],
  requiredTools: string[],
  examples: SkillExample[],
  sourceTurnId: string
): SkillDraft {
  // 基础校验已在调用前完成
  return {
    name: baseName,
    description: sanitizedUserGoal.slice(0, 80),
    instructions: `# Workflow\n\n1. 识别课程\n2. 提取通知内容\n3. 查询已有任务\n4. 生成 Proposal\n5. 用户确认后执行\n\n> 基于 sanitized goal: ${sanitizedUserGoal}`,
    kind: "workflow",
    parameters: params,
    requiredTools,
    requiredPermissions: ["read", "propose"],
    examples,
    sourceTurnId,
  };
}
