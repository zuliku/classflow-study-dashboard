// @vitest-environment node
/**
 * OpenCode Go 模型选择器精选（2026-09）：少而精，新的 / 能力强的优先。
 *
 * 契约：
 * - 选择器集合 = OPENCODE_SELECTOR_MODEL_IDS（顺序即展示顺序），全部存在且 transport 合法
 * - 未入选的已验证模型仍在注册表（历史选择 / transport 解析不受影响）
 * - 远端 catalog（/api/ai/models）只返回精选模型并按精选顺序
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  OPENCODE_MODELS,
  OPENCODE_SELECTOR_MODEL_IDS,
  getOpenCodeSelectorModels,
  isOpenCodeSelectorModelId,
} from "@/lib/ai/providers/openCodeGo";
import { getSelectorModelsForProvider, getModelsForProvider } from "@/lib/ai/providers/registry";
import { handleModels } from "@/app/api/ai/models/route";

describe("选择器精选列表", () => {
  it("精选 ids 全部存在于注册表，且 transport 合法", () => {
    const byId = new Map(OPENCODE_MODELS.map((m) => [m.id, m]));
    for (const id of OPENCODE_SELECTOR_MODEL_IDS) {
      const def = byId.get(id);
      expect(def, id).toBeTruthy();
      expect(["openai-chat", "openai-responses", "anthropic-messages"]).toContain(def!.transport);
    }
  });

  it("数量克制（≤ 10）且无重复；新 / 强优先顺序（gpt-6-luna → gpt-5.6-luna → grok-4.7）", () => {
    expect(OPENCODE_SELECTOR_MODEL_IDS.length).toBeLessThanOrEqual(10);
    expect(new Set(OPENCODE_SELECTOR_MODEL_IDS).size).toBe(OPENCODE_SELECTOR_MODEL_IDS.length);
    expect(OPENCODE_SELECTOR_MODEL_IDS.slice(0, 3)).toEqual([
      "gpt-6-luna",
      "gpt-5.6-luna",
      "grok-4.7",
    ]);
    // 默认模型必须在精选列表内（首次使用即可直接发送）
    expect(isOpenCodeSelectorModelId("deepseek-v4.1-flash")).toBe(true);
  });

  it("getOpenCodeSelectorModels 保持精选顺序；注册表（完整）仍包含未入选模型", () => {
    expect(getOpenCodeSelectorModels().map((m) => m.id)).toEqual([...OPENCODE_SELECTOR_MODEL_IDS]);
    expect(OPENCODE_SELECTOR_MODEL_IDS).not.toContain("grok-4.6");
    expect(getModelsForProvider("opencode-go").some((m) => m.id === "grok-4.6")).toBe(true);
  });

  it("新模型能力声明（live probe 通过后放开）", () => {
    const grok = OPENCODE_MODELS.find((m) => m.id === "grok-4.7")!;
    expect(grok.capabilities.vision).toBe(true);
    expect(grok.capabilities.visionMimeTypes).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(grok.capabilities.reasoning?.mechanism).toBe("openai-responses-effort");

    const mimo = OPENCODE_MODELS.find((m) => m.id === "mimo-v2.6-pro")!;
    expect(mimo.capabilities.vision).toBe(true);
    expect(mimo.capabilities.reasoning?.mechanism).toBe("effort");
  });

  it("2026-09-23 官方文档放开：vision / reasoning 扩展（luna / deepseek-v4.1-flash / glm-5.3 / qwen3.8-max / kimi-k2.7-code / mimo-v2-omni）", () => {
    const byId = new Map(OPENCODE_MODELS.map((m) => [m.id, m]));

    const luna = byId.get("gpt-5.6-luna")!;
    expect(luna.capabilities.vision).toBe(true);
    expect(luna.capabilities.visionMimeTypes).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(luna.capabilities.reasoning?.supportedEfforts).toEqual([
      "default",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);

    const deepseek = byId.get("deepseek-v4.1-flash")!;
    expect(deepseek.capabilities.vision).toBe(true);
    expect(deepseek.capabilities.reasoning).toEqual({
      adjustable: true,
      supportedEfforts: ["default", "low", "high", "max"],
      mechanism: "effort",
    });

    const glm = byId.get("glm-5.3")!;
    expect(glm.capabilities.vision).toBe(false);
    expect(glm.capabilities.reasoning?.supportedEfforts).toEqual(["default", "low", "high", "max"]);

    const qwenMax = byId.get("qwen3.8-max")!;
    expect(qwenMax.capabilities.vision).toBe(true);

    const kimiCode = byId.get("kimi-k2.7-code")!;
    expect(kimiCode.capabilities.vision).toBe(true);
    expect(kimiCode.capabilities.reasoning).toBeUndefined();

    const mimoOmni = byId.get("mimo-v2-omni")!;
    expect(mimoOmni.capabilities.vision).toBe(true);

    // 无官方能力证据的模型保持保守
    expect(byId.get("mimo-v2.5-pro")!.capabilities.vision).toBe(false);
    expect(byId.get("minimax-m2.7")!.capabilities.vision).toBe(false);
    expect(byId.get("hy3")!.capabilities.reasoning).toBeUndefined();
  });

  it("远端同步新增：gpt-6-luna（精选首位）/ mimo-v2.6-flash（注册表）官方文档能力", () => {
    const byId = new Map(OPENCODE_MODELS.map((m) => [m.id, m]));

    const gpt6 = byId.get("gpt-6-luna")!;
    expect(gpt6.transport).toBe("openai-responses");
    expect(gpt6.capabilities.vision).toBe(true);
    expect(gpt6.capabilities.visionMimeTypes).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(gpt6.capabilities.reasoning).toEqual({
      adjustable: true,
      supportedEfforts: ["default", "low", "medium", "high", "xhigh", "max"],
      mechanism: "openai-responses-effort",
    });
    expect(gpt6.contextWindowTokens).toBe(1_050_000);
    expect(isOpenCodeSelectorModelId("gpt-6-luna")).toBe(true);

    const flash = byId.get("mimo-v2.6-flash")!;
    expect(flash.transport).toBe("openai-chat");
    expect(flash.capabilities.vision).toBe(true);
    // effort 参数无官方证据 → 不声明 reasoning（保守），不进精选（Pro 代表 mimo）
    expect(flash.capabilities.reasoning).toBeUndefined();
    expect(flash.contextWindowTokens).toBe(1_000_000);
    expect(isOpenCodeSelectorModelId("mimo-v2.6-flash")).toBe(false);
  });

  it("getSelectorModelsForProvider：opencode-go 精选；deepseek 与注册表一致", () => {
    expect(getSelectorModelsForProvider("opencode-go").map((m) => m.id)).toEqual([
      ...OPENCODE_SELECTOR_MODEL_IDS,
    ]);
    expect(getSelectorModelsForProvider("deepseek")).toEqual(getModelsForProvider("deepseek"));
  });
});

describe("模型目录 route：精选列表 / all=1 全部模型", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubRemote(ids: string[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ object: "list", data: ids.map((id) => ({ id })) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
  }

  it("远端可用：过滤为精选模型 + 精选顺序", async () => {
    const { resetOpenCodeGoModelsCache } = await import("@/lib/ai/providers/openCodeGo");
    resetOpenCodeGoModelsCache();
    stubRemote(["hy3", "mimo-v2.6-pro", "omen-alpha", "grok-4.7", "deepseek-v4.1-flash"]);
    const res = await handleModels(new Request("http://local/api/ai/models?provider=opencode-go"));
    const body = (await res.json()) as { models: { id: string }[]; source: string };
    expect(body.source).toBe("remote");
    expect(body.models.map((m) => m.id)).toEqual([
      "grok-4.7",
      "deepseek-v4.1-flash",
      "mimo-v2.6-pro",
    ]);
  });

  it("远端失败：回落精选注册表（顺序不变）", async () => {
    const { resetOpenCodeGoModelsCache } = await import("@/lib/ai/providers/openCodeGo");
    resetOpenCodeGoModelsCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    const res = await handleModels(new Request("http://local/api/ai/models?provider=opencode-go"));
    const body = (await res.json()) as { models: { id: string }[]; source: string };
    expect(body.source).toBe("registry");
    expect(body.models.map((m) => m.id)).toEqual([...OPENCODE_SELECTOR_MODEL_IDS]);
  });

  it("all=1（显示更多模型）：返回全部已验证模型（远端 ∩ 注册表，厂商/能力排序），未入选模型回归", async () => {
    const { resetOpenCodeGoModelsCache } = await import("@/lib/ai/providers/openCodeGo");
    resetOpenCodeGoModelsCache();
    stubRemote(["hy3", "mimo-v2.6-pro", "omen-alpha", "grok-4.7", "deepseek-v4.1-flash"]);
    const res = await handleModels(
      new Request("http://local/api/ai/models?provider=opencode-go&all=1")
    );
    const body = (await res.json()) as { models: { id: string }[]; source: string };
    expect(body.source).toBe("remote");
    const ids = body.models.map((m) => m.id);
    // 全部已验证模型（含未入选精选的 hy3 / grok-4.7）；未知厂商 omen-alpha 仍被过滤
    expect(new Set(ids)).toEqual(new Set(["hy3", "mimo-v2.6-pro", "grok-4.7", "deepseek-v4.1-flash"]));
    expect(ids).not.toContain("omen-alpha");
    // 厂商（字母序）/ 能力排序：deepseek < mimo < tencent(hy3) < xai(grok)
    expect(ids).toEqual(["deepseek-v4.1-flash", "mimo-v2.6-pro", "hy3", "grok-4.7"]);
  });

  it("all=1 且远端失败：回落完整注册表（21 款，非精选）", async () => {
    const { resetOpenCodeGoModelsCache } = await import("@/lib/ai/providers/openCodeGo");
    resetOpenCodeGoModelsCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    const res = await handleModels(
      new Request("http://local/api/ai/models?provider=opencode-go&all=1")
    );
    const body = (await res.json()) as { models: { id: string }[]; source: string };
    expect(body.source).toBe("registry");
    expect(body.models).toHaveLength(OPENCODE_MODELS.length);
    expect(body.models.map((m) => m.id)).toEqual(getModelsForProvider("opencode-go").map((m) => m.id));
  });
});
