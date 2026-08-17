import { describe, it, expect } from "vitest";
import {
  buildCourseOverlapScheduleFingerprint,
  findCourseOverlapsForStudyBlock,
  isCourseOverlapApproved,
  findUnapprovedCourseOverlaps,
  reconcileStudyBlockCourseOverlapApprovals,
} from "@/lib/planning/courseOverlapPolicy";
import { CourseSchedule, Semester, StudyBlock } from "@/types";

const SEMESTER: Semester = { id: "s", name: "S", startDate: "2026-08-10", totalWeeks: 16 }; // 周一开学
const MON = "2026-08-10"; // 第 1 周周一
const OUTSIDE = "2026-12-07"; // 第 18 周（> totalWeeks）

function schedule(patch: Partial<CourseSchedule> = {}): CourseSchedule {
  return {
    id: "s1",
    courseId: "c1",
    dayOfWeek: 1,
    startTime: "10:00",
    endTime: "12:00",
    location: "教101",
    weeks: "1-16周",
    ...patch,
  };
}

function block(patch: Partial<StudyBlock> = {}): StudyBlock {
  return {
    id: "sb1",
    title: "块",
    date: MON,
    startTime: "10:30",
    endTime: "11:30",
    assignmentId: "a1",
    courseId: "c1",
    source: "kiro",
    ...patch,
  } as StudyBlock;
}

