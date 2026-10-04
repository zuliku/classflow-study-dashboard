import {
  getDefaultModel,
  getModelsForProvider,
  getVendorForModelId,
  getSelectorModelsForProvider,
  sortModelsByVendorAndCapability,
} from "@/lib/ai/providers/registry";
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
 * OpenCode Go：远端 /models 为 availability source（transport 以本地 OPENCODE_MODELS 为准）；
 * - 默认：只展示精选列表（少而精，新 / 强优先）并按精选顺序排序；
 * - all=1（Kiro 设置「显示更多模型」）：展示全部已验证模型（厂商/能力排序）；
 * 远端失败回落对应范围的 registry。DeepSeek：registry 固定列表。
 */
export async function handleModels(req: Request) {
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider") as AIProviderId | null;
  if (provider !== "opencode-go" && provider !== "deepseek") {
    return Response.json({ models: [], defaultModel: "" });
  }
  const all = url.searchParams.get("all") === "1";

  const registryScope = (p: AIProviderId): AIModelDefinition[] =>
    all ? getModelsForProvider(p) : getSelectorModelsForProvider(p);

  let models: AIModelDefinition[] = registryScope(provider);
  let source: "remote" | "registry" = "registry";

  if (provider === "opencode-go") {
    // P1：远端挂起不再无限转圈——8s 超时 + 失败回落 registry（此前无 timeout/try-catch）
    let remote: Awaited<ReturnType<typeof fetchOpenCodeGoModels>> = null;
    try {
      remote = await Promise.race([
        fetchOpenCodeGoModels(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
    } catch {
      remote = null;
    }
    if (remote && remote.length > 0) {
      // 远端为 availability source：transport / capabilities / 名称以本地注册表为准
      const byId = new Map(OPENCODE_MODELS.map((m) => [m.id, m]));
      const order = new Map(OPENCODE_SELECTOR_MODEL_IDS.map((id, index) => [id, index]));
      const defs = remote.map((r) => {
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
      models = all
        ? sortModelsByVendorAndCapability(defs)
        : defs
            .filter((m) => isOpenCodeSelectorModelId(m.id))
            .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
      // 远端可选集合为空（或与精选列表无交集）→ 回落 registry（不展示空列表）
      if (models.length === 0) models = registryScope(provider);
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
