/**
 * Kiro Search — BYOK Tavily Key 的 SecretVault 客户端桥。
 *
 * Renderer 只拿到 credentialRef；明文经 contextBridge 一次性写入 Main，
 * 不进入 localStorage / Zustand / 日志 / 备份。
 */
export interface WebSearchCredentialMetadata {
  credentialRef: string;
  provider: string;
  label?: string;
  createdAt?: number;
  updatedAt?: number;
}

interface CredentialsBridge {
  create(input: { provider: "tavily"; label: string; secret: string }): Promise<{ credentialRef: string }>;
  replace(input: { credentialRef: string; secret: string }): Promise<unknown>;
  delete(input: { credentialRef: string }): Promise<unknown>;
  list(): Promise<{ metadata?: WebSearchCredentialMetadata[] }>;
}

function getBridge(): CredentialsBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { classflowDesktop?: { credentials?: unknown } })
    .classflowDesktop?.credentials as CredentialsBridge | undefined;
  return bridge ?? null;
}

export function isWebSearchSecretStorageAvailable(): boolean {
  return getBridge() !== null;
}

function errorInfo(err: unknown): { code: string | null; message: string } {
  if (err instanceof Error) {
    try {
      const parsed = JSON.parse(err.message) as { code?: string; message?: string };
      if (parsed.code || parsed.message) {
        return { code: parsed.code ?? null, message: parsed.message || parsed.code || "凭据保存失败" };
      }
    } catch {
      /* non-JSON error */
    }
    return { code: null, message: err.message || "凭据保存失败" };
  }
  return { code: null, message: "凭据保存失败" };
}

/** null = 安全存储不可用/读取失败（不能据此清空已有 ref）；[] = 成功读取但无 Tavily 记录。 */
export async function listTavilyCredentialMetadata(): Promise<WebSearchCredentialMetadata[] | null> {
  const bridge = getBridge();
  if (!bridge) return null;
  try {
    const result = await bridge.list();
    return (result?.metadata ?? []).filter((m) => m.provider === "tavily");
  } catch {
    return null;
  }
}

/**
 * 保存/替换 Tavily Key。返回 credentialRef。
 * 旧 ref 失效（CREDENTIAL_NOT_FOUND）时自动 create 一条新记录。
 */
export async function saveTavilyCredential(secret: string, existingRef?: string): Promise<string> {
  const bridge = getBridge();
  if (!bridge) throw new Error("桌面安全存储不可用");
  const trimmed = secret.trim();
  if (!trimmed) throw new Error("API Key 不能为空");

  const ref = (existingRef ?? "").trim();
  if (ref) {
    try {
      await bridge.replace({ credentialRef: ref, secret: trimmed });
      return ref;
    } catch (err) {
      // 只有旧 ref 不存在时才 create 新记录；安全存储不可用等错误必须 fail closed。
      if (errorInfo(err).code !== "CREDENTIAL_NOT_FOUND") {
        throw new Error(errorInfo(err).message);
      }
    }
  }
  try {
    const created = await bridge.create({ provider: "tavily", label: "Kiro Search", secret: trimmed });
    const createdRef = created?.credentialRef;
    if (typeof createdRef !== "string" || !createdRef) throw new Error("凭据保存失败");
    return createdRef;
  } catch (err) {
    throw new Error(errorInfo(err).message);
  }
}

export async function deleteTavilyCredential(credentialRef: string): Promise<void> {
  const bridge = getBridge();
  const ref = credentialRef.trim();
  if (!bridge || !ref) return;
  await bridge.delete({ credentialRef: ref });
}
