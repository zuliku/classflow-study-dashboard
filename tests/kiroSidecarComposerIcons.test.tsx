/**
 * Sidecar Composer 图标化（UX V2）：一级栏只显示图标，文字进二级 popover。
 * 用 renderToStaticMarkup 断言（无需 jsdom）。
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KiroReasoningMenu } from "@/components/kiro/computer/KiroReasoningMenu";
import { KiroAgentModeMenu } from "@/components/kiro/computer/KiroAgentModeMenu";
import { KiroReasoningEffort, ReasoningCapability } from "@/lib/ai/reasoning/types";
import { KiroAgentMode } from "@/lib/ai/computer/types";

const cap: ReasoningCapability = {
  adjustable: true,
  supportedEfforts: ["default", "low", "high", "max"],
  mechanism: "effort",
};

describe("Sidecar compact 一级图标按钮", () => {
  it("KiroReasoningMenu iconOnly：无「思考」文字，仅图标（aria 保留）", () => {
    const html = renderToStaticMarkup(
      <KiroReasoningMenu capability={cap} effort={"high" as KiroReasoningEffort} onChange={() => {}} iconOnly />
    );
    expect(html).not.toContain("思考");
    expect(html).toContain('aria-label="思考程度"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("KiroReasoningMenu 非 iconOnly：仍显示「思考 高」", () => {
    const html = renderToStaticMarkup(
      <KiroReasoningMenu capability={cap} effort={"high" as KiroReasoningEffort} onChange={() => {}} />
    );
    expect(html).toContain("思考 高");
  });

  it("KiroAgentModeMenu iconOnly：无模式文字标签（仅图标）", () => {
    const html = renderToStaticMarkup(
      <KiroAgentModeMenu mode={"guided" as KiroAgentMode} onChange={() => {}} iconOnly />
    );
    expect(html).not.toContain("受控");
    expect(html).toContain('aria-label="权限模式"');
  });

  it("KiroAgentModeMenu 非 iconOnly：显示模式标签", () => {
    const html = renderToStaticMarkup(
      <KiroAgentModeMenu mode={"guided" as KiroAgentMode} onChange={() => {}} />
    );
    expect(html).toContain("受控");
  });
});
