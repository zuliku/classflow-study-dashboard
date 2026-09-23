// @vitest-environment node
/**
 * S1 — Main Skill Store（userData/skills）读写契约测试（§62/§65/§67）。
 *
 * 覆盖：create 写 SKILL.md + agents/kiro.json；structured metadata 不进入 SKILL.md；
 * scalar metadata round-trip；update description 保留 manifest sidecar；
 * legacy desktop-*（无 manifest）→ recipe；malformed manifest → 不崩溃 fallback；
 * explicit manifest kind 优先；testSkill deterministic 校验；export 只导出 SKILL.md。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const hoisted = vi.hoisted(() => ({ userDataDir: "" }));

vi.mock("electron", () => ({
  app: {
    getPath: () => hoisted.userDataDir,
  },
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}));

import {
  createSkill,
  getSkill,
  listSkills,
  updateSkill,
  exportSkill,
  testSkill,
  deleteSkill,
} from "@/src/main/skills/skillStore";
import { KIRO_SKILL_MANIFEST_VERSION } from "@/lib/ai/skills/kiroManifest";

let skillsDir = "";

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "classflow-skillstore-"));
  hoisted.userDataDir = root;
  skillsDir = join(root, "skills");
});

afterEach(() => {
  if (hoisted.userDataDir) rmSync(hoisted.userDataDir, { recursive: true, force: true });
});

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    version: KIRO_SKILL_MANIFEST_VERSION,
    kind: "workflow",
    requiredTools: ["propose_study_plan"],
    requiredPermissions: ["read", "propose"],
    requiredCapabilities: ["planning"],
    parameters: [{ name: "course", type: "course", description: "课程", required: true }],
    sourceTurnId: "turn-1",
    ...overrides,
  };
}

describe("Main Skill Store — create / read canonical package", () => {
  it("create 写入 SKILL.md + agents/kiro.json；getSkill 返回 kind / origin / manifest", () => {
    const created = createSkill({
      name: "study-planning",
      description: "制定与调整学习计划。",
      instructions: "# Workflow\n\n1. 收集目标",
      kiroManifest: manifest(),
    });
    expect(created.kind).toBe("workflow");
    expect(created.origin).toBe("user");
    expect(existsSync(join(skillsDir, "study-planning", "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillsDir, "study-planning", "agents", "kiro.json"))).toBe(true);

    const read = getSkill("study-planning")!;
    expect(read.kind).toBe("workflow");
    expect(read.kiroManifest?.requiredTools).toEqual(["propose_study_plan"]);
    expect(read.requiredTools).toEqual(["propose_study_plan"]);
    expect(read.requiredCapabilities).toEqual(["planning"]);
    expect(read.kiroManifest?.parameters[0].name).toBe("course");
    expect(read.kiroManifest?.sourceTurnId).toBe("turn-1");
  });

  it("structured Kiro metadata 绝不写入 SKILL.md（无 metadata block / 无 [object Object]）", () => {
    createSkill({
      name: "study-planning",
      description: "desc",
      instructions: "# Workflow",
      kiroManifest: manifest(),
    });
    const md = readFileSync(join(skillsDir, "study-planning", "SKILL.md"), "utf8");
    expect(md).not.toContain("metadata:");
    expect(md).not.toContain("[object Object]");
    expect(md).not.toContain("sourceTurnId");
    expect(md).not.toContain("propose_study_plan");
    // manifest 在 sidecar 中
    const sidecar = readFileSync(join(skillsDir, "study-planning", "agents", "kiro.json"), "utf8");
    expect(sidecar).toContain('"requiredTools"');
    expect(sidecar).toContain('"sourceTurnId"');
  });

  it("scalar metadata round-trip；object metadata → 拒绝（不写坏文件）", () => {
    createSkill({
      name: "with-metadata",
      description: "desc",
      instructions: "# Workflow",
      metadata: { version: 2, stable: true },
    });
    const read = getSkill("with-metadata")!;
    expect(read.metadata).toEqual({ version: "2", stable: "true" });

    expect(() =>
      createSkill({
        name: "bad-metadata",
        description: "desc",
        instructions: "# Workflow",
        metadata: { parameters: [{ name: "x" }] as unknown as string },
      })
    ).toThrow(/INVALID_FRONTMATTER/);
    expect(existsSync(join(skillsDir, "bad-metadata"))).toBe(false);
  });

  it("updateSkill(description) 保留既有 manifest sidecar（不重建 / 不清空）", () => {
    createSkill({
      name: "study-planning",
      description: "old",
      instructions: "# Workflow",
      kiroManifest: manifest(),
    });
    updateSkill("study-planning", { description: "new description" });
    const read = getSkill("study-planning")!;
    expect(read.description).toBe("new description");
    expect(read.kiroManifest?.requiredTools).toEqual(["propose_study_plan"]);
    expect(read.kiroManifest?.parameters[0].name).toBe("course");
    expect(read.kiroManifest?.sourceTurnId).toBe("turn-1");
  });

  it("legacy triggers：读取保留，update description 后不丢（不参与 routing）", () => {
    createSkill({ name: "legacy-triggers", description: "desc", instructions: "# Workflow" });
    // 手工写入 legacy triggers（模拟旧用户文件）
    const mdPath = join(skillsDir, "legacy-triggers", "SKILL.md");
    const original = readFileSync(mdPath, "utf8");
    writeFileSync(mdPath, original.replace("description: desc", "description: desc\ntriggers: [课程, 作业]"), "utf8");
    expect(getSkill("legacy-triggers")!.legacyTriggers).toEqual(["课程", "作业"]);

    updateSkill("legacy-triggers", { description: "updated" });
    const read = getSkill("legacy-triggers")!;
    expect(read.description).toBe("updated");
    expect(read.legacyTriggers).toEqual(["课程", "作业"]);
  });

  it("export 只导出 SKILL.md 文本（不是完整 package export）", () => {
    createSkill({
      name: "study-planning",
      description: "desc",
      instructions: "# Workflow",
      kiroManifest: manifest(),
    });
    const exported = exportSkill("study-planning");
    expect(exported).toContain("name: study-planning");
    expect(exported).not.toContain('"version"');
    expect(exported).not.toContain("requiredTools");
  });

  it("deleteSkill 清理目录", () => {
    createSkill({ name: "temp-skill", description: "desc", instructions: "# Workflow" });
    deleteSkill("temp-skill");
    expect(getSkill("temp-skill")).toBeNull();
  });
});

describe("Main Skill Store — legacy / malformed manifest 兼容", () => {
  function seedSkillMd(name: string, extra = ""): void {
    const dir = join(skillsDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: seeded${extra}\n---\n\n# Workflow\n\n1. step\n`,
      "utf8"
    );
  }

  it("无 manifest 的普通 Skill → workflow default", () => {
    seedSkillMd("plain-skill");
    expect(getSkill("plain-skill")!.kind).toBe("workflow");
  });

  it("desktop-* legacy（无 manifest）→ recipe", () => {
    seedSkillMd("desktop-wechat-send-file");
    const pkg = getSkill("desktop-wechat-send-file")!;
    expect(pkg.kind).toBe("recipe");
    expect(pkg.origin).toBe("user");
  });

  it("explicit manifest kind=workflow 优先于 desktop-* 前缀", () => {
    seedSkillMd("desktop-explicit");
    mkdirSync(join(skillsDir, "desktop-explicit", "agents"), { recursive: true });
    writeFileSync(
      join(skillsDir, "desktop-explicit", "agents", "kiro.json"),
      JSON.stringify({ version: 1, kind: "workflow", requiredTools: [], requiredPermissions: [], requiredCapabilities: [], parameters: [], sourceTurnId: "" }),
      "utf8"
    );
    expect(getSkill("desktop-explicit")!.kind).toBe("workflow");
  });

  it("malformed manifest → skill 仍可加载（fallback kind），不崩溃", () => {
    seedSkillMd("broken-manifest");
    mkdirSync(join(skillsDir, "broken-manifest", "agents"), { recursive: true });
    writeFileSync(join(skillsDir, "broken-manifest", "agents", "kiro.json"), "{ not json", "utf8");
    const pkg = getSkill("broken-manifest")!;
    expect(pkg).not.toBeNull();
    expect(pkg.kind).toBe("workflow");
    expect(pkg.kiroManifest).toBeUndefined();

    seedSkillMd("desktop-broken");
    mkdirSync(join(skillsDir, "desktop-broken", "agents"), { recursive: true });
    writeFileSync(join(skillsDir, "desktop-broken", "agents", "kiro.json"), "{ not json", "utf8");
    expect(getSkill("desktop-broken")!.kind).toBe("recipe");
  });

  it("legacy capabilities（旧文件 Tool 名）→ requiredTools 诊断，不当作 requiredCapabilities", () => {
    const dir = join(skillsDir, "legacy-caps");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      `---\nname: legacy-caps\ndescription: desc\ncapabilities: [read_material, web_search]\n---\n\n# Workflow\n`,
      "utf8"
    );
    const pkg = getSkill("legacy-caps")!;
    expect(pkg.requiredTools).toEqual(["read_material", "web_search"]);
    expect(pkg.requiredCapabilities).toBeUndefined();
  });

  it("listSkills 不因 malformed manifest 崩溃（多个 skill 一起读）", () => {
    seedSkillMd("ok-skill");
    seedSkillMd("broken-manifest");
    mkdirSync(join(skillsDir, "broken-manifest", "agents"), { recursive: true });
    writeFileSync(join(skillsDir, "broken-manifest", "agents", "kiro.json"), "{ not json", "utf8");
    const names = listSkills().map((s) => s.name).sort();
    expect(names).toEqual(["broken-manifest", "ok-skill"]);
  });
});

describe("Main Skill Store — deterministic testSkill（schema / contract）", () => {
  it("合法 skill → ok", () => {
    createSkill({
      name: "study-planning",
      description: "制定与调整学习计划。",
      instructions: "# Workflow",
      kiroManifest: manifest(),
    });
    expect(testSkill("study-planning")).toEqual({ ok: true, errors: [] });
  });

  it("unknown tool → error；external MCP 名字不误判", () => {
    createSkill({
      name: "with-unknown-tool",
      description: "desc",
      instructions: "# Workflow",
      kiroManifest: manifest({ requiredTools: ["not_a_real_tool"] }),
    });
    expect(testSkill("with-unknown-tool").errors).toContain("unknown tool: not_a_real_tool");

    createSkill({
      name: "with-mcp-tool",
      description: "desc",
      instructions: "# Workflow",
      kiroManifest: manifest({ requiredTools: ["mcp_calendar_create_event"] }),
    });
    expect(testSkill("with-mcp-tool").ok).toBe(true);
  });

  it("illegal permission 在 create 时被丢弃（绝不存成有效权限）", () => {
    createSkill({
      name: "with-admin",
      description: "desc",
      instructions: "# Workflow",
      kiroManifest: manifest({ requiredPermissions: ["read", "admin", "always-allow"] }),
    });
    expect(getSkill("with-admin")!.kiroManifest?.requiredPermissions).toEqual(["read"]);
  });

  it("malformed manifest → INVALID_KIRO_MANIFEST error（可诊断，不崩溃）", () => {
    const dir = join(skillsDir, "broken-manifest");
    mkdirSync(join(dir, "agents"), { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: broken-manifest\ndescription: desc\n---\n\n# Workflow\n`, "utf8");
    writeFileSync(join(dir, "agents", "kiro.json"), "{ not json", "utf8");
    const result = testSkill("broken-manifest");
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("INVALID_KIRO_MANIFEST");
  });
});
