/**
 * Kiro Artifact Browser Download Trigger（V2 Part 3）。
 * 只做 Blob URL + <a download>；绝不 window.open / 原生打开 / Explorer reveal。
 * Blob URL 必须 revoke（下一任务/定时器）。
 */
import { KiroArtifactDownloadPayload } from "@/lib/ai/computer/artifacts/access";
import { ComputerError } from "@/lib/ai/computer/errors";

export function triggerArtifactDownload(payload: KiroArtifactDownloadPayload): void {
  if (typeof window === "undefined" || typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new ComputerError("UNSUPPORTED_BROWSER", "当前环境不支持文件下载");
  }
  const blob = new Blob([payload.bytes.slice().buffer as ArrayBuffer], { type: payload.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = payload.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 下一任务周期 revoke（保证下载已启动）
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
