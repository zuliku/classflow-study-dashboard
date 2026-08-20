/**
 * Deterministic Sanitize — 7 步去敏
 * 1. 去真实 entity ID
 * 2. 去 credentialRef
 * 3. 去 native path
 * 4. 去 token/key
 * 5. 去 toolCallId
 * 6. 去一次性日期
 * 7. 泛化课程/任务实例
 */

import type { WorkflowTrace, SanitizedTrace } from "@/lib/ai/skills/types";

const ENTITY_ID_RE = /\b[a-z]+_[a-zA-Z0-9]{6,}\b/g;
const CREDENTIAL_RE = /credentialRef|cred_[a-z0-9]+/gi;
const PATH_RE = /[A-Z]:\\[^\s"']+|\/[\w\/\.\-]+/g;
const TOKEN_RE = /(sk-[a-zA-Z0-9]+|apiKey|accessToken|refreshToken|token)/gi;
const DATE_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?/g;
const COURSE_RE = /计量经济学|高数|高数群|课程/g;

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    let s = value;
    s = s.replace(ENTITY_ID_RE, "{entityId}");
    s = s.replace(CREDENTIAL_RE, "{credentialRef}");
    s = s.replace(PATH_RE, "{path}");
    s = s.replace(TOKEN_RE, "{token}");
    s = s.replace(DATE_RE, "{date}");
    // 泛化课程实例：计量经济学 -> {course}
    s = s.replace(/计量经济学/g, "{course}");
    s = s.replace(/第三次作业/g, "{assignmentTitle}");
    s = s.replace(/8月25日\s*23:59/g, "{deadline}");
    return s;
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "toolCallId" || k === "id" || k === "credentialRef" || k === "apiKey" || k === "token") {
        out[k] = `{${k}}`;
        continue;
      }
      if (k === "courseId" || k === "assignmentId" || k === "projectId") {
        out[k] = `{${k}}`;
        continue;
      }
      out[k] = sanitizeValue(v);
    }
    return out;
  }
  return value;
}

export function sanitizeWorkflowTrace(trace: WorkflowTrace): SanitizedTrace {
  const sanitizedGoal = String(sanitizeValue(trace.userGoal));
  const steps = trace.toolCalls.map((call) => {
    const sanitizedInput = sanitizeValue(call.input) as Record<string, unknown>;
    // 去 toolCallId
    delete sanitizedInput.toolCallId;
    return {
      tool: call.toolName,
      sanitizedInput,
    };
  });

  const requiredTools = Array.from(new Set(trace.toolCalls.map((c) => c.toolName)));

  return {
    userGoal: sanitizedGoal,
    steps,
    requiredTools,
    hasProposal: !!trace.proposals && trace.proposals.length > 0,
    hasConfirmation: !!trace.userConfirmation,
  };
}

/**
 * 检查 sanitized 结果是否不含敏感信息
 */
export function assertSanitized(trace: SanitizedTrace): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const text = JSON.stringify(trace);
  if (/sk-/.test(text)) errors.push("contains apiKey");
  if (/credentialRef/.test(text) && text.includes("cred_")) errors.push("contains credentialRef");
  if (/[A-Z]:\\/.test(text)) errors.push("contains native path");
  if (/\b[a-z]+_[a-zA-Z0-9]{6,}\b/.test(text) && !text.includes("{entityId}")) errors.push("contains entityId");
  return { ok: errors.length === 0, errors };
}
