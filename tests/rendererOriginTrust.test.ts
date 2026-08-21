import { describe, it, expect } from "vitest";
import { canonicalRendererOrigin, isTrustedRendererUrl, isValidAppBundleRequestUrl, parseTrustedRendererUrl, isStrictAppBundleUrl } from "@/lib/security/rendererOrigin";
import { decideNavigation } from "@/lib/security/navigation";
import { validateIpcSender } from "@/lib/security/ipcSender";
import { shouldInjectLocalApiCapability } from "@/src/main/security/localApiCapability";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Task 16D-C Renderer Trust-Origin Security Closure
 * Exploit regression tests A-Q + literal prefix exploit fixtures
 */

const DEV_ORIGIN = "http://localhost:5173";
const API_ORIGIN = "http://127.0.0.1:54321";

describe("rendererOrigin canonical — exploit fixtures", () => {
  it("app://bundle canonical is app://bundle", () => {
    expect(canonicalRendererOrigin("app://bundle/index.html")).toBe("app://bundle");
    expect(canonicalRendererOrigin("app://bundle/settings")).toBe("app://bundle");
    expect(canonicalRendererOrigin("app://bundle/")).toBe("app://bundle");
    expect(canonicalRendererOrigin("app://bundle")).toBe("app://bundle");
  });

  it("attacker app:// hosts rejected", () => {
    expect(canonicalRendererOrigin("app://evil/index.html")).toBeNull();
    expect(canonicalRendererOrigin("app://bundle.evil/index.html")).toBeNull();
    expect(canonicalRendererOrigin("app://bundle-evil/index.html")).toBeNull();
    expect(canonicalRendererOrigin("app://user@bundle/index.html")).toBeNull();
    expect(canonicalRendererOrigin("app://bundle:9999/index.html")).toBeNull();
    expect(canonicalRendererOrigin("app://bundle.evil/logo.png")).toBeNull();
    expect(canonicalRendererOrigin("app://evil/logo.png")).toBeNull();
  });

  it("http(s) canonical is origin", () => {
    expect(canonicalRendererOrigin("http://localhost:5173/")).toBe("http://localhost:5173");
    expect(canonicalRendererOrigin("http://localhost:5173/index.html")).toBe("http://localhost:5173");
    expect(canonicalRendererOrigin("https://example.com/path")).toBe("https://example.com");
  });

  it("userinfo exploit canonicalizes to attacker origin", () => {
    // critical: http://127.0.0.1:54321@evil.example/ has origin http://evil.example, not api origin
    expect(canonicalRendererOrigin("http://127.0.0.1:54321@evil.example/")).toBe("http://evil.example");
    expect(canonicalRendererOrigin("http://localhost:5173@evil.example/")).toBe("http://evil.example");
    // isTrustedRendererUrl must not trust them even with matching dev/api origin
    expect(isTrustedRendererUrl("http://127.0.0.1:54321@evil.example/", { allowedDevOrigin: DEV_ORIGIN })).toBe(false);
    expect(isTrustedRendererUrl("http://localhost:5173@evil.example/", { allowedDevOrigin: DEV_ORIGIN })).toBe(false);
  });

  it("dev origin exact match only", () => {
    expect(isTrustedRendererUrl("http://localhost:5173/", { allowedDevOrigin: DEV_ORIGIN })).toBe(true);
    expect(isTrustedRendererUrl("http://localhost:5173/index.html", { allowedDevOrigin: DEV_ORIGIN })).toBe(true);
    expect(isTrustedRendererUrl("http://localhost:5173", { allowedDevOrigin: DEV_ORIGIN })).toBe(true);
    // must fail
    expect(isTrustedRendererUrl("http://localhost:51730", { allowedDevOrigin: DEV_ORIGIN })).toBe(false);
    expect(isTrustedRendererUrl("http://localhost:51730/", { allowedDevOrigin: DEV_ORIGIN })).toBe(false);
    expect(isTrustedRendererUrl("http://localhost:5173@evil.example/", { allowedDevOrigin: DEV_ORIGIN })).toBe(false);
    expect(isTrustedRendererUrl("http://localhost.evil:5173/", { allowedDevOrigin: DEV_ORIGIN })).toBe(false);
    expect(isTrustedRendererUrl("http://evil.example/?next=http://localhost:5173", { allowedDevOrigin: DEV_ORIGIN })).toBe(false);
    expect(isTrustedRendererUrl("http://localhost:5173.evil/", { allowedDevOrigin: DEV_ORIGIN })).toBe(false);
  });

  it("production only app://bundle is trusted", () => {
    expect(isTrustedRendererUrl("app://bundle/index.html")).toBe(true);
    expect(isTrustedRendererUrl("app://bundle/settings")).toBe(true);
    expect(isTrustedRendererUrl("app://evil/index.html")).toBe(false);
    expect(isTrustedRendererUrl("app://bundle.evil/index.html")).toBe(false);
    expect(isTrustedRendererUrl("app://bundle-evil/index.html")).toBe(false);
    expect(isTrustedRendererUrl("app://user@bundle/index.html")).toBe(false);
    expect(isTrustedRendererUrl("app://bundle:9999/index.html")).toBe(false);
  });

  it("Local API origin is NOT renderer identity", () => {
    // Even with allowedApiOrigin passed, isTrustedRendererUrl does not grant trust
    // This is verified via validateIpcSender later, but also direct check:
    expect(isTrustedRendererUrl("http://127.0.0.1:54321/", { allowedDevOrigin: DEV_ORIGIN })).toBe(false);
    expect(isTrustedRendererUrl("http://127.0.0.1:54321/api/ai/chat", { allowedDevOrigin: DEV_ORIGIN })).toBe(false);
  });

  it("parseTrustedRendererUrl", () => {
    expect(parseTrustedRendererUrl("app://bundle/index.html")).toEqual({ kind: "production" });
    expect(parseTrustedRendererUrl("http://localhost:5173/")?.kind).toBe("development");
    expect(parseTrustedRendererUrl("http://localhost:5173@evil.example/")).toEqual({ kind: "development", origin: "http://evil.example" });
    // but that origin won't match dev origin, so isTrusted will be false
    expect(parseTrustedRendererUrl("app://evil/index.html")).toBeNull();
  });
});

