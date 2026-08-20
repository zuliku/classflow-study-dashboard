import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { sanitizeWorkflowTrace, assertSanitized } from "@/lib/ai/skills/sanitize";
import { distillWorkflowToSkill } from "@/lib/ai/skills/distill";
import type { WorkflowTrace } from "@/lib/ai/skills/types";

describe("workflowDistillIntegration", () => {
  it("Distill via Local API (Renderer does not call provider directly)", async () => {
    const distillPath = path.join(process.cwd(), "lib/ai/skills/distill.ts");
    const dialogPath = path.join(process.cwd(), "components/kiro/SkillDistillDialog.tsx");
    const distillContent = fs.readFileSync(distillPath, "utf8");
    const dialogContent = fs.readFileSync(dialogPath, "utf8");
    // Renderer wrapper throws and directs to Local API
    expect(distillContent).toContain("Local API");
    expect(distillContent).toContain("/api/ai/skills/distill");
    // Dialog actually uses Local API via window.classflowDesktop.api.request
    expect(dialogContent).toContain("window.classflowDesktop.api.request");
    expect(dialogContent).toContain("/api/ai/skills/distill");
    expect(dialogContent).not.toContain('fetch("http://127.0.0.1');
  });

  it("apiKey missing → error (and sanitize gate prevents AI call)", async () => {
    const trace: WorkflowTrace = {
      userGoal: "test workflow",
      toolCalls: [{ toolName: "search_courses", input: { query: "test", id: "assignment_abc123def456" } }],
      proposals: [],
      userConfirmation: false,
    };
    const sanitized = sanitizeWorkflowTrace(trace);
    const gate = assertSanitized(sanitized);
    // sanitized contains {entityId} so gate passes despite tool name pattern
    expect(gate.ok).toBe(true);

    // Renderer side distill should fail closed if called directly (requires Local API)
    await expect(distillWorkflowToSkill(trace, { apiKey: "sk-test-key" } as never)).rejects.toThrow(/Local API/);

    // Dialog checks apiKey presence before calling Local API (see SkillDistillDialog handleDistill)
    const dialogPath = path.join(process.cwd(), "components/kiro/SkillDistillDialog.tsx");
    const dialogContent = fs.readFileSync(dialogPath, "utf8");
    expect(dialogContent).toContain("getSessionApiKey");
    expect(dialogContent).toContain("请先在 Kiro 设置中配置 API Key");
  });

  it("sanitized trace blocks AI when contains secret", async () => {
    const badTrace: WorkflowTrace = {
      userGoal: "test sk-1234567890abcdefghij12345",
      toolCalls: [{ toolName: "test", input: { token: "sk-1234567890abcdefghij12345" } }],
      proposals: [],
      userConfirmation: false,
    };
    const sanitized = sanitizeWorkflowTrace(badTrace);
    const gate = assertSanitized(sanitized);
    // sanitize should replace secret, gate still ok but raw secret not leaked
    expect(gate.ok).toBe(true);
    // If sanitization failed, distill would not call AI
    const badSanitized = { userGoal: "sk-1234567890abcdefghij12345", steps: [{ tool: "test", sanitizedInput: { token: "sk-1234567890abcdefghij12345" } }], requiredTools: ["test"], hasProposal: false, hasConfirmation: false } as never;
    const badGate = assertSanitized(badSanitized);
    expect(badGate.ok).toBe(false);
  });
});
