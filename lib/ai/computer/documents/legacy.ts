/**
 * Legacy Kiro DOCX Detector（V2.5 / V2.9）。
 *
 * 旧手写 OOXML renderer 的确定性签名（已在真实用户失败文件中确认）：
 * 1. word/document.xml：<w:tc> 直接包含 <w:r>（Word 要求单元格内容为 block-level
 *    document content，至少包含 <w:p>）
 * 2. word/styles.xml：<w:style> 直接包含 <w:numPr>（numPr 必须位于 pPr 内）
 * 3. word/document.xml：<w:tbl> 缺少 <w:tblPr> / <w:tblGrid>（WordprocessingML schema
 *    要求 tbl 子元素顺序 tblPr? tblGrid? tr+；无 tblGrid 时 OpenXmlValidator 拒绝
 *    "unexpected child element tr"——旧 renderer 手写 <w:tbl><w:tr> 结构即此签名）
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
  /** tbl 缺少合法 table structure（首 tr 之前无 tblPr 或无 tblGrid）的个数 */
  malformedTables: number;
}

export async function detectLegacyKiroDocx(bytes: Uint8Array): Promise<LegacyKiroDocxDetection> {
  const result: LegacyKiroDocxDetection = {
    legacy: false,
    directTableRuns: 0,
    invalidStyleNumPr: 0,
    malformedTables: 0,
  };
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

      // V2.9：tbl 缺少合法 table structure——首 tr 之前必须存在 tblPr 与 tblGrid
      //（OpenXmlValidator 对 <w:tbl><w:tr> 直接结构报 "unexpected child element tr"）
      const tblRe = /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g;
      let tm: RegExpExecArray | null;
      while ((tm = tblRe.exec(documentXml))) {
        const headEnd = tm[1].indexOf("<w:tr");
        const head = headEnd === -1 ? tm[1] : tm[1].slice(0, headEnd);
        if (!/<w:tblPr\b/.test(head) || !/<w:tblGrid\b/.test(head)) {
          result.malformedTables += 1;
        }
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

    result.legacy =
      result.directTableRuns > 0 || result.invalidStyleNumPr > 0 || result.malformedTables > 0;
  } catch {
    // 不是可解析的 DOCX package → 保持全 false
  }
  return result;
}
