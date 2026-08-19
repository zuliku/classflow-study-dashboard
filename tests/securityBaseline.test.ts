import { describe, it, expect } from "vitest";
import { validateIpcSender } from "@/lib/security/ipcSender";
import { PRODUCTION_CSP, validateProductionCsp, getCspHeader, DEVELOPMENT_CSP } from "@/lib/security/csp";
import { validateExternalUrl, decideNavigation } from "@/lib/security/navigation";
import { SECURE_WINDOW_OPTIONS, assertSecureWindowOptions, buildClassFlowWebPreferences } from "@/lib/security/electronConfig";
import { ELECTRON_BASELINE, isStableElectronVersion } from "@/lib/desktop/electronBaseline";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Security Baseline — Task 01/02 + Task05 integration", () => {
  it("1. Renderer sandbox 为 true（常量 + 真实 builder）", () => {
    expect(SECURE_WINDOW_OPTIONS.webPreferences.sandbox).toBe(true);
    expect(assertSecureWindowOptions({ sandbox: true, contextIsolation: true, nodeIntegration: false }).ok).toBe(true);
    const prefs = buildClassFlowWebPreferences({ preloadPath: "/tmp/preload.mjs", apiBase: "http://127.0.0.1:1234" });
    expect(prefs.sandbox).toBe(true);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.preload).toBe("/tmp/preload.mjs");
    expect(prefs.additionalArguments[0]).toContain("http://127.0.0.1:1234");
  });

  it("2. nodeIntegration 为 false（builder）", () => {
    expect(SECURE_WINDOW_OPTIONS.webPreferences.nodeIntegration).toBe(false);
    expect(buildClassFlowWebPreferences({ preloadPath: "x", apiBase: "http://127.0.0.1:1" }).nodeIntegration).toBe(false);
  });

  it("3. contextIsolation 为 true（builder）", () => {
    expect(SECURE_WINDOW_OPTIONS.webPreferences.contextIsolation).toBe(true);
    expect(buildClassFlowWebPreferences({ preloadPath: "x", apiBase: "http://127.0.0.1:1" }).contextIsolation).toBe(true);
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

  it("Electron baseline 为受支持稳定版本且非 prerelease（43.3.x）", () => {
    expect(ELECTRON_BASELINE.channel).toBe("stable");
    expect(ELECTRON_BASELINE.prerelease).toBe(false);
    expect(isStableElectronVersion(ELECTRON_BASELINE.electron)).toBe(true);
    expect(ELECTRON_BASELINE.electron).toBe("43.3.0");
    expect(ELECTRON_BASELINE.electron).toMatch(/^43\.3\./);
    expect(isStableElectronVersion("43.3.0-beta")).toBe(false);
    expect(ELECTRON_BASELINE.nodeTypes).toMatch(/^22\./);
  });

  it("integration: Desktop Bridge 注册使用 validateIpcSender 且覆盖未来通道", () => {
    const bridgeSrc = fs.readFileSync(path.join(process.cwd(), "src/main/desktopBridge.ts"), "utf-8");
    expect(bridgeSrc).toContain("validateIpcSender");
    expect(bridgeSrc).toContain("withValidation");
    expect(validateIpcSender("bridge:credential:create", { destroyed: false, isTrustedWindow: false, url: "app://bundle/index.html" }).ok).toBe(false);
    expect(validateIpcSender("bridge:mcp:connect", { destroyed: false, isTrustedWindow: false, url: "app://bundle/index.html" }).ok).toBe(false);
    expect(validateIpcSender("bridge:channel:send", { destroyed: false, isTrustedWindow: false, url: "app://bundle/index.html" }).ok).toBe(false);
  });

  it("integration: main navigation handler 使用 decideNavigation（非手写 startsWith）", () => {
    const indexSrc = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf-8");
    expect(indexSrc).toContain("decideNavigation");
    expect(indexSrc).toContain("buildClassFlowWebPreferences");
    expect(indexSrc).toContain("getCspHeader");
    expect(indexSrc).not.toMatch(/if\s*\(\s*url\.startsWith\("http/);
    expect(buildClassFlowWebPreferences({ preloadPath: "a", apiBase: "b" }).sandbox).toBe(true);
  });

  it("integration: production renderer CSP 通过 header 真正下发且与 dev 分离", () => {
    const prod = getCspHeader(false);
    const dev = getCspHeader(true);
    expect(prod).not.toBe(dev);
    expect(prod).toContain("default-src 'self'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("base-uri 'none'");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).not.toContain("script-src *");
    expect(dev).toContain("http://localhost");
    const indexSrc = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf-8");
    expect(indexSrc).toContain("onHeadersReceived");
    expect(indexSrc).toContain("Content-Security-Policy");
    expect(validateProductionCsp().ok).toBe(true);
    expect(DEVELOPMENT_CSP["script-src"]?.join(" ")).toContain("unsafe-eval");
  });

  it("malformed URL fail closed", () => {
    expect(validateExternalUrl("ht!tp://[invalid").ok).toBe(false);
    expect(decideNavigation({ url: "not a url" }).kind).toBe("deny");
  });
});
