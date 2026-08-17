import { describe, it, expect } from "vitest";
import {
  isCourseEntityInteractive,
  resolveMaterialUploadTarget,
} from "@/lib/courseDetailOwnership";

describe("isCourseEntityInteractive", () => {
  it("当前选中 = 已 settle 的 displayed → interactive", () => {
    expect(isCourseEntityInteractive("c1", "c1", "in")).toBe(true);
  });

  it("A→B swap-out：displayed 仍是 A、选中已是 B → non-interactive", () => {
    expect(isCourseEntityInteractive("c2", "c1", "out")).toBe(false);
  });

  it("swap-out 即使 displayed === current 也未 settle → non-interactive", () => {
    expect(isCourseEntityInteractive("c1", "c1", "out")).toBe(false);
  });

  it("close presence（currentId=null，displayed 保留供退场）→ non-interactive", () => {
    expect(isCourseEntityInteractive(null, "c1", "in")).toBe(false);
  });

  it("reduced motion：displayedId 立即 = currentId + phase=in → 立即 interactive", () => {
    expect(isCourseEntityInteractive("c2", "c2", "in")).toBe(true);
  });

  it("从未打开（都 null）→ non-interactive", () => {
    expect(isCourseEntityInteractive(null, null, "in")).toBe(false);
  });
});

describe("resolveMaterialUploadTarget", () => {
  it("captured 课程优先：点击上传时 capture A，即使 displayed 已变 B → 仍 A", () => {
    expect(resolveMaterialUploadTarget("cA", "cB")).toBe("cA");
  });

  it("无 capture → 回落当前 displayed 实体", () => {
    expect(resolveMaterialUploadTarget(null, "cB")).toBe("cB");
  });

  it("两者皆空 → null（不上传）", () => {
    expect(resolveMaterialUploadTarget(null, null)).toBeNull();
  });

  it("capture 与 displayed 相同 → 该课程", () => {
    expect(resolveMaterialUploadTarget("cA", "cA")).toBe("cA");
  });
});
