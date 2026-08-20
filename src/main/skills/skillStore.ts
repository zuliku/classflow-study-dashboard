/**
 * Skill Store — Main Process (userData/skills)
 * 每个 Skill = <userData>/skills/<skill-name>/SKILL.md + references/ + assets/ + scripts/ (scripts 不自动执行)
 * Renderer Store 仅保存 UI enabled 状态；实际 package 由 Main 管理
 */

import { app } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync, cpSync, renameSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { parseSkillMd } from "@/lib/ai/skills/parser";
import { validateSkillPackage, validateSkillName } from "@/lib/ai/skills/validator";
import type { SkillPackage } from "@/lib/ai/skills/types";
import { SKILL_NAME_PATTERN } from "@/lib/ai/skills/types";

function getSkillsDir(): string {
  return join(app.getPath("userData"), "skills");
}

function ensureSkillsDir(): string {
  const dir = getSkillsDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function skillDirFor(name: string): string {
  return join(getSkillsDir(), name);
}

function isValidFolderName(name: string): boolean {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..") || name.includes(":")) return false;
  return SKILL_NAME_PATTERN.test(name);
}

function serializeSkillMd(frontmatter: { name: string; description: string; license?: string; compatibility?: string; metadata?: Record<string, unknown> }, body: string): string {
  const lines: string[] = ["---"];
  lines.push(`name: ${frontmatter.name}`);
  lines.push(`description: ${frontmatter.description}`);
  if (frontmatter.license) lines.push(`license: ${frontmatter.license}`);
  if (frontmatter.compatibility) lines.push(`compatibility: ${frontmatter.compatibility}`);
  if (frontmatter.metadata && Object.keys(frontmatter.metadata).length > 0) {
    lines.push("metadata:");
    for (const [k, v] of Object.entries(frontmatter.metadata)) {
      lines.push(`  ${k}: ${String(v)}`);
    }
  }
  lines.push("---");
  lines.push("");
  lines.push(body.trim());
  lines.push("");
  return lines.join("\n");
}

function readSkillPackage(folderName: string, enabledMap: Map<string, boolean>): SkillPackage | null {
  const dir = skillDirFor(folderName);
  const mdPath = join(dir, "SKILL.md");
  if (!existsSync(mdPath)) return null;
  try {
    const raw = readFileSync(mdPath, "utf8");
    const { frontmatter, body } = parseSkillMd(raw);
    if (frontmatter.name !== folderName) return null;
    if (!SKILL_NAME_PATTERN.test(frontmatter.name)) return null;
    if (!frontmatter.description) return null;
    const stat = statSync(dir);
    const enabled = enabledMap.has(frontmatter.name) ? enabledMap.get(frontmatter.name)! : true;
    return {
      name: frontmatter.name,
      description: frontmatter.description,
      license: frontmatter.license,
      compatibility: frontmatter.compatibility,
      metadata: frontmatter.metadata,
      instructions: body,
      rawContent: raw,
      folderName,
      enabled,
      createdAt: stat.ctimeMs,
      updatedAt: stat.mtimeMs,
    };
  } catch {
    return null;
  }
}

function loadEnabledMap(): Map<string, boolean> {
  const dir = getSkillsDir();
  const mapPath = join(dir, ".enabled.json");
  try {
    if (!existsSync(mapPath)) return new Map();
    const raw = readFileSync(mapPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function persistEnabledMap(map: Map<string, boolean>): void {
  const dir = ensureSkillsDir();
  const mapPath = join(dir, ".enabled.json");
  const tmp = join(dir, `.enabled-tmp-${randomUUID().slice(0, 8)}`);
  writeFileSync(tmp, JSON.stringify(Object.fromEntries(map), null, 2), "utf8");
  renameSync(tmp, mapPath);
}

export function listSkills(): SkillPackage[] {
  const dir = ensureSkillsDir();
  const enabledMap = loadEnabledMap();
  const entries = readdirSync(dir, { withFileTypes: true });
  const out: SkillPackage[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".")) continue;
    if (!isValidFolderName(e.name)) continue;
    const pkg = readSkillPackage(e.name, enabledMap);
    if (pkg) out.push(pkg);
  }
  return out;
}

export function getSkill(name: string): SkillPackage | null {
  if (!isValidFolderName(name)) return null;
  const enabledMap = loadEnabledMap();
  return readSkillPackage(name, enabledMap);
}

export function createSkill(input: {
  name: string;
  description: string;
  instructions: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
}): SkillPackage {
  const { name, description, instructions } = input;
  const nameCheck = validateSkillName(name);
  if (!nameCheck.ok) throw new Error(JSON.stringify({ code: "INVALID_NAME_PATTERN", message: nameCheck.reason }));
  if (!description || description.trim().length === 0) throw new Error(JSON.stringify({ code: "MISSING_DESCRIPTION", message: "description required" }));
  const dir = ensureSkillsDir();
  const enabledMap = loadEnabledMap();
  if (existsSync(skillDirFor(name))) throw new Error(JSON.stringify({ code: "DUPLICATE_NAME", message: `Skill ${name} already exists` }));
  const pkgPath = skillDirFor(name);
  mkdirSync(pkgPath, { recursive: true });
  const frontmatter = { name, description: description.trim(), license: input.license, compatibility: input.compatibility, metadata: input.metadata };
  const body = instructions?.trim() ? instructions.trim() : `# Workflow\n\n1. 识别课程\n2. 提取通知内容\n3. 查询已有任务\n4. 生成 Proposal\n5. 用户确认后执行`;
  const raw = serializeSkillMd(frontmatter, body);
  const mdPath = join(pkgPath, "SKILL.md");
  const tmp = join(dirname(mdPath), `.SKILL-tmp-${randomUUID().slice(0, 8)}`);
  writeFileSync(tmp, raw, "utf8");
  renameSync(tmp, mdPath);
  enabledMap.set(name, true);
  persistEnabledMap(enabledMap);
  return {
    name,
    description: description.trim(),
    license: input.license,
    compatibility: input.compatibility,
    metadata: input.metadata,
    instructions: body,
    rawContent: raw,
    folderName: name,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function updateSkill(
  name: string,
  patch: { description?: string; instructions?: string; license?: string; compatibility?: string; metadata?: Record<string, unknown> }
): SkillPackage {
  const existing = getSkill(name);
  if (!existing) throw new Error(JSON.stringify({ code: "NOT_FOUND", message: `Skill not found: ${name}` }));
  const newDescription = patch.description !== undefined ? patch.description.trim() : existing.description;
  if (!newDescription) throw new Error(JSON.stringify({ code: "MISSING_DESCRIPTION", message: "description required" }));
  const newInstructions = patch.instructions !== undefined ? patch.instructions.trim() : existing.instructions;
  const frontmatter = {
    name,
    description: newDescription,
    license: patch.license !== undefined ? patch.license : existing.license,
    compatibility: patch.compatibility !== undefined ? patch.compatibility : existing.compatibility,
    metadata: patch.metadata !== undefined ? patch.metadata : existing.metadata,
  };
  const raw = serializeSkillMd(frontmatter, newInstructions);
  const mdPath = join(skillDirFor(name), "SKILL.md");
  const tmp = join(dirname(mdPath), `.SKILL-tmp-${randomUUID().slice(0, 8)}`);
  writeFileSync(tmp, raw, "utf8");
  renameSync(tmp, mdPath);
  return getSkill(name)!;
}

export function deleteSkill(name: string): void {
  if (!isValidFolderName(name)) throw new Error(JSON.stringify({ code: "FOLDER_TRAVERSAL", message: "invalid name" }));
  const dir = skillDirFor(name);
  if (!existsSync(dir)) throw new Error(JSON.stringify({ code: "NOT_FOUND", message: `Skill not found: ${name}` }));
  rmSync(dir, { recursive: true, force: true });
  const enabledMap = loadEnabledMap();
  enabledMap.delete(name);
  persistEnabledMap(enabledMap);
}

export function setSkillEnabled(name: string, enabled: boolean): void {
  if (!isValidFolderName(name)) throw new Error(JSON.stringify({ code: "FOLDER_TRAVERSAL", message: "invalid name" }));
  const existing = getSkill(name);
  if (!existing) throw new Error(JSON.stringify({ code: "NOT_FOUND", message: `Skill not found: ${name}` }));
  const map = loadEnabledMap();
  map.set(name, enabled);
  persistEnabledMap(map);
}

export function importSkill(sourcePath: string): SkillPackage {
  const base = basename(sourcePath);
  if (!isValidFolderName(base)) throw new Error(JSON.stringify({ code: "FOLDER_TRAVERSAL", message: `invalid import folder: ${base}` }));
  const sourceMd = join(sourcePath, "SKILL.md");
  if (!existsSync(sourceMd)) {
    if (existsSync(sourcePath) && basename(sourcePath) === "SKILL.md") {
      const content = readFileSync(sourcePath, "utf8");
      const { frontmatter, body } = parseSkillMd(content);
      return createSkill({ name: frontmatter.name, description: frontmatter.description, instructions: body, license: frontmatter.license, compatibility: frontmatter.compatibility, metadata: frontmatter.metadata });
    }
    throw new Error(JSON.stringify({ code: "INVALID_FRONTMATTER", message: "SKILL.md not found in import source" }));
  }
  const content = readFileSync(sourceMd, "utf8");
  const { frontmatter, body } = parseSkillMd(content);
  if (frontmatter.name !== base) throw new Error(JSON.stringify({ code: "NAME_MISMATCH", message: `frontmatter.name ${frontmatter.name} != folder ${base}` }));
  const validation = validateSkillPackage({ folderName: base, frontmatter, existingNames: new Set(listSkills().map((s) => s.name)) });
  if (!validation.ok) throw new Error(JSON.stringify({ code: validation.code, message: validation.errors.join("; ") }));
  const targetDir = skillDirFor(base);
  if (existsSync(targetDir)) throw new Error(JSON.stringify({ code: "DUPLICATE_NAME", message: `Skill ${base} already exists` }));
  mkdirSync(targetDir, { recursive: true });
  cpSync(sourcePath, targetDir, { recursive: true, force: true });
  const enabledMap = loadEnabledMap();
  enabledMap.set(base, true);
  persistEnabledMap(enabledMap);
  return getSkill(base)!;
}

export function exportSkill(name: string): string {
  const pkg = getSkill(name);
  if (!pkg) throw new Error(JSON.stringify({ code: "NOT_FOUND", message: `Skill not found: ${name}` }));
  return pkg.rawContent;
}

export function testSkill(name: string): { ok: boolean; errors: string[] } {
  const pkg = getSkill(name);
  if (!pkg) return { ok: false, errors: [`Skill not found: ${name}`] };
  const errors: string[] = [];
  if (!SKILL_NAME_PATTERN.test(pkg.name)) errors.push("INVALID_NAME_PATTERN");
  if (!pkg.description) errors.push("MISSING_DESCRIPTION");
  if (pkg.name !== pkg.folderName) errors.push("NAME_MISMATCH");
  const scriptsDir = join(skillDirFor(name), "scripts");
  if (existsSync(scriptsDir)) {
  }
  return { ok: errors.length === 0, errors };
}

export function __clearAllSkillsForTest(): void {
  const dir = getSkillsDir();
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && isValidFolderName(e.name)) {
      rmSync(join(dir, e.name), { recursive: true, force: true });
    }
  }
  const mapPath = join(dir, ".enabled.json");
  if (existsSync(mapPath)) rmSync(mapPath, { force: true });
}
