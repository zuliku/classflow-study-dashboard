/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { SearchField } from "@/components/ui/SearchField";

afterEach(() => cleanup());

/**
 * S2-2 输入控件焦点环：
 * - Input/Textarea 的 focus:outline-none 会覆盖全局 :focus-visible 环（specificity），
 *   必须显式补回与 Button 同款 ring；SearchField 经 Input 继承。
 * - 全局规则收敛到 S1 --ring* token。
 */
describe("Input/Textarea focus-visible ring", () => {
  it("Input 携带 focus-visible ring（与 Button 同款）", () => {
    render(<Input aria-label="t" />);
    const el = screen.getByLabelText("t");
    expect(el.className).toContain("focus-visible:outline-2");
    expect(el.className).toContain("focus-visible:outline-charcoal/30");
  });

  it("Textarea 携带 focus-visible ring", () => {
    render(<Textarea aria-label="t" />);
    const el = screen.getByLabelText("t");
    expect(el.className).toContain("focus-visible:outline-2");
    expect(el.className).toContain("focus-visible:outline-charcoal/30");
  });

  it("SearchField 经 Input 继承 ring", () => {
    render(<SearchField aria-label="s" />);
    const el = screen.getByLabelText("s");
    expect(el.className).toContain("focus-visible:outline-2");
  });

  it("全局 :focus-visible 规则收敛到 S1 --ring* token", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toMatch(/outline:\s*var\(--ring-width\)\s+solid\s+var\(--ring\)/);
    expect(css).toMatch(/outline-offset:\s*var\(--ring-offset\)/);
  });
});
