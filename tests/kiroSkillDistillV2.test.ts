// @vitest-environment node
/**
 * S1 — Distillation / Dialog / Chat Route / Security 契约测试（§65/§66/§67）。
 *
 * 覆盖：普通 distilled draft → workflow；desktop draft → recipe；manifest round-trip（parameters /
 * sourceTurnId）；requiredTools 不写入 SKILL.md；权限 allowlist；Dialog 不再维护手写 knownTools；
 * Chat Route 只消费 Registry 分类；Skill 不改变权限 / 不跳过 approval / scripts 不执行。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAndNormalizeDraft } from "@/lib/ai/skills/distillCore";
import { renderSkillDraftToMd, validateSkillDraft } from "@/lib/ai/skills/draft";
import { kiroSkillManifestFromDraft, normalizeKiroSkillManifest } from "@/lib/ai/skills/kiroManifest";
import { buildDesktopSkillDraft } from "@/src/main/computer/trajectory";
import { classifyKiroSkillTool, isKnownKiroSkillTool } from "@/lib/ai/skills/knownTools";
import type { WorkflowTrace } from "@/lib/ai/skills/types";

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const TRACE: WorkflowTrace = {
  turnId: "turn-42",
  userGoal: "整理课程通知",
  toolCalls: [{ toolName: "search_courses", input: {}, toolCallId: "c1" }],
  toolResults: [{ toolName: "search_courses", result: {}, toolCallId: "c1" }],
  finalStatus: "success",
  timestamp: 1,
};

describe("Distillation：kind 与 manifest ownership", () => {
  it("普通 distilled draft → workflow（kind 显式）", () => {
    const draft = parseAndNormalizeDraft(
      JSON.stringify({
        name: "course-notice-to-actions",
        description: "把课程通知整理为可执行建议。",
        instructions: "1. 识别课程\n2. 生成 Proposal",
        parameters: [],
        requiredTools: ["search_courses"],
        requiredPermissions: ["read", "propose"],
        examples: [],
      }),
      TRACE
    );
    expect(draft.kind).toBe("workflow");
    expect(draft.sourceTurnId).toBe("turn-42");
  });

  it("非法权限在 normalize 时被丢弃（allowlist）", () => {
    const draft = parseAndNormalizeDraft(
      JSON.stringify({
        name: "with-admin",
        description: "desc",
        instructions: "1. step",
        parameters: [],
        requiredTools: [],
        requiredPermissions: ["read", "admin", "sudo"],
        examples: [],
      }),
      TRACE
    );
    expect(draft.requiredPermissions).toEqual(["read"]);
    const manifest = kiroSkillManifestFromDraft(draft)!;
    expect(manifest.requiredPermissions).toEqual(["read"]);
  });

  it("desktop trajectory draft → recipe（manifest kind = recipe）", () => {
    const draft = buildDesktopSkillDraft(
      {
        appName: "wechat",
        appLabel: "微信",
        goal: "发送报告",
        result: "completed",
        startedAt: 1,
        steps: [
          { index: 0, action: "click", targetLabel: "Button「发送」", risk: "external", verificationPassed: true, at: 1 },
        ],
      },
      "cs-1"
    );
    expect(draft.kind).toBe("recipe");
    const manifest = kiroSkillManifestFromDraft(draft)!;
    expect(manifest.kind).toBe("recipe");
    expect(manifest.requiredTools).toContain("observe_desktop");
    expect(manifest.requiredCapabilities).toEqual(["ui.interact"]);
  });

  it("parameters / sourceTurnId / requiredTools 能 round-trip（manifest）", () => {
    const draft = parseAndNormalizeDraft(
      JSON.stringify({
        name: "course-notice-to-actions",
        description: "desc",
        instructions: "1. {course}",
        parameters: [{ name: "course", type: "course", description: "课程", required: true }],
        requiredTools: ["search_courses", "search_assignments"],
        requiredPermissions: ["read"],
        examples: [],
      }),
      TRACE
    );
    const manifest = kiroSkillManifestFromDraft(draft)!;
    expect(manifest.parameters[0]).toEqual({ name: "course", type: "course", description: "课程", required: true });
    expect(manifest.requiredTools).toEqual(["search_courses", "search_assignments"]);
    expect(manifest.sourceTurnId).toBe("turn-42");
    expect(normalizeKiroSkillManifest(manifest)).toEqual(manifest);
  });

  it("renderSkillDraftToMd：structured metadata 不进入 frontmatter（无 metadata block）", () => {
    const draft = parseAndNormalizeDraft(
      JSON.stringify({
        name: "course-notice-to-actions",
        description: "desc",
        instructions: "1. step",
        parameters: [{ name: "course", type: "course", description: "课程", required: true }],
        requiredTools: ["search_courses"],
        requiredPermissions: ["read"],
        examples: [],
      }),
      TRACE
    );
    const md = renderSkillDraftToMd(draft);
    const frontmatter = md.split("---")[1];
    expect(frontmatter).not.toContain("metadata:");
    expect(frontmatter).not.toContain("sourceTurnId");
    expect(frontmatter).not.toContain("parameters:");
    expect(md).not.toContain("[object Object]");
    expect(validateSkillDraft(draft).ok).toBe(true);
  });

  it("description 是 routing contract：长度上限 500", () => {
    const base = {
      name: "long-desc",
      instructions: "1. step",
      parameters: [],
      requiredTools: [],
      requiredPermissions: ["read"],
      examples: [],
      sourceTurnId: "t1",
      kind: "workflow" as const,
    };
    expect(validateSkillDraft({ ...base, description: "x".repeat(500) }).ok).toBe(true);
    const tooLong = validateSkillDraft({ ...base, description: "x".repeat(501) });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.errors).toContain("DESCRIPTION_TOO_LONG");
  });
});

describe("SkillDistillDialog：不再维护第二份 Tool 事实来源", () => {
  const dialog = stripComments(read("components/kiro/SkillDistillDialog.tsx"));

  it("移除手写 knownTools 列表，改用共享 Tool Registry 判定", () => {
    expect(dialog).toContain("isKnownKiroSkillTool");
    expect(dialog).not.toContain("const knownTools");
    expect(dialog).not.toContain('"search_courses"');
    expect(dialog).not.toContain("mcp_search_tools");
  });

  it("移除「触发条件」输入；description 辅助文案说明 routing 用途", () => {
    expect(dialog).not.toContain("触发条件");
    expect(dialog).not.toContain("draft.triggers");
    expect(dialog).toContain("描述同时用于帮助 Kiro 判断何时使用此 Skill");
  });

  it("保存走 agents/kiro.json（kiroManifest），不再写 SKILL.md metadata", () => {
    expect(dialog).toContain("kiroSkillManifestFromDraft");
    expect(dialog).toContain("kiroManifest");
    expect(dialog).not.toContain("metadata: {");
    expect(dialog).not.toContain("sourceTurnId: draft.sourceTurnId");
  });

  it("Test 按钮只做 schema / contract validation（不再伪称 trigger eval）", () => {
    expect(dialog).not.toContain("测试是否触发正确");
    expect(dialog).toContain("isKnownKiroSkillTool");
    expect(dialog).toContain("KIRO_SKILL_PERMISSIONS");
  });
});

describe("Chat Route：只消费 Registry 分类", () => {
  const route = stripComments(read("app/api/ai/chat/route.ts"));

  it("使用 buildKiroSkillRegistry；Available Skills 与 recipe section 分源", () => {
    expect(route).toContain("buildKiroSkillRegistry");
    expect(route).toContain("registry.workflows");
    expect(route).toContain("registry.recipes");
    expect(route).toContain("buildDesktopRecipePromptSection(registry.recipes)");
  });

  it("slash activation 只在 workflow 中查找（recipe 绝不 fallback）", () => {
    expect(route).toContain("activateSkill(registry.workflows");
  });

  it("route 不自行分类（无 skill kind filter / prefix 判断）", () => {
    expect(route).not.toContain('startsWith("desktop-")');
    expect(route).not.toContain('.kind === "workflow"');
    expect(route).not.toContain('.kind === "recipe"');
    expect(route).not.toContain("metadata?.builtin");
  });
});

describe("S1 安全边界", () => {
  it("scripts 仍绝不执行：skillStore / knownTools 无 eval / spawn / dynamic import", () => {
    for (const file of ["src/main/skills/skillStore.ts", "lib/ai/skills/knownTools.ts"]) {
      const source = stripComments(read(file));
      expect(source, file).not.toMatch(/\beval\s*\(/);
      expect(source, file).not.toContain("execFile");
      expect(source, file).not.toContain("spawn(");
      expect(source, file).not.toContain("require(");
    }
  });

  it("Skill / Recipe 不能改变权限或跳过 approval（activation 语义声明 + 无 store 写入）", () => {
    const activation = stripComments(read("lib/ai/skills/activation.ts"));
    expect(activation).not.toContain("upsertPermissionRule");
    expect(activation).not.toContain("useKiroComputerStore");
    expect(activation).not.toContain("setAgentMode");
    const recipes = stripComments(read("lib/ai/skills/recipes.ts"));
    expect(recipes).not.toContain("approval");
    expect(recipes).not.toContain("permissionRules");
    expect(recipes).not.toContain("setAgentMode");
  });

  it("manifest 不包含 absolute package path / native 标识", () => {
    const manifestSource = read("lib/ai/skills/kiroManifest.ts");
    const fields = manifestSource
      .split("\n")
      .filter((line) => /^\s{2}\w+[?]?:/.test(line))
      .join("\n");
    for (const forbidden of ["path", "dir", "hwnd", "pid", "handle"]) {
      expect(fields.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it("IPC list 不暴露 native skill 目录 / 完整 instructions", () => {
    const ipc = stripComments(read("src/main/skills/skillIpc.ts"));
    const listHandler = ipc.slice(ipc.indexOf("bridge:skill:list"), ipc.indexOf("bridge:skill:get"));
    expect(listHandler).not.toContain("instructions");
    expect(listHandler).not.toContain("rawContent");
    expect(listHandler).not.toContain("dir");
    expect(listHandler).not.toContain("absolute");
  });

  it("knownTools：builtin / web / mcp-gateway / external-unverified / unknown 分类", () => {
    expect(classifyKiroSkillTool("propose_study_plan")).toBe("builtin");
    expect(classifyKiroSkillTool("observe_desktop")).toBe("builtin");
    expect(classifyKiroSkillTool("web_search")).toBe("web");
    expect(classifyKiroSkillTool("mcp_call_tool")).toBe("mcp-gateway");
    expect(classifyKiroSkillTool("mcp_calendar_create_event")).toBe("external-unverified");
    expect(classifyKiroSkillTool("totally_made_up_tool")).toBe("unknown");
    expect(isKnownKiroSkillTool("mcp_calendar_create_event")).toBe(true);
    expect(isKnownKiroSkillTool("totally_made_up_tool")).toBe(false);
  });
});
