import { describe, it, expect } from "vitest";
import { validateIpcSender } from "@/lib/security/ipcSender";
import { PRODUCTION_CSP, validateProductionCsp, getCspHeader } from "@/lib/security/csp";
import { validateExternalUrl, decideNavigation } from "@/lib/security/navigation";
import { SECURE_WINDOW_OPTIONS, assertSecureWindowOptions } from "@/lib/security/electronConfig";
import { ELECTRON_BASELINE, isStableElectronVersion } from "@/lib/desktop/electronBaseline";

describe("Security Baseline — Task 01/02", () => {
  it("1. Renderer sandbox 为 true", () => {
    expect(SECURE_WINDOW_OPTIONS.webPreferences.sandbox).toBe(true);
    expect(assertSecureWindowOptions({ sandbox: true, contextIsolation: true, nodeIntegration: false }).ok).toBe(true);
  });

  it("2. nodeIntegration 为 false", () => {
    expect(SECURE_WINDOW_OPTIONS.webPreferences.nodeIntegration).toBe(false);
  });

  it("3. contextIsolation 为 true", () => {
    expect(SECURE_WINDOW_OPTIONS.webPreferences.contextIsolation).toBe(true);
  });

  it("4. 非受信任 sender 无法调用 Filesystem IPC", () => {
    const res = validateIpcSender("bridge:fs:readText", { destroyed: false, isTrustedWindow: false, url: "app://bundle/index.html" });
    expect(res.ok).toBe(false);
    const res2 = validateIpcSender("bridge:fs:list", { destroyed: false, isTrustedWindow: true, url: "https://evil.com" });
    expect(res2.ok).toBe(false);
    const res3 = validateIpcSender("bridge:fs:readText", { destroyed: true, isTrustedWindow: true, url: "app://bundle/index.html" });
    expect(res3.ok).toBe(false);
  });

  it("5. 非受信任 sender 无法调用 Terminal IPC", () => {
    const res = validateIpcSender("bridge:terminal:execute", { destroyed: false, isTrustedWindow: false, url: "app://bundle/index.html" });
    expect(res.ok).toBe(false);
    const allowed = validateIpcSender("bridge:terminal:execute", { destroyed: false, isTrustedWindow: true, url: "app://bundle/index.html" }, { allowedApiOrigin: "http://127.0.0.1:3000" });
    // app:// 内允许
    expect(allowed.ok).toBe(true);
  });

  it("6. javascript: 不可 external open", () => {
    expect(validateExternalUrl("javascript:alert(1)").ok).toBe(false);
    expect(decideNavigation({ url: "javascript:alert(1)" }).kind).toBe("deny");
  });

  it("7. file: 不可 external open", () => {
    expect(validateExternalUrl("file:///etc/passwd").ok).toBe(false);
    expect(decideNavigation({ url: "file:///C:/Windows" }).kind).toBe("deny");
  });

  it("额外：data: / vbscript: 也拒绝", () => {
    expect(validateExternalUrl("data:text/html,<script>alert(1)</script>").ok).toBe(false);
    expect(validateExternalUrl("vbscript:msgbox(1)").ok).toBe(false);
  });

  it("8. 正常 HTTPS 可以走外部浏览器", () => {
    expect(validateExternalUrl("https://example.com").ok).toBe(true);
    expect(decideNavigation({ url: "https://example.com/docs" }).kind).toBe("allow-external");
  });

  it("9. 内部 app:// 页面可以正常导航", () => {
    expect(decideNavigation({ url: "app://bundle/index.html" }).kind).toBe("allow-internal");
    expect(decideNavigation({ url: "app://bundle/settings" }).kind).toBe("allow-internal");
  });

  it("10. local API origin 正常（绑定到实际端口）", () => {
    const api = "http://127.0.0.1:53211";
    expect(decideNavigation({ url: `${api}/api/status`, allowedApiOrigin: api }).kind).toBe("allow-internal");
    // 任意其他 localhost 端口不应被信任（未绑定）
    expect(decideNavigation({ url: "http://127.0.0.1:9999/evil", allowedApiOrigin: api }).kind).toBe("allow-external");
  });

  it("11. CSP production policy 存在且严格", () => {
    expect(PRODUCTION_CSP).toBeDefined();
    const header = getCspHeader(false);
    expect(header).toContain("default-src");
    expect(header).toContain("object-src 'none'");
    expect(header).toContain("base-uri 'none'");
    expect(header).toContain("frame-ancestors 'none'");
    expect(header).not.toContain("script-src *");
    expect(header).not.toContain("connect-src *");
    expect(header).not.toContain("img-src *");
    const validation = validateProductionCsp();
    expect(validation.ok, validation.errors.join("; ")).toBe(true);
  });

  it("Electron baseline 为受支持稳定版本且非 prerelease", () => {
    expect(ELECTRON_BASELINE.channel).toBe("stable");
    expect(ELECTRON_BASELINE.prerelease).toBe(false);
    expect(isStableElectronVersion(ELECTRON_BASELINE.electron)).toBe(true);
    expect(ELECTRON_BASELINE.electron).toMatch(/^32\./);
    expect(isStableElectronVersion("32.3.3-beta")).toBe(false);
  });

  it("malformed URL fail closed", () => {
    expect(validateExternalUrl("ht!tp://[invalid").ok).toBe(false);
    expect(decideNavigation({ url: "not a url" }).kind).toBe("deny");
  });
});
