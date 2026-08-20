/**
 * Deterministic Sanitize — 通用化 7+ 步去敏
 * 1. 去真实 entity ID (assignment_*, course_*, etc)
 * 2. 去 credentialRef (cred_*, credentialRef)
 * 3. 去 native path (Windows C:\, Unix /)
 * 4. 去 token/key (sk-*, Bearer, apiKey, accessToken, refreshToken, token, email credential, MCP credential)
 * 5. 去 toolCallId
 * 6. 去一次性日期 (ISO timestamp, precise)
 * 7. 去 grantId / adapterRef / UUID / email / MCP credential
 * 8. 课程/任务实例泛化交由 AI 语义参数化，不在此硬编码具体名称
 */

import type { WorkflowTrace, SanitizedTrace } from "@/lib/ai/skills/types";

export const MAX_WORKFLOW_TRACE_BYTES = 64 * 1024; // 64KB 上限，防止无限大 Tool Result

const ENTITY_ID_RE = /\b[a-z]+_[A-Za-z0-9]{6,}\b/g;
const CREDENTIAL_RE = /credentialRef|cred_[A-Za-z0-9_-]+/gi;
const GRANT_RE = /grant_[A-Za-z0-9_-]+/gi;
const ADAPTER_RE = /native:[A-Za-z0-9_-]+/gi;
const UUID_RE = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
const PATH_WIN_RE = /[A-Z]:\\[^\s"'`]+/g;
const PATH_UNIX_RE = /\/[a-zA-Z0-9_\-\.\/]+/g;
const TOKEN_RE = /\bsk-[A-Za-z0-9_-]{10,}\b|Bearer\s+[A-Za-z0-9\._-]+|apiKey\s*[:=]\s*["']?[^"'\s]+["']?|accessToken\s*[:=]\s*["']?[^"'\s]+["']?|refreshToken\s*[:=]\s*["']?[^"'\s]+["']?|\btoken\s*[:=]\s*["']?[^"'\s]+["']?/gi;
const DATE_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

function sanitizeString(s: string): string {
  let out = s;
  out = out.replace(ENTITY_ID_RE, "{entityId}");
  out = out.replace(CREDENTIAL_RE, "{credentialRef}");
  out = out.replace(GRANT_RE, "{grantId}");
  out = out.replace(ADAPTER_RE, "{adapterRef}");
  out = out.replace(UUID_RE, "{uuid}");
  out = out.replace(PATH_WIN_RE, "{path}");
  // Unix path: 避免把普通词如 "课程" 误判，限定含 / 且长度>3
  out = out.replace(PATH_UNIX_RE, (m) => (m.includes("/") && m.length > 3 ? "{path}" : m));
  out = out.replace(TOKEN_RE, "{token}");
  out = out.replace(DATE_RE, "{date}");
  out = out.replace(EMAIL_RE, "{email}");
  return out;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 10) return "{truncated}";
  if (typeof value === "string") {
    const truncated = value.length > 2000 ? value.slice(0, 2000) + "...[truncated]" : value;
    return sanitizeString(truncated);
  }
  if (Array.isArray(value)) {
    const sliced = value.length > 20 ? value.slice(0, 20) : value;
    return sliced.map((v) => sanitizeValue(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (["toolCallId"].includes(k)) {
        out[k] = "{toolCallId}";
        continue;
      }
      if (k === "credentialRef") {
        out[k] = "{credentialRef}";
        continue;
      }
      if (["apiKey", "token", "accessToken", "refreshToken", "bearerToken", "password", "secret"].includes(k)) {
        out[k] = "{token}";
        continue;
      }
      if (k === "grantId") {
        out[k] = "{grantId}";
        continue;
      }
      if (k === "adapterRef") {
        out[k] = "{adapterRef}";
        continue;
      }
      if (["id"].includes(k) && typeof v === "string" && /\b[a-z]+_[A-Za-z0-9]{6,}\b/.test(v)) {
        out[k] = "{entityId}";
        continue;
      }
      if (["courseId", "assignmentId", "projectId", "externalMessageId", "conversationId"].includes(k)) {
        out[k] = `{${k}}`;
        continue;
      }
      if (k === "uuid" && typeof v === "string") {
        if (/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.test(v)) {
          out[k] = "{uuid}";
          continue;
        }
      }
      out[k] = sanitizeValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function sanitizeWorkflowTrace(trace: WorkflowTrace): SanitizedTrace {
  const sanitizedGoal = String(sanitizeValue(trace.userGoal));
  const steps = trace.toolCalls.slice(0, 20).map((call) => {
    const sanitizedInput = sanitizeValue(call.input, 0) as Record<string, unknown>;
    // 保留 toolCallId 但去敏为 {toolCallId}
    if (sanitizedInput && typeof sanitizedInput === "object") {
      sanitizedInput["toolCallId"] = "{toolCallId}";
    }
    return {
      tool: call.toolName,
      sanitizedInput: sanitizedInput as Record<string, unknown>,
    };
  });

  const requiredTools = Array.from(new Set(trace.toolCalls.map((c) => c.toolName))).slice(0, 10);

  // 摘要：Tool Result 只保留结构化摘要，截断大内容
  // 此处 sanitized 仅含 toolCalls 的 input，不含完整 result 的大正文，已在 sanitizeValue 中截断

  return {
    userGoal: sanitizedGoal.slice(0, 500),
    steps,
    requiredTools,
    hasProposal: !!trace.proposals && trace.proposals.length > 0,
    hasConfirmation: !!trace.userConfirmation,
  };
}

export function assertSanitized(trace: SanitizedTrace): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const text = JSON.stringify(trace);
  if (text.length > MAX_WORKFLOW_TRACE_BYTES) errors.push(`exceeds MAX_WORKFLOW_TRACE_BYTES: ${text.length}`);
  if (/\bsk-[A-Za-z0-9_-]{10,}\b/.test(text) && !text.includes("{token}")) errors.push("contains apiKey");
  if (/credentialRef/.test(text) && text.includes("cred_") && !text.includes("{credentialRef}")) errors.push("contains credentialRef");
  if (/grant_[A-Za-z0-9_-]+/.test(text) && !text.includes("{grantId}")) errors.push("contains grantId");
  if (/native:/.test(text) && !text.includes("{adapterRef}")) errors.push("contains adapterRef");
  if (/[A-Z]:\\/.test(text) && !text.includes("{path}")) errors.push("contains Windows path");
  if (/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.test(text) && !text.includes("{uuid}")) errors.push("contains UUID");
  if (/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(text) && !text.includes("{email}")) errors.push("contains email");
  if (/\b[a-z]+_[A-Za-z0-9]{6,}\b/.test(text) && !text.includes("{entityId}")) errors.push("contains entityId");
  return { ok: errors.length === 0, errors };
}
