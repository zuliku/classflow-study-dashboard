// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  DEFAULT_APP_READY_WAIT_MS,
  DEFAULT_APP_SETTLE_MS,
  DESKTOP_APP_PROFILES,
  desktopAppProfileInfo,
  desktopAppProfileRiskHint,
  desktopAppReadyWaitMs,
  desktopAppSettleMs,
  resolveDesktopAppProfile,
} from "@/src/main/computer/appProfiles";

describe("V2.4 应用画像 — 进程名匹配", () => {
  it("大小写 / .exe / 空白归一后精确匹配", () => {
    expect(resolveDesktopAppProfile({ appName: "chrome" })?.id).toBe("browser");
    expect(resolveDesktopAppProfile({ appName: " Chrome " })?.id).toBe("browser");
    expect(resolveDesktopAppProfile({ appName: "WeChat.exe" })?.id).toBe("im");
    expect(resolveDesktopAppProfile({ appName: "WINWORD" })?.id).toBe("office");
    expect(resolveDesktopAppProfile({ appName: "SystemSettings" })?.id).toBe("settings");
    expect(resolveDesktopAppProfile({ appName: "explorer" })?.id).toBe("explorer");
  });

  it("未知应用 / 空输入 → null", () => {
    expect(resolveDesktopAppProfile({ appName: "my-random-tool" })).toBeNull();
    expect(resolveDesktopAppProfile({ appName: "" })).toBeNull();
    expect(resolveDesktopAppProfile({ appName: null, windowTitle: null })).toBeNull();
    expect(resolveDesktopAppProfile({ appName: undefined })).toBeNull();
  });

  it("进程名不匹配时不误判（标题为空）", () => {
    expect(resolveDesktopAppProfile({ appName: "chromedriver" })).toBeNull();
    expect(resolveDesktopAppProfile({ appName: "chrome_helper" })).toBeNull();
  });
});

describe("V2.4 应用画像 — 标题匹配（受保护应用）", () => {
  it("银行 / 支付标题 → blocked（浏览器内网银页面同样拦截）", () => {
    const inBrowser = resolveDesktopAppProfile({
      appName: "chrome",
      windowTitle: "中国工商银行个人网上银行 - Google Chrome",
    });
    expect(inBrowser?.id).toBe("banking");
    expect(inBrowser?.blocked).toBe(true);

    const unknownProcess = resolveDesktopAppProfile({
      appName: "unknown-app",
      windowTitle: "个人网上银行 登录",
    });
    expect(unknownProcess?.id).toBe("banking");
    expect(unknownProcess?.blocked).toBe(true);

    // 普通浏览器页面不受影响
    expect(
      resolveDesktopAppProfile({ appName: "chrome", windowTitle: "ClassFlow 文档 - Google Chrome" })?.id
    ).toBe("browser");
  });

  it("密码管理器 / 系统安全界面 → blocked + 原因", () => {
    const passwordManager = resolveDesktopAppProfile({ appName: "bitwarden" });
    expect(passwordManager?.blocked).toBe(true);
    expect(passwordManager?.reason).toContain("密码");

    const security = resolveDesktopAppProfile({ appName: "consent" });
    expect(security?.id).toBe("security-ui");
    expect(security?.blocked).toBe(true);
    expect(security?.reason).toContain("系统安全");
  });

  it("标题模式过长 / 非法正则不影响解析（内置常量防御）", () => {
    // 超长标题会被截断，不应抛错
    const longTitle = "设置".repeat(500);
    expect(() => resolveDesktopAppProfile({ appName: "", windowTitle: longTitle })).not.toThrow();
  });
});

describe("V2.4 应用画像 — 时序与风险提示", () => {
  it("画像 settle / readyWait 生效；未知应用回退默认值", () => {
    const browser = resolveDesktopAppProfile({ appName: "chrome" });
    const office = resolveDesktopAppProfile({ appName: "winword" });
    expect(desktopAppSettleMs(browser)).toBe(250);
    expect(desktopAppSettleMs(office)).toBe(300);
    expect(desktopAppReadyWaitMs(office)).toBe(900);
    expect(desktopAppSettleMs(null)).toBe(DEFAULT_APP_SETTLE_MS);
    expect(desktopAppReadyWaitMs(null)).toBe(DEFAULT_APP_READY_WAIT_MS);
  });

  it("即时通讯画像包含高风险控件模式（转账 / 红包 / 发送）", () => {
    const im = resolveDesktopAppProfile({ appName: "wechat" });
    const patterns = im?.riskyNamePatterns.join("|") ?? "";
    expect(patterns).toContain("转账");
    expect(patterns).toContain("红包");
    expect(patterns).toContain("发送");
    const hint = desktopAppProfileRiskHint(im);
    expect(hint?.blocked).toBe(false);
    expect(hint?.label).toBe("即时通讯");
  });

  it("info / hint 已脱敏（只含 id / label / blocked；无路径字段）", () => {
    const profile = resolveDesktopAppProfile({ appName: "1password" });
    const info = desktopAppProfileInfo(profile);
    expect(info).toEqual({ id: "password-manager", label: "密码管理器", blocked: true });
    const hint = desktopAppProfileRiskHint(profile);
    expect(hint && Object.keys(hint).sort()).toEqual([
      "blocked",
      "id",
      "label",
      "reason",
      "riskyNamePatterns",
    ]);
    expect(desktopAppProfileInfo(null)).toBeNull();
    expect(desktopAppProfileRiskHint(null)).toBeUndefined();
  });

  it("画像表内 blocked 项都有原因，非 blocked 项原因为 null", () => {
    for (const profile of DESKTOP_APP_PROFILES) {
      if (profile.blocked) expect(profile.reason).toBeTruthy();
      else expect(profile.reason).toBeNull();
      expect(profile.readyWaitMs).toBeGreaterThan(0);
      expect(profile.settleMs).toBeGreaterThan(0);
    }
  });
});
