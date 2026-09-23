// @vitest-environment node
/**
 * S1 — SKILL.md Parser + agents/kiro.json Manifest 测试（§62）。
 *
 * 覆盖：portable frontmatter 解析 / scalar metadata round-trip / structured object 不再
 * String(object) / legacy triggers 可读且不参与 routing / manifest 合法与边界 / malformed fallback /
 * metadata 非 scalar 拒绝。
 */
import { describe, it, expect } from "vitest";
import { parseSkillMd } from "@/lib/ai/skills/parser";
import {
  KIRO_SKILL_MANIFEST_LIMITS,
  KIRO_SKILL_MANIFEST_MAX_BYTES,
  KIRO_SKILL_MANIFEST_VERSION,
  normalizeKiroSkillManifest,
  parseKiroSkillManifest,
  serializeKiroSkillManifest,
  kiroSkillManifestFromDraft,
} from "@/lib/ai/skills/kiroManifest";

describe("SKILL.md parser（portable frontmatter）", () => {
  it("portable SKILL.md 正常解析（name / description / body）", () => {
    const content = `---
name: study-planning
description: 制定与调整学习计划，说明何时使用。
---
# Workflow

1. 收集目标
`;
    const { frontmatter, body } = parseSkillMd(content);
    expect(frontmatter.name).toBe("study-planning");
    expect(frontmatter.description).toContain("学习计划");
    expect(body).toContain("收集目标");
    expect(frontmatter.metadata).toBeUndefined();
    expect(frontmatter.legacyTriggers).toBeUndefined();
  });

  it("scalar metadata round-trip（number / boolean → string）", () => {
    const content = `---
name: test-skill
description: desc
metadata:
  version: 1.0
  stable: true
---
body`;
    const { frontmatter } = parseSkillMd(content);
    expect(frontmatter.metadata).toEqual({ version: "1.0", stable: "true" });
  });

  it("structured object metadata → INVALID_FRONTMATTER（绝不 String(object)）", () => {
    const content = `---
name: test-skill
description: desc
metadata:
  parameters: [a, b]
---
body`;
    expect(() => parseSkillMd(content)).toThrow(/INVALID_FRONTMATTER/);
  });

  it("legacy triggers 能读取（保留为 legacyTriggers；不参与 routing）", () => {
    const content = `---
name: test-skill
description: desc
triggers: [课程, 作业]
---
body`;
    const { frontmatter } = parseSkillMd(content);
    expect(frontmatter.legacyTriggers).toEqual(["课程", "作业"]);
  });

  it("legacy capabilities / requiredCapabilities → legacyCapabilities（旧 Tool 名归一）", () => {
    const content = `---
name: test-skill
description: desc
capabilities: [read_material, web_search]
---
body`;
    const { frontmatter } = parseSkillMd(content);
    expect(frontmatter.legacyCapabilities).toEqual(["read_material", "web_search"]);
    // 不产生 canonical requiredCapabilities（那是 manifest 的语义）
    expect((frontmatter as unknown as Record<string, unknown>).requiredCapabilities).toBeUndefined();
  });

  it("unsupported 嵌套列表 → fail predictably（不 silent reinterpret）", () => {
    const content = `---
name: test-skill
description: desc
metadata:
  - a
---
body`;
    expect(() => parseSkillMd(content)).toThrow(/INVALID_FRONTMATTER/);
  });
});

describe("agents/kiro.json manifest（v1）", () => {
  const valid = {
    version: 1,
    kind: "workflow",
    requiredTools: ["get_week_schedule"],
    requiredPermissions: ["read", "propose"],
    requiredCapabilities: ["planning"],
    parameters: [{ name: "course", type: "course", description: "课程", required: true }],
    sourceTurnId: "turn-1",
  };

  it("valid manifest 归一 + serialize round-trip", () => {
    const manifest = normalizeKiroSkillManifest(valid)!;
    expect(manifest.version).toBe(KIRO_SKILL_MANIFEST_VERSION);
    expect(manifest.kind).toBe("workflow");
    const round = parseKiroSkillManifest(serializeKiroSkillManifest(manifest));
    expect(round).toEqual(manifest);
  });

  it("missing manifest → null（调用方 fallback workflow default）", () => {
    expect(parseKiroSkillManifest("")).toBeNull();
  });

  it("malformed manifest → null，不 crash", () => {
    expect(parseKiroSkillManifest("{ not json")).toBeNull();
    expect(normalizeKiroSkillManifest(null)).toBeNull();
    expect(normalizeKiroSkillManifest({ version: 2, kind: "workflow" })).toBeNull();
    expect(normalizeKiroSkillManifest({ version: 1, kind: "core-protocol" })).toBeNull();
  });

  it("explicit manifest workflow 优先于 legacy desktop-* 前缀", async () => {
    const { resolveLegacySkillKind } = await import("@/lib/ai/skills/registry");
    expect(resolveLegacySkillKind({ name: "desktop-x", manifestKind: "workflow" })).toBe("workflow");
    expect(resolveLegacySkillKind({ name: "desktop-x", manifestKind: "recipe" })).toBe("recipe");
  });

  it("manifest arrays bounded（数量 + 字符串长度）", () => {
    const tooMany = normalizeKiroSkillManifest({
      ...valid,
      requiredTools: Array.from({ length: KIRO_SKILL_MANIFEST_LIMITS.maxRequiredTools + 5 }, (_, i) => `tool_${i}`),
    })!;
    expect(tooMany.requiredTools.length).toBe(KIRO_SKILL_MANIFEST_LIMITS.maxRequiredTools);

    const longString = normalizeKiroSkillManifest({
      ...valid,
      requiredCapabilities: ["x".repeat(1000)],
    })!;
    expect(longString.requiredCapabilities[0].length).toBe(KIRO_SKILL_MANIFEST_LIMITS.maxStringLength);

    // 非数组 / 非字符串 → malformed
    expect(normalizeKiroSkillManifest({ ...valid, requiredTools: "get_week_schedule" })).toBeNull();
    expect(normalizeKiroSkillManifest({ ...valid, requiredTools: [1, 2] })).toBeNull();
  });

  it("manifest size bounded（> 64KB → null）", () => {
    const huge = `{"version":1,"kind":"workflow","requiredTools":["${"a".repeat(KIRO_SKILL_MANIFEST_MAX_BYTES)}"]}`;
    expect(parseKiroSkillManifest(huge)).toBeNull();
  });

  it("requiredPermissions allowlist：非法权限被丢弃（绝不存成有效权限）", () => {
    const manifest = normalizeKiroSkillManifest({
      ...valid,
      requiredPermissions: ["read", "admin", "sudo", "always-allow", "write"],
    })!;
    expect(manifest.requiredPermissions).toEqual(["read", "write"]);
  });

  it("kiroSkillManifestFromDraft：draft kind 缺省 workflow；recipe 显式保留", () => {
    expect(kiroSkillManifestFromDraft({ sourceTurnId: "t1" })!.kind).toBe("workflow");
    expect(kiroSkillManifestFromDraft({ kind: "recipe", sourceTurnId: "t1" })!.kind).toBe("recipe");
    expect(kiroSkillManifestFromDraft({ kind: "recipe", requiredPermissions: ["admin"] })!.requiredPermissions).toEqual([]);
  });
});
