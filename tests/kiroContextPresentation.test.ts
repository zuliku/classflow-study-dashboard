import { describe, it, expect } from "vitest";
import { KiroContextRef } from "@/lib/ai/context/types";
import {
  formatKiroContextDisplayLabel,
  getKiroContextVisualRole,
  splitKiroContextsForDisplay,
} from "@/lib/ai/context/presentation";
import { resolveContextRefs } from "@/lib/ai/context/contextSelection";

function ref(key: string, kind: KiroContextRef["kind"], source: KiroContextRef["source"], label = key): KiroContextRef {
  return { key, kind, entityId: key, label, source };
}

const autoWeek = () => ref("auto-week-current", "week", "auto", "时间范围 · 本周（第 1 周）");
const autoCourse = () => ref("auto-course-c1", "course", "auto", "当前课程 · 微观经济学");
const manual1 = () => ref("m1", "course", "manual", "计量经济学");
const manual2 = () => ref("m2", "assignment", "manual", "期末论文");
const manual3 = () => ref("m3", "course", "manual", "数据库实验");
const entry1 = () => ref("e1", "assignment", "entry", "进程调度实验报告");

describe("getKiroContextVisualRole", () => {
  it("auto → ambient；manual / entry → manual（entry 是显式意图）", () => {
    expect(getKiroContextVisualRole(autoWeek())).toBe("ambient");
    expect(getKiroContextVisualRole(autoCourse())).toBe("ambient");
    expect(getKiroContextVisualRole(manual1())).toBe("manual");
    expect(getKiroContextVisualRole(entry1())).toBe("manual");
  });
});

describe("splitKiroContextsForDisplay（产品决策：自动永不进胶囊，只进模型）", () => {
  it("auto 再多也不展示（Desktop/compact 一致），manual 按上限展示", () => {
    const desktop = splitKiroContextsForDisplay([autoWeek(), autoCourse(), manual1()], false);
    expect(desktop.visibleAmbient).toEqual([]);
    expect(desktop.visibleManual.map((c) => c.key)).toEqual(["m1"]);
    expect(desktop.overflow).toHaveLength(0);

    const compact = splitKiroContextsForDisplay([autoWeek(), manual1(), manual2()], true);
    expect(compact.visibleAmbient).toEqual([]);
    expect(compact.visibleManual.map((c) => c.key)).toEqual(["m1"]);
    expect(compact.overflow.map((c) => c.key)).toEqual(["m2"]);
  });

  it("只有 manual → 按上限展示（Desktop 2，余进 +N）", () => {
    const { visibleAmbient, visibleManual, overflow } = splitKiroContextsForDisplay(
      [manual1(), manual2(), manual3()],
      false
    );
    expect(visibleAmbient).toHaveLength(0);
    expect(visibleManual).toHaveLength(2);
    expect(overflow).toHaveLength(1);
  });

  it("空列表 → 全空", () => {
    const r = splitKiroContextsForDisplay([], false);
    expect(r.visibleAmbient).toEqual([]);
    expect(r.visibleManual).toEqual([]);
    expect(r.overflow).toEqual([]);
  });
});

describe("formatKiroContextDisplayLabel", () => {
  it("week：时间范围 · 本周（第 1 周）→ 本周 · 第 1 周", () => {
    expect(formatKiroContextDisplayLabel(autoWeek())).toBe("本周 · 第 1 周");
  });

  it("week：入口样式「时间范围 · 第 2 周」（当前周）→ 本周 · 第 2 周", () => {
    expect(formatKiroContextDisplayLabel(ref("e", "week", "entry", "时间范围 · 第 2 周"))).toBe(
      "本周 · 第 2 周"
    );
  });

  it("week：无括号形式 → 去掉「时间范围 ·」前缀", () => {
    expect(formatKiroContextDisplayLabel(ref("w", "week", "auto", "时间范围 · 本周"))).toBe("本周");
  });

  it("无法识别 → 原样保留", () => {
    expect(formatKiroContextDisplayLabel(manual1())).toBe("计量经济学");
    expect(formatKiroContextDisplayLabel(ref("w", "week", "auto", "自定义周文案"))).toBe("自定义周文案");
  });
});

describe("autoContextEnabled 数据流（Provider 在 autoRefs 组合层过滤 → resolveContextRefs 层）", () => {
  const auto = ref("auto-week-current", "week", "auto", "时间范围 · 本周（第 1 周）");
  const manual = manual1();
  const entry = entry1();

  it("开启（effectiveAutoRefs 非空）：auto + entry + manual 都在", () => {
    const r = resolveContextRefs([auto], [manual], [entry], []);
    expect(r.map((x) => x.key)).toEqual(["auto-week-current", "e1", "m1"]);
  });

  it("关闭（effectiveAutoRefs=[]）：manual + entry（显式意图）保留，auto 移除", () => {
    const r = resolveContextRefs([], [manual], [entry], []);
    expect(r.map((x) => x.key)).toEqual(["e1", "m1"]);
    expect(r.some((x) => x.source === "auto")).toBe(false);
  });

  it("重新开启仍尊重 suppressedAutoKeys（会话级手动 × 不清空）", () => {
    const r = resolveContextRefs([auto], [manual], [entry], ["auto-week-current"]);
    expect(r.map((x) => x.key)).toEqual(["e1", "m1"]);
  });
});
