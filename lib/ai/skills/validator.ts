/**
 * Skill Validator — 覆盖 13 场景
 */

import { SKILL_NAME_PATTERN, type SkillValidationResult } from "@/lib/ai/skills/types";
import type { SkillFrontmatter } from "@/lib/ai/skills/types";

export function validateSkillName(name: string): { ok: boolean; reason?: string } {
  if (typeof name !== "string" || name.length === 0) return { ok: false, reason: "MISSING_NAME" };
  if (!SKILL_NAME_PATTERN.test(name)) {
    return { ok: false, reason: `INVALID_NAME_PATTERN: ${name} must match ${SKILL_NAME_PATTERN.source}` };
  }
  return { ok: true };
}

export function validateSkillPackage(input: {
  folderName: string;
  frontmatter: SkillFrontmatter;
  existingNames?: Set<string>;
}): SkillValidationResult {
  const errors: string[] = [];
  const { folderName, frontmatter, existingNames } = input;
  if (typeof folderName !== "string" || folderName.length === 0) {
    errors.push("FOLDER_TRAVERSAL: folderName empty");
    return { ok: false, code: "FOLDER_TRAVERSAL", errors };
  }
  if (folderName.includes("/") || folderName.includes("\\") || folderName.includes("..") || folderName.includes(":")) {
    errors.push(`FOLDER_TRAVERSAL: invalid folderName ${folderName}`);
    return { ok: false, code: "FOLDER_TRAVERSAL", errors };
  }
  const nameCheck = validateSkillName(frontmatter.name);
  if (!nameCheck.ok) {
    errors.push(nameCheck.reason!);
    return { ok: false, code: "INVALID_NAME_PATTERN", errors };
  }
  if (frontmatter.name !== folderName) {
    errors.push(`NAME_MISMATCH: frontmatter.name (${frontmatter.name}) != folderName (${folderName})`);
    return { ok: false, code: "NAME_MISMATCH", errors };
  }
  if (!frontmatter.description || frontmatter.description.trim().length === 0) {
    errors.push("MISSING_DESCRIPTION: description required");
    return { ok: false, code: "MISSING_DESCRIPTION", errors };
  }
  if (existingNames && existingNames.has(frontmatter.name)) {
    errors.push(`DUPLICATE_NAME: ${frontmatter.name} already exists`);
    return { ok: false, code: "DUPLICATE_NAME", errors };
  }
  if (frontmatter.license !== undefined && typeof frontmatter.license !== "string") {
    errors.push("INVALID_FRONTMATTER: license must be string");
    return { ok: false, code: "INVALID_FRONTMATTER", errors };
  }
  if (frontmatter.compatibility !== undefined && typeof frontmatter.compatibility !== "string") {
    errors.push("INVALID_FRONTMATTER: compatibility must be string");
    return { ok: false, code: "INVALID_FRONTMATTER", errors };
  }
  return { ok: true, code: "VALID", errors: [] };
}

export function mapParserErrorToCode(err: unknown): SkillValidationResult {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("MISSING_NAME")) return { ok: false, code: "MISSING_NAME", errors: [msg] };
  if (msg.includes("MISSING_DESCRIPTION")) return { ok: false, code: "MISSING_DESCRIPTION", errors: [msg] };
  if (msg.includes("INVALID_YAML")) return { ok: false, code: "INVALID_YAML", errors: [msg] };
  if (msg.includes("INVALID_FRONTMATTER")) return { ok: false, code: "INVALID_FRONTMATTER", errors: [msg] };
  if (msg.includes("NAME_MISMATCH")) return { ok: false, code: "NAME_MISMATCH", errors: [msg] };
  return { ok: false, code: "INVALID_YAML", errors: [msg] };
}
