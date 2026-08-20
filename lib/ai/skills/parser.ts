/**
 * SKILL.md Parser — Kiro Skills 兼容
 * Frontmatter 为 YAML，位于文件顶部 --- ... ---
 */

import type { SkillFrontmatter } from "@/lib/ai/skills/types";

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/;

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
    let valuePart = raw.slice(colonIdx + 1);
    const afterColon = valuePart.trim();
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
        const nColon = nestedTrim.indexOf(":");
        if (nColon === -1) throw new Error(`INVALID_YAML: nested missing colon at line ${i + 1}`);
        const nKey = nestedTrim.slice(0, nColon).trim();
        let nVal = nestedTrim.slice(nColon + 1).trim();
        if ((nVal.startsWith('"') && nVal.endsWith('"')) || (nVal.startsWith("'") && nVal.endsWith("'"))) {
          nVal = nVal.slice(1, -1);
        }
        nested[nKey] = nVal;
        i++;
      }
      result[key] = nested;
      continue;
    }
    let value: unknown = afterColon;
    if (afterColon.startsWith("[") && afterColon.endsWith("]")) {
      const inner = afterColon.slice(1, -1).trim();
      if (inner === "") value = [];
      else value = inner.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
    } else {
      let v = afterColon;
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      value = v;
    }
    if (value === "" && i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
      const arr: string[] = [];
      i++;
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s*-\s+/, "").trim().replace(/^['"]|['"]$/g, "");
        arr.push(item);
        i++;
      }
      result[key] = arr;
      continue;
    }
    result[key] = value;
    i++;
  }
  return result;
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
    if (msg.startsWith("INVALID_YAML")) throw e;
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
  if (typeof parsed.compatibility === "string" && parsed.compatibility.trim() !== "") frontmatter.compatibility = String(parsed.compatibility).trim();
  if (parsed.metadata && typeof parsed.metadata === "object") frontmatter.metadata = parsed.metadata as Record<string, unknown>;
  if (Array.isArray(parsed.triggers)) frontmatter.triggers = parsed.triggers as string[];
  if (Array.isArray(parsed.capabilities)) frontmatter.capabilities = parsed.capabilities as string[];
  if (Array.isArray(parsed.requiredCapabilities)) frontmatter.requiredCapabilities = parsed.requiredCapabilities as string[];
  return { frontmatter, body, rawContent: content };
}

export function parseSkillFrontmatterOnly(content: string): SkillFrontmatter {
  return parseSkillMd(content).frontmatter;
}
