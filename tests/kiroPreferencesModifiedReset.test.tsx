/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_KIRO_SETTINGS_PREFERENCES,
  getModifiedKiroSettingsPreferenceKeys,
  resetKiroSettingsPreferencePatch,
  useKiroPreferencesStore,
  type KiroSettingsPreferences,
} from "@/store/useKiroPreferencesStore";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { KiroAISettings } from "@/components/settings/KiroAISettings";
import { DEFAULT_KIRO_RESPONSE_PREFERENCE } from "@/lib/ai/responsePreference";
import {
  DEFAULT_WEB_PDF_VISION_MODEL,
  getWebPdfVisionModelOptions,
} from "@/lib/ai/web/vision/models";
import {
  getSessionWebSearchApiKey,
  setSessionWebSearchApiKey,
} from "@/lib/ai/web/credentials";
import {
  getSessionWebPdfVisionApiKey,
  setSessionWebPdfVisionApiKey,
} from "@/lib/ai/web/vision/credentials";

vi.mock("@/hooks/useAIModelCatalog", () => ({
  useAIModelCatalog: () => ({ models: [] }),
}));

vi.mock("@/components/settings/KiroMemorySettings", () => ({
  KiroMemorySettings: () => null,
}));

if (typeof (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const CANONICAL: KiroSettingsPreferences = {
  outputTextSize: "standard",
  autoContextEnabled: true,
  responsePreference: DEFAULT_KIRO_RESPONSE_PREFERENCE,
  webSearchEnabled: true,
  webSearchCredentialMode: "server",
  webPdfVisionEnabled: true,
  webPdfVisionModel: DEFAULT_WEB_PDF_VISION_MODEL,
  showAllModels: false,
};

function alternateVisionModel(): string {
  return (
    getWebPdfVisionModelOptions().find((option) => option.id !== DEFAULT_WEB_PDF_VISION_MODEL)?.id ??
    DEFAULT_WEB_PDF_VISION_MODEL
  );
}

describe("V5A9 A：canonical Kiro Settings preference truth", () => {
  it("canonical defaults 只包含 8 个 Settings-facing preference", () => {
    expect(DEFAULT_KIRO_SETTINGS_PREFERENCES).toEqual(CANONICAL);
    expect(Object.keys(DEFAULT_KIRO_SETTINGS_PREFERENCES).sort()).toEqual(
      [
        "autoContextEnabled",
        "outputTextSize",
        "responsePreference",
        "showAllModels",
        "webPdfVisionEnabled",
        "webPdfVisionModel",
        "webSearchCredentialMode",
        "webSearchEnabled",
      ].sort()
    );
  });

  it("默认 preference → modified keys 为空", () => {
    expect(getModifiedKiroSettingsPreferenceKeys({ ...CANONICAL })).toEqual([]);
  });
});

describe("V5A9 B：逐字段 modified/reset semantics", () => {
  it.each([
    ["outputTextSize", { ...CANONICAL, outputTextSize: "large" }],
    ["autoContextEnabled", { ...CANONICAL, autoContextEnabled: false }],
    ["responsePreference", { ...CANONICAL, responsePreference: "deep" }],
    ["webSearchEnabled", { ...CANONICAL, webSearchEnabled: false }],
    ["webSearchCredentialMode", { ...CANONICAL, webSearchCredentialMode: "byok" }],
    ["webPdfVisionEnabled", { ...CANONICAL, webPdfVisionEnabled: false }],
    ["webPdfVisionModel", { ...CANONICAL, webPdfVisionModel: "non-default-model" }],
    ["showAllModels", { ...CANONICAL, showAllModels: true }],
  ] as const)("%s 偏离 → 仅该字段 modified", (key, preferences) => {
    expect(getModifiedKiroSettingsPreferenceKeys(preferences)).toEqual([key]);
  });

  it.each([
    ["outputTextSize", "standard"],
    ["autoContextEnabled", true],
    ["responsePreference", DEFAULT_KIRO_RESPONSE_PREFERENCE],
    ["webSearchEnabled", true],
    ["webSearchCredentialMode", "server"],
    ["webPdfVisionEnabled", true],
    ["webPdfVisionModel", DEFAULT_WEB_PDF_VISION_MODEL],
    ["showAllModels", false],
  ] as const)("resetKiroSettingsPreferencePatch(%s) → canonical", (key, value) => {
    expect(resetKiroSettingsPreferencePatch(key)).toEqual({ [key]: value });
  });
});

describe("V5A9 C：store reset boundary / hydrate compatibility", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  async function freshStore() {
    vi.resetModules();
    const mod = await import("@/store/useKiroPreferencesStore");
    return mod.useKiroPreferencesStore;
  }

  it("reset 单字段，不触碰其他 Settings preference / Sidecar / privacy state", async () => {
    const store = await freshStore();
    const originalSidecarSize = store.getState().sidecarSize;
    const originalSidecarPosition = store.getState().sidecarPosition;
    const originalMinimizedPosition = store.getState().sidecarMinimizedPosition;

    store.getState().setOutputTextSize("large");
    store.getState().setAutoContextEnabled(false);
    store.getState().setVisualAttachmentPrivacyNoticeSeen(true);

    store.getState().resetKiroSettingsPreference("outputTextSize");

    expect(store.getState().outputTextSize).toBe("standard");
    expect(store.getState().autoContextEnabled).toBe(false);
    expect(store.getState().sidecarSize).toEqual(originalSidecarSize);
    expect(store.getState().sidecarPosition).toEqual(originalSidecarPosition);
    expect(store.getState().sidecarMinimizedPosition).toEqual(originalMinimizedPosition);
    expect(store.getState().visualAttachmentPrivacyNoticeSeen).toBe(true);
  });

  it("legacy / malformed persisted Settings values 继续回落 canonical；排除字段仍按原逻辑 hydrate", async () => {
    localStorage.setItem(
      "classflow-kiro-preferences-v1",
      JSON.stringify({
        state: {
          outputTextSize: "giant",
          autoContextEnabled: "yes",
          responsePreference: "essay",
          webSearchEnabled: 1,
          webSearchCredentialMode: "fallback",
          webPdfVisionEnabled: "yes",
          webPdfVisionModel: "not-a-real-model",
          visualAttachmentPrivacyNoticeSeen: true,
        },
      })
    );

    const store = await freshStore();
    const state = store.getState();
    expect(state.outputTextSize).toBe(CANONICAL.outputTextSize);
    expect(state.autoContextEnabled).toBe(CANONICAL.autoContextEnabled);
    expect(state.responsePreference).toBe(CANONICAL.responsePreference);
    expect(state.webSearchEnabled).toBe(CANONICAL.webSearchEnabled);
    expect(state.webSearchCredentialMode).toBe(CANONICAL.webSearchCredentialMode);
    expect(state.webPdfVisionEnabled).toBe(CANONICAL.webPdfVisionEnabled);
    expect(state.webPdfVisionModel).toBe(CANONICAL.webPdfVisionModel);
    expect(state.showAllModels).toBe(CANONICAL.showAllModels);
    expect(state.visualAttachmentPrivacyNoticeSeen).toBe(true);
  });
});

describe("V5A9 D：KiroAISettings consumer modified/reset wiring", () => {
  const RESET_LABELS: Record<string, string> = {
    "kiro-response-preference": "将回答偏好恢复默认",
    "kiro-output-text-size": "将输出字号恢复默认",
    "kiro-auto-context": "将自动环境上下文恢复默认",
    "kiro-web-search-enabled": "将联网搜索恢复默认",
    "kiro-web-search-credential": "将搜索凭据恢复默认",
    "kiro-web-pdf-vision-enabled": "将扫描 PDF 识别恢复默认",
    "kiro-web-pdf-vision-model": "将 Vision 模型恢复默认",
    "kiro-show-all-models": "将模型范围恢复默认",
  };

  function resetButton(container: HTMLElement, settingId: string): HTMLButtonElement | null {
    return container.querySelector(
      `[data-setting-id="${settingId}"] button[aria-label="${RESET_LABELS[settingId]}"]`
    );
  }

  /**
   * 凭据 / Vision 行位于默认折叠的披露区（“搜索设置”/“高级设置”）内；
   * DisclosureRegion 未展开时 children 不挂载——测试按真实用户路径先展开再操作，
   * production disclosure 默认状态保持不变。
   */
  async function openDisclosure(container: HTMLElement, label: string) {
    const toggle = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes(label)
    );
    expect(toggle, `disclosure toggle "${label}" 应存在`).toBeTruthy();
    await act(async () => {
      toggle!.click();
    });
  }

  async function mountKiroSettings() {
    // V5A9.2：consumer 测试使用稳定 module graph——禁止 vi.resetModules() 后再混用
    // 顶层 import 的 createRoot（实测会分裂出两份 React/ReactDOM 实例）。
    // fresh state 通过显式 store reset 获得；需要 module-reset 的 hydration
    // 隔离保留在 C 节（不渲染 React，无此风险）。
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<KiroAISettings />);
    });
    return { container, root };
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // 稳定 graph 下显式恢复 fresh state（替代 vi.resetModules）：
    useKiroPreferencesStore.setState({ ...DEFAULT_KIRO_SETTINGS_PREFERENCES });
    useAISettingsStore.getState().reset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ serverConfigured: true }),
      }))
    );
  });

  it("默认态无 reset；字号改为 large 后出现 reset，点击恢复 standard", async () => {
    const { container, root } = await mountKiroSettings();
    const store = useKiroPreferencesStore;
    try {
      expect(resetButton(container, "kiro-output-text-size")).toBeNull();
      act(() => store.getState().setOutputTextSize("large"));
      expect(resetButton(container, "kiro-output-text-size")).toBeTruthy();
      await act(async () => resetButton(container, "kiro-output-text-size")!.click());
      expect(store.getState().outputTextSize).toBe("standard");
      expect(resetButton(container, "kiro-output-text-size")).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("搜索凭据 reset → server，但 Tavily session key 保留", async () => {
    setSessionWebSearchApiKey("tvly-v5a9-secret");
    const { container, root } = await mountKiroSettings();
    const store = useKiroPreferencesStore;
    try {
      act(() => store.getState().setWebSearchCredentialMode("byok"));
      await openDisclosure(container, "搜索设置");
      expect(resetButton(container, "kiro-web-search-credential")).toBeTruthy();
      await act(async () => resetButton(container, "kiro-web-search-credential")!.click());
      expect(store.getState().webSearchCredentialMode).toBe("server");
      expect(getSessionWebSearchApiKey()).toBe("tvly-v5a9-secret");
      expect(resetButton(container, "kiro-web-search-credential")).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("PDF Vision preference reset 不清 Vision session key", async () => {
    setSessionWebPdfVisionApiKey("vision-v5a9-secret");
    const { container, root } = await mountKiroSettings();
    const store = useKiroPreferencesStore;
    try {
      act(() => {
        store.getState().setWebPdfVisionEnabled(false);
        store.getState().setWebPdfVisionModel(alternateVisionModel());
      });
      await openDisclosure(container, "高级设置");
      expect(resetButton(container, "kiro-web-pdf-vision-enabled")).toBeTruthy();
      await act(async () => resetButton(container, "kiro-web-pdf-vision-enabled")!.click());
      expect(store.getState().webPdfVisionEnabled).toBe(true);
      expect(getSessionWebPdfVisionApiKey()).toBe("vision-v5a9-secret");
      expect(resetButton(container, "kiro-web-pdf-vision-enabled")).toBeNull();

      if (alternateVisionModel() !== DEFAULT_WEB_PDF_VISION_MODEL) {
        expect(resetButton(container, "kiro-web-pdf-vision-model")).toBeTruthy();
        await act(async () => resetButton(container, "kiro-web-pdf-vision-model")!.click());
        expect(store.getState().webPdfVisionModel).toBe(DEFAULT_WEB_PDF_VISION_MODEL);
        expect(getSessionWebPdfVisionApiKey()).toBe("vision-v5a9-secret");
        expect(resetButton(container, "kiro-web-pdf-vision-model")).toBeNull();
      }
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("模型范围：OpenCode Go 下打开「显示更多模型」出现 reset，点击恢复精选", async () => {
    useAISettingsStore.setState({ provider: "opencode-go", model: "deepseek-v4.1-flash" });
    const { container, root } = await mountKiroSettings();
    const store = useKiroPreferencesStore;
    try {
      expect(container.querySelector('[data-setting-id="kiro-show-all-models"]')).toBeTruthy();
      expect(resetButton(container, "kiro-show-all-models")).toBeNull();
      act(() => store.getState().setShowAllModels(true));
      expect(resetButton(container, "kiro-show-all-models")).toBeTruthy();
      await act(async () => resetButton(container, "kiro-show-all-models")!.click());
      expect(store.getState().showAllModels).toBe(false);
      expect(resetButton(container, "kiro-show-all-models")).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("AI 关闭态可启用：点击“启用 Kiro”后设置正常渲染且偏好 truth 不变", async () => {
    const { container, root } = await mountKiroSettings();
    const store = useKiroPreferencesStore;
    try {
      expect(useAISettingsStore.getState().enabled).toBe(false);
      const enableSwitch = container.querySelector(
        '[data-setting-id="ai-enabled"] [role="switch"]'
      ) as HTMLButtonElement | null;
      expect(enableSwitch).toBeTruthy();
      await act(async () => {
        enableSwitch!.click();
      });
      expect(useAISettingsStore.getState().enabled).toBe(true);
      // 启用后设置行正常渲染（Hook 顺序稳定，无 render exception），偏好 truth 不变
      expect(container.querySelector('[data-setting-id="kiro-output-text-size"]')).toBeTruthy();
      expect(resetButton(container, "kiro-output-text-size")).toBeNull();
      expect(store.getState().outputTextSize).toBe("standard");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
