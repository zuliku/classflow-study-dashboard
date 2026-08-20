export interface LocalApiCapabilityRequestContext {
  requestUrl: string;
  webContentsId?: number;
  trustedWebContentsId: number;
  initiator?: string;
  originHeader?: string;
  apiOrigin: string;
  trustedRendererOrigins: readonly string[];
  currentRendererUrl?: string;
}

function canonicalAppOrigin(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.protocol === "app:" && u.hostname === "bundle") {
      return "app://bundle";
    }
    return u.origin;
  } catch {
    // For custom app:// URLs, URL may fail in some Node versions; fallback to manual parse
    if (value.startsWith("app://bundle")) {
      // Must be exactly app://bundle or app://bundle/... but we need exact
      // For canonical check, we require protocol app: and host bundle
      const withoutProto = value.slice("app://".length);
      const host = withoutProto.split("/")[0].split(":")[0];
      if (host === "bundle") return "app://bundle";
    }
    return null;
  }
}

function isTrustedRendererOrigin(candidate: string, trustedOrigins: readonly string[]): boolean {
  if (!candidate || candidate === "null") return false;
  let candidateOrigin: string | null = null;
  // Try to canonicalize candidate as URL origin
  const appCanonical = canonicalAppOrigin(candidate);
  if (appCanonical) {
    candidateOrigin = appCanonical;
  } else {
    try {
      candidateOrigin = new URL(candidate).origin;
    } catch {
      return false;
    }
  }
  for (const trusted of trustedOrigins) {
    let trustedOrigin: string | null = null;
    const trustedApp = canonicalAppOrigin(trusted);
    if (trustedApp) trustedOrigin = trustedApp;
    else {
      try {
        trustedOrigin = new URL(trusted).origin;
      } catch {
        continue;
      }
    }
    if (candidateOrigin === trustedOrigin) return true;
  }
  return false;
}

export function shouldInjectLocalApiCapability(context: LocalApiCapabilityRequestContext): boolean {
  // 1. requestUrl must be exactly apiOrigin (origin)
  let urlOrigin: string;
  try {
    urlOrigin = new URL(context.requestUrl).origin;
  } catch {
    return false;
  }
  if (urlOrigin !== context.apiOrigin) return false;

  // 2. webContentsId must be exactly trusted
  if (context.webContentsId === undefined || context.webContentsId !== context.trustedWebContentsId) return false;

  // 3. renderer origin must be trusted
  const candidate = context.initiator || context.originHeader || "";
  if (!candidate || candidate === "null" || candidate === "") {
    // Opaque origin (Origin: null) may occur for app://bundle fetch to 127.0.0.1.
    // Only allow if currentRendererUrl is exactly app://bundle/* and trusted list contains app://bundle.
    const currentUrl = context.currentRendererUrl ?? "";
    if (!currentUrl) return false;
    let currentOrigin: string | null = null;
    const currentApp = canonicalAppOrigin(currentUrl);
    if (currentApp) currentOrigin = currentApp;
    else {
      try {
        currentOrigin = new URL(currentUrl).origin;
      } catch {
        return false;
      }
    }
    if (currentOrigin !== "app://bundle") return false;
    // Also ensure trustedRendererOrigins contains app://bundle
    if (!context.trustedRendererOrigins.includes("app://bundle") && !context.trustedRendererOrigins.includes("app://bundle/")) {
      return false;
    }
    return true;
  }
  return isTrustedRendererOrigin(candidate, context.trustedRendererOrigins);
}

export function installLocalApiCapabilityInjector(
  session: Electron.Session,
  apiBase: string,
  apiCapability: string,
  getTrustedWebContentsId: () => number | undefined,
  getCurrentRendererUrl: () => string | undefined,
  getTrustedRendererOrigins: () => readonly string[]
): () => void {
  const apiOrigin = new URL(apiBase).origin;
  const handler: Parameters<Electron.Session["webRequest"]["onBeforeSendHeaders"]>[0] = (details, callback) => {
    const trustedWebContentsId = getTrustedWebContentsId();
    if (trustedWebContentsId === undefined) {
      callback({});
      return;
    }
    const allowed = shouldInjectLocalApiCapability({
      requestUrl: details.url,
      webContentsId: details.webContentsId,
      trustedWebContentsId,
      initiator: (details as unknown as { initiator?: string }).initiator,
      originHeader: (details.requestHeaders?.["Origin"] as string) ?? (details.requestHeaders?.["origin"] as string) ?? "",
      apiOrigin,
      trustedRendererOrigins: getTrustedRendererOrigins(),
      currentRendererUrl: getCurrentRendererUrl(),
    });
    if (!allowed) {
      callback({});
      return;
    }
    callback({ requestHeaders: { ...details.requestHeaders, "x-classflow-capability": apiCapability } });
  };
  session.webRequest.onBeforeSendHeaders(handler);
  return () => {
    try {
      // Electron does not provide off* for webRequest, but setting handler to null removes it
      session.webRequest.onBeforeSendHeaders(null as unknown as typeof handler);
    } catch {}
  };
}
