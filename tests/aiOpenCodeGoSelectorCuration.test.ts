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

  it("数量克制（≤ 10）且无重复；2026-10 官方新增优先（gpt-6-luna → claude-haiku-5-5 → gemini-4-argon）", () => {
    expect(OPENCODE_SELECTOR_MODEL_IDS.length).toBeLessThanOrEqual(10);
    expect(new Set(OPENCODE_SELECTOR_MODEL_IDS).size).toBe(OPENCODE_SELECTOR_MODEL_IDS.length);
    expect(OPENCODE_SELECTOR_MODEL_IDS.slice(0, 4)).toEqual([
      "gpt-6-luna",
      "claude-haiku-5-5",
      "gemini-4-argon",
      "kimi-k3.1-pro",
    ]);
    // 默认模型必须在精选列表内（首次使用即可直接发送）
    expect(isOpenCodeSelectorModelId("deepseek-v4.1-flash")).toBe(true);
  });

  it("getOpenCodeSelectorModels 保持精选顺序；注册表（完整）仍包含未入选模型", () => {
    expect(getOpenCodeSelectorModels().map((m) => m.id)).toEqual([...OPENCODE_SELECTOR_MODEL_IDS]);
    expect(OPENCODE_SELECTOR_MODEL_IDS).not.toContain("muse-spark-1.3-contributor");
    expect(getModelsForProvider("opencode-go").some((m) => m.id === "muse-spark-1.3-contributor")).toBe(true);
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

  it("官方文档放开：vision / reasoning 扩展（luna / deepseek-v4.1-flash / glm-5.3 / qwen3.8-max / kimi-k2.7-code）", () => {
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

    // 无官方能力证据的模型保持保守
    expect(byId.get("mimo-v2.5-pro")!.capabilities.vision).toBe(false);
    expect(byId.get("glm-5.2")!.capabilities.vision).toBe(false);
    expect(byId.get("deepseek-v4-pro")!.capabilities.vision).toBe(false);
  });

  it("思考程度覆盖扩展：glm-5.3-flash 官方三源确认档位（与 glm-5.3 同档同机制）", () => {
    const byId = new Map(OPENCODE_MODELS.map((m) => [m.id, m]));
    const flash = byId.get("glm-5.3-flash")!;
    expect(flash.capabilities.reasoning).toEqual({
      adjustable: true,
      supportedEfforts: ["default", "low", "high", "max"],
      mechanism: "effort",
    });
  });

  it("仍暂缓：官方 variants 不是 effort 形态 / 无档位的模型不声明 reasoning（防虚假 control）", () => {
    const byId = new Map(OPENCODE_MODELS.map((m) => [m.id, m]));
    // MiniMax M3：variants 仅 none/thinking（开关，不是 effort 档位）
    expect(byId.get("minimax-m3")!.capabilities.reasoning).toBeUndefined();
    // mimo：仅 thinking 开关（v2.5/pro 各档效果一致；flash 无档位证据）
    for (const id of ["mimo-v2.5", "mimo-v2.6-flash", "mimo-v2.5-pro"]) {
      expect(byId.get(id)!.capabilities.reasoning, id).toBeUndefined();
    }
    // k2.7-code：常开且无 effort 参数；longcat：官方 variants 为空
    expect(byId.get("kimi-k2.7-code")!.capabilities.reasoning).toBeUndefined();
    expect(byId.get("longcat-2.0")!.capabilities.reasoning).toBeUndefined();
  });

  it("2026-10-29 官方 variants：hy / qwen 档位随官方数据放开", () => {
    const byId = new Map(OPENCODE_MODELS.map((m) => [m.id, m]));
    expect(byId.get("hy3")!.capabilities.reasoning).toEqual({
      adjustable: true,
      supportedEfforts: ["default", "low", "high"],
      mechanism: "effort",
    });
    expect(byId.get("hy4-preview")!.capabilities.reasoning).toEqual({
      adjustable: true,
      supportedEfforts: ["default", "high"],
      mechanism: "effort",
    });
    expect(byId.get("qwen3.8-flash")!.capabilities.reasoning).toEqual({
      adjustable: true,
      supportedEfforts: ["default", "low", "medium", "xhigh"],
      mechanism: "anthropic-effort",
    });
    expect(byId.get("qwen3.7-plus")!.capabilities.reasoning).toEqual({
      adjustable: true,
      supportedEfforts: ["default", "high", "max"],
      mechanism: "anthropic-effort",
    });
  });

  it("思考程度覆盖扩展：qwen3.8-max 官方档位经 anthropic-effort 放开", () => {
    const byId = new Map(OPENCODE_MODELS.map((m) => [m.id, m]));
    const qwenMax = byId.get("qwen3.8-max")!;
    expect(qwenMax.capabilities.reasoning).toEqual({
      adjustable: true,
      supportedEfforts: ["default", "low", "medium", "xhigh"],
      mechanism: "anthropic-effort",
    });
  });

  it("2026-10-29 官方目录同步：28 款非免费模型，免费模型与下线模型排除", () => {
    const ids = OPENCODE_MODELS.map((m) => m.id);
    expect(ids).toHaveLength(28);
    expect(new Set(ids).size).toBe(28);
    for (const free of ["beam-free", "iceman-contributor-free"]) {
      expect(ids).not.toContain(free);
    }
    for (const retired of ["grok-4.6", "mimo-v2-omni", "minimax-m2.7"]) {
      expect(ids).not.toContain(retired);
    }
    for (const added of [
      "kimi-k3.1-pro",
      "minimax-m3.1-flash",
      "gemini-4-argon",
      "claude-haiku-5-5",
      "step-5-preview",
      "deepseek-v4-pro",
      "glm-5.2",
      "muse-spark-1.2-contributor",
    ]) {
      expect(ids, added).toContain(added);
    }
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
    stubRemote([
      "hy3",
      "mimo-v2.6-pro",
      "omen-alpha",
      "grok-4.7",
      "deepseek-v4.1-flash",
      "claude-haiku-5-5",
      "gemini-4-argon",
      "minimax-m3.1-flash",
    ]);
    const res = await handleModels(new Request("http://local/api/ai/models?provider=opencode-go"));
    const body = (await res.json()) as { models: { id: string }[]; source: string };
    expect(body.source).toBe("remote");
    expect(body.models.map((m) => m.id)).toEqual([
      "claude-haiku-5-5",
      "gemini-4-argon",
      "grok-4.7",
      "minimax-m3.1-flash",
      "deepseek-v4.1-flash",
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

  it("all=1 且远端失败：回落完整注册表（28 款，非精选）", async () => {
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

  it("refresh=1：跳过短缓存强制请求官方 /models；普通请求仍命中缓存", async () => {
    const { resetOpenCodeGoModelsCache } = await import("@/lib/ai/providers/openCodeGo");
    resetOpenCodeGoModelsCache();
    let ids = ["grok-4.7"];
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ object: "list", data: ids.map((id) => ({ id })) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await handleModels(new Request("http://local/api/ai/models?provider=opencode-go"));
    expect(((await first.json()) as { source: string }).source).toBe("remote");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    ids = ["deepseek-v4.1-flash"];
    const cached = await handleModels(
      new Request("http://local/api/ai/models?provider=opencode-go")
    );
    const cachedBody = (await cached.json()) as { models: { id: string }[] };
    expect(cachedBody.models.map((m) => m.id)).toEqual(["grok-4.7"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const refreshed = await handleModels(
      new Request("http://local/api/ai/models?provider=opencode-go&refresh=1")
    );
    const refreshedBody = (await refreshed.json()) as { models: { id: string }[]; source: string };
    expect(refreshedBody.source).toBe("remote");
    expect(refreshedBody.models.map((m) => m.id)).toEqual(["deepseek-v4.1-flash"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshed.headers.get("cache-control")).toBe("no-store");
  });

  it("refresh=1 失败：source=registry，且不污染上一次成功缓存", async () => {
    const { resetOpenCodeGoModelsCache } = await import("@/lib/ai/providers/openCodeGo");
    resetOpenCodeGoModelsCache();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ object: "list", data: [{ id: "grok-4.7" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await handleModels(new Request("http://local/api/ai/models?provider=opencode-go"));
    expect(((await first.json()) as { source: string }).source).toBe("remote");

    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const failed = await handleModels(
      new Request("http://local/api/ai/models?provider=opencode-go&refresh=1")
    );
    const failedBody = (await failed.json()) as { models: { id: string }[]; source: string };
    expect(failedBody.source).toBe("registry");
    // registry fallback 仍包含已下线/精选模型，客户端据 source 提示刷新失败
    expect(failedBody.models.map((m) => m.id)).toEqual([...OPENCODE_SELECTOR_MODEL_IDS]);

    // 刷新失败不写 null 缓存：下一次普通请求继续使用上一次成功结果（不再打远端）
    const after = await handleModels(new Request("http://local/api/ai/models?provider=opencode-go"));
    const afterBody = (await after.json()) as { models: { id: string }[]; source: string };
    expect(afterBody.source).toBe("remote");
    expect(afterBody.models.map((m) => m.id)).toEqual(["grok-4.7"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
