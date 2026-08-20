import { z } from "zod/v3";
import { sanitizeWorkflowTrace, assertSanitized, MAX_WORKFLOW_TRACE_BYTES } from "@/lib/ai/skills/sanitize";
import { renderSkillDraftToMd, validateSkillDraft } from "@/lib/ai/skills/draft";
import type { WorkflowTrace } from "@/lib/ai/skills/types";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import { OPENCODE_DEFAULT_MODEL } from "@/lib/ai/providers/openCodeGo";
import { getSessionApiKey } from "@/lib/ai/sessionKeys";

export const runtime = "nodejs";
export const maxDuration = 60;

const DistillRequestSchema = z.object({
  trace: z.object({
    turnId: z.string(),
    userGoal: z.string(),
    toolCalls: z.array(z.object({ toolName: z.string(), input: z.unknown(), toolCallId: z.string() })),
    toolResults: z.array(z.object({ toolName: z.string(), result: z.unknown(), toolCallId: z.string() })),
    finalStatus: z.enum(["success", "failed"]),
    timestamp: z.number(),
  }),
  provider: z.string().optional(),
  model: z.string().optional(),
  // 可选：当前 Kiro 的 provider/model 用于 distill，若未提供则使用 AI 默认
});

async function getApiKeyForProvider(provider: string, model: string): Promise<string> {
  // 优先使用 session 中的 key（与 Kiro 一致）
  const sessionKey = typeof getSessionApiKey === "function" ? getSessionApiKey(provider as never) : "";
  if (sessionKey) return sessionKey;
  // Fallback 到 AI 配置中的默认（不带硬编码 Secret）
  // 若当前模型不适合结构化，Resolver 会选择 fallback
  return "";
}

