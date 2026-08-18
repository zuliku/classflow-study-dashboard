import { describe, it, expect } from "vitest";

/**
 * MiMo V2.5 Timetable Vision Live Smoke（gated）。
 *
 * Gate：OPENCODE_GO_TEST_API_KEY + 真实课表 fixture 同时存在才执行。
 * 走生产链路：provider resolver → @ai-sdk → 真实 KIRO_SYSTEM_PROMPT +
 * 生产 propose_timetable_import tool schema（模型真实调用工具，捕获 tool arguments）。
 */
const key = process.env.OPENCODE_GO_TEST_API_KEY;
// 可用环境变量覆盖测试模型（默认 mimo-v2.5；如 OPENCODE_GO_SMOKE_MODEL=gpt-5.6-luna）
const smokeModel = process.env.OPENCODE_GO_SMOKE_MODEL ?? "mimo-v2.5";
const fixturePath = "tests/fixtures/timetable/sanitized-real-timetable.jpg";
const { existsSync } = require("node:fs") as typeof import("node:fs");
const hasFixture = existsSync(fixturePath);

const gated = hasFixture && !!key ? describe : describe.skip;

gated(`${smokeModel} Timetable Vision Smoke（真实截图 + 生产 schema）`, () => {
  it("Layer 0：连通性（无图片无 tools）", async () => {
    const { generateText } = await import("ai");
    const { resolveLanguageModel } = await import("@/lib/ai/providers/resolver");
    const resolved = await resolveLanguageModel({ provider: "opencode-go", model: smokeModel, apiKey: key! });
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
      model: smokeModel,
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
      // Golden Accuracy：识别质量必须稳定（不因模型偶发放宽）
      expect(draft.courses.length).toBe(10);
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

    const resolved = await resolveLanguageModel({ provider: "opencode-go", model: smokeModel, apiKey: key! });
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
    const normalizedSlotCount = noBell.ok
      ? noBell.proposal.draft.courses.reduce((n, c) => n + c.slots.length, 0)
      : 0;

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
      expect(importedSchedules).toBe(normalizedSlotCount);
      console.log(`[LIVE:apply] courses=${importedCourses} slots=${importedSchedules} once=${importCalls}`);
    }
  }, 240000);

  it("Layer C：Normalized Golden Accuracy（10 门 / 15 逻辑时段 + 关键课程断言）", async () => {
    const { generateText, tool } = await import("ai");
    const { resolveLanguageModel } = await import("@/lib/ai/providers/resolver");
    const { KIRO_SYSTEM_PROMPT } = await import("@/lib/ai/prompts/kiroSystemPrompt");
    const { proposeTimetableImportInputSchema } = await import("@/lib/ai/timetableImport/schemas");
    const { normalizeTimetableImportDraft } = await import("@/lib/ai/timetableImport/draft");
    const { normalizeWeekExpression } = await import("@/lib/scheduleWeekExpression");
    const { readFileSync } = await import("node:fs");
    const { TimetableImportCourseDraft } = await import("@/lib/ai/timetableImport/types");

    const resolved = await resolveLanguageModel({ provider: "opencode-go", model: smokeModel, apiKey: key! });
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
        propose_timetable_import: tool({ description: "课表导入", inputSchema: proposeTimetableImportInputSchema }),
      },
    });
    const call = toolCalls.find((t) => t.toolName === "propose_timetable_import");
    const parsed = proposeTimetableImportInputSchema.safeParse(call!.input);
    expect(parsed.success).toBe(true);

    // Normalized Golden：统一 canonical 后断言
    const normalized = normalizeTimetableImportDraft(parsed.data!);
    const totalSlots = normalized.courses.reduce((n, c) => n + c.slots.length, 0);
    console.log(`[LIVE:golden] raw=${parsed.data!.courses.length}/${parsed.data!.courses.reduce((n, c) => n + c.slots.length, 0)} normalized=${normalized.courses.length}/${totalSlots}`);
    for (const c of normalized.courses) {
      console.log(`[GOLDEN:course] ${c.name} slots=${c.slots.length} -> ${c.slots.map((s) => `d${s.dayOfWeek}p${s.periodStart}-${s.periodEnd ?? "?"}[${s.weekExpression ?? ""}] loc=${s.location ?? "-"}`).join(" | ")}`);
    }
    expect(normalized.courses.length).toBe(10);
    expect(totalSlots).toBe(15);

    const findCourse = (name: string) => normalized.courses.find((c) => c.name.includes(name));
    const findSlot = (course: TimetableImportCourseDraft | undefined, day: number, ps: number, pe?: number) =>
      course?.slots.find((s) => s.dayOfWeek === day && s.periodStart === ps && (pe === undefined || s.periodEnd === pe));
    const normWeek = (w?: string) => (w ? normalizeWeekExpression(w) : "");

    // 网络营销：周一 1-2，weeks=1-5,7-17，E-506
    const wl = findCourse("网络营销");
    const wlSlot = findSlot(wl, 1, 1, 2);
    expect(wlSlot).toBeTruthy();
    if (wlSlot) {
      expect(normWeek(wlSlot.weekExpression)).toBe("1-5,7-17");
      expect(wlSlot.location ?? "").toContain("E-506");
    }

    // 管理信息系统：至少 3 个逻辑 slot；周一 3-4（仅第 1 周）/5-6 + 周二 3-4
    const mis = findCourse("管理信息系统");
    expect((mis?.slots ?? []).length).toBeGreaterThanOrEqual(3);
    const mis1 = findSlot(mis, 1, 3, 4);
    const mis2 = findSlot(mis, 1, 5, 6);
    const mis3 = findSlot(mis, 2, 3, 4);
    expect(mis1).toBeTruthy();
    expect(mis2).toBeTruthy();
    expect(mis3).toBeTruthy();
    if (mis1) {
      expect(normWeek(mis1.weekExpression)).toBe("1");
      expect(mis1.location ?? "").toContain("E-506");
    }
    if (mis2) expect(normWeek(mis2.weekExpression)).toBe("2-5,7-16");
    if (mis3) expect(normWeek(mis3.weekExpression)).toBe("6");

    // 管理沟通：周一 3-4，2-5,7-10，E-114
    const gc = findCourse("管理沟通");
    const gcSlot = findSlot(gc, 1, 3, 4);
    expect(gcSlot).toBeTruthy();
    if (gcSlot) {
      expect(normWeek(gcSlot.weekExpression)).toBe("2-5,7-10");
      expect(gcSlot.location ?? "").toContain("E-114");
    }

    // 数字乡村建设专题：周一 5-6（仅第 1 周，E-114）+ 周四 3-4（1-4,6-7,9-17，E-312）
    const dz = findCourse("数字乡村");
    expect((dz?.slots ?? []).length).toBeGreaterThanOrEqual(2);
    const dzMon = findSlot(dz, 1, 5, 6);
    const dzSlot = findSlot(dz, 4, 3, 4);
    expect(dzMon).toBeTruthy();
    expect(dzSlot).toBeTruthy();
    if (dzMon) {
      expect(normWeek(dzMon.weekExpression)).toBe("1");
      expect(dzMon.location ?? "").toContain("E-114");
    }
    if (dzSlot) {
      expect(normWeek(dzSlot.weekExpression)).toBe("1-4,6-7,9-17");
      expect(dzSlot.location ?? "").toContain("E-312");
    }

    // 国际贸易实务：周一 7-8（必须合并，不能是两个独立 slot）
    const gj = findCourse("国际贸易实务");
    expect(gj).toBeTruthy();
    const gjMerged = gj?.slots.find((s) => s.dayOfWeek === 1 && s.periodStart === 7 && s.periodEnd === 8);
    expect(gjMerged).toBeTruthy();
    if (gjMerged) {
      expect(normWeek(gjMerged.weekExpression)).toBe("1-5,7-17");
      expect(gjMerged.location ?? "").toContain("E-114");
    }
    // 不允许 7 和 8 拆成两个独立 slot
    const gjSplit = gj?.slots.filter((s) => s.dayOfWeek === 1 && (s.periodStart === 7 || s.periodStart === 8));
    expect((gjSplit ?? []).length).toBe(1);

    // 财政学：2 slot（周二 1-2 / 周三 3-4）
    const cz = findCourse("财政学");
    expect(cz).toBeTruthy();
    const cz1 = findSlot(cz, 2, 1, 2);
    const cz2 = findSlot(cz, 3, 3, 4);
    expect(cz1).toBeTruthy();
    expect(cz2).toBeTruthy();
    if (cz1) expect(normWeek(cz1.weekExpression)).toBe("1-5,7-9");
    if (cz2) expect(normWeek(cz2.weekExpression)).toBe("1-7,9");

    // 财务管理：2 slot（周二 3-4 / 周三 5-6）
    const cw = findCourse("财务管理");
    const cw1 = findSlot(cw, 2, 3, 4);
    const cw2 = findSlot(cw, 3, 5, 6);
    expect(cw1).toBeTruthy();
    expect(cw2).toBeTruthy();
    if (cw1) expect(normWeek(cw1.weekExpression)).toBe("1-5");
    if (cw2) expect(normWeek(cw2.weekExpression)).toBe("1-7,9-12");

    // 新制度经济学：周三 1-2，1-7,9-17，E-508
    const xz = findCourse("新制度经济学");
    const xzSlot = findSlot(xz, 3, 1, 2);
    expect(xzSlot).toBeTruthy();
    if (xzSlot) expect(normWeek(xzSlot.weekExpression)).toBe("1-7,9-17");

    // 企业战略管理：周三 7-8（必须合并），1-7,9-17，E-510
    const qy = findCourse("企业战略管理");
    const qyMerged = qy?.slots.find((s) => s.dayOfWeek === 3 && s.periodStart === 7 && s.periodEnd === 8);
    expect(qyMerged).toBeTruthy();
    if (qyMerged) expect(normWeek(qyMerged.weekExpression)).toBe("1-7,9-17");
    const qySplit = qy?.slots.filter((s) => s.dayOfWeek === 3 && (s.periodStart === 7 || s.periodStart === 8));
    expect((qySplit ?? []).length).toBe(1);

    // 宝石鉴定与欣赏：周三 9-11，3-7,9；教室可为"未定"或进 pending，禁止猜教室
    const bs = findCourse("宝石鉴定");
    expect(bs).toBeTruthy();
    const bsSlot = bs?.slots.find((s) => s.dayOfWeek === 3 && s.periodStart === 9 && s.periodEnd === 11);
    expect(bsSlot).toBeTruthy();
    if (bsSlot) {
      expect(normWeek(bsSlot.weekExpression)).toBe("3-7,9");
      const loc = (bsSlot.location ?? "").trim();
      if (loc) {
        // 若填写了教室，必须与"未定"语义一致（不允许模型猜一个具体教室名）
        expect(["未定", "待定", "待通知", "TBD", ""].includes(loc)).toBe(true);
      }
    }

    // PII 检查（normalized draft 同样不得含姓名/学号）
    const rawJson = JSON.stringify(normalized);
    expect(rawJson).not.toMatch(/学号|姓名/);
  }, 240000);
});
