// @vitest-environment node
/**
 * P4 安全边界回归：Agent Run / Inline Approval / Approval Presentation 源码不得出现
 * native 标识、raw reasoning、raw tool payload 或内部 id 渲染。
 *
 * 允许的例外：
 * - KiroWorklog.tsx（canonical Timeline Engine）继续按 toolCallId 精确关联 Terminal activity
 *   （既有契约，本次不修改）；本扫描不覆盖该文件。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

/** 注释中的「禁止清单」不应算作违规——扫描前剥离注释 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const RUN_FILES = [
  "components/kiro/run/KiroAgentRun.tsx",
  "components/kiro/run/KiroAgentRunHeader.tsx",
  "components/kiro/run/KiroAgentRunControls.tsx",
  "components/kiro/run/KiroInlineApproval.tsx",
  "components/kiro/run/KiroAgentRunResult.tsx",
  "lib/ai/ui/kiroAgentRun.ts",
  "lib/ai/ui/computerApprovalPresentation.ts",
];

const FORBIDDEN = [
  "adapterRef",
  "nativePath",
  "absolutePath",
  "nativeRef",
  "HWND",
  "PID",
  "elementId",
  "observationId",
  "windowId",
  "toolCallId",
  "snapshot",
  "rawContent",
  "reasoningText",
];

describe("P4 安全边界 — Agent Run / Approval 源码", () => {
  it.each(RUN_FILES)("%s 不含 native 标识 / raw payload / 内部 id", (file) => {
    const source = stripComments(read(file));
    for (const needle of FORBIDDEN) {
      expect(source, `${file} 不应包含 ${needle}`).not.toContain(needle);
    }
  });

  it("Inline Approval 只消费 allowedDecisions，不自行扩展决策", () => {
    const source = stripComments(read("components/kiro/run/KiroInlineApproval.tsx"));
    expect(source).toContain("request.allowedDecisions.map");
    // 不允许写死 allow-session / allow-workspace 决策按钮
    expect(source).not.toContain('"allow-session"');
    expect(source).not.toContain('"allow-workspace"');
  });

  it("Reasoning 只允许压缩 summary：Run 组件不消费 reasoning 原文", () => {
    const run = stripComments(read("components/kiro/run/KiroAgentRun.tsx"));
    expect(run).toContain("reasoningSummary");
    expect(run).not.toContain("reasoningText");
    expect(run).not.toContain("part.text");
  });

  it("Fallback Dialog 保留安全渲染并声明 orphan 语义", () => {
    const raw = read("components/kiro/computer/ComputerApprovalDialog.tsx");
    const dialog = stripComments(raw);
    // 注释（语义声明）在 raw source 中检查
    expect(raw).toContain("Fallback Approval Dialog");
    expect(raw).toContain("orphan");
    expect(dialog).toContain("getComputerApprovalPresentation");
    expect(dialog).toContain("allowedDecisions.map");
    expect(dialog).not.toContain("adapterRef");
    expect(dialog).not.toContain("absolutePath");
    expect(dialog).not.toContain("HWND");
  });

  it("Task Result 不再重复 running steps（去重复化守卫）", () => {
    const result = stripComments(read("components/kiro/run/KiroAgentRunResult.tsx"));
    expect(result).not.toContain("task.steps");
    expect(result).not.toContain("Clock3");
  });
});
