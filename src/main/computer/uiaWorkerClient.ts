/**
 * Computer Use V2.2 — UIA Worker 客户端（带一次性脚本 fallback）。
 *
 * 每个方法：
 * 1. 优先走常驻 worker（元素缓存 + 无冷启动）
 * 2. worker 基础设施失败（启动失败 / 超时 / 崩溃）→ 回退一次性 PowerShell 脚本（既有行为）
 * 3. 业务失败（element-missing / bounds-changed / 未找到）→ 原样返回，绝不 fallback 重试
 *
 * 通过 createUiaWorkerClient 注入依赖，使 fallback 契约可在 CI（无 PowerShell）验证。
 */
import type { NativeWindowRecord } from "./windows";
import { listNativeWindows, parseWindowEnumeration, activateNativeWindow } from "./windows";
import { inspectNativeUiTree, parseUiElement, parseUiTree, type NativeUiElement } from "./uia";
import {
  runNativeGuiAction,
  parseGuiActionResult,
  type NativeGuiActionConfig,
  type NativeGuiActionResult,
} from "./guiAction";
import { getUiaWorker, UiaWorkerUnavailableError, type UiaWorker } from "./uiaWorker";

export interface WorkerWindowsRaw {
  foreground?: unknown;
  windows?: unknown;
}

export type UiaWorkerOp = "ping" | "windows" | "inspect" | "resolve" | "act" | "activate";

export interface UiaWorkerClientDeps {
  request: <T>(op: UiaWorkerOp, payload?: Record<string, unknown>, timeoutMs?: number) => Promise<T>;
  fallback: {
    listWindows: () => Promise<NativeWindowRecord[]>;
    inspectUiTree: (hwnd: number) => Promise<{ elements: NativeUiElement[]; truncated: boolean }>;
    resolveUiElement: (hwnd: number, nativeRef: string) => Promise<NativeUiElement | null>;
    runGuiAction: (config: NativeGuiActionConfig) => Promise<NativeGuiActionResult>;
    activateWindow: (hwnd: number) => Promise<boolean>;
  };
}

export function createUiaWorkerClient(deps: UiaWorkerClientDeps) {
  /** worker 基础设施失败才 fallback；业务错误原样抛出 */
  async function withFallback<T>(run: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof UiaWorkerUnavailableError)) throw err;
      return fallback();
    }
  }

  return {
    listNativeWindows: (): Promise<NativeWindowRecord[]> =>
      withFallback(async () => {
        const raw = await deps.request<WorkerWindowsRaw>("windows");
        return parseWindowEnumeration(raw);
      }, deps.fallback.listWindows),

    inspectNativeUiTree: (hwnd: number): Promise<{ elements: NativeUiElement[]; truncated: boolean }> =>
      withFallback(async () => {
        const raw = await deps.request<unknown>("inspect", { hwnd });
        return parseUiTree(raw);
      }, () => deps.fallback.inspectUiTree(hwnd)),

    resolveNativeUiElement: (hwnd: number, nativeRef: string): Promise<NativeUiElement | null> =>
      withFallback(async () => {
        const raw = await deps.request<{ element?: unknown }>("resolve", { hwnd, nativeRef });
        return parseUiElement(raw?.element ?? null);
      }, () => deps.fallback.resolveUiElement(hwnd, nativeRef)),

    runNativeGuiAction: (config: NativeGuiActionConfig): Promise<NativeGuiActionResult> =>
      withFallback(async () => {
        const raw = await deps.request<unknown>("act", config as unknown as Record<string, unknown>);
        return parseGuiActionResult(raw);
      }, () => deps.fallback.runGuiAction(config)),

    activateNativeWindow: (hwnd: number): Promise<boolean> =>
      withFallback(async () => {
        const raw = await deps.request<{ active?: unknown }>("activate", { hwnd });
        return raw?.active === true;
      }, () => deps.fallback.activateWindow(hwnd)),
  };
}

/** Main 默认客户端（常驻 worker + 一次性脚本 fallback） */
const defaultClient = createUiaWorkerClient({
  request: (op, payload, timeoutMs) =>
    (getUiaWorker() as UiaWorker).request(op, payload ?? {}, timeoutMs) as never,
  fallback: {
    listWindows: listNativeWindows,
    inspectUiTree: inspectNativeUiTree,
    resolveUiElement: async (hwnd, nativeRef) => {
      const tree = await inspectNativeUiTree(hwnd);
      return tree.elements.find((element) => element.nativeRef === nativeRef) ?? null;
    },
    runGuiAction: runNativeGuiAction,
    activateWindow: activateNativeWindow,
  },
});

export const workerListNativeWindows = defaultClient.listNativeWindows;
export const workerInspectNativeUiTree = defaultClient.inspectNativeUiTree;
export const workerResolveNativeUiElement = defaultClient.resolveNativeUiElement;
export const workerRunNativeGuiAction = defaultClient.runNativeGuiAction;
export const workerActivateNativeWindow = defaultClient.activateNativeWindow;
