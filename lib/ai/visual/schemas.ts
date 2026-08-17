/**
 * propose_visual_actions 输入 schema（Server 侧只发 schema；执行在 Browser 端）。
 * 模型必须已经 Read Courses / Assignments / Schedules / 临时变更，输入只接受真实 entity ID。
 * V1.1 Trust & UX Hardening：模型只提供「从截图理解到的事实」+「结构化业务操作」；
 * attachment IDs / kind / display 字段全部是 Runtime / Preflight 拥有的，模型不得提供。
 * V1.2 Partial Proposals：actions 可空（pending-only），但 actions + pendingItems 不能同时为空。
 */
import { z } from "zod";
import { MAX_CHANGE_SET_ACTIONS } from "@/lib/ai/transactions/types";
import { VISUAL_PENDING_REASONS, VisualPendingReason } from "@/lib/ai/visual/types";

const MAX_EVIDENCE_CHARS = 160;
const MAX_SUMMARY_CHARS = 60;
const MAX_DESCRIPTION_CHARS = 120;
const MAX_PENDING_ITEMS = 8;

const changeInputSchema = z
  .object({
    tool: z.string().trim().min(1).max(40),
    input: z.record(z.string(), z.unknown()),
  })
  .strict();

const visualProposalActionInputSchema = z
  .object({
    /** 模型从截图读到、促成该 Action 的最短事实（Vision extraction；不是整张 OCR transcript） */
    evidence: z.string().trim().min(1).max(MAX_EVIDENCE_CHARS),
    change: changeInputSchema,
  })
  .strict();

/** V1.2：Pending Item 输入（严格无执行能力：无 change/tool/input 字段） */
const visualPendingItemInputSchema = z
  .object({
    reason: z.enum(VISUAL_PENDING_REASONS as [VisualPendingReason, ...VisualPendingReason[]]),
    evidence: z.string().trim().min(1).max(MAX_EVIDENCE_CHARS),
    /** 为什么现在不能安全执行（如「无法唯一确定对应课程」） */
    description: z.string().trim().min(1).max(MAX_DESCRIPTION_CHARS),
  })
  .strict();

export const proposeVisualActionsInputSchema = z
  .object({
    /** conversation summary（非执行事实）；每条 Action Row 的展示由 Preflight Facts 决定 */
    summary: z.string().trim().min(1).max(MAX_SUMMARY_CHARS),
    /** V1.2：允许空数组（截图只有模糊内容时）；整体仍与 pendingItems 一起进入 refinement */
    actions: z.array(visualProposalActionInputSchema).max(MAX_CHANGE_SET_ACTIONS),
    pendingItems: z.array(visualPendingItemInputSchema).max(MAX_PENDING_ITEMS).optional(),
  })
  .strict()
  .refine((v) => v.actions.length + (v.pendingItems?.length ?? 0) >= 1, {
    message: "截图方案不能为空：至少包含 1 项可执行操作或待确认事项。",
    path: ["actions"],
  });

export type ProposeVisualActionsInput = z.infer<typeof proposeVisualActionsInputSchema>;
