import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getCspHeader, getCspPolicy, canonicalLocalApiOrigin, PRODUCTION_CSP, DEVELOPMENT_CSP, validateProductionCsp } from "@/lib/security/csp";

describe("CSP Local API Runtime Closure — Task 16D-D", () => {
  const validApi = "http://127.0.0.1:54321";

  it("canonicalLocalApiOrigin strict validation", () => {
    expect(canonicalLocalApiOrigin(validApi)).toBe("http://127.0.0.1:54321");
    expect(canonicalLocalApiOrigin("http://127.0.0.1:54321/")).toBe("http://127.0.0.1:54321");
    // invalid cases must be null (fail closed)
    expect(canonicalLocalApiOrigin("http://127.0.0.1:54321@evil.example")).toBeNull();
    expect(canonicalLocalApiOrigin("http://evil.example")).toBeNull();
    expect(canonicalLocalApiOrigin("https://127.0.0.1:54321")).toBeNull();
    expect(canonicalLocalApiOrigin("http://localhost:54321")).toBeNull();
    expect(canonicalLocalApiOrigin("http://127.0.0.1")).toBeNull(); // no port
    expect(canonicalLocalApiOrigin("http://127.0.0.1:99999")).toBeNull(); // invalid port
    expect(canonicalLocalApiOrigin("http://127.0.0.1:54321/api")).toBeNull(); // pathname beyond /
    expect(canonicalLocalApiOrigin("http://127.0.0.1:54321?x=1")).toBeNull();
    expect(canonicalLocalApiOrigin("http://127.0.0.1:54321#frag")).toBeNull();
    expect(canonicalLocalApiOrigin("http://user:pass@127.0.0.1:54321")).toBeNull();
    expect(canonicalLocalApiOrigin("")).toBeNull();
    expect(canonicalLocalApiOrigin("not a url")).toBeNull();
  });

  it("Production: must contain exact apiOrigin", () => {
    const header = getCspHeader(false, { apiOrigin: validApi });
    expect(header).toContain("http://127.0.0.1:54321");
  });

  it("Production: must NOT contain wrong port", () => {
    const header = getCspHeader(false, { apiOrigin: validApi });
    expect(header).not.toContain("http://127.0.0.1:54322");
    // ensure only exact is present, not substring trick
    // wrong port should not appear even as part of header
    const policy = getCspPolicy(false, { apiOrigin: validApi });
    expect(policy["connect-src"]).toContain("http://127.0.0.1:54321");
    expect(policy["connect-src"]).not.toContain("http://127.0.0.1:54322");
  });

  it("Production: must NOT contain wildcard 127.0.0.1:*", () => {
    const header = getCspHeader(false, { apiOrigin: validApi });
    expect(header).not.toContain("http://127.0.0.1:*");
    const policy = getCspPolicy(false, { apiOrigin: validApi });
    expect(policy["connect-src"]?.some((v) => v.includes("*") && v.includes("127.0.0.1"))).toBe(false);
  });

  it("Production: must NOT contain localhost alias", () => {
    const header = getCspHeader(false, { apiOrigin: validApi });
    expect(header).not.toContain("http://localhost:54321");
    const policy = getCspPolicy(false, { apiOrigin: validApi });
    expect(policy["connect-src"]).not.toContain("http://localhost:54321");
  });

  it("Production: still contains required base directives", () => {
    const header = getCspHeader(false, { apiOrigin: validApi });
    expect(header).toContain("default-src");
    expect(header).toContain("object-src 'none'");
    expect(header).toContain("base-uri 'none'");
    expect(header).toContain("frame-ancestors 'none'");
    expect(header).not.toContain("script-src *");
    expect(header).not.toContain("connect-src *");
  });

  it("Production: base policy not mutated", () => {
    const before = [...(PRODUCTION_CSP["connect-src"] ?? [])];
    getCspHeader(false, { apiOrigin: validApi });
    getCspHeader(false, { apiOrigin: "http://127.0.0.1:9999" });
    expect(PRODUCTION_CSP["connect-src"]).toEqual(before);
    expect(PRODUCTION_CSP["connect-src"]).not.toContain("http://127.0.0.1:54321");
    expect(PRODUCTION_CSP["connect-src"]).not.toContain("http://127.0.0.1:9999");
  });

  it("Dev: must authorize BOTH localhost:* and exact apiOrigin", () => {
    const devOrigin = "http://localhost:5173";
    const header = getCspHeader(true, { apiOrigin: validApi, devOrigin });
    expect(header).toContain("http://localhost:*");
    expect(header).toContain("ws://localhost:*");
    expect(header).toContain("http://127.0.0.1:54321");
    expect(header).not.toContain("http://127.0.0.1:*");
    const policy = getCspPolicy(true, { apiOrigin: validApi, devOrigin });
    expect(policy["connect-src"]).toContain("http://localhost:*");
    expect(policy["connect-src"]).toContain("ws://localhost:*");
    expect(policy["connect-src"]).toContain("http://127.0.0.1:54321");
  });

  it("Dev: without apiOrigin still has Vite HMR but no 127.0.0.1", () => {
    const header = getCspHeader(true);
    expect(header).toContain("http://localhost:*");
    expect(header).toContain("ws://localhost:*");
    // base dev connect-src does not contain 127.0.0.1 exact
    expect(header).not.toContain("http://127.0.0.1:54321");
  });

  it("Invalid apiOrigin fails closed (not injected)", () => {
    const evil = "http://127.0.0.1:54321@evil.example";
    const header = getCspHeader(false, { apiOrigin: evil });
    expect(header).not.toContain(evil);
    expect(header).not.toContain("evil.example");
    const policy = getCspPolicy(false, { apiOrigin: evil });
    expect(policy["connect-src"]).not.toContain(evil);
    expect(policy["connect-src"]).toEqual(PRODUCTION_CSP["connect-src"]);

    const header2 = getCspHeader(false, { apiOrigin: "http://localhost:54321" });
    expect(header2).not.toContain("http://localhost:54321");
    const header3 = getCspHeader(false, { apiOrigin: "https://127.0.0.1:54321" });
    expect(header3).not.toContain("https://127.0.0.1:54321");
    const header4 = getCspHeader(false, { apiOrigin: "http://127.0.0.1:54321/api" });
    expect(header4).not.toContain("http://127.0.0.1:54321/api");
  });

  it("Do not blindly interpolate arbitrary strings — CSP remains valid", () => {
    const header = getCspHeader(false, { apiOrigin: "'; injected" });
    expect(header).not.toContain("'; injected");
    expect(validateProductionCsp(getCspPolicy(false, { apiOrigin: "http://127.0.0.1:54321" })).ok).toBe(true);
  });

  it("validateProductionCsp still enforces base security", () => {
    expect(validateProductionCsp().ok).toBe(true);
    const withApi = getCspPolicy(false, { apiOrigin: validApi });
    expect(validateProductionCsp(withApi).ok).toBe(true);
  });

  it("Main passes runtime apiOrigin into getCspHeader", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf-8");
    expect(src).toContain("getCspHeader");
    // Must pass apiOrigin, not just isDev
    expect(src).toMatch(/getCspHeader\s*\(\s*isDev\s*,\s*\{/);
    expect(src).toContain("apiOrigin");
    // Must not be the old bare call in createWindow context
    // Ensure at least one call includes apiOriginForCsp or apiOrigin
    expect(src).toContain("apiOriginForCsp");

    // Ensure CSP header uses runtime origin derived from apiBase, not Renderer
    expect(src).toContain("new URL(apiBase).origin");
    expect(src).not.toMatch(/getCspHeader\s*\(\s*isDev\s*\)\s*;/);
  });

  it("CSP does not expose capability", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf-8");
    // CSP line should not contain capability
    const cspLines = src.split("\n").filter((l) => l.includes("getCspHeader"));
    for (const line of cspLines) {
      expect(line).not.toContain("capability");
      expect(line).not.toContain("x-classflow-capability");
    }
    const header = getCspHeader(false, { apiOrigin: validApi });
    expect(header).not.toContain("capability");
  });

  it("Keep LOCAL API security layers independent — CSP exact + other gates", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/main/httpServer.ts"), "utf-8");
    expect(src).toContain("isTrustedOrigin");
    expect(src).toContain("x-classflow-capability");
    expect(src).toContain("401");
    expect(src).toContain("403");
    const mainSrc = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf-8");
    expect(mainSrc).toContain("installLocalApiCapabilityInjector");
    expect(mainSrc).toContain("getCspHeader");
  });

  it("No wildcard 127.0.0.1:* in any runtime header", () => {
    const prod = getCspHeader(false, { apiOrigin: validApi });
    const dev = getCspHeader(true, { apiOrigin: validApi, devOrigin: "http://localhost:5173" });
    expect(prod).not.toContain("http://127.0.0.1:*");
    expect(dev).not.toContain("http://127.0.0.1:*");
  });
});
