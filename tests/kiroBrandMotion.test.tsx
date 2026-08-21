// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}
if (typeof window !== "undefined" && !window.matchMedia) {
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  });
}
if (typeof globalThis !== "undefined" && !(globalThis as unknown as Record<string, unknown>).matchMedia) {
  (globalThis as unknown as Record<string, unknown>).matchMedia = (window as unknown as Record<string, unknown>).matchMedia;
}

// Mock Kiro session for capsule busy
vi.mock("@/components/kiro/KiroSessionProvider", async () => {
  const actual = await vi.importActual<typeof import("@/components/kiro/KiroSessionProvider")>("@/components/kiro/KiroSessionProvider");
  return actual;
});

describe("Kiro Brand Motion System V2", () => {
  beforeEach(() => cleanup());

  it("Sidebar Kiro ambient data-kiro-flow always present", async () => {
    const src = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    expect(src).toContain('--kiro-flow-ambient');
    expect(src).toContain('[data-kiro-flow="ambient"]');
    // Sidebar component should have data-kiro-flow
    const sidebarSrc = fs.readFileSync(path.join(process.cwd(), "components/layout/Sidebar.tsx"), "utf8");
    expect(sidebarSrc).toContain('data-kiro-flow');
    expect(sidebarSrc).toContain('sidebar-kiro');
  });

  it("active Kiro state has active flow", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toContain('[data-kiro-flow="active"]');
    expect(css).toContain('--kiro-flow-active');
  });

  it("Capsule idle has ambient animated flow", async () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/kiro/sidecar/KiroSidecarMinimized.tsx"), "utf8");
    expect(src).toContain('data-kiro-flow={kiroBusy ? "working" : "ambient"}');
    expect(src).toContain('data-kiro-flow={kiroBusy ? "working" : "ambient"}');
    // Also check CSS has ambient
    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toContain('.kiro-capsule[data-kiro-flow="ambient"]');
  });

  it("Capsule busy enters working modifier", async () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/kiro/sidecar/KiroSidecarMinimized.tsx"), "utf8");
    expect(src).toContain('"working"');
    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toContain('[data-kiro-flow="working"]');
    expect(css).toContain('--kiro-flow-working');
  });

  it("Reduced Motion disables perimeter animation", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toContain('html[data-motion-effective="reduced"] [data-kiro-flow] .kiro-ring');
    expect(css).toContain('animation: none');
  });

  it("Thread Rail has ambient flow by default", async () => {
    const railSrc = fs.readFileSync(path.join(process.cwd(), "components/kiro/KiroThreadRail.tsx"), "utf8");
    expect(railSrc).toContain('data-kiro-flow');
    expect(railSrc).toContain('kiro-rail-plate');
    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toContain('.kiro-rail-plate[data-kiro-flow="ambient"]');
  });
});
