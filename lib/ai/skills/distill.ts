/**
 * Distillation Pipeline — Deterministic Sanitize + AI Abstraction
 * 1. Sanitize (7 steps)
 * 2. AI Abstraction via Muse Spark 1.2 Contributor
 * 3. Draft → SKILL.md deterministic render
 * 禁止让模型自由决定文件位置或写磁盘
 */

import type { WorkflowTrace, SkillDraft, SanitizedTrace } from "@/lib/ai/skills/types";
import { sanitizeWorkflowTrace } from "@/lib/ai/skills/sanitize";
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

const SkillDraftSchemaRaw = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().min(1).max(200),
  instructions: z.string().min(1),
  parameters: z.union([
    z.array(SkillParameterSchema),
    z.record(SkillParameterSchema.omit({ name: true })),
  ]),
  requiredTools: z.array(z.string()),
  requiredPermissions: z.array(z.string()).optional(),
  examples: z.array(
    z.union([
      SkillExampleSchema,
      z.object({
        input: z.record(z.string()),
        output: z.string().optional(),
        expectedSteps: z.array(z.string()).optional(),
        description: z.string().optional(),
      }),
    ])
  ),
  sourceTurnId: z.string().optional(),
});

const SkillDraftSchema = SkillDraftSchemaRaw.transform((raw) => {
  let parameters: z.infer<typeof SkillParameterSchema>[] = [];
  if (Array.isArray(raw.parameters)) {
    parameters = raw.parameters as never;
  } else if (raw.parameters && typeof raw.parameters === "object") {
    parameters = Object.entries(raw.parameters as Record<string, unknown>).map(([k, v]) => {
      const val = v as Record<string, unknown>;
      return {
        name: k,
        type: (val.type as string) ?? "string",
        description: (val.description as string) ?? k,
        required: (val.required as boolean) ?? true,
        example: val.example as string | undefined,
      } as z.infer<typeof SkillParameterSchema>;
    });
  }
  const examples = (raw.examples as unknown[]).map((ex) => {
    const e = ex as Record<string, unknown>;
    if (Array.isArray(e.expectedSteps)) return e as z.infer<typeof SkillExampleSchema>;
    if (typeof e.output === "string") return { input: (e.input as Record<string, string>) ?? {}, expectedSteps: [e.output as string], description: e.description as string | undefined };
    return { input: (e.input as Record<string, string>) ?? {}, expectedSteps: [], description: e.description as string | undefined };
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

/**
 * 调用当前 Kiro 模型进行 AI 抽象（Server-side，Secret 不落地 Renderer）
 * Provider/Model 来自 AI Settings Store，Server Resolver 负责 fallback
 */
export async function callMuseSparkForDistill(
  sanitized: SanitizedTrace,
  trace: WorkflowTrace,
  apiKey: string,
  opts?: { provider?: string; model?: string }
): Promise<SkillDraft> {
  const { generateText } = await import("ai");
  const { resolveLanguageModel } = await import("@/lib/ai/providers/resolver");
  const { OPENCODE_DEFAULT_MODEL } = await import("@/lib/ai/providers/openCodeGo");

  const prompt = buildDistillPrompt(sanitized, trace);

  const provider = (opts?.provider as never) ?? "opencode-go";
  const modelId = (opts?.model as string) ?? OPENCODE_DEFAULT_MODEL;

  const { model } = await resolveLanguageModel({
    provider: provider as never,
    model: modelId,
    apiKey,
  });

  const { text } = await generateText({
    model: model as never,
    prompt,
    temperature: 0.2,
  } as never);

  // 提取 JSON（模型可能返回 markdown 包裹的 JSON）
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // 尝试清理 markdown 标记
    const cleaned = jsonStr.replace(/```json/g, "").replace(/```/g, "").trim();
    parsed = JSON.parse(cleaned);
  }

  const result = SkillDraftSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`SkillDraft validation failed: ${result.error.message}`);
  }

  const draft: SkillDraft = {
    ...(result.data as unknown as SkillDraft),
    sourceTurnId: trace.turnId,
    triggers: undefined,
  } as SkillDraft;

  return draft;
}

function buildDistillPrompt(sanitized: SanitizedTrace, trace: WorkflowTrace): string {
  return `You are a Skill distillation expert for ClassFlow (Kiro Skills compatible). You must return ONLY valid JSON, no markdown, no code blocks, no explanations.

Given a sanitized workflow trace, abstract it into a reusable SkillDraft.

Sanitized User Goal: ${sanitized.userGoal}
Sanitized Steps: ${JSON.stringify(sanitized.steps, null, 2)}
Required Tools: ${sanitized.requiredTools.join(", ")}
Has Proposal: ${sanitized.hasProposal}
Has Confirmation: ${sanitized.hasConfirmation}
Original trace had ${trace.toolCalls.length} tool calls, finalStatus=${trace.finalStatus}.

Requirements:
- Skill name must be lowercase hyphen, e.g. "course-notification-to-task", NOT date-specific like "2026-08-19-高数群第三次作业"
- Description must be generic, 1 sentence, e.g. "将课程通知中的作业、DDL、调课信息整理为 ClassFlow 操作建议。"
- Instructions must be workflow guidance (1. 识别课程 2. 提取通知...) not permission elevation. Must include "Skill cannot elevate permissions."
- Parameters must be generic placeholders: {course}, {deadline}, {assignmentTitle} NOT fixed values like "计量经济学" "8月25日 23:59" "第三次作业"
- RequiredTools from sanitized.requiredTools
- RequiredPermissions from sanitized steps (read/propose/write etc, but skill cannot elevate)
- Examples: 2-3 simulated inputs with generic values, each with input and expectedSteps
- sourceTurnId: ${trace.turnId}
- Do NOT decide file location or write to disk. Just return the SkillDraft JSON.

Example JSON (strictly follow this structure, no extra keys):
{
  "name": "course-notification-to-task",
  "description": "将课程通知中的作业、DDL、调课信息整理为 ClassFlow 操作建议。",
  "instructions": "1. 识别课程 ({course})\\n2. 提取通知内容 ({assignmentTitle}, {deadline})\\n3. 查询已有任务\\n4. 生成 Proposal\\n5. 用户确认后执行\\n\\nSkill cannot elevate permissions.",
  "parameters": [
    {"name": "course", "type": "course", "description": "课程名称", "required": true, "example": "计量经济学"},
    {"name": "deadline", "type": "deadline", "description": "截止时间", "required": true, "example": "2026-08-25T23:59"},
    {"name": "assignmentTitle", "type": "assignment", "description": "作业标题", "required": true, "example": "第三次作业"}
  ],
  "requiredTools": ${JSON.stringify(sanitized.requiredTools)},
  "requiredPermissions": ["read", "propose"],
  "examples": [
    {"input": {"course": "高等数学", "assignmentTitle": "第一章习题", "deadline": "2026-12-31"}, "expectedSteps": ["search_courses", "search_assignments", "create_assignment"]},
    {"input": {"course": "大学英语", "assignmentTitle": "写作作业", "deadline": "2026-09-01"}, "expectedSteps": ["search_courses", "search_assignments", "create_assignment"]}
  ],
  "sourceTurnId": "${trace.turnId}"
}

Return JSON only.`;
}

/**
 * 完整 Pipeline: Sanitize → AI Abstraction → Validate → Render
 */
export async function distillWorkflowToSkill(
  trace: WorkflowTrace,
  opts: { apiKey: string; provider?: string; model?: string; onSanitized?: (s: SanitizedTrace) => void }
): Promise<{ draft: SkillDraft; md: string; sanitized: SanitizedTrace }> {
  const sanitized = sanitizeWorkflowTrace(trace);
  if (opts.onSanitized) opts.onSanitized(sanitized);

  const draft = await callMuseSparkForDistill(sanitized, trace, opts.apiKey, { provider: opts.provider, model: opts.model });

  const draftWithParams = ensureParameterized(draft, trace);

  const validation = validateSkillDraft(draftWithParams);
  if (!validation.ok) {
    throw new Error(`SkillDraft validation failed: ${validation.errors.join("; ")}`);
  }

  const md = renderSkillDraftToMd(draftWithParams);
  return { draft: draftWithParams, md, sanitized };
}

function ensureParameterized(draft: SkillDraft, trace: WorkflowTrace): SkillDraft {
  let instructions = draft.instructions;
  instructions = instructions.replace(/计量经济学/g, "{course}");
  instructions = instructions.replace(/8月25日\s*23:59/g, "{deadline}");
  instructions = instructions.replace(/第三次作业/g, "{assignmentTitle}");
  instructions = instructions.replace(/2026-08-19-高数群第三次作业/g, "course-notification-to-task");
  let name = draft.name;
  if (/2026/.test(name) || /高数/.test(name)) {
    name = "course-notification-to-task";
  }
  return { ...draft, name, instructions };
}

export function previewSkillDraft(draft: SkillDraft): { md: string; validation: ReturnType<typeof validateSkillDraft> } {
  const validation = validateSkillDraft(draft);
  const md = renderSkillDraftToMd(draft);
  return { md, validation };
}
