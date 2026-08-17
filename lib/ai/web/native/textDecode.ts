/**
 * Kiro Web Reader 兼容 Hotfix —— 网页文本解码（charset）。
 *
 * 优先级：HTTP Content-Type charset → HTML meta charset（前 4096 bytes ASCII sniff）→ UTF-8。
 * 支持 GBK / GB2312 / GB18030 / Big5 / UTF-8（Node 完整 ICU：TextDecoder 原生支持，无新增依赖）。
 * 陌生 charset → 安全回退 UTF-8（不整页失败），并报告 charsetSource="fallback"。
 *
 * 不做完整 HTML parser；只做 ASCII-compatible meta charset sniff。
 */

export type CharsetSource = "header" | "meta" | "utf8" | "fallback";

export interface DecodedWebText {
  text: string;
  charset: string | null;
  charsetSource: CharsetSource;
}

/** charset 别名归一（大小写不敏感） */
export function normalizeCharsetLabel(raw: string): string {
  const label = raw.trim().toLowerCase().replace(/['"]/g, "");
  switch (label) {
    case "utf8":
    case "utf-8":
      return "utf-8";
    case "gb2312":
    case "gb_2312":
    case "gb_2312-80":
    case "gbk":
      return "gbk";
    case "gb18030":
      return "gb18030";
    case "big5":
    case "big-5":
      return "big5";
    case "latin1":
    case "iso-8859-1":
    case "ascii":
    case "us-ascii":
      return "utf-8"; // ASCII 兼容超集，按 UTF-8 处理即安全
    default:
      return label;
  }
}

/** 从 HTTP Content-Type 提取 charset（text/html; charset=gb2312） */
export function charsetFromContentType(contentType: string): string | null {
  const m = /;\s*charset\s*=\s*"?([^;"\s]+)"?/i.exec(contentType);
  return m ? normalizeCharsetLabel(m[1]) : null;
}

/** 从 HTML 前 4096 bytes 嗅探 meta charset（ASCII-compatible sniff，不解析 DOM） */
export function sniffMetaCharset(head: Uint8Array): string | null {
  const headText = Buffer.from(head).toString("latin1").slice(0, 4096);
  // <meta charset="gbk"> 或 <meta http-equiv="Content-Type" content="text/html; charset=gb2312">
  const m =
    /<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_\-]+)/i.exec(headText) ??
    /<meta[^>]+http-equiv=["']content-type["'][^>]+content=["'][^"']*charset=([A-Za-z0-9_\-]+)/i.exec(headText);
  return m ? normalizeCharsetLabel(m[1]) : null;
}

function decodeWith(bytes: Uint8Array, charset: string): string | null {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return null; // 未知 label / 解码失败
  }
}

/**
 * 网页 bytes → 文本（Charset 检测优先级见文件头）。
 * 任何陌生 charset 都安全回退 UTF-8（不 throw、不整页失败）。
 */
export function decodeWebText(bytes: Uint8Array, contentType: string): DecodedWebText {
  const headerCharset = charsetFromContentType(contentType);
  if (headerCharset) {
    const text = decodeWith(bytes, headerCharset);
    if (text !== null) return { text, charset: headerCharset, charsetSource: "header" };
    // header 声明了陌生 charset：回退 utf-8
    return { text: decodeWith(bytes, "utf-8") ?? "", charset: null, charsetSource: "fallback" };
  }
  const metaCharset = sniffMetaCharset(bytes);
  if (metaCharset) {
    const text = decodeWith(bytes, metaCharset);
    if (text !== null) return { text, charset: metaCharset, charsetSource: "meta" };
  }
  return { text: decodeWith(bytes, "utf-8") ?? "", charset: null, charsetSource: "utf8" };
}
