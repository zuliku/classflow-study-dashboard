import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getKiroOutputFontSize,
  KIRO_OUTPUT_FONT_SIZE_PX,
  normalizeKiroOutputTextSize,
} from "@/lib/ai/ui/typography";

describe("Kiro 输出字号纯配置", () => {
  it("三档字号：small=14 / standard=15 / large=17", () => {
    expect(KIRO_OUTPUT_FONT_SIZE_PX.small).toBe(14);
    expect(KIRO_OUTPUT_FONT_SIZE_PX.standard).toBe(15);
    expect(KIRO_OUTPUT_FONT_SIZE_PX.large).toBe(17);
    expect(getKiroOutputFontSize("small")).toBe(14);
    expect(getKiroOutputFontSize("standard")).toBe(15);
    expect(getKiroOutputFontSize("large")).toBe(17);
  });

  it("unknown / 迁移数据 normalize → fallback standard", () => {
    expect(normalizeKiroOutputTextSize("standard")).toBe("standard");
    expect(normalizeKiroOutputTextSize("small")).toBe("small");
    expect(normalizeKiroOutputTextSize("large")).toBe("large");
    expect(normalizeKiroOutputTextSize(undefined)).toBe("standard");
    expect(normalizeKiroOutputTextSize("xl")).toBe("standard");
    expect(normalizeKiroOutputTextSize(17)).toBe("standard");
  });
});

describe("useKiroPreferencesStore（轻量 persistence 覆盖）", () => {
  const KEY = "classflow-kiro-preferences-v1";

  beforeEach(() => {
    localStorage.clear();
  });

  async function freshStore() {
    vi.resetModules();
    const mod = await import("@/store/useKiroPreferencesStore");
    return mod.useKiroPreferencesStore;
  }

  it("默认 standard；setOutputTextSize 更新并持久化到 localStorage", async () => {
    const store = await freshStore();
    expect(store.getState().outputTextSize).toBe("standard");

    store.getState().setOutputTextSize("large");
    expect(store.getState().outputTextSize).toBe("large");

    const raw = localStorage.getItem(KEY);
    expect(raw).toContain('"outputTextSize":"large"');
  });

  it("刷新（重新 hydrate）后保持 large", async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { outputTextSize: "large" }, version: 0 }));
    const store = await freshStore();
    expect(store.getState().outputTextSize).toBe("large");
  });

  it("非法持久化值回退 standard", async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { outputTextSize: "huge" }, version: 0 }));
    const store = await freshStore();
    expect(store.getState().outputTextSize).toBe("standard");
  });

  it("Task 7E：autoContextEnabled 默认 true", async () => {
    const store = await freshStore();
    expect(store.getState().autoContextEnabled).toBe(true);
  });

  it("Task 7E：set false → 持久化 false；重新 hydrate 保留", async () => {
    const store = await freshStore();
    store.getState().setAutoContextEnabled(false);
    expect(store.getState().autoContextEnabled).toBe(false);
    expect(localStorage.getItem(KEY)).toContain('"autoContextEnabled":false');

    vi.resetModules();
    const store2 = (await import("@/store/useKiroPreferencesStore")).useKiroPreferencesStore;
    expect(store2.getState().autoContextEnabled).toBe(false);
  });

  it("Task 7E：legacy 持久化（无 autoContextEnabled 字段）→ fallback true", async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { outputTextSize: "small" }, version: 0 }));
    const store = await freshStore();
    expect(store.getState().outputTextSize).toBe("small");
    expect(store.getState().autoContextEnabled).toBe(true);
  });
});
