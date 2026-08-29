import { describe, it, expect, beforeEach } from "vitest";
import { executeKiroReadTool } from "@/lib/ai/tools/read/executor";
import { executeKiroWriteTool } from "@/lib/ai/tools/write/executor";
import { createKiroWriteApi } from "@/lib/ai/tools/write/api";
import { useAppStore } from "@/store/useAppStore";
import { KIRO_SYSTEM_PROMPT } from "@/lib/ai/prompts/kiroSystemPrompt";

describe("Kiro New Tools", () => {
  beforeEach(() => {
    // 不清空已有 demo 数据，确保至少有一个课程
    const s = useAppStore.getState();
    if (s.courses.length === 0) {
      useAppStore.setState({
        courses: [
          {
            id: "c-test-1",
            name: "测试课程",
            code: "TEST101",
            teacher: "测试老师",
            classroom: "A101",
            credit: 3,
            description: "",
            materials: [],
            bgHex: "#ffffff",
            borderHex: "#e5e7eb",
            textHex: "#111827",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as any,
        ],
      });
    }
  });

  it("KIRO_SYSTEM_PROMPT contains new sections", () => {
    expect(KIRO_SYSTEM_PROMPT).toContain("并行与就绪即停");
    expect(KIRO_SYSTEM_PROMPT).toContain("批量正例");
    expect(KIRO_SYSTEM_PROMPT).toContain("规划可视化");
    expect(KIRO_SYSTEM_PROMPT).toContain("仅当用户明确");
  });

  it("search_assignments with new filters", () => {
    const s = useAppStore.getState();
    const courseId = s.courses[0].id;
    // create a test assignment with priority urgent
    const id = useAppStore.getState().addAssignment({ courseId, title: "测试任务", priority: "urgent", tags: ["test"] } as any, { source: "kiro" } as any);
    const fresh = useAppStore.getState();
    const r = executeKiroReadTool("search_assignments", { priority: "urgent", tag: "test", hasDDL: false, hasEstimatedMinutes: false, sortBy: "priority", includeHealth: true }, fresh as any) as any;
    expect(r.ok).toBe(true);
    expect(r.data.length).toBeGreaterThan(0);
    expect(r.data[0].priority).toBe("urgent");
    expect(r.data[0].health).toBeDefined();
  });

  it("get_available_time with includeCourseOverlap", () => {
    const state = useAppStore.getState();
    const r = executeKiroReadTool("get_available_time", { startDate: "2026-03-10", endDate: "2026-03-12", includeCourseOverlap: true, includeStudyBlocks: false }, state as any) as any;
    expect(r.ok).toBe(true);
    expect(r.data.preferredMinutes).toBeDefined();
    expect(r.data.combinedMinutes).toBeDefined();
  });

  it("get_assignment_health with includeEvidence", () => {
    const courseId = useAppStore.getState().courses[0].id;
    const id = useAppStore.getState().addAssignment({ courseId, title: "健康测试", ddl: "2026-04-10T23:59:00", estimatedMinutes: 120 } as any, { source: "kiro" } as any);
    const fresh = useAppStore.getState();
    const r = executeKiroReadTool("get_assignment_health", { assignmentId: id, includeEvidence: true, horizonDays: 7 }, fresh as any) as any;
    expect(r.ok).toBe(true);
    expect(r.data.evidence).toBeDefined();
  });

  it("search_course_materials", () => {
    const state = useAppStore.getState();
    const course = state.courses[0];
    // add a material
    const materialId = `m-${Date.now()}`;
    // simulate adding material via store
    const c = state.courses.find((c) => c.id === course.id);
    if (c) {
      useAppStore.setState((s: any) => ({
        courses: s.courses.map((cc: any) => cc.id === course.id ? { ...cc, materials: [...(cc.materials || []), { id: materialId, title: "测试资料 线性代数", type: "pdf", size: "1MB", uploadDate: new Date().toISOString() }] } : cc),
      }));
    }
    const r = executeKiroReadTool("search_course_materials", { courseId: course.id, query: "线性代数" }, useAppStore.getState() as any) as any;
    expect(r.ok).toBe(true);
    expect(r.data.results.length).toBeGreaterThan(0);
  });

  it("get_preferences", () => {
    const r = executeKiroReadTool("get_preferences", {}, useAppStore.getState() as any) as any;
    expect(r.ok).toBe(true);
    expect(r.data).toHaveProperty("defaultTaskPriority");
  });

  it("create_study_block via write", () => {
    const api = createKiroWriteApi({ toolCallId: "t1", pushToast: () => {}, registerUndo: () => {}, onCancelOutput: () => {} });
    const r = executeKiroWriteTool("create_study_block", { title: "测试自习", date: "2026-03-15", startTime: "10:00", endTime: "11:00" }, api, "t1") as any;
    expect(r.ok).toBe(true);
    expect(r.data.id).toBeDefined();
  });

  it("update_course_appearance", () => {
    const api = createKiroWriteApi({ toolCallId: "t2", pushToast: () => {}, registerUndo: () => {}, onCancelOutput: () => {} });
    const courseId = useAppStore.getState().courses[0].id;
    const r = executeKiroWriteTool("update_course_appearance", { courseId, bgHex: "#ff0000" }, api, "t2") as any;
    expect(r.ok).toBe(true);
  });

  it("update_preferences", () => {
    const api = createKiroWriteApi({ toolCallId: "t3", pushToast: () => {}, registerUndo: () => {}, onCancelOutput: () => {} });
    const r = executeKiroWriteTool("update_preferences", { defaultTaskPriority: "high" }, api, "t3") as any;
    expect(r.ok).toBe(true);
  });

  it("update_user_profile", () => {
    const api = createKiroWriteApi({ toolCallId: "t4", pushToast: () => {}, registerUndo: () => {}, onCancelOutput: () => {} });
    const r = executeKiroWriteTool("update_user_profile", { name: "测试用户" }, api, "t4") as any;
    expect(r.ok).toBe(true);
  });
});
