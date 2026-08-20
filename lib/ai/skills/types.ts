/**
 * Kiro Skill Core V1 — Types (Agent Skills / Kiro Skills 兼容)
 * Skill 包 = skill-name/SKILL.md + references/ + assets/ + scripts/ (scripts 不自动执行)
 */

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SkillName = string;

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  triggers?: string[];
  capabilities?: string[];
  requiredCapabilities?: string[];
}

export interface SkillPackage {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  instructions: string;
  rawContent: string;
  folderName: string;
  enabled: boolean;
  triggers?: string[];
  requiredCapabilities?: string[];
  permissionsNote?: string;
  lastUsedAt?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface SkillCatalogEntry {
  name: string;
  description: string;
  enabled: boolean;
}

export interface SkillActivationResult {
  ok: boolean;
  name?: string;
  description?: string;
  instructions?: string;
  requiredCapabilities?: string[];
  metadata?: Record<string, unknown>;
  error?: string;
  code?: string;
}

export type SkillValidationCode =
  | "VALID"
  | "INVALID_YAML"
  | "MISSING_NAME"
  | "MISSING_DESCRIPTION"
  | "NAME_MISMATCH"
  | "INVALID_NAME_PATTERN"
  | "DUPLICATE_NAME"
  | "FOLDER_TRAVERSAL"
  | "INVALID_FRONTMATTER";

export interface SkillValidationResult {
  ok: boolean;
  code: SkillValidationCode;
  errors: string[];
}

export interface SkillImportResult {
  ok: boolean;
  skill?: SkillPackage;
  code?: SkillValidationCode;
  errors?: string[];
}

export const SKILL_PERMISSIONS_NOTE =
  "Skill cannot elevate permissions. Skill instructions provide workflow guidance only and do not grant system authority.";
