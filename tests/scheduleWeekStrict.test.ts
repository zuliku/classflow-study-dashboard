import { describe, it, expect } from "vitest";
import { parseWeekExpressionStrict, parseWeekExpression } from "@/lib/scheduleWeekExpression";

describe("parseWeekExpressionStrict — 全量消费校验（Vision 课表导入）", () => {
  it.each([
    "1-16",
    "1-16周",
    "第1-16周",
    "1-5,7-17",
    "1-5，7-17",
    "1-4,6-7,9-17",
    "3-7,9",
    "1,3,5,7",
    "单周",
    "双周",
    "1-16单周",
    "1-16双周",
  ])("合法：%s", (expr) => {
    expect(parseWeekExpressionStrict(expr)).not.toBeNull();
  });

  it.each(["1-5,7-?", "1--5", "abc", "1-5,test", "0-5", "5-2", "", "   ", "第3-2周"])(
    "非法：%s → null",
    (expr) => {
      expect(parseWeekExpressionStrict(expr)).toBeNull();
    }
  );

  it("strict 结果与 lenient 在合法输入上一致", () => {
    expect(parseWeekExpressionStrict("1-5,7-17")?.canonical).toBe(
      parseWeekExpression("1-5,7-17")?.canonical
    );
    expect(parseWeekExpressionStrict("单周")?.parity).toBe("odd");
  });

  it("非法输入 strict=null 但 lenient 可能部分消费（历史兼容）", () => {
    // "1-5,7-?" lenient 只保留 1-5；strict 拒绝
    expect(parseWeekExpressionStrict("1-5,7-?")).toBeNull();
    expect(parseWeekExpression("1-5,7-?")?.ranges).toEqual([{ start: 1, end: 5 }]);
  });
});
