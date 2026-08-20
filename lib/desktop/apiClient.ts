/**
 * Desktop local API helper — Task 15B path contract fail-closed
 * Ensures preload api.request is used with correct path prefix and capability handling
 */

export async function requestDesktopApi(path: string, init?: RequestInit): Promise<Response> {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error("DESKTOP_API_UNAVAILABLE: path must start with /");
  }
  if (path.includes("://") || path.startsWith("http://") || path.startsWith("https://") || path.startsWith("//")) {
    throw new Error("DESKTOP_API_UNAVAILABLE: path must not be URL");
  }
  if (typeof window === "undefined" || !(window as unknown as { classflowDesktop?: { api?: { request: (p: string, init?: RequestInit) => Promise<Response> } } }).classflowDesktop?.api?.request) {
    throw new Error("DESKTOP_API_UNAVAILABLE");
  }
  return (window as unknown as { classflowDesktop: { api: { request: (p: string, init?: RequestInit) => Promise<Response> } } }).classflowDesktop.api.request(path, init);
}
