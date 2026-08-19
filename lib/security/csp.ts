/**
 * CSP — Task 02
 * Production 必须存在严格 CSP；开发环境因 Vite HMR 可更宽，但必须与 production 分开。
 */

export interface CspPolicy {
  "default-src": string[];
  "object-src": string[];
  "base-uri": string[];
  "frame-ancestors": string[];
  "script-src"?: string[];
  "style-src"?: string[];
  "connect-src"?: string[];
  "img-src"?: string[];
  "font-src"?: string[];
  "worker-src"?: string[];
}

export const PRODUCTION_CSP: CspPolicy = {
  "default-src": ["'self'", "app://*"],
  "object-src": ["'none'"],
  "base-uri": ["'none'"],
  "frame-ancestors": ["'none'"],
  // ClassFlow 实际能力最小开放
  "script-src": ["'self'", "app://*"],
  "style-src": ["'self'", "'unsafe-inline'", "app://*"], // KaTeX / Tailwind inline
  "connect-src": ["'self'", "app://*", "https://*"], // 本地 API + AI 后端（https）
  "img-src": ["'self'", "app://*", "data:", "blob:"], // 附件预览依赖 Blob/Data URL
  "font-src": ["'self'", "data:", "app://*"],
  "worker-src": ["'self'", "blob:"],
};

export const DEVELOPMENT_CSP: CspPolicy = {
  "default-src": ["'self'", "http://localhost:*", "ws://localhost:*"],
  "object-src": ["'none'"],
  "base-uri": ["'none'"],
  "frame-ancestors": ["'none'"],
  // Vite HMR 需要 unsafe-eval / inline
  "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'", "http://localhost:*", "ws://localhost:*"],
  "style-src": ["'self'", "'unsafe-inline'", "http://localhost:*"],
  "connect-src": ["'self'", "http://localhost:*", "ws://localhost:*", "https://*"],
  "img-src": ["'self'", "data:", "blob:", "http://localhost:*"],
  "font-src": ["'self'", "data:"],
  "worker-src": ["'self'", "blob:"],
};

function serializePolicy(policy: CspPolicy): string {
  const parts: string[] = [];
  for (const [key, values] of Object.entries(policy) as [keyof CspPolicy, string[] | undefined][]) {
    if (!values) continue;
    parts.push(`${key} ${values.join(" ")}`);
  }
  return parts.join("; ");
}

export function getCspHeader(isDev: boolean): string {
  return serializePolicy(isDev ? DEVELOPMENT_CSP : PRODUCTION_CSP);
}

/** 校验 production CSP 是否满足基线（测试用） */
export function validateProductionCsp(policy: CspPolicy = PRODUCTION_CSP): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!policy["default-src"]?.includes("'self'")) errors.push("default-src must include 'self'");
  if (!policy["object-src"]?.includes("'none'")) errors.push("object-src must be 'none'");
  if (!policy["base-uri"]?.includes("'none'")) errors.push("base-uri must be 'none'");
  if (!policy["frame-ancestors"]?.includes("'none'")) errors.push("frame-ancestors must be 'none'");
  // 禁止 script-src * / connect-src * / img-src *
  const hasWildcard = (arr?: string[]) => arr?.includes("*") || arr?.includes("script-src *") || false;
  if (hasWildcard(policy["script-src"])) errors.push("script-src must not be *");
  if (hasWildcard(policy["connect-src"])) errors.push("connect-src must not be *");
  if (hasWildcard(policy["img-src"])) errors.push("img-src must not be *");
  if (policy["script-src"]?.includes("*")) errors.push("script-src must not be *");
  if (policy["connect-src"]?.includes("*")) errors.push("connect-src must not be *");
  if (policy["img-src"]?.includes("*")) errors.push("img-src must not be *");
  return { ok: errors.length === 0, errors };
}
