import { describe, it, expect } from "vitest";
import { describeBrowserNotificationPermission } from "@/lib/reminders/browserNotifications";

describe("describeBrowserNotificationPermission（Settings V3 Task 4）", () => {
  it("granted → 已授权 / success", () => {
    const r = describeBrowserNotificationPermission("granted");
    expect(r.label).toContain("已授权");
    expect(r.tone).toBe("success");
  });

  it("denied → 真实反映阻止状态，不伪造「已开启」/ warning", () => {
    const r = describeBrowserNotificationPermission("denied");
    expect(r.label).toContain("已阻止");
    expect(r.tone).toBe("warning");
  });

  it("default → 未授权 + 开启时请求 / neutral", () => {
    const r = describeBrowserNotificationPermission("default");
    expect(r.label).toContain("未授权");
    expect(r.tone).toBe("neutral");
  });

  it("unsupported → 提示不支持 / neutral", () => {
    const r = describeBrowserNotificationPermission("unsupported");
    expect(r.label).toContain("不支持");
    expect(r.tone).toBe("neutral");
  });
});
