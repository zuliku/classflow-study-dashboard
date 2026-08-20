/**
 * Distill Core — 共享的 Prompt/Parse/Normalize/Validate/Render
 * Route 负责 request validation / credential / AI call / error boundary
 * Renderer 不 import Provider Client
 */

import type { WorkflowTrace, SkillDraft, SanitizedTrace } from "@/lib/ai/skills/types";
import { renderSkillDraftToMd, validateSkillDraft } from "@/lib/ai/skills/draft";
import { z } from "zod/v3";

const SkillParameterSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "date", "course", "assignment", "deadline"]),
  description: z.string(),
  required: z.boolean(),
  example: z.string().optional(),
});

const SkillExampleSchema = z.object({
  input: z.record(z.string()),
  expectedSteps: z.array(z.string()),
  description: z.string().optional(),
});

const DraftSchemaRaw = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().min(1).max(200),
  instructions: z.string().min(1),
  parameters: z.union([z.array(SkillParameterSchema), z.record(SkillParameterSchema.omit({ name: true }))]),
  requiredTools: z.array(z.string()),
  requiredPermissions: z.array(z.string()).optional(),
  examples: z.array(z.union([SkillExampleSchema, z.object({ input: z.record(z.string()), output: z.string().optional(), expectedSteps: z.array(z.string()).optional() })])),
  sourceTurnId: z.string().optional(),
});

export const SkillDraftSchema = DraftSchemaRaw.transform((raw) => {
  let parameters: z.infer<typeof SkillParameterSchema>[] = [];
  if (Array.isArray(raw.parameters)) parameters = raw.parameters as never;
  else if (raw.parameters && typeof raw.parameters === "object") {
    parameters = Object.entries(raw.parameters as Record<string, unknown>).map(([k, v]) => {
      const val = v as Record<string, unknown>;
      return { name: k, type: (val.type as string) ?? "string", description: (val.description as string) ?? k, required: (val.required as boolean) ?? true, example: val.example as string | undefined } as z.infer<typeof SkillParameterSchema>;
    });
  }
  const examples = (raw.examples as unknown[]).map((ex) => {
    const e = ex as Record<string, unknown>;
    if (Array.isArray(e.expectedSteps)) return e as z.infer<typeof SkillExampleSchema>;
    if (typeof e.output === "string") return { input: (e.input as Record<string, string>) ?? {}, expectedSteps: [e.output as string] } as z.infer<typeof SkillExampleSchema>;
    return { input: (e.input as Record<string, string>) ?? {}, expectedSteps: [] } as z.infer<typeof SkillExampleSchema>;
  });
  return {
    name: raw.name,
    description: raw.description,
    instructions: raw.instructions,
    parameters,
    requiredTools: raw.requiredTools,
    requiredPermissions: raw.requiredPermissions ?? ["read", "propose"],
    examples,
    sourceTurnId: raw.sourceTurnId ?? "",
  };
});

export function buildDistillPrompt(sanitized: SanitizedTrace, trace: WorkflowTrace): string {
  return `You are a Skill distillation expert for ClassFlow (Kiro Skills compatible). You must return ONLY valid JSON, no markdown, no code blocks, no explanations.

Sanitized User Goal: ${sanitized.userGoal}
Sanitized Steps: ${JSON.stringify(sanitized.steps, null, 2)}
Required Tools: ${sanitized.requiredTools.join(", ")}
Original trace had ${(trace as unknown as { toolCalls: unknown[] }).toolCalls.length} tool calls.

Requirements:
- Skill name must be lowercase hyphen, e.g. "course-notification-to-task", NOT date-specific
- Description generic, 1 sentence
- Instructions workflow guidance, must include "Skill cannot elevate permissions."
- Parameters generic placeholders: {course}, {deadline}, {assignmentTitle} etc, NOT fixed values
- RequiredTools from sanitized.requiredTools
- Examples: 2-3 simulated inputs with generic values
- sourceTurnId: ${trace.turnId}
- Do NOT decide file location or write to disk. Just return JSON.

Example JSON:
{
  "name": "course-notification-to-task",
  "description": "将课程通知中的作业、DDL、调课信息整理为 ClassFlow 操作建议。",
  "instructions": "1. 识别课程 ({course})\\n2. 提取通知内容 ({assignmentTitle}, {deadline})\\n3. 查询已有任务\\n4. 生成 Proposal\\n5. 用户确认后执行\\n\\nSkill cannot elevate permissions.",
  "parameters": [
    {"name": "course", "type": "course", "description": "课程名称", "required": true, "example": "示例课程A"},
    {"name": "deadline", "type": "deadline", "description": "截止时间", "required": true, "example": "2099-01-01T23:59"}
  ],
  "requiredTools": ${JSON.stringify(sanitized.requiredTools)},
  "requiredPermissions": ["read", "propose"],
  "examples": [
    {"input": {"course": "示例课程A", "assignmentTitle": "示例任务A", "deadline": "2099-01-01"}, "expectedSteps": ["search_courses", "search_assignments", "create_assignment"]}
  ],
  "sourceTurnId": "${trace.turnId}"
}

Return JSON only.`;
}

export function parseAndNormalizeDraft(jsonStr: string, trace: WorkflowTrace): SkillDraft {
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  const str = jsonMatch ? jsonMatch[0] : jsonStr;
  let parsed: unknown;
  try {
    parsed = JSON.parse(str);
  } catch {
    const cleaned = str.replace(/```json/g, "").replace(/```/g, "").trim();
    parsed = JSON.parse(cleaned);
  }
  const result = SkillDraftSchema.safeParse(parsed);
  if (!result.success) throw new Error(`SkillDraft validation failed: ${result.error.message}`);
  const draft = { ...(result.data as unknown as SkillDraft), sourceTurnId: trace.turnId } as SkillDraft;
  return draft;
}

export function renderAndValidateDraft(draft: SkillDraft): { md: string; validation: ReturnType<typeof validateSkillDraft> } {
  const validation = validateSkillDraft(draft);
  const md = renderSkillDraftToMd(draft);
  return { md, validation };
}
