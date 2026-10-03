// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { filterSlashSkills, moveSlashIndex, parseSlashQuery } from "@/lib/ai/skills/slashMenu";

const SKILLS = [
  { name: "document-handling", description: "文档" },
  { name: "computer-control", description: "电脑控制" },
  { name: "task-triage", description: "任务" },
];

describe("Slash Skill 菜单逻辑", () => {
  it("只把「输入中的命令」识别为展开状态（选中后带空格 → 折叠）", () => {
    expect(parseSlashQuery("/")).toBe("");
    expect(parseSlashQuery("/doc")).toBe("doc");
    expect(parseSlashQuery("/document-handling")).toBe("document-handling");
    // 选中技能后的文本（尾随空格）不再展开菜单
    expect(parseSlashQuery("/document-handling ")).toBeNull();
    expect(parseSlashQuery("/doc 帮我整理")).toBeNull();
    expect(parseSlashQuery("你好 /doc")).toBeNull();
    expect(parseSlashQuery("")).toBeNull();
  });

  it("前缀过滤（大小写不敏感；空 query 全部）", () => {
    expect(filterSlashSkills(SKILLS, "")).toHaveLength(3);
    expect(filterSlashSkills(SKILLS, "doc").map((s) => s.name)).toEqual(["document-handling"]);
    expect(filterSlashSkills(SKILLS, "COM").map((s) => s.name)).toEqual(["computer-control"]);
    expect(filterSlashSkills(SKILLS, "zzz")).toHaveLength(0);
  });

  it("键盘导航循环且对空列表安全", () => {
    expect(moveSlashIndex(0, 1, 3)).toBe(1);
    expect(moveSlashIndex(2, 1, 3)).toBe(0);
    expect(moveSlashIndex(0, -1, 3)).toBe(2);
    expect(moveSlashIndex(5, 1, 0)).toBe(0);
  });
});

describe("KiroComposer Slash 菜单契约（源码锁定）", () => {
  const src = readFileSync(join(process.cwd(), "components/kiro/KiroComposer.tsx"), "utf8");

  it("不再出现 demo 味表头文案", () => {
    expect(src).not.toContain("已启用 Skills · 输入 /skill-name 显式调用");
    expect(src).not.toContain("输入 /skill-name 显式调用");
  });

  it("菜单使用 listbox/option 语义 + 选中态高亮 + 键盘导航", () => {
    expect(src).toContain('role="listbox"');
    expect(src).toContain('role="option"');
    expect(src).toContain("aria-selected={active}");
    expect(src).toContain("moveSlashIndex");
    expect(src).toContain("handleSlashSelect(target.name)");
  });

  it("/skill 令牌以 chip 形式突出显示（不再是普通文本）", () => {
    expect(src).toContain("font-mono text-[11px] font-bold text-charcoal");
    expect(src).toContain("/{s.name}");
  });

  it("入场动画改为专用 kiro-slash-enter（不再复用 structure-settle 造成位移重叠）", () => {
    expect(src).toContain("kiro-slash-enter");
    expect(src).not.toMatch(/skill-slash-menu[\s\S]{0,200}kiro-structure-settle/);
  });

  it("IME 组词中 Enter 不发送/不导航（isComposing 首行放行）", () => {
    expect(src).toContain("e.nativeEvent.isComposing");
  });

  it("Slash 异步竞态：旧请求晚回不得覆盖新查询（请求 ID 守卫）", () => {
    expect(src).toContain("slashRequestRef");
    expect(src).toMatch(/slashRequestRef\.current !== requestId/);
  });

  it("未配置 AI 服务时禁用发送（有点即静默失败）", () => {
    expect(src).toMatch(/canSend[\s\S]{0,400}configured &&/);
  });

  it("toolbar 窄屏可压缩（label 先缩，不断行不溢出；链路禁 overflow 裁剪保住上弹菜单）", () => {
    // 左右组 + 锚点 wrapper 可收缩（min-w-0），label truncate 生效
    expect(src).toContain('<div ref={addRef} className="relative min-w-0">');
    expect(src).toContain('<div ref={accessRef} className="relative min-w-0">');
    expect(src).toContain('<div ref={modelRef} className="relative min-w-0">');
    const model = readFileSync(join(process.cwd(), "components/kiro/composer/KiroComposerModelControl.tsx"), "utf8");
    const access = readFileSync(join(process.cwd(), "components/kiro/composer/KiroComposerAccessControl.tsx"), "utf8");
    expect(model).toContain("disabled:opacity-40 disabled:cursor-not-allowed min-w-0");
    expect(access).toContain('text-[11px] font-semibold transition-colors min-w-0');
    // toolbar 行禁 overflow 裁剪（上弹菜单会被裁掉）
    const row = src.match(/<div className="flex items-center justify-between gap-2 pt-1\.5">/);
    expect(row).toBeTruthy();
    expect(row![0]).not.toContain("overflow");
  });
});
