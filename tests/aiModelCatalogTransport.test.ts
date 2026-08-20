import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("useAIModelCatalog transport — Task 16D Phase 20", () => {
  it("uses apiUrl for remote catalog (injected via webRequest)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "hooks/useAIModelCatalog.ts"), "utf8");
    expect(src).toContain('apiUrl(`/api/ai/models?provider=opencode-go`)');
    expect(src).toContain('fetch(apiUrl');
    // Must not use requestDesktopApi for catalog (that is DTO, not needed for simple GET)
    expect(src).not.toContain("requestDesktopApi");
  });

  it("handles remote failure gracefully (registry fallback)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "hooks/useAIModelCatalog.ts"), "utf8");
    expect(src).toContain("registry fallback");
    expect(src).toContain("catch");
    expect(src).toContain("setModels(fallback)");
  });
});
