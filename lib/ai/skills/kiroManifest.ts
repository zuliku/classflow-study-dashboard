/**
 * Kiro Skill Manifest V1（agents/kiro.json）— Kiro-specific structured metadata。
 *
 * 为什么单独 sidecar：
 * - SKILL.md 的 metadata 是 portable scalar contract（Record<string, string>）；
 * - requiredTools / requiredPermissions / requiredCapabilities / parameters / sourceTurnId
 *   属于 Kiro Runtime 的 structured metadata，塞进 SKILL.md 会造成 round-trip 损坏
 *   （String(object) / [object Object]）与语义漂移。
 *
 * 契约：
 * - 文件位置：<skill>/agents/kiro.json；整个文件 ≤ 64 KB；
 * - 所有数组有数量 bound，所有字符串有长度 bound；
 * - requiredPermissions 只允许 allowlist enum（read / propose / write）——
 *   「想使用什么权限类别」≠「授予权限」；Skill 永远不能提权；
 * - malformed manifest 绝不导致 Skill 系统崩溃（调用方 fallback 到 legacy kind 推导）。
 */
import type { KiroSkillKind, SkillParameter } from "@/lib/ai/skills/types";

export const KIRO_SKILL_MANIFEST_VERSION = 1;
export const KIRO_SKILL_MANIFEST_MAX_BYTES = 64 * 1024;

export const KIRO_SKILL_MANIFEST_LIMITS = {
  maxRequiredTools: 32,
  maxRequiredPermissions: 16,
  maxRequiredCapabilities: 16,
  maxParameters: 32,
  maxExamples: 0,
  maxStringLength: 200,
  maxSourceTurnIdLength: 120,
} as const;

/** Skill 可请求的权限类别 allowlist（模型 / 用户都不能扩权） */
export const KIRO_SKILL_PERMISSIONS = ["read", "propose", "write"] as const;
export type KiroSkillPermission = (typeof KIRO_SKILL_PERMISSIONS)[number];

export const KIRO_SKILL_PARAMETER_TYPES = [
  "string",
  "number",
  "date",
  "course",
  "assignment",
  "deadline",
] as const;

export interface KiroSkillManifestV1 {
  version: typeof KIRO_SKILL_MANIFEST_VERSION;
  kind: KiroSkillKind;
  requiredTools: string[];
  requiredPermissions: KiroSkillPermission[];
  requiredCapabilities: string[];
  parameters: SkillParameter[];
  sourceTurnId: string;
}

function boundString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  return trimmed.slice(0, maxLength);
}

