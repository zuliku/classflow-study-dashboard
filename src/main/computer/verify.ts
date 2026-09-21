/**
 * Computer Use V2.1 — Action 后确定性验证（desktop_action.expect）。
 *
 * 目标：把"点击成功 = 任务完成"的模型自述，换成可机器验证的事实：
 * - elementAppears / textAppears：新 observation 中是否出现预期控件或文本
 * - elementDisappears：动作前的元素（通过 nativeRef 稳定身份）是否消失
 * - titleContains / windowAppears：窗口标题 / 前台应用是否变化
 *
 * 纯函数（Main 侧调用；不触碰 native / 不产生 IO）。
 */
import type { ClassFlowDesktopComputerElement } from "@/lib/desktop/types";

export interface ActionExpectation {
  elementAppears?: { role?: string; nameContains?: string; nameEquals?: string };
  /** 动作前 observation 的 elementId（Main 解析为稳定 nativeRef 后校验） */
  elementDisappears?: { elementId: string };
  titleContains?: string;
  windowAppears?: { appName?: string };
  textAppears?: string;
}

export interface VerificationCheck {
  check: string;
  passed: boolean;
  detail?: string;
}

export interface VerificationResult {
  passed: boolean;
  checks: VerificationCheck[];
}

export interface VerificationInput {
  expectation: ActionExpectation;
  newWindowTitle: string;
  newAppName: string;
  newElements: readonly Pick<ClassFlowDesktopComputerElement, "role" | "name">[];
  /** 动作前元素解析出的 nativeRef（elementDisappears 用）；null = 无法解析 */
  disappearedNativeRef: string | null;
  /** 新 observation 的全部 nativeRef（runtime-only，用于稳定身份比较） */
  newNativeRefs: ReadonlySet<string>;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function matchesElement(
  element: Pick<ClassFlowDesktopComputerElement, "role" | "name">,
  filter: { role?: string; nameContains?: string; nameEquals?: string }
): boolean {
  if (filter.role && normalize(element.role) !== normalize(filter.role)) return false;
  if (filter.nameEquals && normalize(element.name) !== normalize(filter.nameEquals)) return false;
  if (filter.nameContains && !normalize(element.name).includes(normalize(filter.nameContains))) return false;
  return true;
}

/** 求值 expect（未配置任何检查 → passed=true, checks=[]） */
export function evaluateActionExpectation(input: VerificationInput): VerificationResult {
  const { expectation } = input;
  const checks: VerificationCheck[] = [];

  if (expectation.elementAppears) {
    const filter = expectation.elementAppears;
    const matched = input.newElements.some((element) => matchesElement(element, filter));
    checks.push({
      check: "elementAppears",
      passed: matched,
      detail: matched
        ? undefined
        : `未找到 ${filter.role ?? "任意角色"}${filter.nameContains ? ` 名称包含「${filter.nameContains}」` : ""}${
            filter.nameEquals ? ` 名称等于「${filter.nameEquals}」` : ""
          } 的元素`,
    });
  }

  if (expectation.elementDisappears) {
    const ref = input.disappearedNativeRef;
    const gone = ref !== null && ref !== "" && !input.newNativeRefs.has(ref);
    checks.push({
      check: "elementDisappears",
      passed: gone,
      detail: gone ? undefined : "目标元素仍然存在（或无法解析该元素身份）",
    });
  }

  if (expectation.titleContains) {
    const passed = normalize(input.newWindowTitle).includes(normalize(expectation.titleContains));
    checks.push({
      check: "titleContains",
      passed,
      detail: passed ? undefined : `当前标题「${input.newWindowTitle}」不包含「${expectation.titleContains}」`,
    });
  }

  if (expectation.windowAppears) {
    const appName = expectation.windowAppears.appName;
    const passed = appName
      ? normalize(input.newAppName).includes(normalize(appName))
      : input.newAppName.length > 0;
    checks.push({
      check: "windowAppears",
      passed,
      detail: passed ? undefined : `前台应用「${input.newAppName}」不匹配`,
    });
  }

  if (expectation.textAppears) {
    const needle = normalize(expectation.textAppears);
    const matched = input.newElements.some((element) => normalize(element.name).includes(needle));
    checks.push({
      check: "textAppears",
      passed: matched,
      detail: matched ? undefined : `界面文本中未出现「${expectation.textAppears}」`,
    });
  }

  return { passed: checks.every((check) => check.passed), checks };
}

/** 是否配置了任何可验证检查 */
export function hasVerifiableExpectation(expectation: ActionExpectation | undefined): boolean {
  if (!expectation) return false;
  return Boolean(
    expectation.elementAppears ||
      expectation.elementDisappears ||
      expectation.titleContains ||
      expectation.windowAppears ||
      expectation.textAppears
  );
}
