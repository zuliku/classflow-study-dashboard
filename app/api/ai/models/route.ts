import { NextRequest } from "next/server";
import { getModelsForProvider, getDefaultModel } from "@/lib/ai/providers/registry";
import { fetchOpenCodeGoModels, OPENCODE_CHAT_MODELS } from "@/lib/ai/providers/openCodeGo";
import { AIProviderId, AIModelDefinition } from "@/lib/ai/providers/types";

export const runtime = "nodejs";

/**
 * 模型列表：Settings / Composer 共用。
 * OpenCode Go：优先远端 /models（按 openai-chat transport 筛选），失败回落 registry。
 * DeepSeek：registry 固定列表。
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
      // 远端为最新来源：name 优先取 registry 已登记名称，新模型用 id 兜底
      const byId = new Map(OPENCODE_CHAT_MODELS.map((m) => [m.id, m]));
      models = remote.map((r) => ({
        id: r.id,
        name: byId.get(r.id)?.name ?? r.id,
        provider: "opencode-go" as const,
        transport: "openai-chat" as const,
        capabilities: { streaming: true, tools: true, vision: false, fileParts: false },
      }));
      source = "remote";
    }
  }

  return Response.json({
    models: models.map((m) => ({ id: m.id, name: m.name, transport: m.transport })),
    defaultModel: getDefaultModel(provider),
    source,
  });
}
