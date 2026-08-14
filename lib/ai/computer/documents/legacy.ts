/**
 * Legacy Kiro DOCX Detector（V2.5）。
 *
 * 旧手写 OOXML renderer 的确定性签名（已在真实用户失败文件中确认）：
 * 1. word/document.xml：<w:tc> 直接包含 <w:r>（Word 要求单元格内容为 block-level
 *    document content，至少包含 <w:p>）
 * 2. word/styles.xml：<w:style> 直接包含 <w:numPr>（numPr 必须位于 pPr 内）
 *
 * 这是 migration 的「最高优先 evidence」——不依赖 rendererVersion 字段（IndexedDB 中
 * 可能存在各种旧状态）。浏览器 runtime 实现（JSZip + 字符串扫描）；OpenXmlValidator 仍只用于 dev/CI。
 */

import JSZip from "jszip";

/** 当前生产 DOCX renderer 版本（写入新 Source IR；migration 判断仍以 structural detector 为最高优先） */
export const CURRENT_DOCX_RENDERER_VERSION = 2 as const;

export interface LegacyKiroDocxDetection {
  legacy: boolean;
  directTableRuns: number;
  invalidStyleNumPr: number;
}

export async function detectLegacyKiroDocx(bytes: Uint8Array): Promise<LegacyKiroDocxDetection> {
  const result: LegacyKiroDocxDetection = { legacy: false, directTableRuns: 0, invalidStyleNumPr: 0 };
  try {
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const stylesXml = await zip.file("word/styles.xml")?.async("string");

    if (documentXml) {
      // w:tc 直接包含 w:r：先剥离 tcPr 与整个 p 块，剩余出现 w:r = 非法 direct run child
      const tcRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
      let m: RegExpExecArray | null;
      while ((m = tcRe.exec(documentXml))) {
        let inner = m[1].replace(/<w:tcPr\b[^>]*?\/?>[\s\S]*?<\/w:tcPr>/g, "");
        inner = inner.replace(/<w:p\b[^>]*?\/?>[\s\S]*?<\/w:p>/g, "");
        if (/<w:r\b[^>]*>/.test(inner)) result.directTableRuns += 1;
      }
    }

    if (stylesXml) {
      // w:style 直接包含 w:numPr（先剥离 pPr，剩余内容中出现 numPr = 非法 style 结构）
      const styleRe = /<w:style\b[^>]*>([\s\S]*?)<\/w:style>/g;
      let m: RegExpExecArray | null;
      while ((m = styleRe.exec(stylesXml))) {
        const inner = m[1].replace(/<w:pPr\b[^>]*?\/?>[\s\S]*?<\/w:pPr>/g, "");
        if (/<w:numPr\b[^>]*>/.test(inner)) result.invalidStyleNumPr += 1;
      }
    }

    result.legacy = result.directTableRuns > 0 || result.invalidStyleNumPr > 0;
  } catch {
    // 不是可解析的 DOCX package → 保持全 false
  }
  return result;
}
