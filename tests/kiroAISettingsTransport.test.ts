import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("KiroAISettings transport — Task 16D Phase 21", () => {
  it("uses fetch(apiUrl(...)) for all three routes, no requestDesktopApi fallback", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/settings/KiroAISettings.tsx"), "utf8");
    expect(src).toContain('fetch(apiUrl("/api/ai/web-search/status")');
    expect(src).toContain('fetch(apiUrl("/api/ai/test")');
    expect(src).toContain('fetch(apiUrl("/api/ai/web-search/test")');
    // Must not have try { requestDesktopApi } catch { fetch }
    expect(src).not.toMatch(/try\s*\{\s*res\s*=\s*await\s*requestDesktopApi/);
    expect(src).not.toContain("catch == environment detection");
  });

  it("imports apiUrl and AI for sanitized logging", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/settings/KiroAISettings.tsx"), "utf8");
    expect(src).toContain('import { apiUrl }');
    expect(src).toContain('import { AI }');
    expect(src).toContain("endpointHostname");
    expect(src).toContain("provider=");
  });
});
