import { describe, it, expect } from "vitest";
import { parseCSVSchedule, parseICS } from "@/lib/parser";

describe("parseCSVSchedule", () => {
  it("支持标准双引号字段（含逗号的课程名不被拆开）", () => {
    const csv = [
      "课程名称,代码,教师,教室,学分,星期,开始时间,结束时间,周次",
      '"国际贸易,专题研究",ECON301,张教授,教二201,3,2,08:00,09:40,1-16周',
    ].join("\n");

    const res = parseCSVSchedule(csv);
    expect(res.errors).toHaveLength(0);
    expect(res.courses).toHaveLength(1);
    expect(res.courses[0].name).toBe("国际贸易,专题研究");
    expect(res.schedules[0].dayOfWeek).toBe(2);
  });

  it("引号内转义 \"\" 解析为单个引号", () => {
    const csv = '"AI ""深度"" 导论",AI101,李教授,信科楼,3,1,08:00,09:40,1-16周';
    const res = parseCSVSchedule(csv);
    expect(res.courses[0].name).toBe('AI "深度" 导论');
  });

  it("dayOfWeek 非法（非 1-7）→ 进入 errors 且不生成课程", () => {
    const csv = "高等数学,MATH102,陈教授,教三305,5,9,10:00,11:40,1-16周";
    const res = parseCSVSchedule(csv);
    expect(res.courses).toHaveLength(0);
    expect(res.errors.join()).toContain("星期");
  });

  it("start >= end → 进入 errors", () => {
    const csv = "数据库,CS204,李教授,计算机楼102,4,3,10:00,09:40,1-16周";
    const res = parseCSVSchedule(csv);
    expect(res.courses).toHaveLength(0);
    expect(res.errors.join()).toContain("结束");
  });

  it("课程名称为空 → 进入 errors", () => {
    const csv = ",CS101,王老师,教一101,2,1,14:00,15:40,1-16周";
    const res = parseCSVSchedule(csv);
    expect(res.courses).toHaveLength(0);
    expect(res.errors.join()).toContain("名称为空");
  });

  it("多行中仅跳过非法行，其余正常解析", () => {
    const csv = [
      "英语口语,ENGL301,Sarah,外语楼207,2,4,13:00,14:40,1-16周",
      "管理学,MGMT101,刘老师,教一101,3,8,16:00,17:40,1-16周",
      "微观经济学,ECON201,王教授,教二201,4,1,08:00,09:40,1-16周",
    ].join("\n");
    const res = parseCSVSchedule(csv);
    expect(res.courses.map((c) => c.name)).toEqual(["英语口语", "微观经济学"]);
    expect(res.errors).toHaveLength(1);
  });
});

describe("parseICS", () => {
  const wrap = (vevent: string) =>
    `BEGIN:VCALENDAR\nVERSION:2.0\n${vevent}\nEND:VCALENDAR`;

  it("从 DTSTART 真实日期推算星期（2026-08-24 为周一）", () => {
    const ics = wrap([
      "BEGIN:VEVENT",
      "SUMMARY:计量经济学",
      "DTSTART:20260824T080000",
      "DTEND:20260824T094000",
      "END:VEVENT",
    ].join("\n"));

    const res = parseICS(ics);
    expect(res.errors).toHaveLength(0);
    expect(res.schedules[0].dayOfWeek).toBe(1);
    expect(res.schedules[0].startTime).toBe("08:00");
    expect(res.schedules[0].endTime).toBe("09:40");
  });

  it("支持 DTSTART;TZID=Asia/Shanghai:... 形式", () => {
    const ics = wrap([
      "BEGIN:VEVENT",
      "SUMMARY:高等数学",
      "DTSTART;TZID=Asia/Shanghai:20260825T100000",
      "DTEND;TZID=Asia/Shanghai:20260825T114000",
      "END:VEVENT",
    ].join("\n"));

    const res = parseICS(ics);
    expect(res.schedules[0].dayOfWeek).toBe(2); // 2026-08-25 为周二
    expect(res.schedules[0].startTime).toBe("10:00");
    expect(res.schedules[0].endTime).toBe("11:40");
  });

  it("RRULE:FREQ=WEEKLY;BYDAY=MO 优先于 DTSTART 日期（2026-09-03 为周四但 BYDAY=MO）", () => {
    const ics = wrap([
      "BEGIN:VEVENT",
      "SUMMARY:英语口语",
      "DTSTART:20260903T100000",
      "DTEND:20260903T114000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "END:VEVENT",
    ].join("\n"));

    const res = parseICS(ics);
    expect(res.schedules[0].dayOfWeek).toBe(1);
  });

  it("无法可靠表示的 RRULE 产生 warning 而非静默猜测", () => {
    const ics = wrap([
      "BEGIN:VEVENT",
      "SUMMARY:管理学原理",
      "DTSTART:20260826T140000",
      "DTEND:20260826T154000",
      "RRULE:FREQ=YEARLY;BYMONTH=8",
      "END:VEVENT",
    ].join("\n"));

    const res = parseICS(ics);
    expect(res.warnings.join()).toContain("YEARLY");
  });

  it("EXDATE 产生 warning", () => {
    const ics = wrap([
      "BEGIN:VEVENT",
      "SUMMARY:数据库系统",
      "DTSTART:20260827T080000",
      "DTEND:20260827T094000",
      "RRULE:FREQ=WEEKLY;BYDAY=TH",
      "EXDATE:20260910T080000",
      "END:VEVENT",
    ].join("\n"));

    const res = parseICS(ics);
    expect(res.warnings.join()).toContain("EXDATE");
    expect(res.schedules[0].dayOfWeek).toBe(4); // 2026-08-27 为周四
  });

  it("缺少 RRULE 时给出 warning 但仍按每周导入", () => {
    const ics = wrap([
      "BEGIN:VEVENT",
      "SUMMARY:数据结构",
      "DTSTART:20260828T080000",
      "DTEND:20260828T094000",
      "END:VEVENT",
    ].join("\n"));

    const res = parseICS(ics);
    expect(res.warnings.join()).toContain("RRULE");
    expect(res.schedules[0].dayOfWeek).toBe(5); // 2026-08-28 为周五
  });

  it("同一 SUMMARY 合并为一门课程多个时段", () => {
    const ics = wrap([
      "BEGIN:VEVENT",
      "SUMMARY:微观经济学",
      "DTSTART:20260824T080000",
      "DTEND:20260824T094000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "SUMMARY:微观经济学",
      "DTSTART:20260826T140000",
      "DTEND:20260826T154000",
      "RRULE:FREQ=WEEKLY;BYDAY=WE",
      "END:VEVENT",
    ].join("\n"));

    const res = parseICS(ics);
    expect(res.courses).toHaveLength(1);
    expect(res.schedules).toHaveLength(2);
    expect(res.schedules.map((s) => s.dayOfWeek)).toEqual([1, 3]);
  });
});
