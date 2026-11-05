// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { TOKEN_COLORS, TOKEN_SEMANTIC, TOKEN_SPACE_PX, TOKEN_TEXT, TOKEN_RADIUS_PX, TOKEN_Z } from "@/lib/tokens";

/**
 * Design Token Contract V1（S1 立约）：
 * app/globals.css :root（唯一真值）↔ tailwind.config.cjs（派生）↔ lib/tokens.ts（JS 镜像）
 * 三方数值一致，一种语义只存在一个真值。
 * 新增 token 先加 :root，再派生；本测试失败即有人单方面改了一源。
 */

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("Token Contract：CSS :root ↔ JS 镜像一致", () => {
  const css = readRepo("app/globals.css");

  it.each([
    ["background", "--background", TOKEN_COLORS.background],
    ["alabaster", "--alabaster", TOKEN_COLORS.alabaster],
    ["stoneBeige", "--stone-beige", TOKEN_COLORS.stoneBeige],
    ["charcoal", "--dark-charcoal", TOKEN_COLORS.charcoal],
    ["sandrift", "--sandrift", TOKEN_COLORS.sandrift],
    ["pastelMint", "--pastel-mint", TOKEN_COLORS.pastelMint],
    ["surface", "--surface", TOKEN_COLORS.surface],
    ["surfaceSoft", "--surface-soft", TOKEN_COLORS.surfaceSoft],
    ["surfaceMuted", "--surface-muted", TOKEN_COLORS.surfaceMuted],
    ["inkPrimary", "--ink-primary", TOKEN_COLORS.inkPrimary],
    ["inkSecondary", "--ink-secondary", TOKEN_COLORS.inkSecondary],
    ["inkMuted", "--ink-muted", TOKEN_COLORS.inkMuted],
  ] as const)("TOKEN_COLORS.%s = %s (%s)", (key, cssVar, value) => {
    expect(css).toMatch(new RegExp(`${cssVar}:\\s*${value.replace("#", "\\#")}`));
    expect(key).toBeTruthy();
  });

  it.each([
    ["danger", "--danger", TOKEN_SEMANTIC.danger],
    ["dangerBg", "--danger-bg", TOKEN_SEMANTIC.dangerBg],
    ["dangerBorder", "--danger-border", TOKEN_SEMANTIC.dangerBorder],
    ["warning", "--warning", TOKEN_SEMANTIC.warning],
    ["warningBg", "--warning-bg", TOKEN_SEMANTIC.warningBg],
    ["warningBorder", "--warning-border", TOKEN_SEMANTIC.warningBorder],
    ["success", "--success", TOKEN_SEMANTIC.success],
    ["successBg", "--success-bg", TOKEN_SEMANTIC.successBg],
    ["successBorder", "--success-border", TOKEN_SEMANTIC.successBorder],
  ] as const)("TOKEN_SEMANTIC.%s = %s (%s)", (key, cssVar, value) => {
    expect(css).toMatch(new RegExp(`${cssVar}:\\s*${value.replace("#", "\\#")}`));
    expect(key).toBeTruthy();
  });

  it.each([
    ["gutterSm", "--gutter-sm", TOKEN_SPACE_PX.gutterSm],
    ["gutterMd", "--gutter-md", TOKEN_SPACE_PX.gutterMd],
    ["shellRail", "--shell-w-rail", TOKEN_SPACE_PX.shellRail],
    ["shellFull", "--shell-w-full", TOKEN_SPACE_PX.shellFull],
  ] as const)("TOKEN_SPACE_PX.%s = %s (%spx)", (key, cssVar, value) => {
    expect(css).toMatch(new RegExp(`${cssVar}:\\s*${value}px`));
    expect(key).toBeTruthy();
  });

  it("S4-3 TOKEN_SPACE_PX[18] = --space-18 (Navigator 预留 72px)", () => {
    expect(TOKEN_SPACE_PX[18]).toBe(72);
    expect(css).toMatch(/--space-18:\s*72px/);
  });

  it.each([
    ["caption", "--text-caption", TOKEN_TEXT.caption.size],
    ["body", "--text-body", TOKEN_TEXT.body.size],
    ["title", "--text-title", TOKEN_TEXT.title.size],
    ["h", "--text-h", TOKEN_TEXT.h.size],
  ] as const)("TOKEN_TEXT.%s = %s (%spx)", (key, cssVar, value) => {
    expect(css).toMatch(new RegExp(`${cssVar}:\\s*${value}px`));
    expect(key).toBeTruthy();
  });

  it.each([
    ["sm", "--r-sm", TOKEN_RADIUS_PX.sm],
    ["md", "--r-md", TOKEN_RADIUS_PX.md],
    ["lg", "--r-lg", TOKEN_RADIUS_PX.lg],
    ["xl", "--r-xl", TOKEN_RADIUS_PX.xl],
    ["xxl", "--r-2xl", TOKEN_RADIUS_PX.xxl],
    ["sidecar", "--r-sidecar", TOKEN_RADIUS_PX.sidecar],
  ] as const)("TOKEN_RADIUS_PX.%s = %s (%spx)", (key, cssVar, value) => {
    expect(css).toMatch(new RegExp(`${cssVar}:\\s*${value}px`));
    expect(key).toBeTruthy();
  });

  it.each([
    ["header", "--z-header", TOKEN_Z.header],
    ["peek", "--z-peek", TOKEN_Z.peek],
    ["sidecar", "--z-sidecar", TOKEN_Z.sidecar],
    ["dialog", "--z-dialog", TOKEN_Z.dialog],
    ["reminder", "--z-reminder", TOKEN_Z.reminder],
    ["titlebar", "--z-titlebar", TOKEN_Z.titlebar],
  ] as const)("TOKEN_Z.%s = %s (%s)", (key, cssVar, value) => {
    expect(css).toMatch(new RegExp(`${cssVar}:\\s*${value};`));
    expect(key).toBeTruthy();
  });
});

describe("Token Contract：tailwind 派生与 :root 同值", () => {
  const tailwind = readRepo("tailwind.config.cjs");
  const css = readRepo("app/globals.css");

  it.each([
    ["background", "#F7F5F5"],
    ["alabaster", "#F0EBE1"],
    ["stone-beige", "#CDB9AB"],
    ["charcoal", "#313032"],
    ["sandrift", "#A48F82"],
    ["pastel-mint", "#E3E6E0"],
    ["surface", "#F4F2EF"],
  ] as const)("tailwind %s 与 :root 同值 (%s)", (name, value) => {
    expect(tailwind).toContain(value);
    expect(css).toContain(value);
  });

  it("tailwind 声明 :root 为唯一真值（派生关系书面化）", () => {
    expect(tailwind).toMatch(/唯一真值/);
  });

  it("radius xl/2xl 既有档位保持不动（零视觉变更）", () => {
    expect(tailwind).toMatch(/xl:\s*"0\.875rem"/);
    expect(tailwind).toMatch(/"2xl":\s*"1\.125rem"/);
  });

  it("transition 默认值必须落 Motion Contract token", () => {
    expect(tailwind).toMatch(/transitionDuration:\s*\{[^}]*DEFAULT:\s*"var\(--motion-fast\)"/s);
    expect(tailwind).toMatch(/transitionTimingFunction:\s*\{[^}]*DEFAULT:\s*"var\(--ease-standard\)"/s);
  });
});
