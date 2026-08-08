import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getModelsForProvider, getDefaultModel, getActiveModelName, getVendorForModelId, getActiveModelVendor } from "@/lib/ai/providers/registry";
import { AI_PROVIDER_META, getVendorMeta } from "@/lib/ai/providers/vendors";
import { normalizeBaseURL, KIRO_SYSTEM_PROMPT } from "@/lib/ai/config";
import { validateCustomBaseURL } from "@/lib/ai/providers/customOpenAI";
import { normalizeAIError, AIError } from "@/lib/ai/errors";
import { getSessionApiKey, setSessionApiKey } from "@/lib/ai/sessionKeys";
import { DEEPSEEK_MODELS } from "@/lib/ai/providers/deepSeek";
import { OPENCODE_CHAT_MODELS, filterRemoteChatModels } from "@/lib/ai/providers/openCodeGo";

describe("Provider Registry", () => {
  it("DeepSeek：V4 Flash（默认）/ V4 Pro，openai-chat transport", () => {
    const models = getModelsForProvider("deepseek");
    expect(models.map((m) => m.id)).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    expect(getDefaultModel("deepseek")).toBe("deepseek-v4-flash");
    expect(models.every((m) => m.transport === "openai-chat")).toBe(true);
    expect(DEEPSEEK_MODELS[0].name).toBe("V4 Flash");
  });

  it("OpenCode Go：Task 1 支持列表，不含非 openai-chat 模型", () => {
    const models = getModelsForProvider("opencode-go");
    const ids = models.map((m) => m.id);
    expect(ids).toContain("grok-4.5");
    expect(ids).toContain("glm-5.2");
    expect(ids).toContain("kimi-k3");
    expect(ids).toContain("deepseek-v4-flash");
    expect(ids).toContain("mimo-v2.5");
    expect(ids).toContain("hy3");
    expect(ids).not.toContain("gpt-5.6-luna");
    expect(ids).not.toContain("minimax-m3");
    expect(ids).not.toContain("qwen3.8-max");
    expect(models.every((m) => m.transport === "openai-chat")).toBe(true);
    expect(getDefaultModel("opencode-go")).toBe("deepseek-v4-flash");
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

  it("远端模型筛选：只保留 openai-chat 且剔除黑名单", () => {
    const out = filterRemoteChatModels([
      { id: "grok-4.5", transport: "openai-chat" },
      { id: "gpt-5.6-luna", transport: "openai-responses" },
      { id: "some-model" },
      { id: "grok-4.5", transport: "openai-chat" },
    ]);
    expect(out.map((m) => m.id)).toEqual(["grok-4.5", "some-model"]);
  });

  it("OPENCODE_CHAT_MODELS 与远端筛选共用同一黑名单来源（无硬编码漂移）", () => {
    const blacklisted = ["gpt-5.6-luna", "minimax-m3", "qwen3.8-max"];
    for (const id of blacklisted) {
      expect(OPENCODE_CHAT_MODELS.some((m) => m.id === id)).toBe(false);
    }
  });
});

describe("模型 → 厂商（Logo）映射", () => {
  it("每个已知模型都有明确 vendor，且 vendor 在 AI_PROVIDER_META 中有 Logo", () => {
    for (const def of [...DEEPSEEK_MODELS, ...OPENCODE_CHAT_MODELS]) {
      expect(def.vendor, def.id).not.toBeNull();
      expect(AI_PROVIDER_META[def.vendor!].logo, def.id).toBeTruthy();
    }
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
  });

  it("未知模型 → null（UI 走 neutral fallback），不猜厂商", () => {
    expect(getVendorForModelId("some-brand-new-model")).toBeNull();
    expect(getVendorForModelId("")).toBeNull();
    expect(getVendorForModelId("gpt-5.6-luna")).toBeNull(); // 非 openai-chat 支持范围，不猜
  });

  it("已知命名空间前缀兜底只覆盖明确厂商", () => {
    expect(getVendorForModelId("deepseek-v4-flash-free")).toBe("deepseek");
    expect(getVendorForModelId("kimi-k3-turbo")).toBe("kimi");
    expect(getVendorForModelId("mimo-v3")).toBe("mimo");
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
  it("Task 1 极简 prompt：明确无数据/工具能力，不冒充已操作", () => {
    expect(KIRO_SYSTEM_PROMPT).toContain("Kiro");
    expect(KIRO_SYSTEM_PROMPT).toContain("尚未获得 ClassFlow 学业数据与操作工具");
    expect(KIRO_SYSTEM_PROMPT).toContain("不要声称自己已经读取");
    expect(KIRO_SYSTEM_PROMPT).toContain("明确说明该操作能力尚未接入");
  });
});