describe("Navigation exploit regression — A-G", () => {
  it("A. app://bundle/index.html → allow-internal", () => {
    expect(decideNavigation({ url: "app://bundle/index.html" }).kind).toBe("allow-internal");
  });
  it("B. app://evil/index.html → deny", () => {
    const v = decideNavigation({ url: "app://evil/index.html" });
    expect(v.kind).toBe("deny");
  });
  it("C. app://bundle.evil/index.html → deny", () => {
    const v = decideNavigation({ url: "app://bundle.evil/index.html" });
    expect(v.kind).toBe("deny");
  });
  it("D. exact dev origin → allow-internal", () => {
    expect(decideNavigation({ url: "http://localhost:5173/", allowedDevOrigin: DEV_ORIGIN }).kind).toBe("allow-internal");
    expect(decideNavigation({ url: "http://localhost:5173/index.html", allowedDevOrigin: DEV_ORIGIN }).kind).toBe("allow-internal");
  });
  it("E. http://localhost:5173@evil.example/ → NOT allow-internal", () => {
    const v = decideNavigation({ url: "http://localhost:5173@evil.example/", allowedDevOrigin: DEV_ORIGIN });
    expect(v.kind).not.toBe("allow-internal");
    // should be allow-external (http) but never internal
    expect(["allow-external", "deny"]).toContain(v.kind);
  });
  it("F. http://127.0.0.1:54321@evil.example/ with allowedApiOrigin → NOT allow-internal", () => {
    const v = decideNavigation({ url: "http://127.0.0.1:54321@evil.example/", allowedApiOrigin: API_ORIGIN, allowedDevOrigin: DEV_ORIGIN });
    expect(v.kind).not.toBe("allow-internal");
    expect(["allow-external", "deny"]).toContain(v.kind);
    // Also verify exact api origin is deny local-api-navigation, not allow-internal
    const v2 = decideNavigation({ url: "http://127.0.0.1:54321/api/ai/chat", allowedApiOrigin: API_ORIGIN });
    expect(v2.kind).toBe("deny");
    expect((v2 as { reason?: string }).reason).toBe("local-api-navigation");
  });
  it("G. normal https://example.com → allow-external", () => {
    expect(decideNavigation({ url: "https://example.com" }).kind).toBe("allow-external");
    expect(decideNavigation({ url: "http://example.com" }).kind).toBe("allow-external");
  });

  it("additional: app://bundle:9999, user@, bundle-evil all deny", () => {
    expect(decideNavigation({ url: "app://bundle:9999/index.html" }).kind).toBe("deny");
    expect(decideNavigation({ url: "app://user@bundle/index.html" }).kind).toBe("deny");
    expect(decideNavigation({ url: "app://bundle-evil/index.html" }).kind).toBe("deny");
  });

  it("dev origin similar hosts deny", () => {
    expect(decideNavigation({ url: "http://localhost:51730", allowedDevOrigin: DEV_ORIGIN }).kind).not.toBe("allow-internal");
    expect(decideNavigation({ url: "http://localhost:5173.evil", allowedDevOrigin: DEV_ORIGIN }).kind).not.toBe("allow-internal");
    expect(decideNavigation({ url: "http://localhost.evil:5173", allowedDevOrigin: DEV_ORIGIN }).kind).not.toBe("allow-internal");
    expect(decideNavigation({ url: "http://evil.example/?next=http://localhost:5173", allowedDevOrigin: DEV_ORIGIN }).kind).not.toBe("allow-internal");
  });

  it("local API exact origin is deny, not external", () => {
    const v = decideNavigation({ url: API_ORIGIN, allowedApiOrigin: API_ORIGIN });
    expect(v.kind).toBe("deny");
    expect((v as { reason?: string }).reason).toBe("local-api-navigation");
    // non-matching port is external
    expect(decideNavigation({ url: "http://127.0.0.1:9999/evil", allowedApiOrigin: API_ORIGIN }).kind).toBe("allow-external");
  });

  it("BrowserWindow must never navigate internally to arbitrary external HTTP(S)", () => {
    expect(decideNavigation({ url: "https://evil.example" }).kind).not.toBe("allow-internal");
    expect(decideNavigation({ url: "http://evil.example" }).kind).not.toBe("allow-internal");
  });
});

