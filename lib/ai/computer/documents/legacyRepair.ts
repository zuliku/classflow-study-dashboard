/**
 * Legacy Kiro DOCX Bounded Repair（V2.6 / V2.9）。
 *
 * 只修已在真实用户文件中确认的错误（不扩展任何其它 surgery）：
 *
 * A. word/document.xml：<w:tc> 直接包含 <w:r>
 *    → 把 tcPr 之后连续的 direct runs 包入 <w:p>（保留 tcPr / rPr / runs / 文本 / 顺序）
 * B. word/styles.xml：<w:style> 直接包含 <w:numPr>
 *    → 移入 <w:pPr>（pPr 已存在则追加进去，否则创建 <w:pPr>）
 * C. word/document.xml：<w:tbl> 缺少合法 table structure（无 tblPr / tblGrid）
 *    → 从真实行 cell 数推导列数与宽度，补充 <w:tblPr><w:tblW/></w:tblPr> + <w:tblGrid>
 *      （宽度优先复用 cell 的 <w:tcW w:w>；无有效宽度时按 A4 可打印宽均分；
 *      列数绝不硬编码——从第一个 <w:tr> 的实际 <w:tc> 数推导）
 *
 * 安全边界（由调用方 enforce）：只有 legacyKiroProducer === true（package 证据确认旧 Kiro
 * renderer 产物）才允许对文件执行 repair；未知 producer 的文件绝不自动手术。
 *
 * 实现约束：只操作已知 producer 的确定性结构，绝不动 runs 内部内容 / cell 文本。
 */

import JSZip from "jszip";
import { detectLegacyKiroDocx, LegacyKiroDocxDetection } from "@/lib/ai/computer/documents/legacy";

/** 无有效列宽时的 fallback 总宽（A4 页宽 11906 − 左右边距 1304×2，与生产 renderer 一致） */
const DEFAULT_TABLE_TOTAL_TWIP = 9298;

/**
 * 修复 document.xml 的 w:tc → w:r direct child。
 * 只包「紧跟在 tcPr（或 tc 开始）之后的连续 run 组」；若 run 组后还有其它内容则跳过（不手术）。
 */
export function repairDocumentXml(xml: string): string {
  return xml.replace(
    /(<w:tc\b[^>]*>)([\s\S]*?)(<\/w:tc>)/g,
    (whole: string, open: string, inner: string, close: string) => {
      const tcPr = /^(\s*)(<w:tcPr\b[^>]*\/?>[\s\S]*?<\/w:tcPr>)(\s*)/.exec(inner);
      let head = "";
      let rest = inner;
      if (tcPr) {
        head = tcPr[0];
        rest = inner.slice(tcPr[0].length);
      }
      const runs = /^(?:<w:r\b[\s\S]*?<\/w:r>\s*)+/.exec(rest);
      if (!runs) return whole;
      // 只有 rest 全部是 runs（允许首尾空白）才包；否则不手术
      if (rest.trim() !== runs[0].trim()) return whole;
      return open + head + "<w:p>" + runs[0].trim() + "</w:p>" + close;
    }
  );
}

/**
 * 修复 document.xml 的 w:tbl 缺少合法 table structure：
 * 首 tr 之前补 <w:tblPr><w:tblW/></w:tblPr> 与 <w:tblGrid>（顺序 tblPr → tblGrid → tr）。
 * - 列数 = 第一个 <w:tr> 的实际 <w:tc> 数（绝不硬编码）
 * - 列宽：优先复用每个 cell 的 <w:tcW w:w>；无有效宽度 → A4 可打印宽均分（sum 恒等）
 * - 只动 tbl 头部；cell 文本 / runs / 字体 / 行顺序完全不动
 */
