import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getModelsForProvider, getDefaultModel, getActiveModelName, getVendorForModelId, getActiveModelVendor, sortModelsByVendorAndCapability } from "@/lib/ai/providers/registry";
import { AI_PROVIDER_META, getVendorMeta } from "@/lib/ai/providers/vendors";
import { normalizeBaseURL, KIRO_SYSTEM_PROMPT } from "@/lib/ai/config";
import { validateCustomBaseURL } from "@/lib/ai/providers/customOpenAI";
import { normalizeAIError, AIError } from "@/lib/ai/errors";
import { logProviderError } from "@/lib/ai/providerLog";
import { getSessionApiKey, setSessionApiKey } from "@/lib/ai/sessionKeys";
import { DEEPSEEK_MODELS } from "@/lib/ai/providers/deepSeek";
import { OPENCODE_MODELS, filterRemoteGoModels } from "@/lib/ai/providers/openCodeGo";

describe("Provider Registry", () => {
  it("DeepSeek：V4 Flash（默认）/ V4 Pro，openai-chat transport", () => {
    const models = getModelsForProvider("deepseek");
    expect(models.map((m) => m.id)).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    expect(getDefaultModel("deepseek")).toBe("deepseek-v4-flash");
    expect(models.every((m) => m.transport === "openai-chat")).toBe(true);
    expect(DEEPSEEK_MODELS[0].name).toBe("V4 Flash");
  });

  it("OpenCode Go：官方三 transport 注册表（chat + responses + messages）", () => {
    const models = getModelsForProvider("opencode-go");
    const ids = models.map((m) => m.id);
    expect(ids).toContain("glm-5.3");
    expect(ids).toContain("glm-5.2");
    expect(ids).toContain("kimi-k3");
    expect(ids).toContain("deepseek-v4-flash");
    expect(ids).toContain("mimo-v2.5");
    expect(ids).toContain("hy3");
    // openai-responses 模型（Phase 3.1 正式接入）
    expect(ids).toContain("gpt-5.6-luna");
    expect(ids).toContain("grok-4.5");
    // anthropic-messages 模型
    expect(ids).toContain("minimax-m3");
    expect(ids).toContain("minimax-m2.7");
    expect(ids).toContain("qwen3.8-max");
    expect(ids).toContain("qwen3.7-max");
    expect(ids).toContain("qwen3.6-plus");
    // 每个模型都有合法 transport（全部来自注册表声明）
    expect(
      models.every(
        (m) => m.transport === "openai-chat" || m.transport === "openai-responses" || m.transport === "anthropic-messages"
      )
    ).toBe(true);
    expect(getDefaultModel("opencode-go")).toBe("deepseek-v4-flash");
  });

  it("OpenCode transport 划分与官方 endpoint 表一致", () => {
    const byId = new Map(OPENCODE_MODELS.map((m) => [m.id, m.transport]));
    const chatModels = ["glm-5.3", "glm-5.2", "glm-5.1", "kimi-k3", "kimi-k2.7-code", "kimi-k2.6", "deepseek-v4-pro", "deepseek-v4-flash", "mimo-v2.5", "mimo-v2.5-pro", "hy3"];
    const responsesModels = ["grok-4.5", "gpt-5.6-luna"];
    const messagesModels = ["minimax-m3", "minimax-m2.7", "minimax-m2.5", "qwen3.8-max", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus"];
    for (const id of chatModels) expect(byId.get(id), id).toBe("openai-chat");
    for (const id of responsesModels) expect(byId.get(id), id).toBe("openai-responses");
    for (const id of messagesModels) expect(byId.get(id), id).toBe("anthropic-messages");
  });

  it("模型排序：厂商首字母分组相邻，组内按能力降序", () => {
    const models = getModelsForProvider("opencode-go");
    const vendors = models.map((m) => m.vendor);
    // 相同厂商相邻（vendor 序列无交叉）
    const seen = new Set<string>();
    let last: string | null = null;
    for (const v of vendors) {
      const key = v ?? "";
      if (seen.has(key) && key !== last) throw new Error(`vendor 交叉：${vendors.join(",")}`);
      seen.add(key);
      last = key;
    }
    // 厂商首字母序：deepseek(D) < kimi(K) < mimo(M) < minimax(M) < openai(O) < qwen(Q) < tencent(T) < xai(X) < zai(Z)
    const unique = Array.from(new Set(vendors.map((v) => v ?? "")));
    expect(unique).toEqual(["deepseek", "kimi", "mimo", "minimax", "openai", "qwen", "tencent", "xai", "zai"]);
    // 组内能力降序：kimi 的 vision 模型（k3/k2.7-code，Phase 3.7）都在 k2.6（非 vision）前
    const kimiIdx = models.map((m) => m.id);
    expect(kimiIdx.indexOf("kimi-k2.6")).toBeGreaterThan(Math.max(kimiIdx.indexOf("kimi-k3"), kimiIdx.indexOf("kimi-k2.7-code")));
    // DeepSeek 组内按 id 稳定
    expect(models.map((m) => m.id).indexOf("deepseek-v4-flash")).toBeLessThan(models.map((m) => m.id).indexOf("deepseek-v4-pro"));
  });

  it("排序纯函数：不修改原数组，能力相同保持稳定", () => {
    const list = [
      { id: "b", vendor: "kimi" as const, capabilities: { vision: false, fileParts: false } },
      { id: "a", vendor: "kimi" as const, capabilities: { vision: false, fileParts: false } },
    ];
    const sorted = sortModelsByVendorAndCapability(list);
    expect(sorted.map((m) => m.id)).toEqual(["a", "b"]);
    expect(list.map((m) => m.id)).toEqual(["b", "a"]); // 原数组不变
  });

  it("Custom：registry 无固定列表；展示名来自用户 Model ID", () => {
    expect(getModelsForProvider("custom-openai")).toEqual([]);
    expect(getActiveModelName({ provider: "custom-openai", model: "my-model", customModel: "my-model" })).toBe("my-model");
    expect(getActiveModelName({ provider: "custom-openai", model: "", customModel: "" })).toBe("未设置模型");
  });

  it("展示名：DeepSeek 显示短名而非完整 id", () => {
    expect(getActiveModelName({ provider: "deepseek", model: "deepseek-v4-flash", customModel: "" })).toBe("V4 Flash");
    expect(getActiveModelName({ provider: "deepseek", model: "deepseek-v4-pro", customModel: "" })).toBe("V4 Pro");
  });

  it("远端模型筛选：已知 ID 保留真实 transport；未知模型过滤，不默认 openai-chat", () => {
    const out = filterRemoteGoModels([
      { id: "glm-5.3" },
      { id: "minimax-m3" },
      { id: "qwen3.7-plus" },
      { id: "gpt-5.6-luna" }, // openai-responses：已支持 → 保留
      { id: "grok-4.5" }, // openai-responses：已支持 → 保留
      { id: "some-unknown-model" }, // 未知 → 跳过（远端不返回 transport，绝不猜测）
      { id: "minimax-m3" }, // 去重
    ]);
    expect(out).toEqual([
      { id: "glm-5.3", transport: "openai-chat" },
      { id: "minimax-m3", transport: "anthropic-messages" },
      { id: "qwen3.7-plus", transport: "anthropic-messages" },
      { id: "gpt-5.6-luna", transport: "openai-responses" },
      { id: "grok-4.5", transport: "openai-responses" },
    ]);
  });

  it("OPENCODE_MODELS 中不存在 transport 黑名单/白名单漂移：每个模型 transport 均来自注册表声明", () => {
    expect(OPENCODE_MODELS.some((m) => m.id === "gpt-5.6-luna")).toBe(true);
    expect(OPENCODE_MODELS.some((m) => m.id === "grok-4.5")).toBe(true);
    expect(
      OPENCODE_MODELS.every(
        (m) => m.transport === "openai-chat" || m.transport === "openai-responses" || m.transport === "anthropic-messages"
      )
    ).toBe(true);
  });
});

describe("OpenCode Phase 3.1：openai-responses registry 与过滤一致性", () => {
  it("1. glm-5.3 已注册，transport = openai-chat", () => {
    const def = OPENCODE_MODELS.find((m) => m.id === "glm-5.3");
    expect(def?.transport).toBe("openai-chat");
    expect(def?.vendor).toBe("zai");
    expect(def?.name).toBe("GLM 5.3");
    expect(def?.capabilities.reasoning).toBeUndefined(); // 不声明 reasoning → fixed/default
  });

  it("2. grok-4.5 已注册，transport = openai-responses", () => {
    const def = OPENCODE_MODELS.find((m) => m.id === "grok-4.5");
    expect(def?.transport).toBe("openai-responses");
    expect(def?.vendor).toBe("xai");
    expect(def?.name).toBe("Grok 4.5");
    expect(def?.capabilities.vision).toBe(false); // 保守：未实测多模态兼容
    // Phase 3.2B：Grok reasoning 经 live smoke 验证 → adjustable（default/low/medium/high）
    expect(def?.capabilities.reasoning?.adjustable).toBe(true);
    expect(def?.capabilities.reasoning?.mechanism).toBe("openai-responses-effort");
  });

  it("3. gpt-5.6-luna 已注册，transport = openai-responses", () => {
    const def = OPENCODE_MODELS.find((m) => m.id === "gpt-5.6-luna");
    expect(def?.transport).toBe("openai-responses");
    expect(def?.vendor).toBe("openai"); // OpenAI Blossom Logo（浅色主题用黑色版）
    expect(def?.name).toBe("GPT 5.6 Luna");
    // Phase 3.2A：Luna 是唯一 verified OpenCode adjustable reasoning 模型
    expect(def?.capabilities.reasoning?.adjustable).toBe(true);
    expect(def?.capabilities.reasoning?.mechanism).toBe("openai-responses-effort");
  });

  it("4. filterRemoteGoModels：glm-5.3 / minimax-m3 / grok-4.5 / gpt-5.6-luna 保留各自 transport；unknown 过滤", () => {
    const out = filterRemoteGoModels([
      { id: "glm-5.3" },
      { id: "minimax-m3" },
      { id: "grok-4.5" },
      { id: "gpt-5.6-luna" },
      { id: "some-unknown-model" },
    ]);
    expect(out).toEqual([
      { id: "glm-5.3", transport: "openai-chat" },
      { id: "minimax-m3", transport: "anthropic-messages" },
      { id: "grok-4.5", transport: "openai-responses" },
      { id: "gpt-5.6-luna", transport: "openai-responses" },
    ]);
  });

  it("5. 未知远端模型（mimo-v2-omni）在未 verified transport 前过滤", () => {
    expect(OPENCODE_MODELS.some((m) => m.id === "mimo-v2-omni")).toBe(false);
    expect(filterRemoteGoModels([{ id: "mimo-v2-omni" }])).toEqual([]);
  });
});

describe("模型 → 厂商（Logo）映射", () => {
  it("已知 vendor 模型都有 Logo；vendor=null（MiniMax/Qwen 暂无本地 Logo）走 neutral fallback", () => {
    for (const def of [...DEEPSEEK_MODELS, ...OPENCODE_MODELS]) {
      if (def.vendor === null) continue; // 新厂商无本地 Logo → neutral fallback（不允许下载）
      expect(AI_PROVIDER_META[def.vendor].logo, def.id).toBeTruthy();
    }
    expect(getVendorMeta(null).logo).toBe("");
  });

  it("模型 → 厂商映射正确（不靠名称猜测）", () => {
    expect(getVendorForModelId("grok-4.5")).toBe("xai");
    expect(getVendorForModelId("glm-5.2")).toBe("zai");
    expect(getVendorForModelId("glm-5.1")).toBe("zai");
    expect(getVendorForModelId("kimi-k3")).toBe("kimi");
    expect(getVendorForModelId("kimi-k2.7-code")).toBe("kimi");
    expect(getVendorForModelId("deepseek-v4-flash")).toBe("deepseek");
    expect(getVendorForModelId("deepseek-v4-pro")).toBe("deepseek");
    expect(getVendorForModelId("mimo-v2.5")).toBe("mimo");
    expect(getVendorForModelId("hy3")).toBe("tencent");
    expect(getVendorForModelId("minimax-m3")).toBe("minimax");
    expect(getVendorForModelId("qwen3.7-max")).toBe("qwen");
  });

  it("未知模型 → null（UI 走 neutral fallback），不猜厂商", () => {
    expect(getVendorForModelId("some-brand-new-model")).toBeNull();
    expect(getVendorForModelId("")).toBeNull();
    // gpt-5.6-luna 已注册（Phase 3.1）→ 明确 vendor=openai；不是猜的
    expect(getVendorForModelId("gpt-5.6-luna")).toBe("openai");
    expect(getVendorForModelId("gpt-unknown-model")).toBeNull(); // 未注册 gpt-* 不猜
  });

  it("已知命名空间前缀兜底只覆盖明确厂商", () => {
    expect(getVendorForModelId("deepseek-v4-flash-free")).toBe("deepseek");
    expect(getVendorForModelId("kimi-k3-turbo")).toBe("kimi");
    expect(getVendorForModelId("mimo-v3")).toBe("mimo");
    expect(getVendorForModelId("minimax-m3-turbo")).toBe("minimax");
    expect(getVendorForModelId("qwen3-x-max")).toBe("qwen");
    expect(getVendorForModelId("mystery-model")).toBeNull();
  });

  it("getActiveModelVendor：当前选中模型 → vendor；custom → null", () => {
    expect(getActiveModelVendor({ provider: "opencode-go", model: "hy3", customModel: "" })).toBe("tencent");
    expect(getActiveModelVendor({ provider: "deepseek", model: "deepseek-v4-flash", customModel: "" })).toBe("deepseek");
    expect(getActiveModelVendor({ provider: "custom-openai", model: "my-model", customModel: "my-model" })).toBeNull();
  });

  it("厂商元数据：所有 Logo 为本地静态资源（无外部 hotlink）", () => {
    for (const meta of Object.values(AI_PROVIDER_META)) {
      expect(meta.logo.startsWith("/ai-providers/")).toBe(true);
    }
    expect(AI_PROVIDER_META.deepseek.name).toBe("DeepSeek");
    expect(AI_PROVIDER_META.tencent.name).toContain("Hunyuan");
  });

  it("getVendorMeta：未知 vendor 返回 fallback", () => {
    const fb = getVendorMeta(null);
    expect(fb.logo).toBe("");
    expect(getVendorMeta("xai").logo).toBe("/ai-providers/xai.png");
  });
});

describe("Custom Base URL 归一化", () => {
  it("保留合法 base URL", () => {
    expect(normalizeBaseURL("https://provider.example.com/v1")).toBe("https://provider.example.com/v1");
    expect(normalizeBaseURL("https://provider.example.com/v1/")).toBe("https://provider.example.com/v1");
  });

  it("用户误贴 /chat/completions 时归一化，避免双重拼接", () => {
    expect(normalizeBaseURL("https://provider.example.com/v1/chat/completions")).toBe("https://provider.example.com/v1");
    expect(normalizeBaseURL("https://provider.example.com/chat/completions")).toBe("https://provider.example.com");
  });
});

describe("SSRF 防护（validateCustomBaseURL）", () => {
  const rejectCases = [
    "http://api.example.com/v1",
    "https://localhost/v1",
    "https://localhost.localdomain/v1",
    "https://127.0.0.1/v1",
    "https://127.0.0.2:8443/v1",
    "https://0.0.0.0/v1",
    "https://10.0.0.1/v1",
    "https://10.255.255.255/v1",
    "https://172.16.0.1/v1",
    "https://172.31.255.1/v1",
    "https://192.168.1.1/v1",
    "https://169.254.169.254/v1",
    "https://[::1]/v1",
    "https://[fe80::1]/v1",
    "https://[fc00::1]/v1",
    "https://user:pass@api.example.com/v1",
    "not-a-url",
    "",
  ];
  const allowCases = [
    "https://api.example.com/v1",
    "https://api.deepseek.com",
    "https://opencode.ai/zen/go/v1",
    "https://172.32.0.1/v1", // 公网段
    "https://sub.example.com:8443/v1",
  ];

  it("拒绝私网 / 本机 / 非 https 地址", () => {
    for (const url of rejectCases) {
      if (url.includes("172.32")) continue; // 上面显式放行用例
      expect(validateCustomBaseURL(url), url).not.toBeNull();
    }
  });

  it("放行合法 https 域名与公网地址", () => {
    for (const url of allowCases) {
      expect(validateCustomBaseURL(url), url).toBeNull();
    }
  });
});

describe("AI Error 归一化", () => {
  it("AI SDK statusCode → code", () => {
    expect(normalizeAIError({ statusCode: 401 }).code).toBe("INVALID_API_KEY");
    expect(normalizeAIError({ statusCode: 403 }).code).toBe("INVALID_API_KEY");
    expect(normalizeAIError({ statusCode: 404 }).code).toBe("MODEL_NOT_FOUND");
    expect(normalizeAIError({ statusCode: 429 }).code).toBe("RATE_LIMITED");
    expect(normalizeAIError({ statusCode: 503 }).code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("400/415/422 → INVALID_PROVIDER_REQUEST（不再吞成 UNKNOWN）", () => {
    expect(normalizeAIError({ statusCode: 400 }).code).toBe("INVALID_PROVIDER_REQUEST");
    expect(normalizeAIError({ statusCode: 415 }).code).toBe("INVALID_PROVIDER_REQUEST");
    expect(normalizeAIError({ statusCode: 422 }).code).toBe("INVALID_PROVIDER_REQUEST");
    // 用户 UI 展示安全自然语言，不含 Provider 细节
    expect(normalizeAIError({ statusCode: 400 }).message).toBe("当前模型请求格式不兼容，请更换模型或稍后重试。");
  });

  it("Provider 错误体（APICallError.responseBody）：按 error.code 稳定区分", () => {
    // 400 + invalid_request_error（DeepSeek schema 拒绝的真实响应形状）
    const schemaRejected = normalizeAIError({
      statusCode: 400,
      responseBody: JSON.stringify({
        error: {
          message: "Invalid schema for function 'create_reminder': schema must be a JSON Schema of 'type: object'",
          type: "invalid_request_error",
          code: "invalid_request_error",
        },
      }),
    });
    expect(schemaRejected.code).toBe("INVALID_PROVIDER_REQUEST");
    // 400 + context_length_exceeded → CONTEXT_TOO_LARGE（不应被 400 分支吞掉）
    expect(
      normalizeAIError({
        statusCode: 400,
        responseBody: JSON.stringify({ error: { code: "context_length_exceeded", message: "This model's maximum context length is 131072 tokens" } }),
      }).code
    ).toBe("CONTEXT_TOO_LARGE");
    // 401 + invalid_api_key body
    expect(
      normalizeAIError({ statusCode: 401, responseBody: JSON.stringify({ error: { code: "invalid_api_key", message: "bad key" } }) }).code
    ).toBe("INVALID_API_KEY");
    // 429 + rate_limit_exceeded
    expect(
      normalizeAIError({ statusCode: 429, responseBody: JSON.stringify({ error: { code: "rate_limit_exceeded", message: "slow down" } }) }).code
    ).toBe("RATE_LIMITED");
    // 非 JSON body → 回落 statusCode 分支
    expect(normalizeAIError({ statusCode: 400, responseBody: "not-json" }).code).toBe("INVALID_PROVIDER_REQUEST");
  });

  it("Tool schema / Tool Call / Reasoning+Tool 组合文本特征 → INVALID_PROVIDER_REQUEST", () => {
    expect(normalizeAIError({ message: "Tool calls are not supported: tool_call with thinking enabled" }).code).toBe("INVALID_PROVIDER_REQUEST");
    expect(normalizeAIError({ message: "invalid tool schema for function foo" }).code).toBe("INVALID_PROVIDER_REQUEST");
    expect(normalizeAIError({ message: "reasoning not supported with tools" }).code).toBe("INVALID_PROVIDER_REQUEST");
  });

  it("AI_RetryError（errors 数组）：取最后一次失败并优先 responseBody", () => {
    const err = normalizeAIError({
      name: "AI_RetryError",
      errors: [
        { statusCode: 503 },
        { statusCode: 400, responseBody: JSON.stringify({ error: { code: "invalid_request_error", message: "bad schema" } }) },
      ],
    });
    expect(err.code).toBe("INVALID_PROVIDER_REQUEST");
  });

  it("AbortError / timeout 文案 → TIMEOUT", () => {
    expect(normalizeAIError(new DOMException("timeout", "TimeoutError")).code).toBe("TIMEOUT");
    expect(normalizeAIError({ name: "AbortError", message: "The operation was aborted" }).code).toBe("TIMEOUT");
    expect(normalizeAIError({ message: "fetch timed out" }).code).toBe("TIMEOUT");
  });

  it("服务端下发的 { code, message } JSON → 直接消费", () => {
    const err = normalizeAIError(new Error(JSON.stringify({ code: "RATE_LIMITED", message: "请求过于频繁" })));
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.message).toBe("请求过于频繁");
  });

  it("自有 AIError 原样返回", () => {
    const e = new AIError("INVALID_CUSTOM_URL", "地址无效");
    expect(normalizeAIError(e)).toBe(e);
  });

  it("未知错误 → UNKNOWN，不抛错", () => {
    expect(normalizeAIError(null).code).toBe("UNKNOWN");
    expect(normalizeAIError({}).code).toBe("UNKNOWN");
    expect(normalizeAIError("boom").code).toBe("UNKNOWN");
  });
});

describe("Provider 安全日志（providerLog）", () => {
  const realError = console.error;

  it("记录 status / provider code / message / requestId；绝不记录 API Key 与请求体", () => {
    const calls: unknown[][] = [];
    console.error = (...args: unknown[]) => calls.push(args);
    try {
      logProviderError("test/ctx", {
        statusCode: 400,
        url: "https://api.deepseek.com/chat/completions?foo=bar",
        responseHeaders: { "x-request-id": "req-123" },
        responseBody: JSON.stringify({
          error: { code: "invalid_request_error", message: "Invalid schema, key sk-super-secret-abc123xyz in body" },
        }),
      });
    } finally {
      console.error = realError;
    }
    expect(calls.length).toBe(1);
    const text = calls[0].map(String).join("\n");
    expect(text).toContain("test/ctx");
    expect(text).toContain("status=400");
    expect(text).toContain("code=invalid_request_error");
    expect(text).toContain("requestId=req-123");
    expect(text).toContain("/chat/completions");
    expect(text).not.toContain("foo=bar"); // 不记录 query string
    expect(text).not.toContain("sk-super-secret-abc123xyz"); // message 中回显的 key 被打码
  });

  it("沿 cause 链找到最内层 Provider 错误（AI SDK 重试包裹）", () => {
    const calls: unknown[][] = [];
    console.error = (...args: unknown[]) => calls.push(args);
    try {
      logProviderError("chat/stream", {
        name: "AI_RetryError",
        message: "retried",
        cause: { statusCode: 400, responseBody: JSON.stringify({ error: { code: "invalid_request_error" } }) },
      });
    } finally {
      console.error = realError;
    }
    expect(calls.length).toBe(1);
    expect(calls[0].map(String).join("\n")).toContain("status=400");
  });
});

describe("API Key sessionStorage", () => {
  beforeEach(() => {
    if (typeof sessionStorage !== "undefined") sessionStorage.clear();
  });
  afterEach(() => {
    if (typeof sessionStorage !== "undefined") sessionStorage.clear();
  });

  it("按 provider 分别保存 / 读取 / 清空", () => {
    setSessionApiKey("deepseek", "sk-ds-1");
    setSessionApiKey("opencode-go", "sk-go-1");
    expect(getSessionApiKey("deepseek")).toBe("sk-ds-1");
    expect(getSessionApiKey("opencode-go")).toBe("sk-go-1");
    setSessionApiKey("deepseek", "");
    expect(getSessionApiKey("deepseek")).toBe("");
    expect(getSessionApiKey("opencode-go")).toBe("sk-go-1");
  });

  it("不写入 localStorage（不参与任何持久化备份）", () => {
    setSessionApiKey("deepseek", "sk-secret");
    expect(localStorage.getItem("classflow-ai-key:deepseek")).toBeNull();
  });
});

describe("System Prompt", () => {
  it("Task 3 prompt：可读可写；只有 ok:true 才能声称成功；Markdown 格式指导", () => {
    expect(KIRO_SYSTEM_PROMPT).toContain("Kiro");
    expect(KIRO_SYSTEM_PROMPT).toContain("通过工具读取并修改用户的 ClassFlow 学业数据");
    expect(KIRO_SYSTEM_PROMPT).toContain("不得猜测 ID");
    expect(KIRO_SYSTEM_PROMPT).toContain("只有在写工具返回 ok:true 后，才能告诉用户操作已成功");
    expect(KIRO_SYSTEM_PROMPT).toContain("写工具返回失败、冲突或用户取消时，不得声称修改成功");
    expect(KIRO_SYSTEM_PROMPT).toContain("冲突检测结果");
    expect(KIRO_SYSTEM_PROMPT).toContain("不要输出 ASCII 表格");
    expect(KIRO_SYSTEM_PROMPT).toContain("不要透露内部工具名称");
    expect(KIRO_SYSTEM_PROMPT).not.toContain("尚未获得 ClassFlow 学业数据");
  });
});
