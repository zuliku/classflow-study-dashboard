export interface TrustedRendererContext {
  productionOrigin?: string;
  developmentOrigin?: string;
}

/**
 * Canonical renderer origin for ClassFlow.
 * Production: app://bundle (exact, no user/pass/port, hostname bundle)
 * Development: exact origin of ELECTRON_RENDERER_URL (e.g., http://localhost:5173)
 */

function isStrictAppBundleUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "app:" &&
      u.hostname === "bundle" &&
      u.username === "" &&
      u.password === "" &&
      u.port === ""
    );
  } catch {
    return false;
  }
}

export function canonicalRendererOrigin(rawUrl: string): string | null {
  if (!rawUrl) return null;
  // Handle app://bundle/* specially
  if (rawUrl.startsWith("app://")) {
    // Must be strict app://bundle with no user/pass/port
    try {
      const u = new URL(rawUrl);
      if (u.protocol === "app:" && u.hostname === "bundle" && u.username === "" && u.password === "" && u.port === "") {
        return "app://bundle";
      }
      return null;
    } catch {
      return null;
    }
  }
  try {
    const u = new URL(rawUrl);
    // Only http/https allowed for dev
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function isTrustedRendererUrl(
  rawUrl: string,
  opts?: { allowedDevOrigin?: string }
): boolean {
  const canonical = canonicalRendererOrigin(rawUrl);
  if (!canonical) return false;
  if (canonical === "app://bundle") return true;
  if (opts?.allowedDevOrigin) {
    let devOrigin: string | null = null;
    try {
      devOrigin = new URL(opts.allowedDevOrigin).origin;
    } catch {
      return false;
    }
    return canonical === devOrigin;
  }
  return false;
}

export function parseTrustedRendererUrl(rawUrl: string): { kind: "production" } | { kind: "development"; origin: string } | null {
  const canonical = canonicalRendererOrigin(rawUrl);
  if (!canonical) return null;
  if (canonical === "app://bundle") return { kind: "production" };
  return { kind: "development", origin: canonical };
}
