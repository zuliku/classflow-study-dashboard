import { describe, it, expect } from "vitest";
import { isWithinDoNotDisturbWindow } from "@/lib/reminders/doNotDisturb";

function dateAt(h: number, m: number): Date {
  // 使用本地日期 2026-01-01 的 wall-clock
  return new Date(2026, 0, 1, h, m, 0, 0);
}

describe("isWithinDoNotDisturbWindow", () => {
  it("disabled → 永远 false", () => {
    expect(isWithinDoNotDisturbWindow({ enabled: false, start: "22:00", end: "07:00", now: dateAt(23, 0) })).toBe(false);
    expect(isWithinDoNotDisturbWindow({ enabled: false, start: "08:00", end: "12:00", now: dateAt(9, 0) })).toBe(false);
  });

  describe("普通区间 08:00 -> 12:00 (start <= now < end)", () => {
    const start = "08:00";
    const end = "12:00";
    it("07:59 false", () => expect(isWithinDoNotDisturbWindow({ enabled: true, start, end, now: dateAt(7, 59) })).toBe(false));
    it("08:00 true (exact start)", () => expect(isWithinDoNotDisturbWindow({ enabled: true, start, end, now: dateAt(8, 0) })).toBe(true));
    it("11:59 true", () => expect(isWithinDoNotDisturbWindow({ enabled: true, start, end, now: dateAt(11, 59) })).toBe(true));
    it("12:00 false (exact end)", () => expect(isWithinDoNotDisturbWindow({ enabled: true, start, end, now: dateAt(12, 0) })).toBe(false));
    it("12:01 false", () => expect(isWithinDoNotDisturbWindow({ enabled: true, start, end, now: dateAt(12, 1) })).toBe(false));
  });

  describe("跨午夜 22:00 -> 07:00", () => {
    const start = "22:00";
    const end = "07:00";
    it("21:59 false", () => expect(isWithinDoNotDisturbWindow({ enabled: true, start, end, now: dateAt(21, 59) })).toBe(false));
    it("22:00 true (exact start)", () => expect(isWithinDoNotDisturbWindow({ enabled: true, start, end, now: dateAt(22, 0) })).toBe(true));
    it("23:59 true", () => expect(isWithinDoNotDisturbWindow({ enabled: true, start, end, now: dateAt(23, 59) })).toBe(true));
    it("00:00 true", () => expect(isWithinDoNotDisturbWindow({ enabled: true, start, end, now: dateAt(0, 0) })).toBe(true));
    it("06:59 true", () => expect(isWithinDoNotDisturbWindow({ enabled: true, start, end, now: dateAt(6, 59) })).toBe(true));
    it("07:00 false (exact end)", () => expect(isWithinDoNotDisturbWindow({ enabled: true, start, end, now: dateAt(7, 0) })).toBe(false));
    it("12:00 false (outside)", () => expect(isWithinDoNotDisturbWindow({ enabled: true, start, end, now: dateAt(12, 0) })).toBe(false));
  });

  it("start === end → 零长度 DND → false（不解释为全天）", () => {
    expect(isWithinDoNotDisturbWindow({ enabled: true, start: "22:00", end: "22:00", now: dateAt(22, 0) })).toBe(false);
    expect(isWithinDoNotDisturbWindow({ enabled: true, start: "08:00", end: "08:00", now: dateAt(9, 0) })).toBe(false);
  });

  it("00:00 边界：普通区间跨午夜判 00:00 正确", () => {
    expect(isWithinDoNotDisturbWindow({ enabled: true, start: "23:00", end: "01:00", now: dateAt(0, 0) })).toBe(true);
    expect(isWithinDoNotDisturbWindow({ enabled: true, start: "08:00", end: "12:00", now: dateAt(0, 0) })).toBe(false);
  });

  it("invalid HH:mm → false（不 throw）", () => {
    expect(isWithinDoNotDisturbWindow({ enabled: true, start: "bad", end: "07:00", now: dateAt(23, 0) })).toBe(false);
    expect(isWithinDoNotDisturbWindow({ enabled: true, start: "22:00", end: "bad", now: dateAt(23, 0) })).toBe(false);
    expect(isWithinDoNotDisturbWindow({ enabled: true, start: "25:00", end: "07:00", now: dateAt(23, 0) })).toBe(false);
    expect(isWithinDoNotDisturbWindow({ enabled: true, start: "22:00", end: "07:00", now: new Date("invalid") })).toBe(false);
  });
});
