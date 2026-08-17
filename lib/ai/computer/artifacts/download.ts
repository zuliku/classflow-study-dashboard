/**
 * Kiro Artifact Browser Download Trigger（V2 Part 3 + V2.1 integrity fix）。
 * 只做 Blob URL + <a download>；绝不 window.open / 原生打开 / Explorer reveal。
 *
 * Blob URL 生命周期（P0 fix）：
 * click() 只代表「下载已启动」，不代表「下载消费者已完整读取 blob」。
 * 因此绝不在 setTimeout(0) revoke；延迟 revoke（成熟 FileSaver 同样延迟 ~40s+），
 * 保证浏览器真实写盘完成前 URL 一直有效（否则可能产生 truncated .docx）。
 */
import { KiroArtifactDownloadPayload } from "@/lib/ai/computer/artifacts/access";
import { ComputerError } from "@/lib/ai/computer/errors";

/** Blob URL revoke 延迟：60s（下载消费者有充足时间完整读取） */
export const ARTIFACT_DOWNLOAD_URL_REVOKE_DELAY_MS = 60_000;

/** 清理下载文件名：扩展名前的多余空格（如「本周课表（第1周） .docx」→「本周课表（第1周）.docx」）。
 *  只影响浏览器下载展示名，绝不影响 Artifact logical path / Source IR。 */
export function sanitizeDownloadFileName(name: string): string {
  return name.replace(/\s+(\.[^.]+)$/, "$1").trim();
}

export function triggerArtifactDownload(payload: KiroArtifactDownloadPayload): void {
  if (typeof window === "undefined" || typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new ComputerError("UNSUPPORTED_BROWSER", "当前环境不支持文件下载");
  }
  // byte-safe Blob：保持 TypedArray 语义（不经过 string/base64）
  const bytes = payload.bytes.slice();
  const blob = new Blob([bytes], { type: payload.mimeType });
  if (blob.size !== payload.bytes.byteLength) {
    throw new ComputerError("VERIFICATION_FAILED", "下载数据构造失败");
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = sanitizeDownloadFileName(payload.fileName);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 延迟 revoke（下载消费者读取完成前 URL 必须有效）
  window.setTimeout(() => URL.revokeObjectURL(url), ARTIFACT_DOWNLOAD_URL_REVOKE_DELAY_MS);
}