export function repairTableStructureXml(xml: string): string {
  return xml.replace(
    /(<w:tbl\b[^>]*>)([\s\S]*?)(<\/w:tbl>)/g,
    (whole: string, open: string, inner: string, close: string) => {
      const trIdx = inner.indexOf("<w:tr");
      const head = trIdx === -1 ? inner : inner.slice(0, trIdx);
      const hasTblPr = /<w:tblPr\b/.test(head);
      const hasTblGrid = /<w:tblGrid\b/.test(head);
      if (hasTblPr && hasTblGrid) return whole;

      // 从第一个 tr 推导列数与宽度（无行 → 不手术）
      const firstTr = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/.exec(inner);
      if (!firstTr) return whole;
      const cells = firstTr[1].match(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g) ?? [];
      const colCount = cells.length;
      if (colCount === 0) return whole;

      // 宽度：优先 cell tcW；否则 A4 可打印宽均分（余数分配到前列，sum 恒等）
      const widths: number[] = cells.map((cell) => {
        const tcW = /<w:tcW\b[^>]*w:w="(\d+)"/.exec(cell);
        return tcW ? parseInt(tcW[1], 10) : 0;
      });
      let total = widths.reduce((a, b) => a + b, 0);
      if (total <= 0 || widths.some((w) => w <= 0)) {
        total = DEFAULT_TABLE_TOTAL_TWIP;
        const base = Math.floor(total / colCount);
        const remainder = total - base * colCount;
        widths.length = 0;
        for (let i = 0; i < colCount; i++) {
          widths.push(base + (i < remainder ? 1 : 0));
        }
        total = widths.reduce((a, b) => a + b, 0);
      }

      const tblPr = `<w:tblPr><w:tblW w:type="dxa" w:w="${total}"/></w:tblPr>`;
      const tblGrid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;
      const insertion = (hasTblPr ? "" : tblPr) + (hasTblGrid ? "" : tblGrid);
      return open + insertion + inner + close;
    }
  );
}

/**
 * 修复 styles.xml 的 w:style → w:numPr direct child：
 * 直接子 numPr 移入 pPr（已有 pPr → 追加；无 pPr → 原位包成 <w:pPr>）。
 */
export function repairStylesXml(xml: string): string {
  return xml.replace(
    /(<w:style\b[^>]*>)([\s\S]*?)(<\/w:style>)/g,
    (whole: string, open: string, inner: string, close: string) => {
      // 先剥 pPr：剩余内容中出现的 numPr 就是 direct child（与 detector 同一判定）
      const stripped = inner.replace(/<w:pPr\b[\s\S]*?<\/w:pPr>/g, "");
      const directNumPr = /<w:numPr\b[\s\S]*?<\/w:numPr>/.exec(stripped);
      if (!directNumPr) return whole;
      const existingPPr = /<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(inner);
      if (existingPPr) {
        // 先移除 direct numPr，再把同一段 numPr 追加进 pPr（避免残留直接子级）
        const withoutDirect = inner.replace(directNumPr[0], "");
        const pPr = /<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(withoutDirect);
        if (!pPr) return whole;
        const merged = pPr[0].replace(/<\/w:pPr>/, directNumPr[0] + "</w:pPr>");
        return open + withoutDirect.replace(pPr[0], merged) + close;
      }
      return open + inner.replace(directNumPr[0], `<w:pPr>${directNumPr[0]}</w:pPr>`) + close;
    }
  );
}

export interface LegacyRepairResult {
  repaired: boolean;
  bytes: Uint8Array;
  before: LegacyKiroDocxDetection;
  after: LegacyKiroDocxDetection;
}

/**
 * 对 legacy Kiro DOCX package 做 bounded repair：
 * 只有检测到需要修复的结构才重打包（否则原 bytes 返回，repaired=false）。
 * V2.9：document.xml 依次执行 tc→p 修复 + table structure 修复（styles 的 numPr→pPr）。
 */
export async function repairLegacyKiroDocx(bytes: Uint8Array): Promise<LegacyRepairResult> {
  const before = await detectLegacyKiroDocx(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  const stylesXml = await zip.file("word/styles.xml")?.async("string");
  let changed = false;
  if (documentXml) {
    let repaired = repairDocumentXml(documentXml);
    repaired = repairTableStructureXml(repaired);
    if (repaired !== documentXml) {
      zip.file("word/document.xml", repaired);
      changed = true;
    }
  }
  if (stylesXml && before.invalidStyleNumPr > 0) {
    const repaired = repairStylesXml(stylesXml);
    if (repaired !== stylesXml) {
      zip.file("word/styles.xml", repaired);
      changed = true;
    }
  }
  if (!changed) {
    return { repaired: false, bytes, before, after: before };
  }
  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const after = await detectLegacyKiroDocx(new Uint8Array(out));
  return { repaired: true, bytes: new Uint8Array(out), before, after };
}
