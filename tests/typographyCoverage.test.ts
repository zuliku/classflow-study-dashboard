import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * 全局字体覆盖回归（源码断言；jsdom 不实现 UA 样式层叠，无法用计算样式验证）：
 * - 表单元素必须显式继承 body 字体（否则按钮/输入/下拉无视界面字体设置）
 * - tailwind font-sans 必须指向 --font-ui（否则未来 font-sans 逃逸设置）
 * - 打包字体仅本地文件，禁止在线字体 CDN（About 文案承诺）
 * - data-ui-font 三档与注册表一致
 */
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("全局字体覆盖", () => {
  it("表单元素继承 body 字体（button/input/select/textarea/optgroup/option）", () => {
    const css = readSrc("app/globals.css");
    for (const el of ["button", "input", "select", "textarea", "optgroup", "option"]) {
      expect(css, el).toContain(el);
    }
    expect(css).toMatch(/button,\s*input,\s*select,\s*textarea,\s*optgroup,\s*option\s*\{[^}]*font:\s*inherit/s);
  });

  it("tailwind font-sans 跟随 --font-ui（不回退系统栈）", () => {
    const config = readSrc("tailwind.config.cjs");
    expect(config).toMatch(/sans:\s*\[\s*"var\(--font-ui\)"/);
  });

  it("打包字体仅本地文件：无在线字体引用", () => {
    const css = readSrc("app/globals.css");
    const fontFaceBlocks = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    // HarmonyOS 4 档 + 思源 VF
    expect(fontFaceBlocks.length).toBe(5);
    for (const block of fontFaceBlocks) {
      expect(block).not.toMatch(/url\(\s*["']?https?:/i);
    }
    // MiSans 仅 local 引用，不打包
    expect(css).not.toMatch(/@font-face[^}]*MiSans/s);
  });

  it("data-ui-font 三档与 body token 链路完整", () => {
    const css = readSrc("app/globals.css");
    for (const preset of ["harmonyos-sans-sc", "source-han-sans-sc", "misan"]) {
      expect(css).toContain(`html[data-ui-font="${preset}"]`);
    }
    expect(css).toMatch(/body\s*\{[^}]*font-family:\s*var\(--font-ui\)/s);
    // 代码/终端/数学公式保持专业字体，不受界面字体影响
    expect(css).toMatch(/\.font-mono\s*\{[^}]*var\(--font-mono\)/s);
    expect(css).toContain("KaTeX_Main");
  });
});
