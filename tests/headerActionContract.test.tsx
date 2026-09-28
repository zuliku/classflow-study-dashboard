// @vitest-environment jsdom
/**
 * Header Action Contract 回归（顶栏三层槽位）：
 * L1 状态（quiet，不占操作位）→ L2 操作（页面次要｜AI｜页面主要）→ 全局搜索。
 * 分组用间距，禁止发丝分隔线；条件 AI 操作不进顶栏。
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("Header Action Contract", () => {
  it("Timeline：quiet chip + 无发丝分隔线 + Ask Kiro/新建/搜索俱在", () => {
    const src = read("components/timeline/TimelineWorkspace.tsx");
    // L1：quiet 形态
    expect(src).toContain("<TimelineActiveFocusChip quiet />");
    // 分组：无发丝分隔线（间距即分组）
    expect(src).not.toMatch(/w-px[\s\S]{0,80}?bg-line/);
    // L2 成员俱在：Ask Kiro / More / 新建
    expect(src).toContain('label="Ask Kiro"');
    expect(src).toContain('aria-label="更多操作"');
    expect(src).toContain('aria-label="新建"');
  });

  it("TimelineActiveFocusChip quiet：无边框 pill，有 max 宽约束", () => {
    const src = read("components/timeline/TimelineActiveFocusChip.tsx");
    expect(src).toMatch(/quiet = false/);
    expect(src).toContain("max-w-[180px]");
    // quiet 分支不带 border/bg pill 类
    const quietIdx = src.indexOf('? "max-w-[180px] px-1"');
    expect(quietIdx).toBeGreaterThan(-1);
  });

  it("任务页顶栏：无条件拆解按钮（已归行内），Ask Kiro/新增任务保留", () => {
    const src = read("components/assignment/AssignmentsWorkspace.tsx");
    expect(src).not.toContain("帮我拆解当前任务");
    expect(src).toContain('label="Ask Kiro"');
    expect(src).toContain("新增任务");
  });

  it("任务行内：高亮/hover 拆解入口（Kiro 拆解为步骤）", () => {
    const src = read("components/dashboard/AssignmentTable.tsx");
    expect(src).toContain("Kiro 拆解为步骤");
    expect(src).toContain("handoffAssignmentPrompt");
  });

  it("契约落文档：ui-product-system-v1.md 有 Header Action Contract", () => {
    const doc = read("docs/ui-product-system-v1.md");
    expect(doc).toContain("Header Action Contract");
    expect(doc).toContain("禁止发丝分隔线");
  });
});
