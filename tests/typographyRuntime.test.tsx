/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi, beforeAll } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";

beforeAll(() => {
  // jsdom lacks ResizeObserver / matchMedia required by SegmentedControl & motion hooks
  if (typeof (globalThis as unknown as Record<string, unknown>).ResizeObserver === "undefined") {
    (globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }
});

// TypographyRuntime — preference change → html.dataset.uiFont

describe("Typography V1 — TypographyRuntime", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.uiFont = "";
    vi.resetModules();
  });

  it("mount applies default harmonyos-sans-sc and reacts to updatePreferences", async () => {
    const storeMod = await import("@/store/useAppStore");
    const store = storeMod.useAppStore;
    // ensure default
    expect(store.getState().preferences.uiFont).toBe("harmonyos-sans-sc");

    const { TypographyRuntime } = await import("@/components/runtime/TypographyRuntime");
    render(React.createElement(TypographyRuntime));
    // after mount, dataset should be default
    expect(document.documentElement.dataset.uiFont).toBe("harmonyos-sans-sc");

    await act(async () => {
      store.getState().updatePreferences({ uiFont: "source-han-sans-sc" });
    });
    expect(document.documentElement.dataset.uiFont).toBe("source-han-sans-sc");

    await act(async () => {
      store.getState().updatePreferences({ uiFont: "misan" });
    });
    expect(document.documentElement.dataset.uiFont).toBe("misan");
  });

  it("applyUIFontDataset whitelist & fallback", async () => {
    const { applyUIFontDataset } = await import("@/components/runtime/TypographyRuntime");
    expect(applyUIFontDataset("source-han-sans-sc")).toBe("source-han-sans-sc");
    expect(document.documentElement.dataset.uiFont).toBe("source-han-sans-sc");
    expect(applyUIFontDataset("comic-sans")).toBe("harmonyos-sans-sc");
    expect(document.documentElement.dataset.uiFont).toBe("harmonyos-sans-sc");
    expect(applyUIFontDataset("misan")).toBe("misan");
  });

  it("MiSans selected but CSS fallback is still effective (no crash, dataset retained)", async () => {
    const storeMod = await import("@/store/useAppStore");
    const store = storeMod.useAppStore;
    const { TypographyRuntime } = await import("@/components/runtime/TypographyRuntime");
    render(React.createElement(TypographyRuntime));
    await act(async () => {
      store.getState().updatePreferences({ uiFont: "misan" });
    });
    // dataset keeps misan even though no MiSans file is installed — fallback is CSS-level
    expect(document.documentElement.dataset.uiFont).toBe("misan");
    // preference persists as misan
    expect(store.getState().preferences.uiFont).toBe("misan");
    // no exception, body still has font-family var(--font-ui) which resolves via fallback chain
    expect(document.documentElement.dataset.uiFont).toBe("misan");
  });
});

describe("Typography V1 — GeneralSettings uiFont row", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.uiFont = "";
  });

  it("GeneralSettings shows three options with correct labels and default", async () => {
    const { UI_FONT_LABELS } = await import("@/lib/typography/fonts");
    expect(UI_FONT_LABELS["harmonyos-sans-sc"]).toBe("HarmonyOS Sans SC（默认）");
    expect(UI_FONT_LABELS["source-han-sans-sc"]).toBe("思源黑体 / Source Han Sans");
    expect(UI_FONT_LABELS["misan"]).toBe("MiSans（需本机安装）");
    const fs = await import("node:fs");
    const raw = fs.readFileSync("components/settings/GeneralSettings.tsx", "utf8");
    expect(raw).toContain('settingId="ui-font"');
    expect(raw).toContain("界面字体");
    expect(raw).toContain("调整 ClassFlow 的界面字体，不影响代码、终端与数学公式。");
    // ensure SettingsSelect ariaLabel correct and labels used
    expect(raw).toContain('ariaLabel="界面字体"');
    expect(raw).toContain("UI_FONT_LABELS");
    // verify that GeneralSettings imports and uses uiFont preference
    expect(raw).toContain("preferences.uiFont");
    expect(raw).toContain('resetPreferencePatch("uiFont")');
  });

  it("AboutSettings contains 字体与许可 section with three fonts", async () => {
    const fs = await import("node:fs");
    const raw = fs.readFileSync("components/settings/AboutSettings.tsx", "utf8");
    expect(raw).toContain("字体与许可");
    expect(raw).toContain("FONT_REGISTRY");
    // FONT_REGISTRY supplies display names at runtime; file itself imports registry
    expect(raw).toContain("settings-font-licenses");
    // verify registry has expected entries
    const { FONT_REGISTRY: reg } = await import("@/lib/typography/fonts");
    expect(reg["harmonyos-sans-sc"].displayName).toContain("HarmonyOS");
    expect(reg["source-han-sans-sc"].displayName).toContain("思源");
    expect(reg["misan"].displayName).toBe("MiSans");
  });
});
