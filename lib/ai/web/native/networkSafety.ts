/**
 * Task 18A：Kiro Safe Web Fetch 网络安全层（纯函数，无 IO，可直接单测）。
 *
 * SSRF 防护分类器：
 * - normalizeWebFetchUrl：protocol / credentials / port 白名单
 * - isBlockedHostname：localhost / *.local / *.internal
 * - isBlockedIpAddress：IPv4 / IPv6 / IPv4-mapped IPv6 完整私网与特殊地址段
 *
 * 原则：fail-closed。未知 / 非预期形态一律按 blocked 处理。
 */

/** 严格 IPv4 解析（4 段 0-255）；非纯 IPv4 文本返回 null */
export function parseIPv4(host: string): number[] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const parts = host.split(".").map(Number);
  if (parts.some((p) => p > 255)) return null;
  return parts;
}

/**
 * Hostname Blocklist：lowercase → trim trailing dot 后判断。
 * 至少阻止：localhost / *.localhost / *.local / *.internal
 */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().trim().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local")) return true;
  if (host.endsWith(".internal")) return true;
  return false;
}

/** 拆分 IPv6 文本（支持 :: 压缩与尾部内嵌 IPv4）为 16-bit 段字符串；非法返回 null */
function splitIpv6Text(s: string): string[] | null {
  const parts = s.split("::");
  if (parts.length > 2) return null;
  const seg = (chunk: string): string[] => {
    if (!chunk) return [];
    const arr = chunk.split(":");
    const last = arr[arr.length - 1];
    if (last.includes(".")) {
      const v4 = parseIPv4(last);
      if (!v4) return [];
      arr.pop();
      arr.push(((v4[0] << 8) | v4[1]).toString(16), ((v4[2] << 8) | v4[3]).toString(16));
    }
    return arr;
  };
  const left = seg(parts[0]);
  if (parts.length === 1) return left.length === 8 ? left : null;
  const right = seg(parts[1]);
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array(missing).fill("0"), ...right];
}

/** 归一 IPv6 文本 → 8 个 16-bit 大端段；非 IPv6 返回 null（去括号 / zone id / 小写） */
export function ipv6Segments(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  if (s.startsWith("[")) s = s.slice(1);
  if (s.endsWith("]")) s = s.slice(0, -1);
  if (!s.includes(":")) return null;
  const segs = splitIpv6Text(s);
  if (!segs) return null;
  const out: number[] = [];
  for (const seg of segs) {
    if (!/^[0-9a-f]{1,4}$/.test(seg)) return null;
    out.push(parseInt(seg, 16));
  }
  return out.length === 8 ? out : null;
}

/** IPv4-mapped IPv6（::ffff:a.b.c.d）→ IPv4 段；否则 null */
function ipv4OfMappedIpv6(seg: number[]): number[] | null {
  if (seg[5] !== 0xffff) return null;
  if (seg[0] !== 0 || seg[1] !== 0 || seg[2] !== 0 || seg[3] !== 0 || seg[4] !== 0) return null;
  return [(seg[6] >> 8) & 0xff, seg[6] & 0xff, (seg[7] >> 8) & 0xff, seg[7] & 0xff];
}

/** IPv4 特殊 / 私网段分类（Task 18A §9 全清单，含 metadata 169.254.169.254） */
function isBlockedIpv4(a: number[]): boolean {
  if (a[0] === 0) return true; // 0.0.0.0/8
  if (a[0] === 10) return true; // 10.0.0.0/8
  if (a[0] === 100 && a[1] >= 64 && a[1] <= 127) return true; // 100.64.0.0/10
  if (a[0] === 127) return true; // 127.0.0.0/8
  if (a[0] === 169 && a[1] === 254) return true; // 169.254.0.0/16（含 metadata）
  if (a[0] === 172 && a[1] >= 16 && a[1] <= 31) return true; // 172.16.0.0/12
  if (a[0] === 192 && a[1] === 0 && a[2] === 0) return true; // 192.0.0.0/24
  if (a[0] === 192 && a[1] === 0 && a[2] === 2) return true; // 192.0.2.0/24
  if (a[0] === 192 && a[1] === 168) return true; // 192.168.0.0/16
  if (a[0] === 198 && (a[1] === 18 || a[1] === 19)) return true; // 198.18.0.0/15
  if (a[0] === 198 && a[1] === 51 && a[2] === 100) return true; // 198.51.100.0/24
  if (a[0] === 203 && a[1] === 0 && a[2] === 113) return true; // 203.0.113.0/24
  if (a[0] >= 224) return true; // 224.0.0.0/4 + 240.0.0.0/4
  return false;
}

/** IPv6 特殊 / 私网段分类（::1 / :: / fc00::/7 / fe80::/10 / ff00::/8 + v4-mapped） */
function isBlockedIpv6(seg: number[]): boolean {
  const mapped = ipv4OfMappedIpv6(seg);
  if (mapped) return isBlockedIpv4(mapped); // ::ffff:127.0.0.1 等一律按 IPv4 规则
  if (seg.every((v) => v === 0)) return true; // ::
  if (seg[7] === 1 && seg.slice(0, 7).every((v) => v === 0)) return true; // ::1
  if ((seg[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((seg[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if (seg[0] >= 0xff00) return true; // ff00::/8
  return false;
}

/** IP 文本是否属于 blocked 集合（IPv4 / IPv6 / IPv4-mapped IPv6）；非 IP 文本 → false（交给 hostname 层） */
export function isBlockedIpAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isBlockedIpv4(v4);
  const v6 = ipv6Segments(ip);
  if (v6) return isBlockedIpv6(v6);
  return false;
}

/** hostname 是否为直接 IP 文本（IPv4 或 IPv6）；是 → 无需 DNS，直接分类 */
export function isIpAddressText(host: string): boolean {
  return parseIPv4(host) !== null || ipv6Segments(host) !== null;
}

/**
 * URL 规范化白名单（V1）：
 * - 只允许 http: / https:
 * - 禁止 credentials（username / password）
 * - 只允许默认端口（WHATWG URL 对 http:80 / https:443 会归并为空 port，非默认端口在此暴露）
 * 任何违规 / parse 失败 → null。
 */
export function normalizeWebFetchUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port) return null;
  return url;
}
