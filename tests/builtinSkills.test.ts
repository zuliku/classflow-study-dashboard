// @vitest-environment node
/**
 * S2 — Builtin Workflow Skills 目录（10 → 3）。
 *
 * 覆盖：恰好 3 个 builtin（study-planning / course-material-analysis / class-notice-to-actions）、
 * 全部 kind=workflow + origin=builtin、requiredTools 全部真实存在、被移除的 6 个不再出现、
 * instructions 无提权表述、保留名（builtin + legacy alias）继续拒绝用户创建。
 */
import { describe, it, expect } from "vitest";
import {
  BUILTIN_SKILLS,
  BUILTIN_SKILL_NAMES,
  BUILTIN_RESERVED_SKILL_NAMES,
  withBuiltinSkills,
  assertNotBuiltinSkillName,
} from "@/lib/ai/skills/builtin";
import { BUILTIN_ALIAS_NAMES, resolveBuiltinSkillAlias } from "@/lib/ai/skills/builtinAliases";
import { activateSkill, assertSkillCannotElevate } from "@/lib/ai/skills/activation";
import { validateSkillName } from "@/lib/ai/skills/validator";
import { SKILL_NAME_PATTERN } from "@/lib/ai/skills/types";
import { KIRO_READ_TOOL_NAMES } from "@/lib/ai/tools/read/registry";
import { KIRO_WRITE_TOOL_NAMES } from "@/lib/ai/tools/write/registry";
import { COMPUTER_TOOL_NAMES } from "@/lib/ai/computer/tools/registry";

const KNOWN_TOOLS = new Set<string>([
  ...(KIRO_READ_TOOL_NAMES as string[]),
  ...(KIRO_WRITE_TOOL_NAMES as string[]),
  ...COMPUTER_TOOL_NAMES,
  // 联网工具由 lib/ai/web/tool.ts 动态创建（非静态注册表）
  "web_search",
  "read_web_source",
]);

const REMOVED_BUILTIN_NAMES = [
  "focus-coach",
  "web-research",
  "computer-control",
  "terminal-helper",
  "file-organizer",
  "reminder-assistant",
];

/** skill 正文里形如工具名的 snake_token（排除 capabilities 结构字段本身） */
function referencedToolTokens(instructions: string): string[] {
  const tokens = instructions.match(/\b[a-z]+(?:_[a-z0-9]+)+\b/g) ?? [];
  return [...new Set(tokens)].filter(
    (t) => !["source_id", "project_id", "course_id"].includes(t)
  );
}

describe("S2 内置 Skills 目录（3 个）", () => {
  it("恰好 3 个 builtin：命名 / kind / origin / folderName / metadata", () => {
    const names = BUILTIN_SKILLS.map((s) => s.name);
    expect(names).toEqual(["study-planning", "course-material-analysis", "class-notice-to-actions"]);
    expect([...BUILTIN_SKILL_NAMES].sort()).toEqual([...names].sort());
    for (const s of BUILTIN_SKILLS) {
      expect(SKILL_NAME_PATTERN.test(s.name), s.name).toBe(true);
      expect(s.enabled, s.name).toBe(true);
      expect(s.folderName, s.name).toBe(`__builtin__/${s.name}`);
      expect(s.kind, s.name).toBe("workflow");
      expect(s.origin, s.name).toBe("builtin");
      expect(s.metadata, s.name).toEqual({ builtin: "true" });
      expect(s.permissionsNote, s.name).toBeTruthy();
      // §46：description 必须同时表达能力边界与适用场景（有 routing 信息）
      expect(s.description.length, s.name).toBeGreaterThanOrEqual(40);
      expect(s.description.length, s.name).toBeLessThanOrEqual(200);
      // §47：instructions 保持精简（500–1200 中文字量级）
      expect(s.instructions.length, s.name).toBeGreaterThan(400);
      expect(s.instructions.length, s.name).toBeLessThan(2200);
      expect(s.legacyTriggers, s.name).toBeUndefined();
      expect(s.requiredTools?.length ?? 0, s.name).toBeGreaterThan(0);
    }
  });

  it("被移除的 6 个旧 builtin 不再出现（也不提供 alias）", () => {
    for (const removed of REMOVED_BUILTIN_NAMES) {
      expect(BUILTIN_SKILL_NAMES, removed).not.toContain(removed);
      expect(BUILTIN_RESERVED_SKILL_NAMES, removed).not.toContain(removed);
      expect(resolveBuiltinSkillAlias(removed), removed).toBeNull();
      // 解除 reserved 后用户可以创建同名普通 Skill（不再是系统内置）
      expect(validateSkillName(removed).ok, removed).toBe(true);
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
      expect(r.name, s.name).toBe(s.name);
    }
  });

  it("requiredTools 与正文引用的工具名必须真实存在（防文档漂移成假功能）", () => {
    for (const s of BUILTIN_SKILLS) {
      for (const t of referencedToolTokens(s.instructions)) {
        expect(KNOWN_TOOLS.has(t), `${s.name}: ${t}`).toBe(true);
      }
      for (const t of s.requiredTools ?? []) {
        expect(KNOWN_TOOLS.has(t), `${s.name}: requiredTools ${t}`).toBe(true);
      }
      expect(s.requiredCapabilities, s.name).toBeUndefined();
    }
  });

  it("保留名（builtin canonical + legacy alias）拒绝新建", () => {
    for (const name of [...BUILTIN_SKILL_NAMES, ...BUILTIN_ALIAS_NAMES]) {
      const r = validateSkillName(name);
      expect(r.ok, name).toBe(false);
      expect(r.reason, name).toContain("RESERVED_NAME");
      expect(assertNotBuiltinSkillName(name).ok, name).toBe(false);
    }
    expect(validateSkillName("my-skill").ok).toBe(true);
  });

  it("legacy alias 名称不在 BUILTIN_SKILLS / 不在 catalog 候选", () => {
    for (const alias of BUILTIN_ALIAS_NAMES) {
      expect(BUILTIN_SKILLS.some((s) => s.name === alias), alias).toBe(false);
    }
  });
});
