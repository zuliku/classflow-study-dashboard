/**
 * Distill — thin wrapper for Renderer (deprecated, use Local API)
 * 为了向后兼容保留，但不再直接调用 AI Provider
 * 实际 Distill 应通过 window.classflowDesktop.api.request("/api/ai/skills/distill")
 */

import type { WorkflowTrace, SkillDraft, SanitizedTrace } from "@/lib/ai/skills/types";
import { sanitizeWorkflowTrace, assertSanitized } from "@/lib/ai/skills/sanitize";
import { renderSkillDraftToMd, validateSkillDraft } from "@/lib/ai/skills/draft";
import { buildDistillPrompt, parseAndNormalizeDraft } from "@/lib/ai/skills/distillCore";
import { MAX_WORKFLOW_TRACE_BYTES } from "@/lib/ai/skills/sanitize";

export async function distillWorkflowToSkill(
  trace: WorkflowTrace,
  opts: { apiKey: string; provider?: string; model?: string; onSanitized?: (s: SanitizedTrace) => void }
): Promise<{ draft: SkillDraft; md: string; sanitized: SanitizedTrace }> {
  const sanitized = sanitizeWorkflowTrace(trace);
  if (opts.onSanitized) opts.onSanitized(sanitized);

  const gate = assertSanitized(sanitized);
  if (!gate.ok) throw new Error(`Sanitize failed: ${gate.errors.join("; ")}`);

  const textLen = JSON.stringify(sanitized).length;
  if (textLen > MAX_WORKFLOW_TRACE_BYTES) throw new Error(`Trace too large: ${textLen}`);

  // Renderer 侧不再直接调 AI，提示使用 Local API
  throw new Error("distillWorkflowToSkill should be called via Local API /api/ai/skills/distill, not directly from Renderer");
}

export function previewSkillDraft(draft: SkillDraft): { md: string; validation: ReturnType<typeof validateSkillDraft> } {
  const validation = validateSkillDraft(draft);
  const md = renderSkillDraftToMd(draft);
  return { md, validation };
}

// 保留旧的 callMuseSparkForDistill 作为兼容，但标记为 deprecated
/** @deprecated Use Local API */
export async function callMuseSparkForDistill(): Promise<never> {
  throw new Error("Deprecated: use Local API");
}