function boundStringArray(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    const s = boundString(item, maxLength);
    if (s === null) return null;
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** 权限归一：只保留 allowlist 内条目（非法权限被丢弃，绝不存成有效权限） */
export function normalizeKiroSkillPermissions(value: unknown): KiroSkillPermission[] {
  if (!Array.isArray(value)) return [];
  const out: KiroSkillPermission[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const permission = item.trim() as KiroSkillPermission;
    if ((KIRO_SKILL_PERMISSIONS as readonly string[]).includes(permission) && !out.includes(permission)) {
      out.push(permission);
    }
    if (out.length >= KIRO_SKILL_MANIFEST_LIMITS.maxRequiredPermissions) break;
  }
  return out;
}

function normalizeParameters(value: unknown): SkillParameter[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: SkillParameter[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const rec = item as Record<string, unknown>;
    const name = boundString(rec.name, KIRO_SKILL_MANIFEST_LIMITS.maxStringLength);
    if (!name) return null;
    const type = typeof rec.type === "string" && (KIRO_SKILL_PARAMETER_TYPES as readonly string[]).includes(rec.type)
      ? (rec.type as SkillParameter["type"])
      : "string";
    const description = boundString(rec.description, KIRO_SKILL_MANIFEST_LIMITS.maxStringLength) ?? "";
    const example = rec.example === undefined ? undefined : boundString(rec.example, KIRO_SKILL_MANIFEST_LIMITS.maxStringLength) ?? undefined;
    out.push({
      name,
      type,
      description,
      required: rec.required !== false,
      ...(example !== undefined ? { example } : {}),
    });
    if (out.length >= KIRO_SKILL_MANIFEST_LIMITS.maxParameters) break;
  }
  return out;
}

/**
 * 归一化 manifest（未知 / malformed / 越界 → null；调用方 fallback）。
 * 注意：这里不做「猜测修复」——version 必须显式 1，kind 必须是 workflow / recipe。
 */
export function normalizeKiroSkillManifest(input: unknown): KiroSkillManifestV1 | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const rec = input as Record<string, unknown>;
  if (rec.version !== KIRO_SKILL_MANIFEST_VERSION) return null;
  if (rec.kind !== "workflow" && rec.kind !== "recipe") return null;
  const requiredTools = rec.requiredTools === undefined ? [] : boundStringArray(rec.requiredTools, KIRO_SKILL_MANIFEST_LIMITS.maxRequiredTools, KIRO_SKILL_MANIFEST_LIMITS.maxStringLength);
  if (requiredTools === null) return null;
  const requiredCapabilities = rec.requiredCapabilities === undefined ? [] : boundStringArray(rec.requiredCapabilities, KIRO_SKILL_MANIFEST_LIMITS.maxRequiredCapabilities, KIRO_SKILL_MANIFEST_LIMITS.maxStringLength);
  if (requiredCapabilities === null) return null;
  const parameters = normalizeParameters(rec.parameters);
  if (parameters === null) return null;
  const sourceTurnId = boundString(rec.sourceTurnId ?? "", KIRO_SKILL_MANIFEST_LIMITS.maxSourceTurnIdLength);
  if (sourceTurnId === null) return null;
  return {
    version: KIRO_SKILL_MANIFEST_VERSION,
    kind: rec.kind,
    requiredTools,
    requiredPermissions: normalizeKiroSkillPermissions(rec.requiredPermissions),
    requiredCapabilities,
    parameters,
    sourceTurnId,
  };
}

/** 解析 agents/kiro.json（JSON parse 失败 / 超限 / malformed → null；不抛异常） */
export function parseKiroSkillManifest(jsonText: string): KiroSkillManifestV1 | null {
  if (typeof jsonText !== "string") return null;
  if (jsonText.length > KIRO_SKILL_MANIFEST_MAX_BYTES) return null;
  try {
    return normalizeKiroSkillManifest(JSON.parse(jsonText));
  } catch {
    return null;
  }
}

/** 序列化（稳定字段顺序；只写 canonical 字段） */
export function serializeKiroSkillManifest(manifest: KiroSkillManifestV1): string {
  return `${JSON.stringify(
    {
      version: KIRO_SKILL_MANIFEST_VERSION,
      kind: manifest.kind,
      requiredTools: manifest.requiredTools,
      requiredPermissions: manifest.requiredPermissions,
      requiredCapabilities: manifest.requiredCapabilities,
      parameters: manifest.parameters,
      sourceTurnId: manifest.sourceTurnId,
    },
    null,
    2
  )}\n`;
}

/** 从 SkillDraft（用户确认后的 draft）构造 manifest（normalize 后返回） */
export function kiroSkillManifestFromDraft(draft: {
  kind?: KiroSkillKind;
  requiredTools?: string[];
  requiredPermissions?: string[];
  requiredCapabilities?: string[];
  parameters?: SkillParameter[];
  sourceTurnId?: string;
}): KiroSkillManifestV1 | null {
  return normalizeKiroSkillManifest({
    version: KIRO_SKILL_MANIFEST_VERSION,
    kind: draft.kind === "recipe" ? "recipe" : "workflow",
    requiredTools: draft.requiredTools ?? [],
    requiredPermissions: draft.requiredPermissions ?? [],
    requiredCapabilities: draft.requiredCapabilities ?? [],
    parameters: draft.parameters ?? [],
    sourceTurnId: draft.sourceTurnId ?? "",
  });
}
