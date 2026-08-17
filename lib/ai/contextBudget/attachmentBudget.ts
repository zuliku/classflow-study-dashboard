/**
 * Attachment Budget（Task 7 + Task 11 page-aware）：
 *  - 每份文件先给基础配额，剩余预算按需比例分配（不让第一份文件独占）
 *  - 文件头（名称/来源/课程/类型/是否截断）始终保留
 *  - 区分 extractorTruncated（解析阶段截断）与 budgetTruncated（预算进一步缩短）
 *  - PDF（pages.length > 0）：按页保留，最后一页允许部分保留并标记 budgetTruncated；
 *    text 由保留下来的 pages 重建，避免 text 与 pages 错位
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
  /** PDF 分页（page-aware budget 与 Citation 的基础） */
  pages?: { page: number; text: string }[];
}

export interface AttachmentBudgetResult {
  attachments: BudgetableAttachment[];
  truncated: number;
}

/** PDF 页级截断：逐页保留直到预算耗尽；最后一页部分保留；text 由保留页重建 */
function budgetByPages(a: BudgetableAttachment, allowChars: number): BudgetableAttachment {
  const out: { page: number; text: string }[] = [];
  let used = 0;
  let budgetTruncated = false;
  for (const p of a.pages ?? []) {
    if (p.text.length === 0) continue;
    if (used + p.text.length <= allowChars) {
      out.push(p);
      used += p.text.length;
    } else if (used < allowChars) {
      // 最后一页只留剩余预算（不整页丢弃）
      out.push({ page: p.page, text: p.text.slice(0, allowChars - used) });
      used = allowChars;
      budgetTruncated = true;
    } else {
      budgetTruncated = true;
    }
  }
  return {
    ...a,
    pages: out,
    text: out.map((p) => p.text).join("\n\n"),
    budgetTruncated: a.budgetTruncated || budgetTruncated,
  };
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
    } else if (a.pages && a.pages.length > 0) {
      // PDF：页级截断（保留 page boundary + 页码 metadata）
      truncated++;
      out.push(budgetByPages(a, allow));
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
