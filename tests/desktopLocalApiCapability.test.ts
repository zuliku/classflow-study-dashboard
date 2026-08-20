import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { validateIpcSender } from "@/lib/security/ipcSender";

describe("Desktop local API capability gate — Task 16D Phase 8", () => {
  it("httpServer requires Origin allowlist AND x-classflow-capability", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/main/httpServer.ts"), "utf8");
    expect(src).toContain("isTrustedOrigin");
    expect(src).toContain('x-classflow-capability');
    expect(src).toContain("401");
    expect(src).toContain("Missing capability");
    // Must not allow all localhost
    expect(src).not.toMatch(/if\s*\(\s*origin\.startsWith\("http:\/\/localhost/);
    // Must not bypass for /api/ai/chat
    expect(src).not.toContain("if (url.pathname === \"/api/ai/chat\")");
  });

  it("validateIpcSender still enforces trusted window for local API", () => {
    // Simulate trusted window with app://
    const ok = validateIpcSender("window:minimize", { destroyed: false, isTrustedWindow: true, url: "app://bundle/index.html" }, { allowedApiOrigin: "http://127.0.0.1:1234" });
    expect(ok.ok).toBe(true);
    const denied = validateIpcSender("window:minimize", { destroyed: false, isTrustedWindow: false, url: "app://bundle/index.html" }, { allowedApiOrigin: "http://127.0.0.1:1234" });
    expect(denied.ok).toBe(false);
  });
});

describe("Main webRequest capability injection — Task 16D Phase 14/15", () => {
  it("src/main/index.ts injects via session.webRequest.onBeforeSendHeaders", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf8");
    expect(src).toContain("onBeforeSendHeaders");
    expect(src).toContain("x-classflow-capability");
    expect(src).toContain("apiCapability");
    // Must check exact apiBase origin
    expect(src).toContain("new URL(apiBase).origin");
    expect(src).toContain("urlOrigin !== apiOrigin");
    // Must check webContentsId
    expect(src).toContain("webContentsId");
    expect(src).toContain("mainWebContentsId");
    // Must check trusted initiators (app:// and exact dev origin)
    expect(src).toContain("trustedInitiators");
    expect(src).toContain("app://bundle");
    // Must not use <all_urls> or http://localhost/*
    expect(src).not.toContain("<all_urls>");
    expect(src).not.toContain('"http://localhost/*"');
    // Must not expose capability to Renderer
    expect(src).not.toContain("window.classflowDesktop.capability");
  });

  it("Lifecycle: single owner per launch, avoids duplicate listeners", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf8");
    expect(src).toContain("localApiWebRequestInstalledFor");
    expect(src).toContain("onBeforeSendHeaders(null");
  });
});
