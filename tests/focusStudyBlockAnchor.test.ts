import { describe, it, expect } from "vitest";
import { resolveFocusStudyBlockAnchor } from "@/lib/timeline/focusStudyBlockAnchor";
import { FocusSession, StudyBlock } from "@/types";

/**
 * Workflow UX V10 —— Focus → StudyBlock Execution Anchor：
 * 唯一可信规则 = session.startedAt 的本地日期时间落在 block [startTime, endTime) 内
 * 且 assignmentId 精确匹配；paused 沿用原 startedAt（resume 不重锚）；
 * completed / 无 assignmentId / 无命中 → null；脏数据多候选 → deterministic。
 */

const mkSession = (over: Partial<FocusSession> = {}): FocusSession =>
  ({
    id: "f-1",
    plannedMinutes: 25,
    startedAt: new Date("2026-10-12T14:07:00").getTime(), // 周一 14:07
    accumulatedActiveMs: 0,
    status: "running",
    assignmentId: "a-1",
    source: "manual",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as FocusSession;

const mkBlock = (over: Partial<StudyBlock> & { id: string }): StudyBlock =>
  ({
    assignmentId: "a-1",
    title: `学习 ${over.id}`,
    date: "2026-10-12", // 与 startedAt 同日
    startTime: "14:00",
    endTime: "15:00",
    source: "manual",
    ...over,
  }) as unknown as StudyBlock;

describe("resolveFocusStudyBlockAnchor — eligibility", () => {
  it("running + assignment match + startedAt 在 block 内 → match", () => {
    const anchor = resolveFocusStudyBlockAnchor({
      session: mkSession(),
      studyBlocks: [mkBlock({ id: "b1" })],
    });
    expect(anchor?.id).toBe("b1");
  });

  it("paused → 仍以原 startedAt match（resume 不重锚）", () => {
    // 19:10 开始，暂停后 resume 把 activeStartedAt 推到 21:00——startedAt 不变
    const anchor = resolveFocusStudyBlockAnchor({
      session: mkSession({
        status: "paused",
        startedAt: new Date("2026-10-12T19:10:00").getTime(),
        activeStartedAt: new Date("2026-10-12T21:00:00").getTime(),
      }),
      studyBlocks: [
        mkBlock({ id: "evening", startTime: "19:00", endTime: "20:00" }),
        mkBlock({ id: "night", startTime: "21:00", endTime: "22:00" }),
      ],
    });
    expect(anchor?.id).toBe("evening");
  });

  it("completed → null", () => {
    expect(
      resolveFocusStudyBlockAnchor({
        session: mkSession({ status: "completed" }),
        studyBlocks: [mkBlock({ id: "b1" })],
      })
    ).toBeNull();
  });

  it("no assignmentId → null", () => {
    expect(
      resolveFocusStudyBlockAnchor({
        session: mkSession({ assignmentId: undefined, courseId: "c-1" }),
        studyBlocks: [mkBlock({ id: "b1" })],
      })
    ).toBeNull();
  });

  it("wrong assignment → null", () => {
    expect(
      resolveFocusStudyBlockAnchor({
        session: mkSession({ assignmentId: "a-other" }),
        studyBlocks: [mkBlock({ id: "b1", assignmentId: "a-1" })],
      })
    ).toBeNull();
  });

  it("session null → null", () => {
    expect(resolveFocusStudyBlockAnchor({ session: null, studyBlocks: [mkBlock({ id: "b1" })] })).toBeNull();
  });
});

describe("resolveFocusStudyBlockAnchor — 时间边界 [start, end)", () => {
  it("started exactly start（14:00）→ match（inclusive）", () => {
    const anchor = resolveFocusStudyBlockAnchor({
      session: mkSession({ startedAt: new Date("2026-10-12T14:00:00").getTime() }),
      studyBlocks: [mkBlock({ id: "b1" })],
    });
    expect(anchor?.id).toBe("b1");
  });

  it("started exactly end（15:00）→ null（exclusive）", () => {
    expect(
      resolveFocusStudyBlockAnchor({
        session: mkSession({ startedAt: new Date("2026-10-12T15:00:00").getTime() }),
        studyBlocks: [mkBlock({ id: "b1", startTime: "14:00", endTime: "15:00" })],
      })
    ).toBeNull();
  });

  it("日期不同 → null", () => {
    expect(
      resolveFocusStudyBlockAnchor({
        session: mkSession(),
        studyBlocks: [mkBlock({ id: "b1", date: "2026-10-13" })],
      })
    ).toBeNull();
  });
});

describe("resolveFocusStudyBlockAnchor — 多候选与防御", () => {
  it("同 Assignment 多个 block → 只返回包含 startedAt 的一个", () => {
    const anchor = resolveFocusStudyBlockAnchor({
      session: mkSession(), // 14:07
      studyBlocks: [
        mkBlock({ id: "morning", startTime: "09:00", endTime: "10:00" }),
        mkBlock({ id: "target", startTime: "14:00", endTime: "15:00" }),
        mkBlock({ id: "evening", startTime: "19:00", endTime: "20:00" }),
      ],
    });
    expect(anchor?.id).toBe("target");
  });

  it("没有任何时间命中 → null（不从 Assignment Workspace 手动开始时乱猜）", () => {
    expect(
      resolveFocusStudyBlockAnchor({
        session: mkSession({ startedAt: new Date("2026-10-12T17:30:00").getTime() }),
        studyBlocks: [
          mkBlock({ id: "a2", startTime: "14:00", endTime: "15:00" }),
          mkBlock({ id: "a3", startTime: "19:00", endTime: "20:00" }),
        ],
      })
    ).toBeNull();
  });

  it("多个脏数据候选（重叠 block）→ 按 date/startTime/endTime/id deterministic 取第一", () => {
    const anchor = resolveFocusStudyBlockAnchor({
      session: mkSession(), // 14:07 同时落在两个重叠 block
      studyBlocks: [
        mkBlock({ id: "z-late", startTime: "14:05", endTime: "16:00" }),
        mkBlock({ id: "a-early", startTime: "14:00", endTime: "15:30" }),
      ],
    });
    expect(anchor?.id).toBe("a-early");
  });

  it("block 被移动到其它时间后 → 不再 match（接受 anchor 失效，不伪造持久绑定）", () => {
    const blocks = [mkBlock({ id: "b1", startTime: "20:00", endTime: "21:00" })]; // 原 14:00–15:00 被移走
    expect(
      resolveFocusStudyBlockAnchor({ session: mkSession(), studyBlocks: blocks })
    ).toBeNull();
  });

  it("非法时间字符串的 block 不参与候选（防御性，不 throw）", () => {
    const anchor = resolveFocusStudyBlockAnchor({
      session: mkSession(),
      studyBlocks: [
        mkBlock({ id: "bad", startTime: "??", endTime: "15:00" }),
        mkBlock({ id: "good", startTime: "14:00", endTime: "15:00" }),
      ],
    });
    expect(anchor?.id).toBe("good");
  });
});
