import { isServerWebSearchConfigured } from "@/lib/ai/web/credentials";

export const runtime = "nodejs";

/**
 * Kiro Search Server 配置状态（Hotfix）：
 * 只暴露 { serverConfigured: boolean }——绝不暴露 env 变量名 / API Key / prefix / 长度 / usage。
 * 不做真实 Tavily 请求（"测试连接"由 /api/ai/web-search/test 负责）。
 */
export async function handleWebSearchStatus() {
  return Response.json({ ok: true, serverConfigured: isServerWebSearchConfigured() });
}
