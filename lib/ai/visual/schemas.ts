/**
 * propose_visual_actions 输入 schema（Server 侧只发 schema；执行在 Browser 端）。
 * 模型必须已经 Read Courses / Assignments / Schedules / 临时变更，输入只接受真实 entity ID。
 */
import { z } from "zod";
import { VisualActionKind, VISUAL_ACTION_KINDS } from "@/lib/ai/visual/types";
import { MAX_CHANGE_SET_ACTIONS } from "@/lib/ai/transactions/types";

const MAX_ATTACHMENT_IDS = 10;
const MAX_EVIDENCE_CHARS = 160;
const MAX_DISPLAY_TITLE_CHARS = 80;
const MAX_DISPLAY_SUBTITLE_CHARS = 120;
const MAX_SUMMARY_CHARS = 60;

const changeInputSchema = z
  .object({
    tool: z.string().trim().min(1).max(40),
    input: z.record(z.string(), z.unknown()),
  })
  .strict();

const visualProposalActionInputSchema = z
  .object({
    /** 模型从截图读到、促成该 Action 的最短事实（不是整张 OCR transcript） */
    evidence: z.string().trim().min(1).max(MAX_EVIDENCE_CHARS),
    /** 必须属于 proposal.attachmentIds */
    attachmentId: z.string().trim().min(1).max(80),
    kind: z.enum(VISUAL_ACTION_KINDS as [VisualActionKind, ...VisualActionKind[]]),
    displayTitle: z.string().trim().min(1).max(MAX_DISPLAY_TITLE_CHARS),
    displaySubtitle: z.string().trim().max(MAX_DISPLAY_SUBTITLE_CHARS).optional(),
    change: changeInputSchema,
  })
  .strict();

export const proposeVisualActionsInputSchema = z
  .object({
    summary: z.string().trim().min(1).max(MAX_SUMMARY_CHARS),
    attachmentIds: z.array(z.string().trim().min(1).max(80)).min(1).max(MAX_ATTACHMENT_IDS),
    actions: z.array(visualProposalActionInputSchema).min(1).max(MAX_CHANGE_SET_ACTIONS),
  })
  .strict();

export type ProposeVisualActionsInput = z.infer<typeof proposeVisualActionsInputSchema>;
