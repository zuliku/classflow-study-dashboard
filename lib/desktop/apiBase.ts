/**
 * 桌面版 API 地址解析：
 * - Electron：preload 注入 window.classflowDesktop.apiBase（本地 HTTP server 随机端口）
 * - 纯浏览器（dev 兼容）：回退为相对路径（与 Next 时代行为一致）
 */
export function apiUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const apiBase = (window as unknown as { classflowDesktop?: { apiBase?: string } }).classflowDesktop?.apiBase;
  return apiBase ? `${apiBase}${path}` : path;
}
