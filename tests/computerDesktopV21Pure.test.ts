// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  ELEMENT_SEARCH_MAX_RESULTS,
  scoreElementMatch,
  searchObservationElements,
} from "@/lib/ai/computer/desktop/elementSearch";
import {
  VISION_ELEMENT_MIN_IOU,
  associateVisionCandidates,
  intersectionOverUnion,
  regionToPixels,
} from "@/lib/ai/computer/gui/visionMatch";
import { evaluateActionExpectation, hasVerifiableExpectation } from "@/src/main/computer/verify";

const ELEMENTS = [
  { elementId: "el-1", role: "Edit", name: "搜索", enabled: true, focused: true },
  { elementId: "el-2", role: "Button", name: "搜索按钮", enabled: true, focused: false },
  { elementId: "el-3", role: "Button", name: "发送", enabled: false, focused: false },
  { elementId: "el-4", role: "ListItem", name: "ClassFlow 官网 - 大学生课表", enabled: true, focused: false },
];

describe("elementSearch — 确定性打分", () => {
  it("名称精确 > 前缀 > 包含 > 角色匹配", () => {
    const exact = scoreElementMatch(ELEMENTS[0], "搜索");
    const prefix = scoreElementMatch(ELEMENTS[1], "搜索");
    const role = scoreElementMatch({ elementId: "x", role: "Button", name: "无关", enabled: true, focused: false }, "button");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(role);
  });

  it("enabled / focused 轻加权", () => {
    const enabled = scoreElementMatch(ELEMENTS[0], "搜索");
    const disabled = scoreElementMatch({ ...ELEMENTS[0], enabled: false, focused: false }, "搜索");
    expect(enabled).toBeGreaterThan(disabled);
  });

  it("检索排序稳定 + 上限", () => {
    const matches = searchObservationElements(ELEMENTS, "搜索");
    expect(matches[0].elementId).toBe("el-1"); // 精确匹配优先
    expect(matches.some((m) => m.elementId === "el-2")).toBe(true);
    const many = searchObservationElements(
      Array.from({ length: 30 }, (_, i) => ({
        elementId: `el-${i + 1}`,
        role: "Button",
        name: `保存 ${i}`,
        enabled: true,
        focused: false,
      })),
      "保存",
      50
    );
    expect(many.length).toBeLessThanOrEqual(ELEMENT_SEARCH_MAX_RESULTS);
  });

  it("零命中 / 空查询 → 空", () => {
    expect(searchObservationElements(ELEMENTS, "不存在的控件")).toEqual([]);
    expect(searchObservationElements(ELEMENTS, "   ")).toEqual([]);
  });

  it("多词查询（全 token 命中）", () => {
    const matches = searchObservationElements(ELEMENTS, "ClassFlow 官网");
    expect(matches[0]?.elementId).toBe("el-4");
  });
});

describe("visionMatch — 候选 ↔ UIA 元素关联", () => {
  const viewport = { width: 1000, height: 1000 };
  const element = {
    elementId: "el-1",
    role: "Button",
    name: "开始",
    bounds: { x: 100, y: 200, width: 200, height: 100 },
  };

  it("regionToPixels 按 viewport 换算", () => {
    expect(
      regionToPixels({ label: "x", confidence: 1, bounds: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 } }, viewport)
    ).toEqual({ x: 100, y: 200, width: 200, height: 100 });
  });

  it("IoU 计算正确", () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    expect(intersectionOverUnion(a, a)).toBe(1);
    expect(intersectionOverUnion(a, { x: 200, y: 200, width: 10, height: 10 })).toBe(0);
    expect(intersectionOverUnion(a, { x: 50, y: 0, width: 100, height: 100 })).toBeCloseTo(1 / 3, 5);
  });

  it("IoU ≥ 阈值 → 关联 elementId", () => {
    const [matched] = associateVisionCandidates(
      [{ label: "开始按钮", confidence: 0.9, bounds: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 } }],
      [element],
      viewport
    );
    expect(matched.elementId).toBe("el-1");
    expect(matched.role).toBe("Button");
    expect(matched.iou).toBeGreaterThanOrEqual(VISION_ELEMENT_MIN_IOU);
  });

  it("候选中心在元素内（低 IoU）也关联", () => {
    const [matched] = associateVisionCandidates(
      [{ label: "小按钮", confidence: 0.8, bounds: { x: 0.15, y: 0.25, width: 0.02, height: 0.02 } }],
      [element],
      viewport
    );
    expect(matched.elementId).toBe("el-1");
  });

  it("无重叠 → 不关联（保持坐标回退）", () => {
    const [matched] = associateVisionCandidates(
      [{ label: "别处", confidence: 0.8, bounds: { x: 0.8, y: 0.8, width: 0.05, height: 0.05 } }],
      [element],
      viewport
    );
    expect(matched.elementId).toBeUndefined();
  });
});

describe("verify — desktop_action.expect 求值", () => {
  const newElements = [
    { role: "ListItem", name: "报告.docx 已发送" },
    { role: "Button", name: "发送" },
  ];

  it("未配置检查 → passed=true, checks=[]", () => {
    const result = evaluateActionExpectation({
      expectation: {},
      newWindowTitle: "",
      newAppName: "",
      newElements: [],
      disappearedNativeRef: null,
      newNativeRefs: new Set(),
    });
    expect(result).toEqual({ passed: true, checks: [] });
    expect(hasVerifiableExpectation({})).toBe(false);
    expect(hasVerifiableExpectation(undefined)).toBe(false);
    expect(hasVerifiableExpectation({ textAppears: "x" })).toBe(true);
  });

  it("textAppears / elementAppears / titleContains 通过", () => {
    const result = evaluateActionExpectation({
      expectation: {
        textAppears: "已发送",
        elementAppears: { role: "Button", nameContains: "发送" },
        titleContains: "文件传输助手",
      },
      newWindowTitle: "文件传输助手",
      newAppName: "wechat",
      newElements,
      disappearedNativeRef: null,
      newNativeRefs: new Set(),
    });
    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(3);
  });

  it("elementDisappears 用稳定身份（nativeRef）判断", () => {
    const passed = evaluateActionExpectation({
      expectation: { elementDisappears: { elementId: "el-9" } },
      newWindowTitle: "",
      newAppName: "",
      newElements: [],
      disappearedNativeRef: "42.1002",
      newNativeRefs: new Set(["42.1001"]),
    });
    expect(passed.passed).toBe(true);

    const failed = evaluateActionExpectation({
      expectation: { elementDisappears: { elementId: "el-9" } },
      newWindowTitle: "",
      newAppName: "",
      newElements: [],
      disappearedNativeRef: "42.1002",
      newNativeRefs: new Set(["42.1001", "42.1002"]),
    });
    expect(failed.passed).toBe(false);
    expect(failed.checks[0].check).toBe("elementDisappears");
  });

  it("检查失败 → passed=false + detail（模型必须重新观察）", () => {
    const result = evaluateActionExpectation({
      expectation: { elementAppears: { nameContains: "保存成功" } },
      newWindowTitle: "",
      newAppName: "",
      newElements,
      disappearedNativeRef: null,
      newNativeRefs: new Set(),
    });
    expect(result.passed).toBe(false);
    expect(result.checks[0].detail).toContain("保存成功");
  });
});
