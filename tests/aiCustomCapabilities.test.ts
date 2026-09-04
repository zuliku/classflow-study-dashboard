import { describe, it, expect, beforeEach, vi } from "vitest";
import { getModelCapabilities } from "@/lib/ai/providers/capabilities";

const KEY = "classflow-ai-settings-v1";

/**
 * V5A8：Custom OpenAI 能力声明 persistence truth。
 * setCustom() 与 partialize() 均携带 vision/fileParts/reasoningEffort，
 * hydrate 后的 sanitize 必须同样保留，否则 runtime 回落保守值即为 bug。
 */
describe("V5A8 custom capability persistence truth", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  async function freshStore() {
    vi.resetModules();
    const mod = await import("@/store/useAISettingsStore");
    return mod.useAISettingsStore;
  }

  function seedCustom(custom: Record<string, unknown>) {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: {
          provider: "custom-openai",
          custom: {
            providerName: "My Provider",
            baseURL: "https://example.com/v1",
            model: "my-model",
            ...custom,
          },
        },
      })
    );
  }

  it("Case A — 全 true 跨 hydrate 保留", async () => {
    seedCustom({ vision: true, fileParts: true, reasoningEffort: true });
    const store = await freshStore();
    const custom = store.getState().custom;
    expect(custom.vision).toBe(true);
    expect(custom.fileParts).toBe(true);
    expect(custom.reasoningEffort).toBe(true);
  });

  it("Case B — 显式 false 保持 false（不被翻转）", async () => {
    seedCustom({ vision: false, fileParts: false, reasoningEffort: false });
    const store = await freshStore();
    const custom = store.getState().custom;
    expect(custom.vision).toBe(false);
    expect(custom.fileParts).toBe(false);
    expect(custom.reasoningEffort).toBe(false);
  });

  it("Case C — legacy 缺字段正常 hydrate，runtime 保持保守", async () => {
    seedCustom({});
    const store = await freshStore();
    const custom = store.getState().custom;
    expect(custom.providerName).toBe("My Provider");
    const cap = getModelCapabilities({ provider: "custom-openai", model: "my-model", custom });
    expect(cap.vision).toBe(false);
    expect(cap.fileParts).toBe(false);
    expect(cap.reasoning.adjustable).toBe(false);
  });

  it("Case D — malformed 值回落 conservative false（禁 truthy 强转）", async () => {
    seedCustom({ vision: "true", fileParts: 1, reasoningEffort: {} });
    const store = await freshStore();
    const custom = store.getState().custom;
    expect(custom.vision).toBe(false);
    expect(custom.fileParts).toBe(false);
    expect(custom.reasoningEffort).toBe(false);
    seedCustom({ vision: 0, fileParts: [], reasoningEffort: null });
    const store2 = await freshStore();
    expect(store2.getState().custom.vision).toBe(false);
    expect(store2.getState().custom.fileParts).toBe(false);
    expect(store2.getState().custom.reasoningEffort).toBe(false);
  });

  it("Case E — providerName/baseURL/model 原长度限制不退化", async () => {
    seedCustom({
      providerName: "n".repeat(200),
      baseURL: "https://example.com/" + "p".repeat(600),
      model: "m".repeat(200),
      vision: true,
    });
    const store = await freshStore();
    const custom = store.getState().custom;
    expect(custom.providerName.length).toBe(80);
    expect(custom.baseURL.length).toBe(512);
    expect(custom.model.length).toBe(120);
    expect(custom.vision).toBe(true);
  });

  it("Case F — hydrate 后 runtime truth 与用户选择一致", async () => {
    seedCustom({ vision: true, fileParts: true, reasoningEffort: true });
    const store = await freshStore();
    const custom = store.getState().custom;
    const cap = getModelCapabilities({ provider: "custom-openai", model: "my-model", custom });
    expect(cap.vision).toBe(true);
    expect(cap.fileParts).toBe(true);
    expect(cap.reasoning.adjustable).toBe(true);
    expect(cap.reasoning.supportedEfforts).toEqual(["default", "low", "medium", "high"]);
  });

  it("全链路：setCustom → persist → reload 后 truth 不变", async () => {
    const store = await freshStore();
    store.getState().setCustom({ vision: true, fileParts: true, reasoningEffort: true });
    await new Promise((r) => setTimeout(r, 10));
    const reloaded = await freshStore();
    const custom = reloaded.getState().custom;
    expect(custom.vision).toBe(true);
    expect(custom.fileParts).toBe(true);
    expect(custom.reasoningEffort).toBe(true);
    const cap = getModelCapabilities({ provider: "custom-openai", model: custom.model, custom });
    expect(cap.vision).toBe(true);
    expect(cap.reasoning.adjustable).toBe(true);
  });

  it("storage key 未改变且无 migration（仍为 v1）", async () => {
    const store = await freshStore();
    expect(store.persist.getOptions().name).toBe(KEY);
    store.getState().setCustom({ vision: true });
    await new Promise((r) => setTimeout(r, 10));
    const raw = JSON.parse(localStorage.getItem(KEY)!);
    expect(raw.state.custom.vision).toBe(true);
  });
});