describe("IPC sender exploit regression — H-N", () => {
  const sensitive = "bridge:fs:readText";
  const winControls = "window:minimize";
  function validate(channel: string, sender: { destroyed: boolean; isTrustedWindow: boolean; url?: string }, opts?: { allowedDevOrigin?: string; allowedApiOrigin?: string }) {
    return validateIpcSender(channel, sender, opts);
  }

  it("H. trusted WebContents + app://bundle → allow", () => {
    const res = validate(sensitive, { destroyed: false, isTrustedWindow: true, url: "app://bundle/index.html" }, { allowedDevOrigin: DEV_ORIGIN, allowedApiOrigin: API_ORIGIN });
    expect(res.ok).toBe(true);
    const res2 = validate(winControls, { destroyed: false, isTrustedWindow: true, url: "app://bundle/index.html" }, { allowedDevOrigin: DEV_ORIGIN });
    expect(res2.ok).toBe(true);
  });

  it("I. trusted WebContents + http://127.0.0.1:54321@evil.example/ → deny", () => {
    const res = validate(sensitive, { destroyed: false, isTrustedWindow: true, url: "http://127.0.0.1:54321@evil.example/" }, { allowedDevOrigin: DEV_ORIGIN, allowedApiOrigin: API_ORIGIN });
    expect(res.ok).toBe(false);
  });

  it("J. trusted WebContents + http://localhost:5173@evil.example/ → deny", () => {
    const res = validate(sensitive, { destroyed: false, isTrustedWindow: true, url: "http://localhost:5173@evil.example/" }, { allowedDevOrigin: DEV_ORIGIN, allowedApiOrigin: API_ORIGIN });
    expect(res.ok).toBe(false);
  });

  it("K. trusted WebContents + app://evil → deny", () => {
    const res = validate(sensitive, { destroyed: false, isTrustedWindow: true, url: "app://evil/index.html" }, { allowedDevOrigin: DEV_ORIGIN });
    expect(res.ok).toBe(false);
  });

  it("L. trusted WebContents + app://bundle.evil → deny", () => {
    const res = validate(sensitive, { destroyed: false, isTrustedWindow: true, url: "app://bundle.evil/index.html" }, { allowedDevOrigin: DEV_ORIGIN });
    expect(res.ok).toBe(false);
    const res2 = validate(sensitive, { destroyed: false, isTrustedWindow: true, url: "app://bundle-evil/index.html" }, { allowedDevOrigin: DEV_ORIGIN });
    expect(res2.ok).toBe(false);
  });

  it("M. trusted WebContents + exact dev origin → allow", () => {
    const res = validate(sensitive, { destroyed: false, isTrustedWindow: true, url: "http://localhost:5173/" }, { allowedDevOrigin: DEV_ORIGIN });
    expect(res.ok).toBe(true);
    const res2 = validate(sensitive, { destroyed: false, isTrustedWindow: true, url: "http://localhost:5173/index.html" }, { allowedDevOrigin: DEV_ORIGIN });
    expect(res2.ok).toBe(true);
  });

  it("N. wrong WebContents + trusted URL → deny", () => {
    const res = validate(sensitive, { destroyed: false, isTrustedWindow: false, url: "app://bundle/index.html" }, { allowedDevOrigin: DEV_ORIGIN });
    expect(res.ok).toBe(false);
    const res2 = validate(sensitive, { destroyed: false, isTrustedWindow: false, url: "http://localhost:5173/" }, { allowedDevOrigin: DEV_ORIGIN });
    expect(res2.ok).toBe(false);
  });

  it("additional: IPC must reject api origin even with isTrustedWindow true", () => {
    const res = validate(sensitive, { destroyed: false, isTrustedWindow: true, url: "http://127.0.0.1:54321/" }, { allowedApiOrigin: API_ORIGIN, allowedDevOrigin: DEV_ORIGIN });
    expect(res.ok).toBe(false);
    const res2 = validate(sensitive, { destroyed: false, isTrustedWindow: true, url: "http://127.0.0.1:54321/api/ai/chat" }, { allowedApiOrigin: API_ORIGIN });
    expect(res2.ok).toBe(false);
  });

  it("additional: IPC must reject destroyed or missing url", () => {
    expect(validate(sensitive, { destroyed: true, isTrustedWindow: true, url: "app://bundle/index.html" }).ok).toBe(false);
    expect(validate(sensitive, { destroyed: false, isTrustedWindow: true, url: "" }).ok).toBe(false);
    expect(validate(sensitive, { destroyed: false, isTrustedWindow: true }).ok).toBe(false);
  });

  it("additional: IPC disallows file/javascript/data protocols", () => {
    expect(validate(sensitive, { destroyed: false, isTrustedWindow: true, url: "file:///etc/passwd" }).ok).toBe(false);
    expect(validate(sensitive, { destroyed: false, isTrustedWindow: true, url: "javascript:alert(1)" }).ok).toBe(false);
    expect(validate(sensitive, { destroyed: false, isTrustedWindow: true, url: "data:text/html,hi" }).ok).toBe(false);
  });

  it("non-sensitive channel bypasses validation", () => {
    const res = validate("some:other:channel", { destroyed: false, isTrustedWindow: false, url: "https://evil.com" });
    expect(res.ok).toBe(true);
  });
});

