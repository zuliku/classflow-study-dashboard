import { describe, it, expect } from "vitest";
import {
  applyMentionPick,
  buildMentionOptions,
  filterMentionOptions,
  MENTION_MENU_LIMIT,
  moveMentionIndex,
  parseMentionQuery,
} from "@/lib/ai/context/mentionMenu";
import { getKiroContextGroups } from "@/lib/ai/context/options";

const courses = [
  { id: "c1", name: "高等数学", teacher: "王老师", materials: [{ id: "m1", title: "讲义一", type: "pdf" }] },
];
const assignments = [{ id: "a1", title: "期中作业", courseId: "c1" }];
const projects = [{ id: "p1", title: "低碳课题", courseId: "c1" }];

describe("parseMentionQuery（输入尾部 @query）", () => {
  it("尾部 @xxx → query；无 @ → null", () => {
    expect(parseMentionQuery("@")).toBe("");
    expect(parseMentionQuery("帮我看下@高数")).toBe("高数");
    expect(parseMentionQuery("@本周")).toBe("本周");
    expect(parseMentionQuery("你好")).toBeNull();
    expect(parseMentionQuery("")).toBeNull();
  });

  it("尾随空格 = 已完成 → null（不再弹出，与 slash 同构）", () => {
    expect(parseMentionQuery("@高数 ")).toBeNull();
    expect(parseMentionQuery("看 @讲义一 ")).toBeNull();
  });

  it("邮箱不误触（@ 前是 ASCII 词字符视为邮箱；CJK 前无空格正常放行）", () => {
    expect(parseMentionQuery("发到foo@bar")).toBeNull();
    expect(parseMentionQuery("联系 foo@bar")).toBeNull();
    expect(parseMentionQuery("联系 foo @bar")).toBe("bar");
    expect(parseMentionQuery("帮我看下@高数")).toBe("高数");
  });

  it("中间的 @ 不触发（只看输入尾部）", () => {
    expect(parseMentionQuery("@高数 明天")).toBeNull();
  });
});

describe("getKiroContextGroups（ListView 与 @ 同源）", () => {
  it("五组齐全 + 上限 + 空组过滤（时间范围为常驻组）", () => {
    const groups = getKiroContextGroups(courses, assignments, projects);
    expect(groups.map((g) => g.title)).toEqual(["课程", "任务", "时间范围", "小组项目", "课程资料"]);
    expect(groups[0].items[0]).toMatchObject({ key: "manual-course-c1", kind: "course" });
    // 空 Store 只剩常驻时间范围组（与 ListView 历史行为一致）
    expect(getKiroContextGroups([], [], []).map((g) => g.title)).toEqual(["时间范围"]);
  });
});

describe("filterMentionOptions（展平 + 子串过滤 + 截断）", () => {
  it("空 query → 按组序取前 N", () => {
    const options = filterMentionOptions(getKiroContextGroups(courses, assignments, projects), "");
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThanOrEqual(MENTION_MENU_LIMIT);
    expect(options[0].group).toBe("课程");
  });

  it("子串匹配 label（大小写不敏感）", () => {
    const options = filterMentionOptions(getKiroContextGroups(courses, assignments, projects), "高等");
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => o.label.toLowerCase().includes("高等"))).toBe(true);
  });

  it("无命中 → 空（调用方关闭菜单）", () => {
    expect(filterMentionOptions(getKiroContextGroups(courses, assignments, projects), "不存在的")).toEqual([]);
  });
});

describe("buildMentionOptions（Store 直达）", () => {
  it("与分组展平一致", () => {
    expect(buildMentionOptions(courses, assignments, projects, "")).toEqual(
      filterMentionOptions(getKiroContextGroups(courses, assignments, projects), "")
    );
  });
});

describe("moveMentionIndex（循环导航）", () => {
  it("上下循环 + 空列表归零", () => {
    expect(moveMentionIndex(0, 1, 3)).toBe(1);
    expect(moveMentionIndex(2, 1, 3)).toBe(0);
    expect(moveMentionIndex(0, -1, 3)).toBe(2);
    expect(moveMentionIndex(0, 1, 0)).toBe(0);
  });
});

describe("applyMentionPick（尾部回填）", () => {
  it("@query → @label + 空格", () => {
    expect(applyMentionPick("@高", "高等数学（王老师）")).toBe("@高等数学（王老师） ");
    expect(applyMentionPick("帮我看下@讲", "讲义一 · 高等数学")).toBe("帮我看下@讲义一 · 高等数学 ");
  });
});
