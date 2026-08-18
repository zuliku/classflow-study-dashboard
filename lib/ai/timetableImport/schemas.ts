/**
 * propose_timetable_import 的模型输入 Schema。
 * 模型只输出"从图片读到的课表事实"；真实 ID / 具体时间 / 附件 ID 一律不得提供。
 */
import { z } from "zod";

export const timetableImportCourseDraftSchema = z
  .object({
    draftKey: z.string().min(1).max(40),
    name: z.string().min(1).max(120),
    code: z.string().max(40).optional(),
    teacher: z.string().max(60).optional(),
    classroom: z.string().max(80).optional(),
    credit: z.number().int().min(0).max(30).optional(),
    slots: z
      .array(
        z
          .object({
            dayOfWeek: z.number().int().min(1).max(7),
            periodStart: z.number().int().min(1).max(30).optional(),
            periodEnd: z.number().int().min(1).max(30).optional(),
            weekExpression: z.string().max(60).optional(),
            location: z.string().max(80).optional(),
            evidence: z.string().max(160).optional(),
          })
          .strict()
      )
      .min(1)
      .max(40),
  })
  .strict();

export const timetableImportPendingItemSchema = z
  .object({
    reason: z.enum(["ambiguous-cell", "missing-information"]),
    description: z.string().max(120),
    evidence: z.string().max(160).optional(),
  })
  .strict();

export const proposeTimetableImportInputSchema = z
  .object({
    summary: z.string().min(1).max(80),
    courses: z.array(timetableImportCourseDraftSchema).min(1).max(40),
    pendingItems: z.array(timetableImportPendingItemSchema).max(8).optional(),
  })
  .strict();

export type ProposeTimetableImportInput = z.infer<typeof proposeTimetableImportInputSchema>;
