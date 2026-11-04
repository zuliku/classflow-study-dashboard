/**
 * Kiro Agent Ask User — 结构化澄清（ChatGPT / Claude 式 choices）。
 *
 * 纯控制信号：只生成一个可回答的问题卡；不写 Store、不执行工具、不提升权限。
 * 用户选择后作为下一条普通 user message 发送，由正常的 Agent Turn 继续处理。
 */

import { z } from "zod";

export const KIRO_ASK_USER_TOOL_NAME = "ask_user";
export const MAX_ASK_QUESTION_CHARS = 300;
export const MAX_ASK_HEADER_CHARS = 40;
export const MAX_ASK_OPTIONS = 5;
export const MAX_ASK_OPTION_LABEL_CHARS = 80;
export const MAX_ASK_OPTION_DESCRIPTION_CHARS = 160;

export const kiroAskUserInputSchema = z.object({
  question: z.string().trim().min(1).max(MAX_ASK_QUESTION_CHARS),
  header: z.string().trim().max(MAX_ASK_HEADER_CHARS).optional(),
  options: z
    .array(
      z.object({
        id: z.string().trim().max(40).optional(),
        label: z.string().trim().min(1).max(MAX_ASK_OPTION_LABEL_CHARS),
        description: z.string().trim().max(MAX_ASK_OPTION_DESCRIPTION_CHARS).optional(),
      })
    )
    .min(2)
    .max(MAX_ASK_OPTIONS),
  allowFreeform: z.boolean().optional(),
});

export interface KiroUserQuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface KiroUserQuestion {
  question: string;
  header?: string;
  options: KiroUserQuestionOption[];
  allowFreeform?: boolean;
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

/** 归一化模型输入 / Server 输出；不足 2 个有效选项 → null（不渲染不可回答的问题） */
export function normalizeUserQuestion(value: unknown): KiroUserQuestion | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as {
    question?: unknown;
    header?: unknown;
    options?: unknown;
    allowFreeform?: unknown;
  };
  const question = cleanText(raw.question, MAX_ASK_QUESTION_CHARS);
  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  const options: KiroUserQuestionOption[] = [];
  const usedIds = new Set<string>();
  const usedLabels = new Set<string>();

  for (let i = 0; i < rawOptions.length && options.length < MAX_ASK_OPTIONS; i++) {
    const item = rawOptions[i];
    const rawLabel =
      typeof item === "string"
        ? item
        : (item as { label?: unknown } | null)?.label;
    const label = cleanText(rawLabel, MAX_ASK_OPTION_LABEL_CHARS);
    if (!label) continue;
    const labelKey = label.toLowerCase();
    if (usedLabels.has(labelKey)) continue;
    usedLabels.add(labelKey);
    const requestedId =
      item && typeof item === "object"
        ? cleanText((item as { id?: unknown }).id, 40)
        : "";
    let id = requestedId || `option-${options.length + 1}`;
    if (usedIds.has(id)) id = `option-${options.length + 1}`;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `option-${options.length + 1}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    const description = cleanText(
      item && typeof item === "object" ? (item as { description?: unknown }).description : "",
      MAX_ASK_OPTION_DESCRIPTION_CHARS
    );
    options.push({
      id,
      label,
      ...(description ? { description } : {}),
    });
  }

  if (!question || options.length < 2) return null;
  const header = cleanText(raw.header, MAX_ASK_HEADER_CHARS);
  return {
    question,
    ...(header ? { header } : {}),
    options,
    ...(raw.allowFreeform === true ? { allowFreeform: true } : {}),
  };
}

/** 把用户选择 / 自由输入转换为下一条 user message（不自动执行任何写操作） */
export function buildAskUserAnswerText(
  question: KiroUserQuestion,
  optionId?: string,
  freeform?: string
): string | null {
  const custom = (freeform ?? "").trim();
  if (custom) return custom;
  const option = question.options.find((o) => o.id === optionId);
  return option ? `我选择：${option.label}` : null;
}
