/**
 * Kiro Computer Runtime Provenance（V2.6）。
 *
 * 目的：当「代码在 main 上是新 renderer、但用户拿到的 bytes 是旧 renderer」时，
 * 可以确定性地回答“实际运行的是哪一份 runtime”。
 *
 * - KIRO_COMPUTER_RUNTIME_VERSION：runtime/协议迭代标记（写入报告与 dev fingerprint）
 * - CURRENT_DOCX_RENDERER_ID：当前生产 DOCX renderer 身份
 * - DOCX_RENDERER_MARKER / DOCX_CREATOR：写入新生成 DOCX package 的稳定 metadata
 *   （docProps/core.xml <dc:description> / <dc:creator>），用于把新 renderer 输出
 *   与旧手写 renderer（Application/creator = "ClassFlow Kiro"、无 description）
 *   在 package 层面明确区分，不依赖文件大小 / ZIP entry 数。
 */

export const KIRO_COMPUTER_RUNTIME_VERSION = "kiro-word-v2.6" as const;

export const CURRENT_DOCX_RENDERER_ID = "docx-library-v2" as const;

/** 新 renderer 写入 docProps/core.xml <dc:description> 的稳定 marker */
export const DOCX_RENDERER_MARKER =
  `ClassFlow Kiro DOCX Engine · ${CURRENT_DOCX_RENDERER_ID}` as const;

/** 新 renderer 写入 docProps/core.xml <dc:creator>（与旧 renderer 同名，需配合 marker 判断） */
export const DOCX_CREATOR = "ClassFlow Kiro" as const;

let fingerprintPrinted = false;

/**
 * dev-only：runtime fingerprint 仅打印一次（production / test 静默）。
 * 开发环境创建 Word 文档时可在 dev server 日志看到 renderer 身份，
 * 用于证明实际执行路径（create_document 没走到新 renderer 时该日志不会出现）。
 */
export function logKiroRuntimeFingerprint(): void {
  if (fingerprintPrinted) return;
  fingerprintPrinted = true;
  if (process.env.NODE_ENV !== "development") return;
  console.info("[Kiro Runtime]");
  console.info(`version=${KIRO_COMPUTER_RUNTIME_VERSION}`);
  console.info(`renderer=${CURRENT_DOCX_RENDERER_ID}`);
}
