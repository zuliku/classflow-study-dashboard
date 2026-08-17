import { describe, it, expect } from "vitest";
import {
  combineLocalDateTime,
  getLocalDDLDate,
  getLocalDDLTime,
  parseLocalDDL,
} from "@/lib/ddl";

describe("combineLocalDateTime", () => {
  it("组合为无 Z 的本地时间字符串", () => {
    expect(combineLocalDateTime("2026-08-10", "23:59")).toBe("2026-08-10T23:59:00");
  });

  it("缺省时间按 23:59 处理", () => {
    expect(combineLocalDateTime("2026-08-10", "")).toBe("2026-08-10T23:59:00");
  });
});

describe("getLocalDDLDate / getLocalDDLTime", () => {
  it("新格式直接取本地日期与时间", () => {
    expect(getLocalDDLDate("2026-08-10T23:59:00")).toBe("2026-08-10");
    expect(getLocalDDLTime("2026-08-10T23:59:00")).toBe("23:59");
  });

  it("旧 Z 格式按墙钟读取，不产生时区偏移", () => {
    expect(getLocalDDLDate("2026-08-10T23:59:00.000Z")).toBe("2026-08-10");
    expect(getLocalDDLTime("2026-08-10T23:59:00.000Z")).toBe("23:59");
  });
});

describe("parseLocalDDL", () => {
  const wallClock = (d: Date) => ({
    y: d.getFullYear(),
    m: d.getMonth(),
    day: d.getDate(),
    h: d.getHours(),
    min: d.getMinutes(),
  });

  it("新格式（无偏移）按本地时间解析", () => {
    const d = parseLocalDDL("2026-08-10T23:59:00")!;
    expect(wallClock(d)).toEqual({ y: 2026, m: 7, day: 10, h: 23, min: 59 });
  });

  it("旧 Z 数据按字符串墙钟重建（修复 UTC+8 偏移）", () => {
    const d = parseLocalDDL("2026-08-10T23:59:00.000Z")!;
    expect(wallClock(d)).toEqual({ y: 2026, m: 7, day: 10, h: 23, min: 59 });
  });

  it("带真实时区偏移的字符串按瞬间解析（+08:00 = UTC 15:59）", () => {
    const d = parseLocalDDL("2026-08-10T23:59:00+08:00")!;
    expect(d.getTime()).toBe(Date.UTC(2026, 7, 10, 15, 59));
  });

  it("仅日期按本地零点解析", () => {
    const d = parseLocalDDL("2026-08-10")!;
    expect(wallClock(d)).toEqual({ y: 2026, m: 7, day: 10, h: 0, min: 0 });
  });

  it("空格分隔格式兼容", () => {
    const d = parseLocalDDL("2026-08-10 23:59")!;
    expect(wallClock(d)).toEqual({ y: 2026, m: 7, day: 10, h: 23, min: 59 });
  });

  it("非法输入返回 null", () => {
    expect(parseLocalDDL("")).toBeNull();
    expect(parseLocalDDL("abc")).toBeNull();
    expect(parseLocalDDL("not-a-date")).toBeNull();
  });
});
