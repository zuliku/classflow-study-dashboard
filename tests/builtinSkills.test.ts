import { describe, it, expect } from "vitest";
import { BUILTIN_SKILLS, BUILTIN_SKILL_NAMES, withBuiltinSkills } from "@/lib/ai/skills/builtin";
import { activateSkill, assertSkillCannotElevate } from "@/lib/ai/skills/activation";
import { validateSkillName } from "@/lib/ai/skills/validator";
import { SKILL_NAME_PATTERN } from "@/lib/ai/skills/types";
import { KIRO_READ_TOOL_NAMES } from "@/lib/ai/tools/read/registry";
import { KIRO_WRITE_TOOL_NAMES } from "@/lib/ai/tools/write/registry";

const KNOWN_TOOLS = new Set<string>([...KIRO_READ_TOOL_NAMES, ...KIRO_WRITE_TOOL_NAMES] as string[]);

/** skill 正文里形如工具名的 snake_token（排除 capabilities 结构字段本身） */
function referencedToolTokens(instructions: string): string[] {
  const tokens = instructions.match(/\b[a-z]+(?:_[a-z0-9]+)+\b/g) ?? [];
  return [...new Set(tokens)].filter(
    (t) => !["source_id", "project_id", "course_id"].includes(t)
  );
}

describe("内置 Skills 目录", () => {
  it("5 个内置 skill：命名规范 + 保留名与目录同源（防漂移）", () => {
    const names = BUILTIN_SKILLS.map((s) => s.name);
    expect(names).toEqual([
      "document-handling",
      "timetable-analysis",
      "task-triage",
      "study-plan",
      "focus-coach",
    ]);
    expect([...BUILTIN_SKILL_NAMES].sort()).toEqual([...names].sort());
    for (const s of BUILTIN_SKILLS) {
      expect(SKILL_NAME_PATTERN.test(s.name), s.name).toBe(true);
      expect(s.enabled).toBe(true);
      expect(s.folderName).toBe(`__builtin__/${s.name}`);
      expect(s.description.length).toBeGreaterThan(10);
      expect(s.instructions.length).toBeGreaterThan(100);
      expect(s.triggers?.length ?? 0).toBeGreaterThan(0);
      expect(s.metadata).toMatchObject({ builtin: true });
    }
  });

  it("instructions 无提权表述 + 可激活", () => {
    const merged = withBuiltinSkills([]);
    expect(merged.length).toBe(BUILTIN_SKILLS.length);
    for (const s of BUILTIN_SKILLS) {
      expect(assertSkillCannotElevate(s.instructions).ok, s.name).toBe(true);
      const r = activateSkill(merged, { skillName: s.name });
      expect(r.ok, s.name).toBe(true);
      expect(r.instructions).toBe(s.instructions);
    }
  });

  it("正文引用的工具名必须真实存在（防文档漂移成假功能）", () => {
    for (const s of BUILTIN_SKILLS) {
      for (const t of referencedToolTokens(s.instructions)) {
        expect(KNOWN_TOOLS.has(t), `${s.name}: ${t}`).toBe(true);
      }
      const caps = (s.metadata as { capabilities?: string[] } | undefined)?.capabilities ?? [];
      expect(caps.length, s.name).toBeGreaterThan(0);
      for (const c of caps) {
        expect(KNOWN_TOOLS.has(c), `${s.name}: ${c}`).toBe(true);
      }
    }
  });

  it("保留名拒绝新建（全部 5 个）", () => {
    for (const name of BUILTIN_SKILL_NAMES) {
      const r = validateSkillName(name);
      expect(r.ok, name).toBe(false);
      expect(r.reason).toContain("RESERVED_NAME");
    }
    expect(validateSkillName("my-skill").ok).toBe(true);
  });
});
