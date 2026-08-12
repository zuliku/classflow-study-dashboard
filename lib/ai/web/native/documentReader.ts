/**
 * Task 19B：Kiro Native Document Router —— HTML / PDF 统一 Native 读取入口。
 *
 * 行为：
 * 1) 先 readNativeWebSource（HTML/XHTML/text/plain；PDF 会在 content-type 检查时立即拒绝）
 * 2) success → return；失败但非 WEB_NATIVE_UNSUPPORTED_CONTENT → return（含 POLICY_BLOCKED /
 *    FETCH_FAILED —— 绝不因"也许是 PDF"再请求一次）
 * 3) 只有 WEB_NATIVE_UNSUPPORTED_CONTENT → readNativeWebPdfSource（真正下载 PDF）
 *
 * 不信任 URL .pdf 扩展名；真正 authority = safeWebFetchPdf 的 Content-Type + %PDF- signature。
 */
import { KiroNativeWebReadRequest, KiroNativeWebReadOutcome, readNativeWebSource } from "@/lib/ai/web/native/reader";
import { readNativeWebPdfSource, KiroNativeWebPdfReaderDeps } from "@/lib/ai/web/native/pdfReader";

export interface KiroNativeDocumentReaderDeps {
  htmlReader?: typeof readNativeWebSource;
  pdfReader?: typeof readNativeWebPdfSource;
}

export async function readNativeWebDocumentSource(
  request: KiroNativeWebReadRequest,
  deps?: KiroNativeDocumentReaderDeps
): Promise<KiroNativeWebReadOutcome> {
  const htmlReader = deps?.htmlReader ?? readNativeWebSource;
  const html = await htmlReader(request);
  if (html.ok || html.code !== "WEB_NATIVE_UNSUPPORTED_CONTENT") {
    return html;
  }
  const pdfReader = deps?.pdfReader ?? readNativeWebPdfSource;
  return pdfReader(request);
}

export type { KiroNativeWebPdfReaderDeps };
