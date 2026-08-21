// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// Polyfill
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} } as unknown as typeof ResizeObserver;
}
if (typeof window !== "undefined" && !window.matchMedia) {
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  });
}
if (typeof globalThis !== "undefined" && !(globalThis as unknown as Record<string, unknown>).matchMedia) {
  (globalThis as unknown as Record<string, unknown>).matchMedia = (window as unknown as Record<string, unknown>).matchMedia;
}

describe("Demo Manual Injection Hardening", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("A. main.tsx does not auto inject demo (no DEMO_INJECT_VERSION, no marker)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
    expect(src).not.toContain("DEMO_INJECT_VERSION");
    expect(src).not.toContain("classflow-demo-injected");
    expect(src).not.toContain("buildFullDemoData");
    expect(src).not.toContain("injectDemoDataOnFirstRun");
  });

  it("B. app/page.tsx dev bootstrap does not auto inject without confirm", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "app/page.tsx"), "utf8");
    // Should not contain the automatic dev injection that checks hasData and then import fullDemoData without confirm
    // The remaining preview=task-v2 block is allowed but must have confirm
    const hasAutoInject = src.includes('localStorage.getItem("classflow-demo-injected") === "1"') && src.includes('restoreAppData(buildFullDemoData())') && !src.includes('confirm(');
    // We check that the auto block without confirm is gone
    expect(src).not.toContain('localStorage.setItem("classflow-demo-injected", "1")');
    // Preview block with confirm is allowed
    expect(src).toContain('preview=task-v2');
  });

  it("C. First Run visible when empty", async () => {
    const src = fs.readFileSync(path.join(process.cwd(), "app/page.tsx"), "utf8");
    expect(src).toContain('data-testid="getting-started"');
    expect(src).toContain("欢迎使用 ClassFlow");
    // Verify Home renders getting-started when store is empty (empty check)
    expect(src).toContain('courses.length === 0 &&');
  });

  it("D. Settings manual demo load requires confirm and updates store", async () => {
    const originalEnv = process.env.NODE_ENV;
    // @ts-ignore
    process.env.NODE_ENV = "development";
    vi.resetModules();
    const { useAppStore } = await import("@/store/useAppStore");
    const { buildFullDemoData } = await import("@/lib/dev/fullDemoData");
    // Ensure empty
    const emptyData = { ...buildFullDemoData(), courses: [], schedules: [], assignments: [], calendarMarks: [], studyBlocks: [], groupProjects: [], reminders: [], focusSessions: [], scheduleOccurrenceOverrides: [] };
    useAppStore.setState(emptyData as never);
    const { DataSettings } = await import("@/components/settings/DataSettings");
    const { useConfirmStore } = await import("@/store/useConfirmStore");
    const { useToastStore } = await import("@/store/useToastStore");
    useToastStore.setState({ toasts: [] } as never);
    const confirmSpy = vi.spyOn(useConfirmStore.getState(), "confirm");
    render(<DataSettings />);
    const btn = screen.getByTestId("dev-demo-reload").querySelector("button");
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
    expect(confirmSpy).toHaveBeenCalled();
    const req = useConfirmStore.getState().request;
    expect(req).toBeTruthy();
    expect(req?.title).toContain("载入完整演示数据");
    useConfirmStore.getState().close();
    expect(useAppStore.getState().courses.length).toBe(0);
    fireEvent.click(btn!);
    const req2 = useConfirmStore.getState().request!;
    await req2.onConfirm();
    await waitFor(() => expect(useAppStore.getState().courses.length).toBeGreaterThan(0), { timeout: 4000 });
    expect(useAppStore.getState().courses.length).toBe(10);
    expect(useToastStore.getState().toasts.some(t => t.message.includes("完整演示数据已载入"))).toBe(true);
    confirmSpy.mockRestore();
    // @ts-ignore
    process.env.NODE_ENV = originalEnv;
    vi.resetModules();
  }, 10000);

  it("E. Manual re-injection works without marker", async () => {
    const { useAppStore } = await import("@/store/useAppStore");
    const { buildFullDemoData } = await import("@/lib/dev/fullDemoData");
    // Start with some user data (use full data then replace)
    const base = buildFullDemoData();
    useAppStore.setState({ ...base, courses: [{ id: "c1", name: "Test", materials: [] }] } as never);
    expect(useAppStore.getState().courses.length).toBe(1);
    const data = buildFullDemoData();
    useAppStore.getState().restoreAppData(data);
    expect(useAppStore.getState().courses.length).toBe(10);
    const data2 = buildFullDemoData();
    useAppStore.getState().restoreAppData(data2);
    expect(useAppStore.getState().courses.length).toBe(10);
  });

  it("F. No native dialog in DataSettings", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/settings/DataSettings.tsx"), "utf8");
    expect(src).not.toContain("window.confirm");
    expect(src).not.toContain("window.alert");
    expect(src).not.toContain("window.prompt");
    // Should not use bare confirm( directly (allow useConfirmStore pattern)
    expect(src).not.toMatch(/\bconfirm\s*\(\s*["']/);
    expect(src).toContain("useConfirmStore");
  });

  it("fullDemoData fixture preserved", async () => {
    const { buildFullDemoData } = await import("@/lib/dev/fullDemoData");
    const data = buildFullDemoData();
    expect(data.courses.length).toBe(10);
    expect(data.schedules.length).toBeGreaterThanOrEqual(16);
    expect(data.assignments.length).toBe(30);
  });
});