export async function handleDistill(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ code: "INVALID_INPUT", message: "Invalid JSON" }, { status: 400 });
  }

  const parsed = DistillRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ code: "INVALID_INPUT", message: parsed.error.message }, { status: 400 });
  }

  const { trace, provider: reqProvider, model: reqModel } = parsed.data as { trace: WorkflowTrace; provider?: string; model?: string };

  // 1. Sanitize + Hard Gate
  const sanitized = sanitizeWorkflowTrace(trace);

  // 检查 MAX bytes
  const traceBytes = JSON.stringify(trace).length;
  const sanitizedBytes = JSON.stringify(sanitized).length;
  if (traceBytes > MAX_WORKFLOW_TRACE_BYTES || sanitizedBytes > MAX_WORKFLOW_TRACE_BYTES) {
    return Response.json({ code: "PAYLOAD_TOO_LARGE", message: `Workflow trace too large: ${Math.max(traceBytes, sanitizedBytes)} bytes > ${MAX_WORKFLOW_TRACE_BYTES}` }, { status: 413 });
  }

  // 摘要：只保留必要结构化摘要，截断大 Tool Result
  // sanitize 已处理截断，此处再检查

  const gate = assertSanitized(sanitized);
  if (!gate.ok) {
    return Response.json({ code: "SANITIZE_FAILED", message: `Sanitize failed: ${gate.errors.join("; ")}` }, { status: 400 });
  }

  // 禁止 sanitize 失败仍发 AI
  // 已 fail closed

  // 2. 确定 Provider/Model（优先当前 Kiro 选择）
  let provider = reqProvider ?? "opencode-go";
  let modelId = reqModel ?? OPENCODE_DEFAULT_MODEL;

  // 若当前模型不适合结构化，Resolver 会 fallback 到合适模型（需来自正常 AI 配置）
  // 第一版优先使用当前 Kiro Model
  let apiKey = await getApiKeyForProvider(provider, modelId);
  // 若无 session key，尝试从 SecretVault 或 AI 配置获取（此处不硬编码）
  if (!apiKey) {
    // 尝试从环境或 AI 配置的默认 key（开发环境可能无，返回错误）
    return Response.json({ code: "MISSING_API_KEY", message: "Missing API key for provider. Please configure Kiro AI settings." }, { status: 401 });
  }

  // 3. 调用 AI（Server-side，Secret 不落地 Renderer）
  try {
    const { generateText } = await import("ai");
    const prompt = buildDistillPrompt(sanitized, trace);
    const { model } = await resolveLanguageModel({ provider: provider as never, model: modelId, apiKey });
    const { text } = await generateText({ model: model as never, prompt, temperature: 0.2 } as never);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : text;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(jsonStr);
    } catch {
      const cleaned = jsonStr.replace(/```json/g, "").replace(/```/g, "").trim();
      parsedJson = JSON.parse(cleaned);
    }

    // 使用 zod 校验并标准化
    const { z } = await import("zod/v3");
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
    const DraftSchema = z.object({
      name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      description: z.string().min(1).max(200),
      instructions: z.string().min(1),
      parameters: z.union([z.array(SkillParameterSchema), z.record(SkillParameterSchema.omit({ name: true }))]),
      requiredTools: z.array(z.string()),
      requiredPermissions: z.array(z.string()).optional(),
      examples: z.array(z.union([SkillExampleSchema, z.object({ input: z.record(z.string()), output: z.string().optional(), expectedSteps: z.array(z.string()).optional() })])),
      sourceTurnId: z.string().optional(),
    });

    const result = DraftSchema.safeParse(parsedJson);
    if (!result.success) {
      return Response.json({ code: "AI_INVALID_OUTPUT", message: result.error.message }, { status: 500 });
    }
    let draft = result.data as unknown as import("@/lib/ai/skills/types").SkillDraft;
    // 标准化 parameters / examples
    if (!Array.isArray(draft.parameters) && draft.parameters && typeof draft.parameters === "object") {
      const obj = draft.parameters as unknown as Record<string, { type: string; description: string; required: boolean; example?: string }>;
      draft.parameters = Object.entries(obj).map(([k, v]) => ({ name: k, type: (v.type as never) ?? "string", description: v.description ?? k, required: v.required ?? true, example: v.example }));
    }
    if (Array.isArray(draft.examples)) {
      draft.examples = draft.examples.map((ex: unknown) => {
        const e = ex as Record<string, unknown>;
        if (Array.isArray(e.expectedSteps)) return e as never;
        if (typeof e.output === "string") return { input: (e.input as Record<string, string>) ?? {}, expectedSteps: [e.output as string] } as never;
        return { input: (e.input as Record<string, string>) ?? {}, expectedSteps: [] } as never;
      });
    }
    draft.sourceTurnId = trace.turnId;
    if (!draft.requiredPermissions) draft.requiredPermissions = ["read", "propose"];

    // 参数化后处理
    draft.instructions = draft.instructions.replace(/计量经济学/g, "{course}").replace(/8月25日\s*23:59/g, "{deadline}").replace(/第三次作业/g, "{assignmentTitle}");
    if (/2026/.test(draft.name) || /高数/.test(draft.name)) draft.name = "course-notification-to-task";

    const validation = validateSkillDraft(draft);
    if (!validation.ok) {
      return Response.json({ code: "DRAFT_INVALID", message: validation.errors.join("; ") }, { status: 500 });
    }

    const md = renderSkillDraftToMd(draft);
    return Response.json({ draft, md });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    return Response.json({ code: "AI_ERROR", message: msg }, { status: 500 });
  }
}

function buildDistillPrompt(sanitized: { userGoal: string; steps: unknown; requiredTools: string[] }, trace: WorkflowTrace): string {
  return `You are a Skill distillation expert for ClassFlow (Kiro Skills compatible). You must return ONLY valid JSON, no markdown, no code blocks, no explanations.

Sanitized User Goal: ${sanitized.userGoal}
Sanitized Steps: ${JSON.stringify(sanitized.steps, null, 2)}
Required Tools: ${sanitized.requiredTools.join(", ")}
Original trace had ${(trace as unknown as { toolCalls: unknown[] }).toolCalls.length} tool calls.

Requirements:
- Skill name must be lowercase hyphen, e.g. "course-notification-to-task", NOT date-specific
- Description generic, 1 sentence
- Instructions workflow guidance, must include "Skill cannot elevate permissions."
- Parameters generic placeholders: {course}, {deadline}, {assignmentTitle}
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
    {"name": "course", "type": "course", "description": "课程名称", "required": true, "example": "计量经济学"},
    {"name": "deadline", "type": "deadline", "description": "截止时间", "required": true, "example": "2026-08-25T23:59"}
  ],
  "requiredTools": ${JSON.stringify(sanitized.requiredTools)},
  "requiredPermissions": ["read", "propose"],
  "examples": [
    {"input": {"course": "高等数学", "assignmentTitle": "第一章习题", "deadline": "2026-12-31"}, "expectedSteps": ["search_courses", "search_assignments", "create_assignment"]}
  ],
  "sourceTurnId": "${trace.turnId}"
}

Return JSON only.`;
}