describe("Fingerprint（§53）", () => {
  it("稳定：同 scheduleId/courseId/day/start/end/weeks/excludedWeeks → 相同", () => {
    const a = buildCourseOverlapScheduleFingerprint(schedule());
    const b = buildCourseOverlapScheduleFingerprint(schedule());
    expect(a).toBe(b);
  });

  it("location 变化 → 不变（§69）", () => {
    const a = buildCourseOverlapScheduleFingerprint(schedule({ location: "教101" }));
    const b = buildCourseOverlapScheduleFingerprint(schedule({ location: "教202" }));
    expect(a).toBe(b);
  });

  it("startTime 变化 → 变（§70）", () => {
    const a = buildCourseOverlapScheduleFingerprint(schedule({ startTime: "10:00" }));
    const b = buildCourseOverlapScheduleFingerprint(schedule({ startTime: "10:30" }));
    expect(a).not.toBe(b);
  });

  it("weeks 变化 → 变", () => {
    const a = buildCourseOverlapScheduleFingerprint(schedule({ weeks: "1-16周" }));
    const b = buildCourseOverlapScheduleFingerprint(schedule({ weeks: "1-8周" }));
    expect(a).not.toBe(b);
  });

  it("excludedWeeks 顺序无关：[3,5] 与 [5,3] 相同；内容不同则变", () => {
    const a = buildCourseOverlapScheduleFingerprint(schedule({ excludedWeeks: [3, 5] }));
    const b = buildCourseOverlapScheduleFingerprint(schedule({ excludedWeeks: [5, 3] }));
    const c = buildCourseOverlapScheduleFingerprint(schedule({ excludedWeeks: [3, 6] }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("不包含 location / 颜色语义字段（§6：courseId 是时间语义的一部分，保留）", () => {
    const a = buildCourseOverlapScheduleFingerprint(schedule());
    expect(a).not.toContain("教101");
    expect(a).not.toContain("location");
    expect(a).toContain("cid:c1"); // courseId 属于时间冲突语义（§6）
  });
});

describe("findCourseOverlapsForStudyBlock（§8/9/10）", () => {
  it("按 block.date 计算教学周：周一第 1 周课程生效 → 检出重叠", () => {
    const s1 = schedule({ startTime: "10:00", endTime: "12:00" }); // 周一 10-12
    const overlaps = findCourseOverlapsForStudyBlock({
      block: block({ date: MON, startTime: "10:30", endTime: "11:30" }),
      schedules: [s1],
      semester: SEMESTER,
    });
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].scheduleId).toBe("s1");
    expect(overlaps[0].scheduleFingerprint).toBe(buildCourseOverlapScheduleFingerprint(s1));
  });

  it("学期范围之外不 clamp → 无重叠（不制造假冲突）", () => {
    const overlaps = findCourseOverlapsForStudyBlock({
      block: block({ date: OUTSIDE, startTime: "10:30", endTime: "11:30" }),
      schedules: [schedule()],
      semester: SEMESTER,
    });
    expect(overlaps).toHaveLength(0);
  });

  it("星期不匹配 / 时间不重叠 → 无", () => {
    const noDay = findCourseOverlapsForStudyBlock({
      block: block({ date: "2026-08-11", startTime: "10:30", endTime: "11:30" }), // 周二
      schedules: [schedule()],
      semester: SEMESTER,
    });
    expect(noDay).toHaveLength(0);
    const noTime = findCourseOverlapsForStudyBlock({
      block: block({ date: MON, startTime: "13:00", endTime: "14:00" }),
      schedules: [schedule()],
      semester: SEMESTER,
    });
    expect(noTime).toHaveLength(0);
  });

  it("双周规则 + excludedWeeks 生效", () => {
    const biweekly = schedule({ weeks: "双周" });
    const week1 = findCourseOverlapsForStudyBlock({
      block: block({ date: MON, startTime: "10:30", endTime: "11:30" }), // 第 1 周（单周）
      schedules: [biweekly],
      semester: SEMESTER,
    });
    expect(week1).toHaveLength(0);
    const week2 = findCourseOverlapsForStudyBlock({
      block: block({ date: "2026-08-17", startTime: "10:30", endTime: "11:30" }), // 第 2 周
      schedules: [biweekly],
      semester: SEMESTER,
    });
    expect(week2).toHaveLength(1);
    const excluded = schedule({ excludedWeeks: [1] });
    expect(
      findCourseOverlapsForStudyBlock({
        block: block({ date: MON }),
        schedules: [excluded],
        semester: SEMESTER,
      })
    ).toHaveLength(0);
  });
});

describe("Approval 校验（§54）", () => {
  const overlap = { scheduleId: "s1", courseId: "c1", scheduleFingerprint: "fp-v1" };

  it("scheduleId + fingerprint 匹配 → approved", () => {
    const b = block({ courseOverlapApprovals: [{ scheduleId: "s1", scheduleFingerprint: "fp-v1", approvedAt: 1 }] });
    expect(isCourseOverlapApproved(b, overlap)).toBe(true);
  });

  it("同 ID / fingerprint 变化 → unapproved（§28）", () => {
    const b = block({ courseOverlapApprovals: [{ scheduleId: "s1", scheduleFingerprint: "fp-old", approvedAt: 1 }] });
    expect(isCourseOverlapApproved(b, overlap)).toBe(false);
  });

  it("缺 approval → unapproved", () => {
    expect(isCourseOverlapApproved(block(), overlap)).toBe(false);
  });

  it("findUnapprovedCourseOverlaps：有效批准被排除；失效批准仍报 unapproved", () => {
    const s1 = schedule();
    const approved = block({
      courseOverlapApprovals: [
        { scheduleId: "s1", scheduleFingerprint: buildCourseOverlapScheduleFingerprint(s1), approvedAt: 1 },
      ],
    });
    expect(
      findUnapprovedCourseOverlaps({ block: approved, schedules: [s1], semester: SEMESTER })
    ).toHaveLength(0);
    const stale = block({
      courseOverlapApprovals: [{ scheduleId: "s1", scheduleFingerprint: "old-fp", approvedAt: 1 }],
    });
    expect(
      findUnapprovedCourseOverlaps({ block: stale, schedules: [s1], semester: SEMESTER })
    ).toHaveLength(1);
  });
});

describe("reconcileStudyBlockCourseOverlapApprovals（§32/34/35/36）", () => {
  const s1 = schedule();

  it("explicitApprovals 优先（§37）", () => {
    const r = reconcileStudyBlockCourseOverlapApprovals({
      before: block({ date: MON, startTime: "09:00", endTime: "10:00" }),
      after: block({ date: MON, startTime: "10:30", endTime: "11:30" }),
      schedules: [s1],
      semester: SEMESTER,
      mutationSource: "kiro",
      occurredAt: 42,
      explicitApprovals: [
        { scheduleId: "s1", scheduleFingerprint: buildCourseOverlapScheduleFingerprint(s1), approvedAt: 42 },
      ],
    });
    expect(r).toEqual([
      { scheduleId: "s1", scheduleFingerprint: buildCourseOverlapScheduleFingerprint(s1), approvedAt: 42 },
    ]);
  });

  it("manual 时间变化 → 自动把当前 overlaps 记为批准（§60），approvedAt = occurredAt", () => {
    const r = reconcileStudyBlockCourseOverlapApprovals({
      before: block({ date: MON, startTime: "09:00", endTime: "10:00" }),
      after: block({ date: MON, startTime: "10:30", endTime: "11:30" }),
      schedules: [s1],
      semester: SEMESTER,
      mutationSource: "manual",
      occurredAt: 123,
    });
    expect(r).toEqual([
      { scheduleId: "s1", scheduleFingerprint: buildCourseOverlapScheduleFingerprint(s1), approvedAt: 123 },
    ]);
  });

  it("kiro 时间变化 → 不创造新 Approval（§34/61）；目标无重叠 → 清空", () => {
    const r = reconcileStudyBlockCourseOverlapApprovals({
      before: block({ date: MON, startTime: "09:00", endTime: "10:00" }),
      after: block({ date: MON, startTime: "10:30", endTime: "11:30" }),
      schedules: [s1],
      semester: SEMESTER,
      mutationSource: "kiro",
      occurredAt: 5,
    });
    expect(r).toBeUndefined();
    // 目标无重叠 → undefined
    const noOverlap = reconcileStudyBlockCourseOverlapApprovals({
      before: block({ date: MON, startTime: "10:30", endTime: "11:30" }),
      after: block({ date: MON, startTime: "13:00", endTime: "14:00" }),
      schedules: [s1],
      semester: SEMESTER,
      mutationSource: "manual",
      occurredAt: 6,
    });
    expect(noOverlap).toBeUndefined();
  });

  it("kiro 移动后仍与已批准 schedule 重叠 → 保留旧 Approval（§35）", () => {
    const fp = buildCourseOverlapScheduleFingerprint(s1);
    const r = reconcileStudyBlockCourseOverlapApprovals({
      before: block({ date: MON, startTime: "10:30", endTime: "11:30" }),
      after: block({ date: "2026-08-12", startTime: "10:30", endTime: "11:30" }), // 周三（s1 周一不生效）
      schedules: [s1],
      semester: SEMESTER,
      mutationSource: "kiro",
      occurredAt: 7,
    });
    expect(r).toBeUndefined(); // 新位置不再与 s1 重叠 → 清空
    const kept = reconcileStudyBlockCourseOverlapApprovals({
      before: block({ date: MON, startTime: "09:00", endTime: "10:00" }),
      after: block({ date: MON, startTime: "11:00", endTime: "11:30" }), // 仍与 s1 10-12 重叠
      schedules: [s1],
      semester: SEMESTER,
      mutationSource: "kiro",
      occurredAt: 8,
    });
    expect(kept).toBeUndefined(); // 无旧 Approval 可保留（未传 after.courseOverlapApprovals）
    const withOld = reconcileStudyBlockCourseOverlapApprovals({
      before: block({ date: MON, startTime: "10:30", endTime: "11:30" }),
      after: block({
        date: MON,
        startTime: "11:00",
        endTime: "11:30",
        courseOverlapApprovals: [{ scheduleId: "s1", scheduleFingerprint: fp, approvedAt: 1 }],
      }),
      schedules: [s1],
      semester: SEMESTER,
      mutationSource: "kiro",
      occurredAt: 9,
    });
    expect(withOld).toEqual([{ scheduleId: "s1", scheduleFingerprint: fp, approvedAt: 1 }]);
  });
});
