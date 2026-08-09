import { NextRequest } from "next/server";
import { getModelsForProvider, getDefaultModel, getVendorForModelId } from "@/lib/ai/providers/registry";
import { fetchOpenCodeGoModels, OPENCODE_MODELS } from "@/lib/ai/providers/openCodeGo";
import { AIProviderId, AIModelDefinition } from "@/lib/ai/providers/types";

export const runtime = "nodejs";

/**
 * 模型列表：Settings / Composer 共用（模型发现 / metadata，不创建 Provider instance）。
 * OpenCode Go：优先远端 /models（transport 以本地 OPENCODE_MODELS 为准；openai-responses 与未知模型过滤），
 * 失败回落 registry。DeepSeek：registry 固定列表。
 */
export async function GET(req: NextRequest) {
  const provider = new URL(req.url).searchParams.get("provider") as AIProviderId | null;
  if (provider !== "opencode-go" && provider !== "deepseek") {
    return Response.json({ models: [], defaultModel: "" });
  }

  let models: AIModelDefinition[] = getModelsForProvider(provider);
  let source: "remote" | "registry" = "registry";

  if (provider === "opencode-go") {
    const remote = await fetchOpenCodeGoModels();
    if (remote && remote.length > 0) {
      // 远端为最新来源：transport 原样保留（本地注册表已校验合法）；name 优先取已登记名称
      const byId = new Map(OPENCODE_MODELS.map((m) => [m.id, m]));
      models = remote.map((r) => {
        const known = byId.get(r.id);
        return {
          id: r.id,
          name: known?.name ?? r.id,
          provider: "opencode-go" as const,
          vendor: getVendorForModelId(r.id),
          transport: r.transport as AIModelDefinition["transport"],
          capabilities: known?.capabilities ?? { streaming: true, tools: true, vision: false, fileParts: false },
        };
      });
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
