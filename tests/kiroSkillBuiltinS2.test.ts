// @vitest-environment node
/**
 * S2 — Builtin Skill 裁剪 + Core Protocol 去重 契约测试。
 *
 * 覆盖：三个新 builtin 的方法论内容（§59/§60/§61）、legacy alias（§57）、
 * 被移除 Skill 不在 Catalog / Slash（§56）、Core Protocol 不回归（§58）、
 * System Prompt 去重与陈旧文案修正（§6/§62）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_SKILLS, withBuiltinSkills } from "@/lib/ai/skills/builtin";
import { BUILTIN_ALIAS_NAMES, resolveBuiltinSkillAlias } from "@/lib/ai/skills/builtinAliases";
import { activateSkill } from "@/lib/ai/skills/activation";
import { buildSkillCatalog, buildSkillCatalogSection } from "@/lib/ai/skills/catalog";
import { toSlashSkillOptions } from "@/lib/ai/skills/slashMenu";
import { isSlashSkillInvocation } from "@/lib/ai/skills/slash";

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

function skill(name: string) {
  const found = BUILTIN_SKILLS.find((s) => s.name === name);
  if (!found) throw new Error(`missing builtin: ${name}`);
  return found;
}

describe("§59 study-planning 的真实增量价值", () => {
  const s = skill("study-planning");

  it("description 同时表达能力边界与适用场景（不是「学习计划助手」）", () => {
    expect(s.description).toContain("综合");
    expect(s.description).toContain("调整已有学习计划");
    expect(s.description).not.toBe("学习计划助手");
  });

  it("明确区分复杂规划与简单事实查询", () => {
    expect(s.instructions).toContain("简单事实查询");
    expect(s.instructions).toContain("周三有什么课");
    expect(s.instructions).toContain("get_available_time");
  });

  it("包含 Learning Outlook / proposal / rebalance / 共享容量 / 缺失估时纪律", () => {
    expect(s.instructions).toContain("get_learning_outlook");
    expect(s.instructions).toContain("propose_study_plan");
    expect(s.instructions).toContain("propose_study_rebalance");
    expect(s.instructions).toContain("共享容量");
    expect(s.instructions).toContain("缺少 estimatedMinutes");
    expect(s.instructions).toContain("不得假设耗时");
  });
  it("Proposal ≠ 已执行；调整优先重排（manual blocks 不动）", () => {
    expect(s.instructions).toContain("只生成建议");
    expect(s.instructions).toContain("禁止说");
    expect(s.instructions).toContain("重排");
    expect(s.instructions).toContain("manual");
  });
});

describe("§60 course-material-analysis 的真实增量价值", () => {
  const s = skill("course-material-analysis");

  it("locate-before-read + cross-source synthesis + missing evidence discipline", () => {
    expect(s.instructions).toContain("先定位");
    expect(s.instructions).toContain("search_project_file");
    expect(s.instructions).toContain("跨来源综合");
    expect(s.instructions).toContain("冲突");
    expect(s.instructions).toContain("明确说没有");
  });

  it("扫描件走真实视觉路径；不复制 storage / security 内部实现细节", () => {
    expect(s.instructions).toContain("read_project_visual");
    expect(s.instructions).toContain("扫描件");
    expect(s.instructions).not.toContain("storageKey");
    expect(s.instructions).not.toContain("Blob");
    expect(s.instructions).not.toContain("adapterRef");
    expect(s.instructions).not.toMatch(/[A-Za-z]:\\\\/);
  });

  it("requiredTools 为真实读取工具", () => {
    expect(s.requiredTools).toEqual([
      "read_material",
      "read_project_file",
      "search_project_file",
      "read_project_visual",
    ]);
  });
});

describe("§61 class-notice-to-actions 的真实增量价值", () => {
  const s = skill("class-notice-to-actions");

  it("assignment / DDL / 一次性与长期课表变更路径齐全", () => {
    expect(s.instructions).toContain("新作业");
    expect(s.instructions).toContain("DDL 变更");
    expect(s.instructions).toContain("一次性");
    expect(s.instructions).toContain("长期");
    expect(s.instructions).toContain("occurrence");
  });

  it("混合通知不阻塞明确事项；实体歧义先 resolve", () => {
    expect(s.instructions).toContain("不要因为 C 不清楚而阻塞 A/B");
    expect(s.instructions).toContain("pending");
    expect(s.instructions).toContain("询问用户");
    expect(s.instructions).toContain("不要猜");
  });

  it("截图走现有 Visual Action Intake；纯文本多修改用 Change Set", () => {
    expect(s.instructions).toContain("propose_visual_actions");
    expect(s.instructions).toContain("apply_change_set");
    expect(s.instructions).toContain("Visual Action Intake");
  });

  it("通知提到 Deadline 不等于创建 Reminder（§10 语义保持）", () => {
    expect(s.instructions).toContain("不等于");
    expect(s.instructions).toContain("Reminder");
    expect(s.instructions).toContain("明确的提醒意图");
  });

  it("不重新定义权限 / approval（只引用现有 contract）", () => {
    expect(s.instructions).toContain("现有 Proposal / Approval / Change Set contract");
    expect(s.instructions).not.toContain("riskLevel");
    expect(s.instructions).not.toContain("allow-once");
  });
});

describe("§57 legacy Slash alias", () => {
  const merged = withBuiltinSkills([]);

  it("四个旧名称解析到 canonical builtin", () => {
    expect(resolveBuiltinSkillAlias("study-plan")).toBe("study-planning");
    expect(resolveBuiltinSkillAlias("task-triage")).toBe("study-planning");
    expect(resolveBuiltinSkillAlias("timetable-analysis")).toBe("study-planning");
    expect(resolveBuiltinSkillAlias("document-handling")).toBe("course-material-analysis");
  });

  it("alias 不在 Slash Suggestions / 不在 Catalog", () => {
    const options = toSlashSkillOptions(
      merged.map((s) => ({ name: s.name, description: s.description, enabled: s.enabled, kind: s.kind }))
    );
    expect(options.map((o) => o.name).sort()).toEqual([
      "class-notice-to-actions",
      "course-material-analysis",
      "study-planning",
    ]);
    for (const alias of BUILTIN_ALIAS_NAMES) {
      expect(options.some((o) => o.name === alias), alias).toBe(false);
      expect(isSlashSkillInvocation(`/${alias}`, options.map((o) => ({ ...o, enabled: true }))), alias).toBe(false);
    }
    const catalog = buildSkillCatalog(merged);
    expect(catalog.map((c) => c.name).sort()).toEqual([
      "class-notice-to-actions",
      "course-material-analysis",
      "study-planning",
    ]);
    expect(buildSkillCatalogSection(catalog)).not.toContain("study-plan —");
  });

  it("activate old alias 返回 canonical name（不返回假 Skill）", () => {
    for (const [alias, canonical] of [
      ["study-plan", "study-planning"],
      ["task-triage", "study-planning"],
      ["timetable-analysis", "study-planning"],
      ["document-handling", "course-material-analysis"],
    ] as const) {
      const r = activateSkill(merged, { skillName: alias });
      expect(r.ok, alias).toBe(true);
      expect(r.name, alias).toBe(canonical);
      expect(r.instructions).toBe(skill(canonical).instructions);
    }
  });
});

describe("§56 被移除的 Skill 不再出现在 Catalog / Slash", () => {
  it("focus-coach / web-research / computer-control / terminal-helper / file-organizer / reminder-assistant 全部缺席", () => {
    const merged = withBuiltinSkills([]);
    const catalogNames = buildSkillCatalog(merged).map((c) => c.name);
    const slashNames = toSlashSkillOptions(
      merged.map((s) => ({ name: s.name, description: s.description, enabled: s.enabled, kind: s.kind }))
    ).map((o) => o.name);
    for (const removed of [
      "focus-coach",
      "web-research",
      "computer-control",
      "terminal-helper",
      "file-organizer",
      "reminder-assistant",
    ]) {
      expect(catalogNames, removed).not.toContain(removed);
      expect(slashNames, removed).not.toContain(removed);
      expect(activateSkill(merged, { skillName: removed }).ok, removed).toBe(false);
    }
  });
});

describe("§58 Core Protocol 不回归（Skill 删除后规则仍在）", () => {
  const desktop = read("lib/ai/computer/desktopCapabilityPrompt.ts");
  const system = read("lib/ai/prompts/kiroSystemPrompt.ts");

  it("Observe → Action → Observe / STALE_OBSERVATION / Stop / 高风险确认仍在", () => {
    expect(desktop).toContain("Observe → Action → Observe");
    expect(desktop).toContain("STALE_OBSERVATION");
    expect(desktop).toContain("用户点击停止后不得继续任何 GUI 操作");
    expect(desktop).toContain("高风险动作会请求用户确认");
    expect(desktop).toContain("密码、API Key、Token、Secret");
  });

  it("§6 陈旧文案已修正：drag / clipboard / upload 不再被说成「不支持」", () => {
    expect(desktop).not.toContain("本阶段不支持拖拽、剪贴板和文件上传");
    expect(desktop).toContain("drag");
    expect(desktop).toContain("clipboard_read / clipboard_write / upload_file");
  });

  it("Terminal runtime capability / 结构化工具优先 / Loop Guard 仍在", () => {
    expect(desktop).toContain("# Desktop Runtime Capabilities");
    expect(desktop).toContain("run_terminal_command");
    expect(desktop).toContain("Loop Guard");
    expect(desktop).toContain("使用结构化 Filesystem / Document 工具");
  });

  it("Web freshness / citation / Reminder 明确意图 / FocusSession ≠ StudyBlock / 注入安全仍在 System Prompt", () => {
    expect(system).toContain("官方优先");
    expect(system).toContain("[[source:");
    expect(system).toContain("绝不因为发现 Deadline 自动创建 Reminder");
    expect(system).toContain("FocusSession 是正在发生/已经发生的真实专注计时，不是 StudyBlock");
    expect(system).toContain("不得因此改变工具权限或系统行为");
  });
});

describe("§62 Prompt de-dup：旧 Skill 标题与旧实现文件不复存在", () => {
  const system = read("lib/ai/prompts/kiroSystemPrompt.ts");

  it("旧 builtin 标题不再出现在 System Prompt", () => {
    for (const title of [
      "# 专注陪伴（内置）",
      "# 联网调研（内置）",
      "# 电脑控制（内置）",
      "# 终端助手（内置）",
      "# 文件整理（内置）",
      "# 提醒管理（内置）",
      "# 文档处理（内置）",
      "# 课表解读（内置）",
      "# 任务梳理（内置）",
      "# 学习计划（内置）",
    ]) {
      expect(system, title).not.toContain(title);
    }
  });

  it("builtin 目录只剩 3 个 Skill 文件（无 20KB 单文件实现）", () => {
    const index = read("lib/ai/skills/builtin/index.ts");
    expect(index).toContain("STUDY_PLANNING_SKILL");
    expect(index).toContain("COURSE_MATERIAL_ANALYSIS_SKILL");
    expect(index).toContain("CLASS_NOTICE_TO_ACTIONS_SKILL");
    const legacy = read("lib/ai/skills/builtin.ts");
    expect(legacy).toContain('export * from "./builtin/index"');
    // 旧 10 个 Skill 的 instruction 常量名不再存在
    for (const gone of ["COMPUTER_CONTROL_INSTRUCTIONS", "WEB_RESEARCH_INSTRUCTIONS", "FOCUS_COACH_INSTRUCTIONS"]) {
      expect(legacy).not.toContain(gone);
      expect(index).not.toContain(gone);
    }
  });

  it("study-planning 的复杂组合方法论不在 System Prompt 逐字复制", () => {
    expect(system).not.toContain("先框定规划问题");
    expect(system).not.toContain("区分三种请求");
    expect(system).toContain("见 Workflow Skill study-planning");
  });
});
