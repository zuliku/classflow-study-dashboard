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

  it("数量克制（≤ 10）且无重复；新 / 强优先顺序（gpt-5.6-luna → grok-4.7 → muse-spark-1.3）", () => {
    expect(OPENCODE_SELECTOR_MODEL_IDS.length).toBeLessThanOrEqual(10);
    expect(new Set(OPENCODE_SELECTOR_MODEL_IDS).size).toBe(OPENCODE_SELECTOR_MODEL_IDS.length);
    expect(OPENCODE_SELECTOR_MODEL_IDS.slice(0, 3)).toEqual([
      "gpt-5.6-luna",
      "grok-4.7",
      "muse-spark-1.3-contributor",
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

  it("getSelectorModelsForProvider：opencode-go 精选；deepseek 与注册表一致", () => {
    expect(getSelectorModelsForProvider("opencode-go").map((m) => m.id)).toEqual([
      ...OPENCODE_SELECTOR_MODEL_IDS,
    ]);
    expect(getSelectorModelsForProvider("deepseek")).toEqual(getModelsForProvider("deepseek"));
  });
});

describe("模型目录 route：只返回精选列表", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("远端可用：过滤为精选模型 + 精选顺序", async () => {
    const { resetOpenCodeGoModelsCache } = await import("@/lib/ai/providers/openCodeGo");
    resetOpenCodeGoModelsCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            object: "list",
            data: [
              { id: "hy3" },
              { id: "mimo-v2.6-pro" },
              { id: "omen-alpha" },
              { id: "grok-4.7" },
              { id: "deepseek-v4.1-flash" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );
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
});
