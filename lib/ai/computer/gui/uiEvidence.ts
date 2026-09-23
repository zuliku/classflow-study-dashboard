/**
 * Computer Use P5 — Desktop Observation UI Evidence（ephemeral，UI-only）。
 *
 * 用途：把「Agent 已经真实执行过的 observe_desktop / desktop_action 后自动 re-observe」
 * 产生的截图证据交给 renderer UI（最近画面）。绝不进入模型 / Tool Output / 历史 / Audit。
 *
 * 数据面最小化：
 * - 只含 bounded screenshot 与逻辑展示字段（sessionId / appName / windowTitle / 尺寸 / 时间）；
 * - 绝不携带 elements / elementId / observationId / windowId / PID / HWND / native path /
 *   clipboard / typed text。
 */
export interface DesktopObservationUiEvidence {
  /** opaque Desktop Control session id（cs-…）——Preview 必须与之精确绑定 */
  sessionId: string;
  /** bounded JPEG dataUrl（Main 侧已限制 1280×800 / 1.2MB） */
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  capturedAt: string;
  appName: string;
  windowTitle: string;
  /** 受保护应用：evidence 不会发布（保留字段以便调用方显式判定） */
  appProfileBlocked: boolean;
}

/** 从真实 observation 构造 UI evidence（只取安全字段；调用方负责 blocked 判定） */
export function buildDesktopObservationUiEvidence(input: {
  sessionId: string;
  screenshot: { dataUrl: string; mimeType: string; width: number; height: number; capturedAt: string };
  appName: string;
  windowTitle: string;
  appProfileBlocked: boolean;
}): DesktopObservationUiEvidence {
  return {
    sessionId: input.sessionId,
    dataUrl: input.screenshot.dataUrl,
    mimeType: input.screenshot.mimeType,
    width: input.screenshot.width,
    height: input.screenshot.height,
    capturedAt: input.screenshot.capturedAt,
    appName: input.appName,
    windowTitle: input.windowTitle,
    appProfileBlocked: input.appProfileBlocked,
  };
}
