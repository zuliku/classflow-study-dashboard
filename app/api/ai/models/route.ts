import { getDefaultModel, getVendorForModelId, getSelectorModelsForProvider } from "@/lib/ai/providers/registry";
import {
  fetchOpenCodeGoModels,
  OPENCODE_MODELS,
  OPENCODE_SELECTOR_MODEL_IDS,
  isOpenCodeSelectorModelId,
} from "@/lib/ai/providers/openCodeGo";
import { AIProviderId, AIModelDefinition } from "@/lib/ai/providers/types";

export const runtime = "nodejs";

/**
 * 模型列表：Settings / Composer 共用（模型发现 / metadata，不创建 Provider instance）。
 * OpenCode Go：优先远端 /models（transport 以本地 OPENCODE_MODELS 为准；openai-responses 与未知模型过滤），
 * 失败回落 registry。DeepSeek：registry 固定列表。
 */
export async function handleModels(req: Request) {
  const provider = new URL(req.url).searchParams.get("provider") as AIProviderId | null;
  if (provider !== "opencode-go" && provider !== "deepseek") {
    return Response.json({ models: [], defaultModel: "" });
  }

  let models: AIModelDefinition[] = getSelectorModelsForProvider(provider);
  let source: "remote" | "registry" = "registry";

  if (provider === "opencode-go") {
    const remote = await fetchOpenCodeGoModels();
    if (remote && remote.length > 0) {
      // 远端为 availability source；只展示精选列表，并按精选顺序（新 / 强优先）
      const byId = new Map(OPENCODE_MODELS.map((m) => [m.id, m]));
      const order = new Map(OPENCODE_SELECTOR_MODEL_IDS.map((id, index) => [id, index]));
      models = remote
        .filter((r) => isOpenCodeSelectorModelId(r.id))
        .map((r) => {
          const known = byId.get(r.id);
          return {
            id: r.id,
            name: known?.name ?? r.id,
            provider: "opencode-go" as const,
            vendor: getVendorForModelId(r.id),
            transport: r.transport as AIModelDefinition["transport"],
            capabilities: known?.capabilities ?? { streaming: true, tools: true, vision: false, fileParts: false },
          };
        })
        .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
      // 远端可选集合与精选列表无交集 → 回落精选注册表（不展示空列表）
      if (models.length === 0) models = getSelectorModelsForProvider(provider);
      source = "remote";
    }
  }

  return Response.json({
    models: models.map((m) => ({
      id: m.id,
      name: m.name,
      transport: m.transport,
      vendor: m.vendor,
    })),
    defaultModel: getDefaultModel(provider),
    source,
  });
}
