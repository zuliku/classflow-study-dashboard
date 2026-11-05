import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

describe("Kiro Composer — 发送键位偏好（源码契约）", () => {
  it("Ctrl+Enter 模式下普通 Enter 不发送，Ctrl+Enter 发送", () => {
    const src = readFileSync(join(process.cwd(), "components/kiro/KiroComposer.tsx"), "utf8");
    expect(src).toContain("sendKeyBehavior");
    expect(src).toContain('sendKeyBehavior === "ctrl-enter"');
    expect(src).toContain("e.ctrlKey || e.metaKey");
  });
});