describe("Protocol handler / helper — O-Q", () => {
  it("O. app://bundle/logo.png → accepted renderer host", () => {
    expect(isValidAppBundleRequestUrl("app://bundle/logo.png")).toBe(true);
    expect(isValidAppBundleRequestUrl("app://bundle/index.html")).toBe(true);
    expect(isValidAppBundleRequestUrl("app://bundle/settings")).toBe(true);
    expect(isValidAppBundleRequestUrl("app://bundle/")).toBe(true);
    expect(isValidAppBundleRequestUrl("app://bundle")).toBe(true);
    expect(isStrictAppBundleUrl("app://bundle/logo.png")).toBe(true);
  });

  it("P. app://evil/logo.png → forbidden", () => {
    expect(isValidAppBundleRequestUrl("app://evil/logo.png")).toBe(false);
    expect(isValidAppBundleRequestUrl("app://evil/index.html")).toBe(false);
    expect(isStrictAppBundleUrl("app://evil/logo.png")).toBe(false);
  });

  it("Q. app://bundle.evil/logo.png → forbidden", () => {
    expect(isValidAppBundleRequestUrl("app://bundle.evil/logo.png")).toBe(false);
    expect(isValidAppBundleRequestUrl("app://bundle.evil/index.html")).toBe(false);
    expect(isValidAppBundleRequestUrl("app://bundle-evil/logo.png")).toBe(false);
    expect(isStrictAppBundleUrl("app://bundle.evil/logo.png")).toBe(false);
  });

  it("additional: app:// with userinfo or port forbidden", () => {
    expect(isValidAppBundleRequestUrl("app://user@bundle/index.html")).toBe(false);
    expect(isValidAppBundleRequestUrl("app://bundle:9999/index.html")).toBe(false);
    expect(isValidAppBundleRequestUrl("app://bundle@evil/index.html")).toBe(false);
    expect(isValidAppBundleRequestUrl("app://bundle:8080/logo.png")).toBe(false);
  });

  it("protocol handler source uses shared helper", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf-8");
    expect(src).toContain("isValidAppBundleRequestUrl");
    expect(src).toContain('protocol.handle("app"');
    // Must not expose filesystem path in error
    expect(src).toContain('Response("forbidden"');
    expect(src).not.toContain("forbidden: ${target}");
  });
});

