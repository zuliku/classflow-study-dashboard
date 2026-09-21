/**
 * Computer Use — 模型可见 Observation 摘要（renderer 侧）。
 *
 * 截图 dataUrl 只保留 evidence metadata（尺寸 / 字节 / 时间），
 * 原始像素绝不进入模型 Tool Output（避免无界 token 与内存膨胀）。
 */
import type {
  ClassFlowDesktopComputerAppProfileInfo,
  ClassFlowDesktopComputerObservation,
} from "@/lib/desktop/types";

export interface ModelObservationSummary {
  observationId: string;
  target: "active-window" | "screen";
  appName: string;
  windowTitle: string;
  windowId: string | null;
  viewport: { width: number; height: number };
  windows: ClassFlowDesktopComputerObservation["windows"];
  windowsTruncated: boolean;
  elements: ClassFlowDesktopComputerObservation["elements"];
  elementCount: number;
  elementsTruncated: boolean;
  screenshot:
    | {
        captured: true;
        mimeType: string;
        width: number;
        height: number;
        bytes: number;
        capturedAt: string;
      }
    | { captured: false };
  warnings: string[];
  uiTreeRevision: number;
  capturedAt: string;
  /** V2.4：应用画像（blocked = 动作永不放行） */
  appProfile: ClassFlowDesktopComputerAppProfileInfo | null;
}

/** Observation → 模型安全摘要（无 dataUrl / native 标识） */
export function summarizeObservation(
  observation: ClassFlowDesktopComputerObservation
): ModelObservationSummary {
  return {
    observationId: observation.observationId,
    target: observation.target,
    appName: observation.appName,
    windowTitle: observation.windowTitle,
    windowId: observation.windowId,
    viewport: observation.viewport,
    windows: observation.windows,
    windowsTruncated: observation.windowsTruncated,
    elements: observation.elements,
    elementCount: observation.elementCount,
    elementsTruncated: observation.elementsTruncated,
    screenshot: observation.screenshot
      ? {
          captured: true,
          mimeType: observation.screenshot.mimeType,
          width: observation.screenshot.width,
          height: observation.screenshot.height,
          bytes: observation.screenshot.bytes,
          capturedAt: observation.screenshot.capturedAt,
        }
      : { captured: false },
    warnings: observation.warnings,
    uiTreeRevision: observation.uiTreeRevision,
    capturedAt: observation.capturedAt,
    appProfile: observation.appProfile ?? null,
  };
}
