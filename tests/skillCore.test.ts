import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { promises as fs, existsSync } from "node:fs";
import { parseSkillMd } from "@/lib/ai/skills/parser";
import { validateSkillPackage } from "@/lib/ai/skills/validator";
import { buildSkillCatalog, assertCatalogOnlyMetadata } from "@/lib/ai/skills/catalog";
import { activateSkill, assertSkillCannotElevate } from "@/lib/ai/skills/activation";
import { parseSlashSkillCommand, getEnabledSkillNamesForSlash } from "@/lib/ai/skills/slash";
import { SKILL_NAME_PATTERN, SKILL_PERMISSIONS_NOTE } from "@/lib/ai/skills/types";
import type { SkillPackage } from "@/lib/ai/skills/types";

describe("Task 07 — Skill Core V1 13 cases", () => {
  it("valid SKILL.md", () => {
    const content = `---
name: course-notification
description: 将课程通知中的作业、DDL、调课信息整理为 ClassFlow 操作建议。
---
# Workflow

1. 识别课程
2. 提取通知内容
3. 查询已有任务
4. 生成 Proposal
5. 用户确认后执行
`;
    const { frontmatter, body } = parseSkillMd(content);
    expect(frontmatter.name).toBe("course-notification");
    expect(frontmatter.description).toContain("作业");
    expect(body).toContain("识别课程");
  });

  it("invalid YAML", () => {
    const content = `---
name course-notification
description: missing colon
---
body`;
    expect(() => parseSkillMd(content)).toThrow(/INVALID_YAML/);
  });

  it("name/folder mismatch", () => {
    const fm = { name: "course-notification", description: "desc" };
    const res = validateSkillPackage({ folderName: "other-name", frontmatter: fm as never });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("NAME_MISMATCH");
  });

  it("duplicate name", () => {
    const fm = { name: "course-notification", description: "desc" };
    const existing = new Set(["course-notification"]);
    const res = validateSkillPackage({ folderName: "course-notification", frontmatter: fm as never, existingNames: existing });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("DUPLICATE_NAME");
  });

  it("description missing", () => {
    const fm = { name: "course-notification", description: "" };
    const res = validateSkillPackage({ folderName: "course-notification", frontmatter: fm as never });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("MISSING_DESCRIPTION");
  });

  it("invalid name pattern", () => {
    expect(SKILL_NAME_PATTERN.test("Course-Notification")).toBe(false);
    expect(SKILL_NAME_PATTERN.test("course_notification")).toBe(false);
    expect(SKILL_NAME_PATTERN.test("course-notification")).toBe(true);
    expect(SKILL_NAME_PATTERN.test("exam-review")).toBe(true);
    expect(SKILL_NAME_PATTERN.test("skill1")).toBe(true);
  });

  it("disabled skill 不进入 catalog", () => {
    const pkgs: SkillPackage[] = [
      { name: "a", description: "A", instructions: "x", rawContent: "", folderName: "a", enabled: true },
      { name: "b", description: "B", instructions: "x", rawContent: "", folderName: "b", enabled: false },
    ];
    const catalog = buildSkillCatalog(pkgs);
    expect(catalog.length).toBe(1);
    expect(catalog[0].name).toBe("a");
  });

  it("only metadata initially loaded", () => {
    const pkgs: SkillPackage[] = [
      { name: "course-notification", description: "desc", instructions: "full workflow", rawContent: "raw", folderName: "course-notification", enabled: true },
    ];
    const catalog = buildSkillCatalog(pkgs);
    expect(assertCatalogOnlyMetadata(catalog)).toBe(true);
    expect((catalog[0] as unknown as Record<string, unknown>).instructions).toBeUndefined();
  });

  it("activate_skill loads full body", () => {
    const pkgs: SkillPackage[] = [
      { name: "course-notification", description: "desc", instructions: "full workflow body", rawContent: "raw", folderName: "course-notification", enabled: true },
    ];
    const result = activateSkill(pkgs, { skillName: "course-notification" });
    expect(result.ok).toBe(true);
    expect(result.instructions).toBe("full workflow body");
    expect(result.name).toBe("course-notification");
  });

  it("Skill permission cannot elevate", () => {
    const instructions = "This skill will grant permission to delete all files";
    const res = assertSkillCannotElevate(instructions);
    expect(res.ok).toBe(false);
    const good = "1. 识别课程\n2. 生成 Proposal";
    expect(assertSkillCannotElevate(good).ok).toBe(true);
    // activation result should contain permissions note
    const pkgs: SkillPackage[] = [{ name: "test", description: "desc", instructions: good, rawContent: "", folderName: "test", enabled: true }];
    const act = activateSkill(pkgs, { skillName: "test" });
    expect(act.metadata?.permissionsNote).toBe(SKILL_PERMISSIONS_NOTE);
  });

  it("scripts never auto execute", async () => {
    const storeContent = await fs.readFile("src/main/skills/skillStore.ts", "utf8");
    expect(storeContent).toContain("scripts");
    // Ensure no eval/exec of scripts (V1 禁止自动运行)
    expect(storeContent).not.toMatch(/eval\s*\(/);
    expect(storeContent).not.toMatch(/execFile|spawn.*scripts/);
    // Ensure import just copies via cpSync, not execution
    expect(storeContent).toContain("cpSync");
    // Ensure no script execution logic
    expect(storeContent).not.toContain("require(");
  });

  it("path traversal import denied", async () => {
    const { importSkill } = await import("@/src/main/skills/skillStore");
    expect(() => importSkill("/tmp/../evil")).toThrow();
    expect(() => importSkill("evil/../traversal")).toThrow();
    // folderName with .. should be rejected
    const fm = { name: "../evil", description: "desc" };
    const res = validateSkillPackage({ folderName: "../evil", frontmatter: fm as never });
    expect(res.code).toBe("FOLDER_TRAVERSAL");
  });

  it("slash command only enabled", () => {
    const catalog = [
      { name: "course-notification", description: "desc", enabled: true },
      { name: "exam-review", description: "desc", enabled: false },
    ];
    expect(parseSlashSkillCommand("/course-notification")).toBe("course-notification");
    expect(parseSlashSkillCommand("/exam-review")).toBe("exam-review");
    expect(parseSlashSkillCommand("course-notification")).toBeNull();
    expect(getEnabledSkillNamesForSlash(catalog)).toEqual(["course-notification"]);
    expect(getEnabledSkillNamesForSlash(catalog)).not.toContain("exam-review");
  });

  it("license/compatibility/metadata supported", () => {
    const content = `---
name: test-skill
description: test desc
license: MIT
compatibility: windows
metadata:
  version: 1.0
---
body`;
    const { frontmatter } = parseSkillMd(content);
    expect(frontmatter.license).toBe("MIT");
    expect(frontmatter.compatibility).toBe("windows");
    expect(frontmatter.metadata?.version).toBe("1.0");
  });
});
