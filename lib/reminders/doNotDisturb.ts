/**
 * Do Not Disturb 纯函数（本地墙钟 HH:mm，测试可传入固定 now）。
 * 语义：enabled===false → 永远 false；start===end → 零长度 → false；
 * 普通区间：start <= now < end；跨午夜：now >= start OR now < end；
 * 非法 HH:mm → false（不抛错）。
 */

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseHHMM(s: string): number | null {
  if (typeof s !== "string" || !HHMM_RE.test(s)) return null;
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function nowToMinutes(now: Date | string): number | null {
  if (now instanceof Date) {
    if (Number.isNaN(now.getTime())) return null;
    return now.getHours() * 60 + now.getMinutes();
  }
  if (typeof now === "string") {
    // 支持 "HH:mm" 或 "YYYY-MM-DDTHH:mm:ss"
    if (HHMM_RE.test(now)) return parseHHMM(now);
    const d = new Date(now);
    if (!Number.isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
    return null;
  }
  return null;
}

export function isWithinDoNotDisturbWindow(input: {
  enabled: boolean;
  start: string;
  end: string;
  now: Date | string;
}): boolean {
  try {
    if (!input.enabled) return false;
    const startM = parseHHMM(input.start);
    const endM = parseHHMM(input.end);
    if (startM === null || endM === null) return false;
    if (startM === endM) return false;
    const nowM = nowToMinutes(input.now);
    if (nowM === null) return false;
    if (startM < endM) {
      return nowM >= startM && nowM < endM;
    }
    // 跨午夜
    return nowM >= startM || nowM < endM;
  } catch {
    return false;
  }
}
