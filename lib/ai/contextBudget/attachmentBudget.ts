/**
 * Attachment Budget（Task 7）：
 *  - 每份文件先给基础配额，剩余预算按需比例分配（不让第一份文件独占）
 *  - 文件头（名称/来源/课程/类型/是否截断）始终保留
 *  - 区分 extractorTruncated（解析阶段截断）与 budgetTruncated（预算进一步缩短）
 */

import { estimateTokens, budgetCharsForTokens } from "@/lib/ai/contextBudget/estimate";

export interface BudgetableAttachment {
  name: string;
  type: string;
  text: string;
  source?: string;
  truncated?: boolean;
  budgetTruncated?: boolean;
  courseName?: string;
}

export interface AttachmentBudgetResult {
  attachments: BudgetableAttachment[];
  truncated: number;
}

/** 为多份文件公平分配字符预算；总量超出时按需截断正文 */
export function budgetAttachments(
  attachments: BudgetableAttachment[],
  budgetTokens: number
): AttachmentBudgetResult {
  if (attachments.length === 0) return { attachments: [], truncated: 0 };
  const budgetChars = budgetCharsForTokens(budgetTokens);

  const sizes = attachments.map((a) => a.text.length);
  const total = sizes.reduce((s, n) => s + n, 0);
  if (total <= budgetChars) {
    return { attachments, truncated: 0 };
  }

  const n = attachments.length;
  // 基础配额：每份先保证 min(自身大小, 预算 40% 均分)
  const baseEach = Math.floor((budgetChars * 0.4) / Math.max(n, 1));
  const base = sizes.map((s) => Math.min(s, baseEach));
  const remaining = budgetChars - base.reduce((s, n) => s + n, 0);
  // 剩余按需比例分配
  const needs = sizes.map((s, i) => Math.max(s - base[i], 0));
  const needTotal = needs.reduce((s, n) => s + n, 0) || 1;
  const extra = needs.map((need) => Math.floor(remaining * (need / needTotal)));

  const out: BudgetableAttachment[] = [];
  let truncated = 0;
  for (let i = 0; i < n; i++) {
    const a = attachments[i];
    const allow = base[i] + extra[i];
    if (a.text.length <= allow) {
      out.push({ ...a });
    } else {
      truncated++;
      out.push({
        ...a,
        text: a.text.slice(0, allow),
        budgetTruncated: true,
      });
    }
  }
  return { attachments: out, truncated };
}

/** 附件上下文整体估算（用于触发 compaction 阈值等） */
export function estimateAttachmentsTokens(attachments: BudgetableAttachment[]): number {
  return attachments.reduce(
    (s, a) => s + estimateTokens(a.text) + estimateTokens(a.name + (a.courseName ?? "")),
    0
  );
}
