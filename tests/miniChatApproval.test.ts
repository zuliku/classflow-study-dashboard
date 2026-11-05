import { describe, expect, it } from "vitest";
import { canApproveInMini } from "@/lib/ai/miniChat/approval";
import type { ComputerApprovalRequest } from "@/lib/ai/computer/approval";

function request(over: Partial<ComputerApprovalRequest> = {}): ComputerApprovalRequest {
  return {
    id: "a1",
    toolCallId: "t1",
    taskId: "task1",
    capability: "fs.create",
    risk: "create",
    workspaceId: "ws1",
    workspaceLabel: "课程资料",
    resourceLabel: "notes.md",
    description: "创建文件",
    allowedDecisions: ["deny", "allow-once", "allow-session", "allow-workspace"],
    ...over,
  };
}

describe("canApproveInMini", () => {
  it("低风险前台 allow-once → true", () => {
    expect(canApproveInMini(request())).toBe(true);
  });

  it("destructive / 高危 GUI / 后台静默 → false", () => {
    expect(canApproveInMini(request({ capability: "fs.delete", risk: "destructive" }))).toBe(false);
    expect(
      canApproveInMini(
        request({
          capability: "ui.interact",
          risk: "execute",
          gui: {
            action: "click",
            appName: "微信",
            windowTitle: "文件传输助手",
            targetLabel: "发送",
            riskLevel: "sensitive",
            riskReason: "敏感输入",
            coordinateFallback: false,
          },
        })
      )
    ).toBe(false);
    expect(canApproveInMini(request({ background: true }))).toBe(false);
  });

  it("Runtime 未提供 allow-once → false（即使低风险）", () => {
    expect(canApproveInMini(request({ allowedDecisions: ["deny", "allow-session"] }))).toBe(false);
  });
});
