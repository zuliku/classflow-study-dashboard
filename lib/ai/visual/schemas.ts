/**
 * propose_visual_actions 输入 schema（Server 侧只发 schema；执行在 Browser 端）。
 * 模型必须已经 Read Courses / Assignments / Schedules / 临时变更，输入只接受真实 entity ID。
 * V1.1 Trust & UX Hardening：模型只提供「从截图理解到的事实」+「结构化业务操作」；
 * attachment IDs / kind / display 字段全部是 Runtime / Preflight 拥有的，模型不得提供。
 */
import { z } from "zod";
import { MAX_CHANGE_SET_ACTIONS } from "@/lib/ai/transactions/types";

const MAX_EVIDENCE_CHARS = 160;
const MAX_SUMMARY_CHARS = 60;

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

export const proposeVisualActionsInputSchema = z
  .object({
    /** conversation summary（非执行事实）；每条 Action Row 的展示由 Preflight Facts 决定 */
    summary: z.string().trim().min(1).max(MAX_SUMMARY_CHARS),
    actions: z.array(visualProposalActionInputSchema).min(1).max(MAX_CHANGE_SET_ACTIONS),
  })
  .strict();

export type ProposeVisualActionsInput = z.infer<typeof proposeVisualActionsInputSchema>;
