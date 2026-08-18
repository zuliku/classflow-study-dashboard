import { describe, it, expect } from "vitest";
import { KIRO_SYSTEM_PROMPT } from "@/lib/ai/prompts/kiroSystemPrompt";
import { proposeTimetableImportInputSchema } from "@/lib/ai/timetableImport/schemas";

describe("Kiro System Prompt — Visual 路由 contract", () => {
  it("包含 propose_timetable_import 路由（A 路径：完整课表初始化）", () => {
    expect(KIRO_SYSTEM_PROMPT).toContain("propose_timetable_import");
    expect(KIRO_SYSTEM_PROMPT).toContain("完整新学期课表初始化");
    expect(KIRO_SYSTEM_PROMPT).toContain("帮我录入全部课程");
  });

  it("完整课表初始化不要求逐门 search_courses（A 路径）", () => {
    // A 路径描述不应要求先查找课程
    const aSection = KIRO_SYSTEM_PROMPT.split("## Visual 截图路由")[1]?.split("##")[0] ?? "";
    expect(aSection).toContain("propose_timetable_import");
    // B 路径（已有实体修改）仍要求 resolve real IDs
    expect(KIRO_SYSTEM_PROMPT).toContain("search_courses");
    expect(KIRO_SYSTEM_PROMPT).toContain("已有实体修改");
    // A 路径明确说明不要求逐门查询
    expect(KIRO_SYSTEM_PROMPT).toContain("不要求逐门 search_courses");
  });

  it("已有实体图片修改仍要求 resolve real IDs（B 路径）", () => {
    expect(KIRO_SYSTEM_PROMPT).toContain("使用 Read Tools 解析 ClassFlow 真实数据");
    expect(KIRO_SYSTEM_PROMPT).toContain("没有匹配就询问是否需要创建课程");
  });

  it("只分析不会产生 Proposal（C 路径）", () => {
    expect(KIRO_SYSTEM_PROMPT).toContain("只分析课表特点");
    expect(KIRO_SYSTEM_PROMPT).toContain("不产生任何 Proposal");
  });

  it("禁止通过连续 create_course/create_schedule 绕过 Proposal", () => {
    expect(KIRO_SYSTEM_PROMPT).toContain("create_course");
    expect(KIRO_SYSTEM_PROMPT).toContain("不允许通过连续调用");
  });
});

describe("propose_timetable_import Zod schema contract", () => {
  const valid = {
    summary: "课表",
    courses: [
      {
        draftKey: "c1",
        name: "高等数学",
        slots: [{ dayOfWeek: 1, periodStart: 1, periodEnd: 2, weekExpression: "1-5,7-17" }],
      },
    ],
  };

  it("合法输入通过", () => {
    expect(proposeTimetableImportInputSchema.safeParse(valid).success).toBe(true);
  });

  it("模型不得提供真实 ID / 具体时间（strict schema 拒绝额外字段）", () => {
    expect(
      proposeTimetableImportInputSchema.safeParse({
        ...valid,
        courses: [{ ...valid.courses[0], id: "c_real_1", scheduleId: "s_real_1" }],
      }).success
    ).toBe(false);
    expect(
      proposeTimetableImportInputSchema.safeParse({
        ...valid,
        courses: [{ ...valid.courses[0], slots: [{ ...valid.courses[0].slots[0], startTime: "08:00", endTime: "09:40" }] }],
      }).success
    ).toBe(false);
  });

  it("周次表达式允许复杂形式（原样传入）", () => {
    for (const w of ["1-5,7-17", "1-4,6-7,9-17", "3-7,9", "1,3,5,7", "单周", "双周", "1-16单周"]) {
      const r = proposeTimetableImportInputSchema.safeParse({
        ...valid,
        courses: [{ ...valid.courses[0], slots: [{ ...valid.courses[0].slots[0], weekExpression: w }] }],
      });
      expect(r.success).toBe(true);
    }
  });

  it("dayOfWeek 越界拒绝", () => {
    expect(
      proposeTimetableImportInputSchema.safeParse({
        ...valid,
        courses: [{ ...valid.courses[0], slots: [{ ...valid.courses[0].slots[0], dayOfWeek: 8 }] }],
      }).success
    ).toBe(false);
  });
});
