/**
 * SKILL.md Parser — portable frontmatter（bounded simple YAML）。
 *
 * 支持范围（明确 contract；不引入重量级 YAML dependency）：
 * - 顶层 scalar：`key: value`（可带单/双引号）
 * - 顶层字符串数组：`key: [a, b]` 或缩进 `- item` 列表
 * - `metadata:` 只接受 scalar 子键（Record<string, string>）；
 *   数组 / 嵌套对象 metadata → INVALID_FRONTMATTER（fail predictably，不 silent reinterpret）
 *
 * Kiro-specific structured metadata（requiredTools / permissions / parameters / kind）不属于
 * frontmatter —— 它们位于 agents/kiro.json（见 lib/ai/skills/kiroManifest.ts）。
 * `triggers` / `capabilities` / `requiredCapabilities` 作为 legacy 字段读取保留，但绝不参与 routing。
 */

import type { SkillFrontmatter } from "@/lib/ai/skills/types";

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/;

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseSimpleYaml(yamlText: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yamlText.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const colonIdx = raw.indexOf(":");
    if (colonIdx === -1) {
      throw new Error(`INVALID_YAML: missing colon at line ${i + 1}: ${raw}`);
    }
    const key = raw.slice(0, colonIdx).trim();
    if (!key) throw new Error(`INVALID_YAML: empty key at line ${i + 1}`);
    const afterColon = raw.slice(colonIdx + 1).trim();

    // 缩进块（metadata: 等）
    if (afterColon === "" && i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) {
      const nested: Record<string, unknown> = {};
      i++;
      while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
        const nestedLine = lines[i];
        const nestedTrim = nestedLine.trim();
        if (nestedTrim === "" || nestedTrim.startsWith("#")) {
          i++;
          continue;
        }
        // 嵌套数组项（缩进 - item）不属于支持范围
        if (/^-\s+/.test(nestedTrim)) {
          throw new Error(`INVALID_FRONTMATTER: nested list not supported at line ${i + 1}`);
        }
        const nColon = nestedTrim.indexOf(":");
        if (nColon === -1) throw new Error(`INVALID_YAML: nested missing colon at line ${i + 1}`);
        const nKey = nestedTrim.slice(0, nColon).trim();
        const nRawVal = nestedTrim.slice(nColon + 1).trim();
        // 嵌套块只支持 scalar（metadata 的 contract）；数组 / 对象 → fail predictably
        if (nRawVal.startsWith("[") || nRawVal.startsWith("{")) {
          throw new Error(
            `INVALID_FRONTMATTER: nested structured value not supported at line ${i + 1} (structured data belongs in agents/kiro.json)`
          );
        }
        nested[nKey] = stripQuotes(nRawVal);
        i++;
      }
      result[key] = nested;
      continue;
    }

    // 行内数组
    if (afterColon.startsWith("[") && afterColon.endsWith("]")) {
      const inner = afterColon.slice(1, -1).trim();
      result[key] = inner === "" ? [] : inner.split(",").map((s) => stripQuotes(s.trim()));
      i++;
      continue;
    }

    // 块数组（- item）
    if (afterColon === "" && i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
      const arr: string[] = [];
      i++;
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        arr.push(stripQuotes(lines[i].replace(/^\s*-\s+/, "").trim()));
        i++;
      }
      result[key] = arr;
      continue;
    }

    result[key] = stripQuotes(afterColon);
    i++;
  }
  return result;
}

/**
 * metadata 归一为 Record<string, string>：
 * - scalar（string / number / boolean）→ String(value)
 * - 数组 / 对象 → INVALID_FRONTMATTER（拒绝，不写 [object Object] 的同类数据）
 */
function normalizeMetadata(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_FRONTMATTER: metadata must be a mapping of scalars");
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null || typeof v === "object") {
      throw new Error(`INVALID_FRONTMATTER: metadata.${k} must be a scalar (structured data belongs in agents/kiro.json)`);
    }
    out[k] = String(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseSkillMd(content: string): { frontmatter: SkillFrontmatter; body: string; rawContent: string } {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("INVALID_YAML: empty SKILL.md");
  }
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error("INVALID_FRONTMATTER: missing --- frontmatter");
  }
  const yamlText = match[1];
  const body = match[2].trim();
  if (!yamlText.trim()) {
    throw new Error("INVALID_YAML: empty frontmatter");
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parseSimpleYaml(yamlText);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith("INVALID_YAML") || msg.startsWith("INVALID_FRONTMATTER")) throw e;
    throw new Error(`INVALID_YAML: ${msg}`);
  }
  if (typeof parsed.name !== "string" || (parsed.name as string).trim() === "") {
    throw new Error("MISSING_NAME: frontmatter.name required");
  }
  if (typeof parsed.description !== "string" || (parsed.description as string).trim() === "") {
    throw new Error("MISSING_DESCRIPTION: frontmatter.description required");
  }
  const frontmatter: SkillFrontmatter = {
    name: String(parsed.name).trim(),
    description: String(parsed.description).trim(),
  };
  if (typeof parsed.license === "string" && parsed.license.trim() !== "") frontmatter.license = String(parsed.license).trim();
  if (typeof parsed.compatibility === "string" && parsed.compatibility.trim() !== "") {
    frontmatter.compatibility = String(parsed.compatibility).trim();
  }
  const metadata = normalizeMetadata(parsed.metadata);
  if (metadata) frontmatter.metadata = metadata;
  // Legacy 字段：读取保留（不参与 routing；structured Kiro metadata 属于 agents/kiro.json）
  if (Array.isArray(parsed.triggers)) {
    frontmatter.legacyTriggers = (parsed.triggers as unknown[]).filter((t): t is string => typeof t === "string");
  }
  const legacyCaps: string[] = [];
  if (Array.isArray(parsed.capabilities)) {
    legacyCaps.push(...(parsed.capabilities as unknown[]).filter((c): c is string => typeof c === "string"));
  }
  if (Array.isArray(parsed.requiredCapabilities)) {
    legacyCaps.push(...(parsed.requiredCapabilities as unknown[]).filter((c): c is string => typeof c === "string"));
  }
  if (legacyCaps.length > 0) frontmatter.legacyCapabilities = [...new Set(legacyCaps)];
  return { frontmatter, body, rawContent: content };
}

export function parseSkillFrontmatterOnly(content: string): SkillFrontmatter {
  return parseSkillMd(content).frontmatter;
}
