import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Desktop preload runtime contract — Task 16D Phase 4/5", () => {
  it("Main preload path points to index.cjs", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf8");
    expect(src).toContain('preload/index.cjs');
    expect(src).not.toContain('preload/index.mjs');
  });

  it("Preload does not expose capability to Renderer", () => {
    const preload = fs.readFileSync(path.join(process.cwd(), "src/preload/index.ts"), "utf8");
    expect(preload).not.toContain("window.classflowDesktop.capability");
    expect(preload).not.toContain("getApiCapability");
    expect(preload).toContain("apiCapability");
    // Capability is closure-owned, exposed only via api.request header injection
    expect(preload).toContain("x-classflow-capability");
    expect(preload).toContain("contextBridge.exposeInMainWorld");
  });

  it("Preload api.request returns Response via fetch (capability closure)", () => {
    const preload = fs.readFileSync(path.join(process.cwd(), "src/preload/index.ts"), "utf8");
    expect(preload).toContain("api:");
    expect(preload).toContain("request: async");
    expect(preload).toContain("fetch(url, mergedInit)");
  });
});