describe("Literal prefix exploit fixtures — section 16", () => {
  const evilFixtures = [
    "http://127.0.0.1:54321@evil.example/",
    "http://localhost:5173@evil.example/",
    "app://bundle.evil/index.html",
    "app://evil/index.html",
  ];
  for (const evilUrl of evilFixtures) {
    it(`Navigation: ${evilUrl} must NOT be allow-internal`, () => {
      const v = decideNavigation({ url: evilUrl, allowedApiOrigin: API_ORIGIN, allowedDevOrigin: DEV_ORIGIN });
      expect(v.kind).not.toBe("allow-internal");
    });
    it(`IPC trustedWindow+${evilUrl} must be denied`, () => {
      const r = validateIpcSender("bridge:fs:readText", { destroyed: false, isTrustedWindow: true, url: evilUrl }, { allowedApiOrigin: API_ORIGIN, allowedDevOrigin: DEV_ORIGIN });
      expect(r.ok).toBe(false);
    });
    it(`canonical for ${evilUrl} does not equal trusted`, () => {
      const c = canonicalRendererOrigin(evilUrl);
      // either null or attacker origin, never app://bundle or dev origin
      if (evilUrl.startsWith("app://")) {
        expect(c).toBeNull();
      } else {
        expect(c).toBe("http://evil.example");
      }
    });
  }
});

describe("Dead code removal — ipcSender", () => {
  it("isAllowedInternalUrl helper removed, not exported", async () => {
    const src = fs.readFileSync(path.join(process.cwd(), "lib/security/ipcSender.ts"), "utf-8");
    expect(src).not.toContain("isAllowedInternalUrl");
    // should use isTrustedRendererUrl
    expect(src).toContain("isTrustedRendererUrl");
    // should not use startsWith on url for trust
    // the only startsWith allowed is for SENSITIVE_PREFIXES channel check
    const lines = src.split("\n").filter((l) => l.includes("startsWith") && l.includes("url"));
    expect(lines.length).toBe(0);
  });
  it("navigation does not use startsWith for origin trust", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "lib/security/navigation.ts"), "utf-8");
    // should not contain raw.startsWith(allowedApiOrigin) nor allowedDevOrigin
    expect(src).not.toMatch(/raw\.startsWith\(ctx\.allowedApiOrigin\)/);
    expect(src).not.toMatch(/raw\.startsWith\(ctx\.allowedDevOrigin\)/);
    expect(src).toContain("isTrustedRendererUrl");
  });
  it("httpServer isTrustedOrigin does not use startsWith", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/main/httpServer.ts"), "utf-8");
    // should not contain startsWith("app://bundle") for trust
    expect(src).not.toContain('startsWith("app://bundle")');
    expect(src).toContain("canonicalRendererOrigin");
  });
});

describe("localApiCapability regression — Task 16D Phase 16", () => {
  it("shouldInject still correctly gates userinfo exploits", () => {
    // attacker initiator with @userinfo should be denied even though requestUrl is api
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "http://127.0.0.1:54321/api/ai/chat",
        webContentsId: 42,
        trustedWebContentsId: 42,
        initiator: "http://localhost:5173@evil.example",
        apiOrigin: API_ORIGIN,
        trustedRendererOrigins: ["app://bundle", "http://localhost:5173"],
      })
    ).toBe(false);
    expect(
      shouldInjectLocalApiCapability({
        requestUrl: "http://127.0.0.1:54321/api/ai/chat",
        webContentsId: 42,
        trustedWebContentsId: 42,
        initiator: "http://127.0.0.1:54321@evil.example",
        apiOrigin: API_ORIGIN,
        trustedRendererOrigins: ["app://bundle", "http://localhost:5173"],
      })
    ).toBe(false);
  });
});
