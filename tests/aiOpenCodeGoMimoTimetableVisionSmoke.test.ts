import { describe, it, expect } from "vitest";

/**
 * MiMo V2.5 Timetable Vision Live Smoke（gated）。
 *
 * Gate：OPENCODE_GO_TEST_API_KEY + 真实课表 fixture 同时存在才执行。
 * 走生产链路：provider resolver → @ai-sdk → 真实 KIRO_SYSTEM_PROMPT +
 * 生产 propose_timetable_import tool schema（模型真实调用工具，捕获 tool arguments）。
 */
const key = process.env.OPENCODE_GO_TEST_API_KEY;
const fixturePath = "tests/fixtures/timetable/sanitized-real-timetable.jpg";
const { existsSync } = require("node:fs") as typeof import("node:fs");
const hasFixture = existsSync(fixturePath);

const gated = hasFixture && !!key ? describe : describe.skip;

gated("MiMo V2.5 Timetable Vision Smoke（真实截图 + 生产 schema）", () => {
  it("Layer 0：连通性（无图片无 tools）", async () => {
    const { generateText } = await import("ai");
    const { resolveLanguageModel } = await import("@/lib/ai/providers/resolver");
    const resolved = await resolveLanguageModel({ provider: "opencode-go", model: "mimo-v2.5", apiKey: key! });
    const t0 = Date.now();
    const r = await generateText({ model: resolved.model, prompt: "只回复两个字母：OK", maxOutputTokens: 200 });
    console.log(`[LIVE:ping] ms=${Date.now() - t0} text=${JSON.stringify((r.text ?? "").slice(0, 20))}`);
    // reasoning 模型偶尔 content 为空：连通性验证只看请求成功（不抛错）
    expect(true).toBe(true);
  }, 60000);

  it("Layer A：模型真实调用 propose_timetable_import，tool arguments 通过生产 zod schema", async () => {
    const { generateText, tool } = await import("ai");
    const { resolveLanguageModel } = await import("@/lib/ai/providers/resolver");
    const { KIRO_SYSTEM_PROMPT } = await import("@/lib/ai/prompts/kiroSystemPrompt");
    const { proposeTimetableImportInputSchema } = await import("@/lib/ai/timetableImport/schemas");
    const { readFileSync } = await import("node:fs");

    const resolved = await resolveLanguageModel({
      provider: "opencode-go",
      model: "mimo-v2.5",
      apiKey: key!,
    });
    const image = readFileSync(fixturePath);

    const { toolCalls } = await generateText({
      model: resolved.model,
      system: `${KIRO_SYSTEM_PROMPT}\n\n用户上传了完整新学期课表截图，要求把整张课表导入 ClassFlow。请调用 propose_timetable_import 输出课表草稿。`,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "把这学期课表导入 ClassFlow" },
            { type: "image", image: new Uint8Array(image), mediaType: "image/jpeg" },
          ],
        },
      ],
      maxOutputTokens: 12000,
      tools: {
        propose_timetable_import: tool({
          description:
            "根据完整新学期课程表截图生成课表导入草稿（课程/节次/周次表达式；绝不输出具体时间与真实 ID）。",
          inputSchema: proposeTimetableImportInputSchema,
        }),
      },
    });

    expect(toolCalls.length).toBeGreaterThan(0);
    const call = toolCalls.find((t) => t.toolName === "propose_timetable_import");
    expect(call).toBeTruthy();

    const parsed = proposeTimetableImportInputSchema.safeParse(call!.input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const draft = parsed.data;
      const totalSlots = draft.courses.reduce((n, c) => n + c.slots.length, 0);
      // 打印供人工核对（不打印 key）
      console.log(
        `[LIVE] summary=${draft.summary} courses=${draft.courses.length} slots=${totalSlots} pending=${draft.pendingItems?.length ?? 0}`
      );
      // 断言：模型不得输出具体时间 / 真实 ID / PII 形状
      const raw = JSON.stringify(draft);
      expect(raw).not.toMatch(/startTime/);
      expect(raw).not.toMatch(/endTime/);
      expect(raw).not.toMatch(/courseId/);
      expect(raw).not.toMatch(/scheduleId/);
      expect(raw).not.toMatch(/学号|姓名/);
      expect(totalSlots).toBeGreaterThan(0);
      // 节次必须在合法范围
      for (const c of draft.courses) {
        for (const s of c.slots) {
          expect(s.dayOfWeek).toBeGreaterThanOrEqual(1);
          expect(s.dayOfWeek).toBeLessThanOrEqual(7);
          if (s.periodStart !== undefined) {
            expect(s.periodStart).toBeGreaterThanOrEqual(1);
            expect(s.periodEnd).toBeGreaterThanOrEqual(s.periodStart);
          }
        }
      }
    }
  }, 240000);

  it("Layer B：模型输出 → buildTimetableImportProposal → 无 Bell blocker → 注入 Bell → apply 一次 importSchedules", async () => {
    const { generateText, tool } = await import("ai");
    const { resolveLanguageModel } = await import("@/lib/ai/providers/resolver");
    const { KIRO_SYSTEM_PROMPT } = await import("@/lib/ai/prompts/kiroSystemPrompt");
    const { proposeTimetableImportInputSchema } = await import("@/lib/ai/timetableImport/schemas");
    const { buildTimetableImportProposal } = await import("@/lib/ai/timetableImport/preflight");
    const { applyTimetableImport } = await import("@/lib/ai/timetableImport/executor");
    const { readFileSync } = await import("node:fs");

    const resolved = await resolveLanguageModel({ provider: "opencode-go", model: "mimo-v2.5", apiKey: key! });
    const image = readFileSync(fixturePath);

    // 1. 真实模型输出 draft
    const { toolCalls } = await generateText({
      model: resolved.model,
      system: `${KIRO_SYSTEM_PROMPT}\n\n用户上传了完整新学期课表截图，要求把整张课表导入 ClassFlow。请调用 propose_timetable_import 输出课表草稿。`,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "把这学期课表导入 ClassFlow" },
            { type: "image", image: new Uint8Array(image), mediaType: "image/jpeg" },
          ],
        },
      ],
      maxOutputTokens: 12000,
      tools: {
        propose_timetable_import: tool({ description: "课表导入", inputSchema: proposeTimetableImportInputSchema }),
      },
    });
    const call = toolCalls.find((t) => t.toolName === "propose_timetable_import");
    const parsed = proposeTimetableImportInputSchema.safeParse(call!.input);
    expect(parsed.success).toBe(true);
    const draft = parsed.data!;

    // 2. 无 Bell：proposal 可创建（extraction counts 保留），preflight 有 missing-period-template blocker
    const noBell = buildTimetableImportProposal({
      draft,
      sourceAttachmentIds: ["att_live"],
      state: { existingCourses: [], existingSchedules: [], bellSchedules: [], activeBellScheduleId: null },
    });
    expect(noBell.ok).toBe(true);
    if (noBell.ok) {
      const blockers = noBell.proposal.preview.issues.filter((i) => i.severity === "blocker");
      expect(blockers.length).toBeGreaterThan(0);
      expect(blockers[0].code).toBe("missing-period-template");
      // extraction counts 保持识别数量（10 门 / 15 时段）
      expect(draft.courses.length).toBeGreaterThanOrEqual(8);
    }

    // 3. 注入完整 Bell Schedule（覆盖图片使用的所有节次：1-12 节）后 apply
    const bell = {
      id: "bell_live",
      name: "测试作息",
      periods: Array.from({ length: 12 }, (_, i) => ({
        period: i + 1,
        startTime: `${String(8 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "00" : "45"}`,
        endTime: `${String(8 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "45" : "30"}`,
      })),
    };
    let importedCourses = 0;
    let importedSchedules = 0;
    let importCalls = 0;
    const result = applyTimetableImport(
      noBell.ok ? noBell.proposal : (() => { throw new Error("proposal failed"); })(),
      {
        getState: () => ({ courses: [], schedules: [], bellSchedules: [], activeBellScheduleId: null }),
        importSchedules: (courses, schedules) => {
          importCalls++;
          importedCourses = courses.length;
          importedSchedules = schedules.length;
        },
      },
      { pendingBell: bell }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(importCalls).toBe(1);
      expect(importedCourses).toBe(draft.courses.length);
      expect(importedSchedules).toBe(draft.courses.reduce((n, c) => n + c.slots.length, 0));
      console.log(`[LIVE:apply] courses=${importedCourses} slots=${importedSchedules} once=${importCalls}`);
    }
  }, 240000);
});
