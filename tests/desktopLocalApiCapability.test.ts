import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { validateIpcSender } from "@/lib/security/ipcSender";
import { shouldInjectLocalApiCapability } from "@/src/main/security/localApiCapability";

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
  it("src/main/index.ts delegates to installLocalApiCapabilityInjector", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf8");
    expect(src).toContain("installLocalApiCapabilityInjector");
    expect(src).toContain("disposeLocalApiInjector");
    // The pure policy and header injection lives in the helper
    const helper = fs.readFileSync(path.join(process.cwd(), "src/main/security/localApiCapability.ts"), "utf8");
    expect(helper).toContain("onBeforeSendHeaders");
    expect(helper).toContain("x-classflow-capability");
    expect(helper).toContain("shouldInjectLocalApiCapability");
    // Must check exact apiBase origin
    expect(helper).toContain("new URL(context.requestUrl).origin");
    expect(helper).toContain("urlOrigin !== context.apiOrigin");
    // Must check webContentsId
    expect(helper).toContain("webContentsId");
    expect(helper).toContain("trustedWebContentsId");
    // Must check trusted initiators (app:// and exact dev origin)
    expect(helper).toContain("trustedRendererOrigins");
    expect(helper).toContain("app://bundle");
    // Must not use <all_urls> or http://localhost/*
    expect(helper).not.toContain("<all_urls>");
    expect(helper).not.toContain('"http://localhost/*"');
    // Must not expose capability to Renderer
    expect(src).not.toContain("window.classflowDesktop.capability");
  });

  it("Lifecycle: single owner per launch via install helper", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf8");
    expect(src).toContain("installLocalApiCapabilityInjector");
    expect(src).toContain("disposeLocalApiInjector");
    const helper = fs.readFileSync(path.join(process.cwd(), "src/main/security/localApiCapability.ts"), "utf8");
    expect(helper).toContain("onBeforeSendHeaders");
    expect(helper).toContain("onBeforeSendHeaders(null");
  });
});

describe("shouldInjectLocalApiCapability pure policy — Task 16D Phase 16", () => {
  const apiOrigin = "http://127.0.0.1:54321";
  const trustedOrigins = ["app://bundle", "http://localhost:5173"] as const;
  const trustedId = 42;

  it("1. exact api origin + main webContents + app://bundle → true", () => {
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "http://127.0.0.1:54321/api/ai/chat",
        webContentsId: 42,
        trustedWebContentsId: 42,
        initiator: "app://bundle",
        apiOrigin,
        trustedRendererOrigins: trustedOrigins,
      })
    ).toBe(true);
  });

  it("2. exact API + wrong webContents → false", () => {
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "http://127.0.0.1:54321/api/ai/chat",
        webContentsId: 99,
        trustedWebContentsId: 42,
        initiator: "app://bundle",
        apiOrigin,
        trustedRendererOrigins: trustedOrigins,
      })
    ).toBe(false);
  });

  it("3. wrong API port → false", () => {
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "http://127.0.0.1:54322/api/ai/chat",
        webContentsId: 42,
        trustedWebContentsId: 42,
        initiator: "app://bundle",
        apiOrigin,
        trustedRendererOrigins: trustedOrigins,
      })
    ).toBe(false);
  });

  it("4. external host → false", () => {
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "https://example.com/api/ai/chat",
        webContentsId: 42,
        trustedWebContentsId: 42,
        initiator: "app://bundle",
        apiOrigin,
        trustedRendererOrigins: trustedOrigins,
      })
    ).toBe(false);
  });

  it("5. app://bundle.evil → false", () => {
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "http://127.0.0.1:54321/api/ai/chat",
        webContentsId: 42,
        trustedWebContentsId: 42,
        initiator: "app://bundle.evil",
        apiOrigin,
        trustedRendererOrigins: trustedOrigins,
      })
    ).toBe(false);
  });

  it("6. app://bundle-evil → false", () => {
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "http://127.0.0.1:54321/api/ai/chat",
        webContentsId: 42,
        trustedWebContentsId: 42,
        initiator: "app://bundle-evil",
        apiOrigin,
        trustedRendererOrigins: trustedOrigins,
      })
    ).toBe(false);
  });

  it("7. exact dev origin → true", () => {
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "http://127.0.0.1:54321/api/ai/models?provider=opencode-go",
        webContentsId: 42,
        trustedWebContentsId: 42,
        initiator: "http://localhost:5173",
        apiOrigin,
        trustedRendererOrigins: trustedOrigins,
      })
    ).toBe(true);
  });

  it("8. similar dev origin → false", () => {
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "http://127.0.0.1:54321/api/ai/chat",
        webContentsId: 42,
        trustedWebContentsId: 42,
        initiator: "http://localhost:51730",
        apiOrigin,
        trustedRendererOrigins: trustedOrigins,
      })
    ).toBe(false);
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "http://127.0.0.1:54321/api/ai/chat",
        webContentsId: 42,
        trustedWebContentsId: 42,
        initiator: "http://localhost:5173.evil",
        apiOrigin,
        trustedRendererOrigins: trustedOrigins,
      })
    ).toBe(false);
  });

  it("9. malformed request URL → false", () => {
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "not a url",
        webContentsId: 42,
        trustedWebContentsId: 42,
        initiator: "app://bundle",
        apiOrigin,
        trustedRendererOrigins: trustedOrigins,
      })
    ).toBe(false);
  });

  it("10. untrusted initiator → false", () => {
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "http://127.0.0.1:54321/api/ai/chat",
        webContentsId: 42,
        trustedWebContentsId: 42,
        initiator: "https://evil.com",
        apiOrigin,
        trustedRendererOrigins: trustedOrigins,
      })
    ).toBe(false);
  });

  it("11. Origin header fallback", () => {
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "http://127.0.0.1:54321/api/ai/chat",
        webContentsId: 42,
        trustedWebContentsId: 42,
        originHeader: "http://localhost:5173",
        apiOrigin,
        trustedRendererOrigins: trustedOrigins,
      })
    ).toBe(true);
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "http://127.0.0.1:54321/api/ai/chat",
        webContentsId: 42,
        trustedWebContentsId: 42,
        originHeader: "http://evil.com",
        apiOrigin,
        trustedRendererOrigins: trustedOrigins,
      })
    ).toBe(false);
  });

  it("12. null origin only with verified app://bundle currentRendererUrl", () => {
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "http://127.0.0.1:54321/api/ai/chat",
        webContentsId: 42,
        trustedWebContentsId: 42,
        initiator: "null",
        apiOrigin,
        trustedRendererOrigins: trustedOrigins,
        currentRendererUrl: "app://bundle/index.html",
      })
    ).toBe(true);
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "http://127.0.0.1:54321/api/ai/chat",
        webContentsId: 42,
        trustedWebContentsId: 42,
        initiator: "null",
        apiOrigin,
        trustedRendererOrigins: trustedOrigins,
        currentRendererUrl: "http://localhost:5173/index.html",
      })
    ).toBe(false);
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "http://127.0.0.1:54321/api/ai/chat",
        webContentsId: 42,
        trustedWebContentsId: 42,
        initiator: "null",
        apiOrigin,
        trustedRendererOrigins: trustedOrigins,
      })
    ).toBe(false);
  });
});
