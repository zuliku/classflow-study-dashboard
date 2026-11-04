import { getKiroWebSearchProvider } from "@/lib/ai/web/provider";
import { resolveKiroWebSearchAccessWithStoredRef } from "@/lib/ai/web/storedCredentials";
import { WEB_SEARCH_TIMEOUT_MS } from "@/lib/ai/web/types";

export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * Kiro Search 测试连接（Task 14D / 15A）：
 * - Server mode 有 Key → Tavily `/usage`；无 Key → keyless 最小搜索（不消耗 Tavily 配额）
 * - BYOK → SecretVault ref 优先，旧 apiKey 兜底；失败绝不 fallback Server
 * - 不发送 Chat History / ClassFlow 数据 / 用户资料
 * - 返回 { ok:true, mode } 或 { ok:false, code, message }；绝不返回 usage detail / API Key / provider raw errors
 */
export async function handleWebSearchTest(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, code: "WEB_SEARCH_FAILED", message: "请求格式无效。" }, { status: 400 });
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const mode = b.credentialMode === "byok" ? "byok" : "server";

  const access = await resolveKiroWebSearchAccessWithStoredRef({
    mode,
    userApiKey: typeof b.apiKey === "string" ? b.apiKey : undefined,
    credentialRef: typeof b.credentialRef === "string" ? b.credentialRef : undefined,
  });
  if (!access.ok) {
    return Response.json({ ok: false, code: access.code, message: access.message }, { status: 200 });
  }

  const provider = getKiroWebSearchProvider(access.kind === "keyless" ? "auto" : "tavily");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);
  try {
    const outcome = await provider.checkCredential({
      apiKey: access.kind === "keyed" ? access.apiKey : "",
      signal: controller.signal,
    });
    if (!outcome.ok) {
      return Response.json({ ok: false, code: outcome.code, message: outcome.message }, { status: 200 });
    }
    return Response.json({ ok: true, mode: access.kind === "keyless" ? "basic" : "enhanced" });
  } finally {
    clearTimeout(timer);
  }
}
