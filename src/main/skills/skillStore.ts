/**
 * Skill Store — Main Process (userData/skills)
 *
 * Canonical package：
 *   <userData>/skills/<skill-name>/
 *   ├── SKILL.md            （portable frontmatter + workflow 正文）
 *   └── agents/kiro.json    （Kiro structured metadata，可选）
 *   + references/ assets/ scripts/（inert resource；scripts 绝不执行）
 *
 * S1 契约：
 * - readSkillPackage = 读 SKILL.md → parse → 读 agents/kiro.json → normalize manifest →
 *   resolveLegacySkillKind → canonical SkillPackage（kind / origin / kiroManifest）；
 * - 旧数据（无 manifest / desktop-* 前缀 / triggers / capabilities）只在读取边界归一，不批量重写磁盘；
 * - malformed manifest 不崩溃：fallback 到 legacy kind（desktop-* → recipe，否则 workflow）；
 * - 写入 atomic-ish：temp + rename；SKILL.md 与 manifest 同一流程，best-effort rollback；
 * - metadata 只允许 scalar（Record<string, string>）——structured Kiro metadata 属于 agents/kiro.json。
 */

import { app } from "electron";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  cpSync,
  renameSync,
} from "node:fs";
import { join, basename, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { parseSkillMd } from "@/lib/ai/skills/parser";
import { validateSkillPackage, validateSkillName } from "@/lib/ai/skills/validator";
import type { KiroSkillKind, SkillPackage } from "@/lib/ai/skills/types";
import { SKILL_NAME_PATTERN } from "@/lib/ai/skills/types";
import {
  KIRO_SKILL_MANIFEST_MAX_BYTES,
  KIRO_SKILL_MANIFEST_LIMITS,
  KIRO_SKILL_MANIFEST_VERSION,
  normalizeKiroSkillManifest,
  parseKiroSkillManifest,
  serializeKiroSkillManifest,
  type KiroSkillManifestV1,
} from "@/lib/ai/skills/kiroManifest";
import { resolveLegacySkillKind } from "@/lib/ai/skills/registry";
import { isKnownKiroSkillTool } from "@/lib/ai/skills/knownTools";

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

function kiroManifestPathFor(name: string): string {
  return join(skillDirFor(name), "agents", "kiro.json");
}

function isValidFolderName(name: string): boolean {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..") || name.includes(":")) return false;
  return SKILL_NAME_PATTERN.test(name);
}

/** metadata 只允许 scalar：非 scalar → 拒绝（绝不写 [object Object]） */
function normalizeScalarMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, string> | undefined {
  if (!metadata) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || typeof value === "object") {
      throw new Error(
        JSON.stringify({
          code: "INVALID_FRONTMATTER",
          message: `metadata.${key} must be a scalar (structured data belongs in agents/kiro.json)`,
        })
      );
    }
    out[key] = String(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function serializeSkillMd(
  frontmatter: {
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    metadata?: Record<string, string>;
    legacyTriggers?: string[];
  },
  body: string
): string {
  const lines: string[] = ["---"];
  lines.push(`name: ${frontmatter.name}`);
  lines.push(`description: ${frontmatter.description}`);
  if (frontmatter.license) lines.push(`license: ${frontmatter.license}`);
  if (frontmatter.compatibility) lines.push(`compatibility: ${frontmatter.compatibility}`);
  if (frontmatter.metadata && Object.keys(frontmatter.metadata).length > 0) {
    lines.push("metadata:");
    for (const [k, v] of Object.entries(frontmatter.metadata)) {
      // v 已由 normalizeScalarMetadata 保证是 scalar string
      lines.push(`  ${k}: ${v}`);
    }
  }
  // legacy triggers：读取保留，update 时原样写回（不参与 routing）
  if (frontmatter.legacyTriggers && frontmatter.legacyTriggers.length > 0) {
    lines.push(`triggers: [${frontmatter.legacyTriggers.map((t) => t.replace(/[[\],]/g, " ")).join(", ")}]`);
  }
  lines.push("---");
  lines.push("");
  lines.push(body.trim());
  lines.push("");
  return lines.join("\n");
}

/** 读取 agents/kiro.json（缺失 / malformed / 超限 → null + bounded warn；绝不抛） */
function readKiroManifest(folderName: string): KiroSkillManifestV1 | null {
  const manifestPath = kiroManifestPathFor(folderName);
  if (!existsSync(manifestPath)) return null;
  try {
    const size = statSync(manifestPath).size;
    if (size > KIRO_SKILL_MANIFEST_MAX_BYTES) {
      console.warn(`[skills] agents/kiro.json exceeds ${KIRO_SKILL_MANIFEST_MAX_BYTES} bytes; ignored`);
      return null;
    }
    const raw = readFileSync(manifestPath, "utf8");
    const manifest = parseKiroSkillManifest(raw);
    if (!manifest) {
      console.warn("[skills] agents/kiro.json is malformed; falling back to legacy kind resolution");
      return null;
    }
    return manifest;
  } catch {
    console.warn("[skills] agents/kiro.json unreadable; falling back to legacy kind resolution");
    return null;
  }
}

function writeFileAtomic(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.tmp-${randomUUID().slice(0, 8)}`);
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
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
    const kiroManifest = readKiroManifest(folderName);
    const kind: KiroSkillKind = resolveLegacySkillKind({
      name: frontmatter.name,
      manifestKind: kiroManifest?.kind ?? null,
    });
    // legacy capabilities（旧文件把 Tool 名写在 capabilities / requiredCapabilities）→ requiredTools
    const legacyTools = frontmatter.legacyCapabilities ?? [];
    const requiredTools = kiroManifest
      ? kiroManifest.requiredTools.length > 0
        ? kiroManifest.requiredTools
        : legacyTools
      : legacyTools;
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
      kind,
      origin: "user",
      ...(kiroManifest ? { kiroManifest } : {}),
      ...(frontmatter.legacyTriggers ? { legacyTriggers: frontmatter.legacyTriggers } : {}),
      ...(requiredTools.length > 0 ? { requiredTools } : {}),
      ...(kiroManifest && kiroManifest.requiredCapabilities.length > 0
        ? { requiredCapabilities: kiroManifest.requiredCapabilities }
        : {}),
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
    let parsed: Record<string, boolean>;
    try {
      parsed = JSON.parse(raw) as Record<string, boolean>;
    } catch (parseErr) {
      // 损坏文件：隔离留证（稳定性审计 BUG-041）。旧行为静默当空 → 全部 skill
      // 恢复 enabled 默认值（true），用户禁用状态无声丢失
      const quarantine = `${mapPath}.corrupt-${Date.now()}`;
      try {
        renameSync(mapPath, quarantine);
      } catch {}
      console.error(`[skills] .enabled.json 损坏，已隔离到 ${quarantine}`, parseErr);
      return new Map();
    }
    return new Map(Object.entries(parsed));
  } catch (e) {
    console.error("[skills] load .enabled.json failed", e);
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

/** create/update 输入的 manifest（可空；非法 → throw INVALID_KIRO_MANIFEST） */
function normalizeManifestInput(input: unknown): KiroSkillManifestV1 | undefined {
  if (input === undefined || input === null) return undefined;
  const manifest = normalizeKiroSkillManifest(input);
  if (!manifest) {
    throw new Error(JSON.stringify({ code: "INVALID_KIRO_MANIFEST", message: "agents/kiro.json manifest is invalid" }));
  }
  return manifest;
}

export function createSkill(input: {
  name: string;
  description: string;
  instructions: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  kiroManifest?: unknown;
}): SkillPackage {
  const { name, description, instructions } = input;
  const nameCheck = validateSkillName(name);
  if (!nameCheck.ok) throw new Error(JSON.stringify({ code: "INVALID_NAME_PATTERN", message: nameCheck.reason }));
  if (!description || description.trim().length === 0) {
    throw new Error(JSON.stringify({ code: "MISSING_DESCRIPTION", message: "description required" }));
  }
  if (description.length > 500) {
    throw new Error(JSON.stringify({ code: "MISSING_DESCRIPTION", message: "description must be ≤ 500 chars" }));
  }
  const scalarMetadata = normalizeScalarMetadata(input.metadata);
  const kiroManifest = normalizeManifestInput(input.kiroManifest);
  const dir = ensureSkillsDir();
  const enabledMap = loadEnabledMap();
  if (existsSync(skillDirFor(name))) throw new Error(JSON.stringify({ code: "DUPLICATE_NAME", message: `Skill ${name} already exists` }));
  const pkgPath = skillDirFor(name);
  mkdirSync(pkgPath, { recursive: true });
  try {
    const body = instructions?.trim()
      ? instructions.trim()
      : `# Workflow\n\n1. 识别课程\n2. 提取通知内容\n3. 查询已有任务\n4. 生成 Proposal\n5. 用户确认后执行`;
    const raw = serializeSkillMd(
      {
        name,
        description: description.trim(),
        license: input.license,
        compatibility: input.compatibility,
        metadata: scalarMetadata,
      },
      body
    );
    writeFileAtomic(join(pkgPath, "SKILL.md"), raw);
    // structured Kiro metadata 单独 sidecar（atomic；失败 → best-effort rollback 整个目录）
    if (kiroManifest) {
      writeFileAtomic(kiroManifestPathFor(name), serializeKiroSkillManifest(kiroManifest));
    }
  } catch (e) {
    try {
      rmSync(pkgPath, { recursive: true, force: true });
    } catch {}
    throw e;
  }
  enabledMap.set(name, true);
  persistEnabledMap(enabledMap);
  return getSkill(name)!;
}

export function updateSkill(
  name: string,
  patch: {
    description?: string;
    instructions?: string;
    license?: string;
    compatibility?: string;
    metadata?: Record<string, unknown>;
    kiroManifest?: unknown;
  }
): SkillPackage {
  const existing = getSkill(name);
  if (!existing) throw new Error(JSON.stringify({ code: "NOT_FOUND", message: `Skill not found: ${name}` }));
  const newDescription = patch.description !== undefined ? patch.description.trim() : existing.description;
  if (!newDescription) throw new Error(JSON.stringify({ code: "MISSING_DESCRIPTION", message: "description required" }));
  if (newDescription.length > 500) {
    throw new Error(JSON.stringify({ code: "MISSING_DESCRIPTION", message: "description must be ≤ 500 chars" }));
  }
  const newInstructions = patch.instructions !== undefined ? patch.instructions.trim() : existing.instructions;
  const scalarMetadata =
    patch.metadata !== undefined ? normalizeScalarMetadata(patch.metadata) : existing.metadata;
  const raw = serializeSkillMd(
    {
      name,
      description: newDescription,
      license: patch.license !== undefined ? patch.license : existing.license,
      compatibility: patch.compatibility !== undefined ? patch.compatibility : existing.compatibility,
      metadata: scalarMetadata,
      // 只改 description / instructions 时保留既有 legacy triggers（不静默破坏旧数据）
      legacyTriggers: existing.legacyTriggers,
    },
    newInstructions
  );
  writeFileAtomic(join(skillDirFor(name), "SKILL.md"), raw);
  // Kiro manifest 独立更新：未提供 patch 时保持现有 sidecar（不重建、不清空）
  if (patch.kiroManifest !== undefined) {
    const manifest = normalizeManifestInput(patch.kiroManifest);
    if (manifest) {
      writeFileAtomic(kiroManifestPathFor(name), serializeKiroSkillManifest(manifest));
    }
  }
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

/** Import 体积上限：SKILL.md 单文件 + 目录拷贝总量（防无界同步 IO/内存 DoS） */
const SKILL_MD_MAX_BYTES = 512 * 1024;
const SKILL_DIR_MAX_BYTES = 8 * 1024 * 1024;

function dirSizeRecursive(dir: string): number {
  let total = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += dirSizeRecursive(p);
    else total += statSync(p).size;
    if (total > SKILL_DIR_MAX_BYTES) return total; // 早退
  }
  return total;
}

export function importSkill(sourcePath: string): SkillPackage {
  const base = basename(sourcePath);
  if (!isValidFolderName(base)) throw new Error(JSON.stringify({ code: "FOLDER_TRAVERSAL", message: `invalid import folder: ${base}` }));
  const sourceMd = join(sourcePath, "SKILL.md");
  if (!existsSync(sourceMd)) {
    if (existsSync(sourcePath) && basename(sourcePath) === "SKILL.md") {
      const content = readFileSync(sourcePath, "utf8");
      const { frontmatter, body } = parseSkillMd(content);
      // 单文件导入：legacy capabilities 归一为 requiredTools（diagnostic），不伪造 manifest
      return createSkill({
        name: frontmatter.name,
        description: frontmatter.description,
        instructions: body,
        license: frontmatter.license,
        compatibility: frontmatter.compatibility,
        metadata: frontmatter.metadata,
      });
    }
    throw new Error(JSON.stringify({ code: "INVALID_FRONTMATTER", message: "SKILL.md not found in import source" }));
  }
  // 体积上限（稳定性审计 BUG-037）：先查单文件，再查整树
  const mdSize = statSync(sourceMd).size;
  if (mdSize > SKILL_MD_MAX_BYTES) {
    throw new Error(JSON.stringify({ code: "SKILL_TOO_LARGE", message: `SKILL.md exceeds ${SKILL_MD_MAX_BYTES} bytes` }));
  }
  const treeSize = dirSizeRecursive(sourcePath);
  if (treeSize > SKILL_DIR_MAX_BYTES) {
    throw new Error(JSON.stringify({ code: "SKILL_TOO_LARGE", message: `Skill folder exceeds ${SKILL_DIR_MAX_BYTES} bytes` }));
  }
  const content = readFileSync(sourceMd, "utf8");
  const { frontmatter, body } = parseSkillMd(content);
  if (frontmatter.name !== base) throw new Error(JSON.stringify({ code: "NAME_MISMATCH", message: `frontmatter.name ${frontmatter.name} != folder ${base}` }));
  const validation = validateSkillPackage({ folderName: base, frontmatter, existingNames: new Set(listSkills().map((s) => s.name)) });
  if (!validation.ok) throw new Error(JSON.stringify({ code: validation.code, message: validation.errors.join("; ") }));
  const targetDir = skillDirFor(base);
  if (existsSync(targetDir)) throw new Error(JSON.stringify({ code: "DUPLICATE_NAME", message: `Skill ${base} already exists` }));
  // S1：外部包里的 agents/kiro.json 会被完整复制（recursive cpSync）；malformed 只 warn，不阻塞导入
  const sourceManifest = join(sourcePath, "agents", "kiro.json");
  if (existsSync(sourceManifest)) {
    try {
      const size = statSync(sourceManifest).size;
      const manifest = size <= KIRO_SKILL_MANIFEST_MAX_BYTES
        ? parseKiroSkillManifest(readFileSync(sourceManifest, "utf8"))
        : null;
      if (!manifest) {
        console.warn("[skills] imported agents/kiro.json is malformed; skill loads via legacy kind resolution");
      }
    } catch {
      console.warn("[skills] imported agents/kiro.json unreadable; skill loads via legacy kind resolution");
    }
  }
  mkdirSync(targetDir, { recursive: true });
  cpSync(sourcePath, targetDir, { recursive: true, force: true });
  const enabledMap = loadEnabledMap();
  enabledMap.set(base, true);
  persistEnabledMap(enabledMap);
  return getSkill(base)!;
}

/**
 * Export（S1 保持不变）：只导出 SKILL.md 文本。
 * 注意：这不是完整 package export —— references/ assets/ scripts/ agents/ 不在其中。
 */
export function exportSkill(name: string): string {
  const pkg = getSkill(name);
  if (!pkg) throw new Error(JSON.stringify({ code: "NOT_FOUND", message: `Skill not found: ${name}` }));
  return pkg.rawContent;
}

/**
 * Deterministic Skill Test（S1 §52）：schema / contract validation（不是 AI eval，也不是 trigger eval）。
 * 覆盖：name / description / SKILL.md parse / Kiro manifest / kind / requiredTools / requiredPermissions / scripts inert。
 */
export function testSkill(name: string): { ok: boolean; errors: string[] } {
  const pkg = getSkill(name);
  if (!pkg) return { ok: false, errors: [`Skill not found: ${name}`] };
  const errors: string[] = [];
  if (!SKILL_NAME_PATTERN.test(pkg.name)) errors.push("INVALID_NAME_PATTERN");
  if (!pkg.description || pkg.description.trim().length === 0) errors.push("MISSING_DESCRIPTION");
  if (pkg.description && pkg.description.length > 500) errors.push("DESCRIPTION_TOO_LONG");
  if (pkg.name !== pkg.folderName) errors.push("NAME_MISMATCH");
  try {
    parseSkillMd(pkg.rawContent);
  } catch (e) {
    errors.push(`SKILL_MD_PARSE_FAILED: ${(e as Error).message}`);
  }
  // Kiro manifest：存在但无法归一 → 错误（说明 sidecar 损坏）
  const manifestPath = kiroManifestPathFor(name);
  if (existsSync(manifestPath)) {
    const manifest = readKiroManifest(name);
    if (!manifest) errors.push("INVALID_KIRO_MANIFEST");
    else {
      if (manifest.version !== KIRO_SKILL_MANIFEST_VERSION) errors.push("UNSUPPORTED_MANIFEST_VERSION");
      if (manifest.kind !== "workflow" && manifest.kind !== "recipe") errors.push("INVALID_KIND");
      if (manifest.requiredTools.length > KIRO_SKILL_MANIFEST_LIMITS.maxRequiredTools) {
        errors.push("TOO_MANY_REQUIRED_TOOLS");
      }
      for (const tool of manifest.requiredTools) {
        if (!isKnownKiroSkillTool(tool)) errors.push(`unknown tool: ${tool}`);
      }
      if (manifest.requiredPermissions.length > KIRO_SKILL_MANIFEST_LIMITS.maxRequiredPermissions) {
        errors.push("TOO_MANY_REQUIRED_PERMISSIONS");
      }
    }
  }
  if (pkg.kind !== "workflow" && pkg.kind !== "recipe") errors.push("INVALID_KIND");
  // scripts 存在也绝不执行（inert resource）
  const scriptsDir = join(skillDirFor(name), "scripts");
  if (existsSync(scriptsDir)) {
    // no-op：scripts 只作为资源保留
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
