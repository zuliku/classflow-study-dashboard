/**
 * ClassFlow Desktop Bridge —— Web-facing Native Filesystem Contract（V1）。
 *
 * 本模块只定义「未来 Desktop Runtime 注入 Web 的稳定接口」：
 * - 不依赖 Electron / Tauri / Node（runtime-agnostic）
 * - 不传 / 不返回任何 absolute path（renderer 与 model 永远只见 grantId + relative path）
 * - 全部参数 structured-clone friendly（无 handle / DOM node / callback）
 *
 * 完整迁移契约见 docs/desktop-filesystem-bridge.md。
 */

/** 当前 Web 只支持 Bridge V1（版本协商；未知版本一律视为不可用，不做猜测兼容） */
export const CLASSFLOW_DESKTOP_BRIDGE_VERSION = 1 as const;

export type ClassFlowDesktopPlatform = "windows" | "macos" | "linux" | "unknown";

export type ClassFlowDesktopGrantAccess = "read-only" | "read-write";

/** Native grant 生命周期状态（runtime facts；不持久化到 Workspace metadata） */
export type DesktopGrantStatus = "granted" | "missing" | "denied" | "unavailable";

/** Desktop Bridge 结构化错误（绝不向 Web throw raw OS error / stack / absolute path） */
export type DesktopBridgeErrorCode =
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "PERMISSION_DENIED"
  | "DIRECTORY_NOT_EMPTY"
  | "INVALID_OPERATION"
  | "IO_ERROR";

export interface DesktopBridgeError {
  code: DesktopBridgeErrorCode;
  /** 可选：用户可读短说明（禁止包含 native path / stack） */
  message?: string;
}

/** Native 目录授权结果（grantId 是 opaque token；Web 永远不知道其背后的真实路径） */
export interface ClassFlowDesktopGrant {
  grantId: string;
  displayName: string;
  access: ClassFlowDesktopGrantAccess;
}

export interface ClassFlowDesktopFilesystemBridgeV1 {
  /** 用户手势授权的目录 picker（用户取消 → null；禁止返回 absolute path） */
  pickDirectory(input: {
    access: ClassFlowDesktopGrantAccess;
  }): Promise<ClassFlowDesktopGrant | null>;

  /** 查询授权状态（不触发任何系统权限 UI） */
  getGrantStatus(input: { grantId: string }): Promise<{
    status: Exclude<DesktopGrantStatus, "unavailable">;
  }>;

  /** 忘记授权映射（绝不删除真实目录内容） */
  forgetGrant(input: { grantId: string }): Promise<void>;

  list(input: { grantId: string; path: string }): Promise<
    Array<{ name: string; kind: "file" | "directory"; size: number }>
  >;

  stat(input: { grantId: string; path: string }): Promise<{
    kind: "file" | "directory";
    size: number;
    type?: string;
  } | null>;

  readText(input: { grantId: string; path: string }): Promise<string>;

  readBytes(input: { grantId: string; path: string }): Promise<Uint8Array>;

  /** bounded text prefix（实现必须按 byte prefix 读取；绝不先读全文再截断） */
  readTextPrefix(input: {
    grantId: string;
    path: string;
    maxBytes: number;
  }): Promise<{ text: string; truncated: boolean }>;

  createDirectory(input: { grantId: string; path: string }): Promise<"created" | "exists">;

  writeText(input: {
    grantId: string;
    path: string;
    content: string;
    type?: string;
  }): Promise<void>;

  writeBytes(input: {
    grantId: string;
    path: string;
    content: Uint8Array;
    type?: string;
  }): Promise<void>;

  remove(input: { grantId: string; path: string; kind: "file" | "directory" }): Promise<void>;

  move(input: { grantId: string; from: string; to: string }): Promise<void>;
}

export interface ClassFlowDesktopChannelsBridge {
  list: () => Promise<{ channels: unknown[] }>;
  addQQ: (input: unknown) => Promise<{ channel: unknown }>;
  update: (input: unknown) => Promise<{ channel: unknown }>;
  setEnabled: (input: unknown) => Promise<{ ok: boolean }>;
  connect: (input: unknown) => Promise<{ ok: boolean }>;
  disconnect: (input: unknown) => Promise<{ ok: boolean }>;
  test: (input: unknown) => Promise<{ ok: boolean; error?: string }>;
  remove: (input: unknown) => Promise<{ ok: boolean }>;
  prepareReply: (input: unknown) => Promise<{ approvalId: string; expiresAt: number; preview: { channel: string; conversationType: string; text: string } }>;
  confirmReply: (input: unknown) => Promise<{ ok: boolean; platformMessageId?: string }>;
  cancelReply: (input: unknown) => Promise<{ ok: boolean }>;
  canReply: (input: unknown) => Promise<{ ok: boolean; reason?: string }>;
}

export interface ClassFlowDesktopInboxBridge {
  subscribeExternalItem: (callback: (envelope: unknown) => void) => () => void;
  rendererReady: () => Promise<{ ok: boolean }>;
  ack: (deliveryId: string) => Promise<{ ok: boolean }>;
}

export interface ClassFlowDesktopBridgeV1 {
  version: typeof CLASSFLOW_DESKTOP_BRIDGE_VERSION;
  platform: ClassFlowDesktopPlatform;
  filesystem: ClassFlowDesktopFilesystemBridgeV1;
  /**
   * Optional Capability（V1.1）：Terminal Bridge。
   * Desktop Runtime 可以只有 filesystem（filesystem-only → 依旧 valid；terminal 不可用）。
   * Terminal 自己拥有 version（1=V1 Command Runner；2=Streaming/Lifecycle/stdin/Session）；
   * 版本协商独立于 Bridge version。
   */
  terminal?: ClassFlowDesktopTerminalBridge;
  /**
   * Optional Capability（Computer Use Phase 1）：Desktop Computer Bridge（Observe only）。
   * 渐进能力：缺失 → Observe 工具不暴露（绝不使整个 Bridge invalid）。
   * Computer 自己拥有 version（1 = Observe），版本协商独立于 Bridge version。
   */
  computer?: ClassFlowDesktopComputerBridge;
  channels?: ClassFlowDesktopChannelsBridge;
  inbox?: ClassFlowDesktopInboxBridge;
  credentials?: {
    create: (input: unknown) => Promise<{ credentialRef: string }>;
    replace: (input: unknown) => Promise<unknown>;
    delete: (input: unknown) => Promise<unknown>;
    list: () => Promise<{ metadata: unknown[] }>;
  };
  skills?: unknown;
  mcp?: unknown;
  invocation?: unknown;
  api?: { request: (path: string, init?: RequestInit) => Promise<Response> };
}

export type ClassFlowDesktopTerminalShell = "powershell" | "cmd";

/**
 * Terminal Bridge V1 Error Contract（Handoff 冻结；Desktop Runtime 只实现这 4 种 reject code）。
 * - 绝不 reject TIMEOUT：timeout 属于 process execution outcome（resolve timedOut=true），
 *   不是 Bridge transport failure。
 * - 错误对象绝不包含 absolute path / username / stack / raw OS error。
 */
export type DesktopTerminalBridgeErrorCode =
  | "PERMISSION_DENIED"
  | "CANCELLED"
  | "EXECUTION_FAILED"
  | "INVALID_OPERATION";

export interface DesktopTerminalBridgeError {
  code: DesktopTerminalBridgeErrorCode;
  message?: string;
}

/**
 * Desktop Terminal Bridge V1（Command Runner；不是 interactive PTY）。
 *
 * execute 语义（V1.0.1 冻结）：
 * - resolve：normal exit（exitCode=0）／ non-zero exit（exitCode=N）／ timeout（timedOut=true, exitCode=null）
 * - reject：permission/grant failure（PERMISSION_DENIED）／ 用户取消（CANCELLED）／
 *   runner 基础设施失败如 PowerShell 可执行文件缺失（EXECUTION_FAILED）／ 非法 bridge 操作（INVALID_OPERATION）
 *
 * 安全契约（详见 docs/desktop-filesystem-bridge.md §Terminal）：
 * - 只接受 grantId + relative cwd；绝不接受 absolute cwd（Runtime 负责 grantId → native root 映射）。
 * - Runtime MUST：每次执行验证 grant granted；cwd canonicalize 后必须位于 granted root 内；
 *   cancel/timeout 必须终止整个 process tree；stdout/stderr bounded；non-interactive；
 *   不 elevation / 不管理员 / 不开 shell window；错误不含 absolute path / stack。
 */
export interface ClassFlowDesktopTerminalBridgeV1 {
  version: 1;
  execute(input: {
    /** opaque execution id（Web 生成；cancel 用） */
    executionId: string;
    shell: ClassFlowDesktopTerminalShell;
    grantId: string;
    /** relative cwd（"" = root） */
    cwd: string;
    command: string;
    timeoutMs: number;
  }): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  }>;
  cancel(input: { executionId: string }): Promise<void>;
}

/**
 * Terminal Runtime Event（V2 streaming；经 preload subscribe 推送给 renderer / UI）。
 * - sequence 单调递增（每 execution 从 1 起），保证 chunk 顺序可确定重建。
 * - 事件内容已经过 sanitization（ANSI strip / absolute path redaction / secret redaction / char bound）。
 * - 绝不含 OS pid / native absolute path / username / raw error。
 */
export type DesktopTerminalEvent =
  | {
      type: "started";
      executionId: string;
      sequence: number;
    }
  | {
      type: "stdout";
      executionId: string;
      sequence: number;
      text: string;
    }
  | {
      type: "stderr";
      executionId: string;
      sequence: number;
      text: string;
    }
  | {
      type: "exit";
      executionId: string;
      sequence: number;
      exitCode: number | null;
      timedOut: boolean;
      cancelled: boolean;
      durationMs: number;
    };

/** V2 execution mode：foreground 默认；long-running 必须显式（放宽 timeout 上限） */
export type DesktopTerminalExecutionMode = "foreground" | "long-running";

/** Desktop Terminal Bridge V2：向后兼容 V1（execute/cancel 语义不变）+ 流式 start/subscribe。
 *  Phase 3 增加 write；Phase 4 增加 createSession/writeSession/resizeSession/closeSession。 */
export interface ClassFlowDesktopTerminalBridgeV2 {
  version: 2;
  execute: ClassFlowDesktopTerminalBridgeV1["execute"];
  cancel: ClassFlowDesktopTerminalBridgeV1["cancel"];
  /** 流式启动：resolve 最终 bounded result（与 V1 execute 相同返回契约）；事件经 subscribe 推送 */
  start(input: {
    executionId: string;
    shell: ClassFlowDesktopTerminalShell;
    grantId: string;
    cwd: string;
    command: string;
    timeoutMs: number;
    executionMode?: DesktopTerminalExecutionMode;
  }): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  }>;
  /** 订阅该 runtime 的 terminal 事件流；返回取消订阅函数 */
  subscribe(listener: (event: DesktopTerminalEvent) => void): () => void;
  /** 受控 stdin write（Phase 3）：execution 必须 active；size/rate bounded；结束/取消后 reject INVALID_OPERATION */
  write(input: { executionId: string; data: string }): Promise<void>;
  /** 持久 PowerShell PTY Session（Phase 4，渐进能力）：createSession → writeSession/resizeSession/closeSession */
  createSession?(input: {
    shell: ClassFlowDesktopTerminalShell;
    grantId: string;
    cwd: string;
    cols: number;
    rows: number;
  }): Promise<{ sessionId: string }>;
  writeSession?(input: { sessionId: string; data: string }): Promise<void>;
  resizeSession?(input: { sessionId: string; cols: number; rows: number }): Promise<void>;
  closeSession?(input: { sessionId: string }): Promise<void>;
  subscribeSession?(listener: (event: DesktopTerminalSessionEvent) => void): () => void;
}

/** PTY Session 事件（经 subscribe 的独立 session 事件通道；data 已 sanitized） */
export type DesktopTerminalSessionEvent =
  | { type: "data"; sessionId: string; data: string }
  | { type: "exit"; sessionId: string; exitCode: number };

export type ClassFlowDesktopTerminalBridge = ClassFlowDesktopTerminalBridgeV1 | ClassFlowDesktopTerminalBridgeV2;

/* ---------------- Desktop Computer Bridge（Phase 1 Observe + Phase 2 Action） ---------------- */

/**
 * Computer Bridge 结构化错误（绝不向 Web throw raw OS error / stack）。
 * - RUNTIME_UNAVAILABLE：桌面运行时当前不可用（Electron API / UI Automation 探测失败）
 * - OBSERVATION_FAILED：观察失败（截图 / 窗口枚举 / UIA 读取异常，已脱敏）
 * - INVALID_OPERATION：malformed IPC 输入 / 非法 target/windowId 组合
 * - PERMISSION_DENIED：调用方不受信任
 * - STALE_OBSERVATION：observation 过期 / 窗口切换 / 元素消失 / bounds 明显变化 → 必须重新 observe
 * - ACTION_BLOCKED：目标元素不可用 / 敏感输入 / 会话已取消等确定性拒绝（不重试即应停止）
 * - ACTION_FAILED：输入执行失败（已脱敏）
 * - CANCELLED：用户 Stop 后会话失效，拒绝继续执行
 */
export type DesktopComputerBridgeErrorCode =
  | "PERMISSION_DENIED"
  | "INVALID_OPERATION"
  | "RUNTIME_UNAVAILABLE"
  | "OBSERVATION_FAILED"
  | "NOT_FOUND"
  | "STALE_OBSERVATION"
  | "ACTION_BLOCKED"
  | "ACTION_FAILED"
  | "CANCELLED"
  // Computer Use Phase 3：Session / Task Loop Guard / App Control
  | "SESSION_PAUSED"
  | "SESSION_LIMIT_REACHED"
  | "REPEATED_ACTION"
  | "NO_PROGRESS"
  | "APP_NOT_FOUND"
  | "APP_LAUNCH_FAILED";

/**
 * UI 元素（模型可见的最小字段集）。
 * elementId 是 Runtime 生成的 opaque 逻辑 id（每次观察重新生成）；
 * 绝不暴露 native UI element / HWND / PID。
 * isPassword 是控件语义事实（帮助模型避免在密码字段输入），不是内容。
 */
export interface ClassFlowDesktopComputerElement {
  elementId: string;
  role: string;
  name: string;
  enabled: boolean;
  focused: boolean;
  isPassword?: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

/** 截图证据（dataUrl 仅存在于本次响应；绝不自动持久化到磁盘） */
export interface ClassFlowDesktopComputerScreenshotEvidence {
  captured: true;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  bytes: number;
  capturedAt: string;
  /** dataUrl 为 renderer 侧证据；Executor 不会把原始像素转发给模型（避免无界 token） */
  dataUrl: string;
}

export interface ClassFlowDesktopComputerObservation {
  observationId: string;
  target: "active-window" | "screen";
  appName: string;
  windowTitle: string;
  /** opaque 逻辑窗口 id（win-…）；screen 观察无活动窗口时为 null */
  windowId: string | null;
  /** Computer Use Phase 3：当前活动应用 / 聚焦窗口（多窗口工作流） */
  activeApplication?: string;
  focusedWindow?: string | null;
  viewport: { width: number; height: number };
  /** 有界可操作窗口列表（只含 opaque id/title/appName/active/z-order；hwnd/pid 不出现） */
  windows: ClassFlowDesktopComputerWindow[];
  windowsTruncated: boolean;
  elements: ClassFlowDesktopComputerElement[];
  elementCount: number;
  elementsTruncated: boolean;
  screenshot: ClassFlowDesktopComputerScreenshotEvidence | null;
  /** 已脱敏的降级原因（如 screenshot-unavailable / ui-tree-unavailable） */
  warnings: string[];
  uiTreeRevision: number;
  capturedAt: string;
  /** V2.4：当前应用画像（已脱敏；blocked = 受保护应用，动作永不放行） */
  appProfile?: ClassFlowDesktopComputerAppProfileInfo | null;
  /** Phase 3：本 Turn DesktopControlSession 状态（只读事实） */
  session?: ClassFlowDesktopComputerSessionStatus;
}

/** V2.4：应用画像（Main 侧进程名 / 标题解析；不含路径） */
export interface ClassFlowDesktopComputerAppProfileInfo {
  id: string;
  label: string;
  blocked: boolean;
}

/** 观察到的顶层窗口（模型可用于选择后续观察目标；只含 opaque windowId） */
export interface ClassFlowDesktopComputerWindow {
  windowId: string;
  title: string;
  appName: string;
  active: boolean;
  /** z-order（越小越靠前） */
  zOrder?: number;
}

/** Computer Use Phase 3：多窗口列表（list_desktop_windows） */
export interface ClassFlowDesktopComputerWindowList {
  focusedWindowId: string | null;
  activeApplication: string;
  windows: ClassFlowDesktopComputerWindow[];
  windowsTruncated: boolean;
}

export interface ClassFlowDesktopComputerCapabilities {
  available: boolean;
  platform: ClassFlowDesktopPlatform;
  screenshot: boolean;
  uiAutomation: boolean;
  /** Phase 2：action runtime 可用（prepareAction / action / cancelActions） */
  action: boolean;
  /** Phase 3：session / 多窗口 / 应用控制可用 */
  session: boolean;
  appControl: boolean;
}

/* ---------------- Computer Use Phase 3：DesktopControlSession ---------------- */

export type DesktopControlSessionState =
  | "idle"
  | "observing"
  | "acting"
  | "waiting"
  | "approval-required"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface ClassFlowDesktopComputerSessionStatus {
  sessionId: string;
  state: DesktopControlSessionState;
  createdAt: number;
  updatedAt: number;
  elapsedMs: number;
  actions: number;
  observations: number;
  remainingActions: number;
  appName: string | null;
  windowTitle: string | null;
  actionLabel: string | null;
  failureReason: string | null;
  /** V2.3：本会话目标（模型声明） */
  goal: string | null;
  /** V2.3：计划步骤（1–8 条） */
  plan: string[];
  /** V2.3：当前步骤索引（0-based） */
  stepIndex: number;
  /** V2.3：需要反思（连续验证失败 / 无进展） */
  reflectionRequired: boolean;
  /** V2.4：当前应用画像（已脱敏；无匹配 → null） */
  appProfile?: ClassFlowDesktopComputerAppProfileInfo | null;
}

/** 经 preload subscribe 推送的会话状态事件（sanitized；UI-only，不进入模型 context） */
export interface ClassFlowDesktopComputerSessionEvent {
  type: "session";
  sessionId: string;
  state: DesktopControlSessionState;
  appName: string | null;
  windowTitle: string | null;
  actionLabel: string | null;
  actions: number;
  observations: number;
  updatedAt: number;
  goal: string | null;
  plan: string[];
  stepIndex: number;
  reflectionRequired: boolean;
  /** V2.4：当前应用画像（已脱敏；无匹配 → null） */
  appProfile?: ClassFlowDesktopComputerAppProfileInfo | null;
}

/** 打开应用结果（logical app identifier；绝不返回 exe 绝对路径） */
export interface ClassFlowDesktopComputerAppLaunchResult {
  appId: string;
  label: string;
  launched: boolean;
  /** 启动后出现的窗口（若在等待窗口内找到） */
  windowId?: string;
  elapsedMs: number;
}

/* ---------------- Computer Use Phase 2：Desktop Action contract ---------------- */

export type DesktopGuiActionType =
  | "click"
  | "double_click"
  | "focus"
  | "type"
  | "key"
  | "scroll"
  | "wait";

/** GUI 风险等级（Main 基于真实控件事实分类；renderer 只做策略合成，不篡改风险） */
export type DesktopGuiRiskLevel = "normal" | "external" | "destructive" | "sensitive" | "blocked";

/**
 * 目标只允许两种形式：
 * - elementId：优先（UIA 语义定位）
 * - normalized：仅当 UIA 无法定位时使用；0~1 相对 observation viewport，禁止物理像素
 */
export interface ClassFlowDesktopComputerActionTarget {
  elementId?: string;
  normalized?: { x: number; y: number };
}

export interface ClassFlowDesktopComputerActionRequest {
  /** 本 Turn Desktop Control session（Emergency Stop 用） */
  sessionId?: string;
  /** 具备 target 的动作必须提供最近一次 observation id */
  observationId?: string;
  action: DesktopGuiActionType;
  target?: ClassFlowDesktopComputerActionTarget;
  /** action=type：待输入文本（敏感信息绝不允许经模型路径；Main 会再次拦截） */
  text?: string;
  /** action=key：键或组合键（enter / tab / ctrl+a / …） */
  key?: string;
  /** action=scroll：正数向上、负数向下；每单位 = 3 个滚轮刻度 */
  scroll?: number;
  /** action=wait：等待毫秒（100–5000） */
  wait?: number;
  /** V2.1：动作后确定性验证（不满足时模型必须重新观察 / 换策略，不得宣称完成） */
  expect?: ClassFlowDesktopComputerActionExpectation;
}

/**
 * V2.1 动作期望（deterministic verification）：
 * - elementAppears / textAppears：新 observation 中出现预期控件或文本
 * - elementDisappears：动作前的元素（稳定身份）消失
 * - titleContains / windowAppears：窗口标题 / 前台应用变化
 */
export interface ClassFlowDesktopComputerActionExpectation {
  elementAppears?: { role?: string; nameContains?: string; nameEquals?: string };
  elementDisappears?: { elementId: string };
  titleContains?: string;
  windowAppears?: { appName?: string };
  textAppears?: string;
}

export interface ClassFlowDesktopComputerVerificationCheck {
  check: string;
  passed: boolean;
  detail?: string;
}

export interface ClassFlowDesktopComputerVerificationResult {
  passed: boolean;
  checks: ClassFlowDesktopComputerVerificationCheck[];
}

/** prepareAction 返回的脱敏目标事实（审批展示 + 风险分类输入） */
export interface ClassFlowDesktopComputerActionTargetInfo {
  kind: "element" | "coordinates" | "none";
  elementId?: string;
  role?: string;
  name?: string;
  isPassword?: boolean;
  appName: string;
  windowTitle: string;
  windowId: string | null;
  targetLabel: string;
}

export interface ClassFlowDesktopComputerActionPreparation {
  action: DesktopGuiActionType;
  risk: { level: DesktopGuiRiskLevel; reason: string };
  target: ClassFlowDesktopComputerActionTargetInfo;
  observationId: string | null;
  /** 非敏感文本预览（≤80 chars，控制字符已清洗）；敏感输入 → null */
  textPreview: string | null;
  /** 该动作是否需要 observation 强绑定（wait 为 false；其它为 true） */
  requiresObservation: boolean;
}

export interface ClassFlowDesktopComputerActionResult {
  actionResult: {
    action: DesktopGuiActionType;
    method:
      | "uia-invoke"
      | "uia-select"
      | "uia-setvalue"
      | "uia-focus"
      | "bounds-click"
      | "coordinate-click"
      | "sendinput-text"
      | "sendinput-key"
      | "scroll"
      | "wait";
    durationMs: number;
  };
  /** Action 后 settle + 自动重新观察（wait 无 observation 上下文时为 null） */
  observation: ClassFlowDesktopComputerObservation | null;
  newObservationId: string | null;
  changedWindow: boolean | null;
  uiChanged: boolean | null;
  /** Phase 3：本 Turn DesktopControlSession 状态 */
  session?: ClassFlowDesktopComputerSessionStatus;
  /** V2.1：expect 求值结果（未配置 expect → undefined） */
  verification?: ClassFlowDesktopComputerVerificationResult;
  /** V2.3：需要反思（连续验证失败 / 无进展）——模型必须重新观察并更新计划 */
  reflectionRequired?: boolean;
  reflectionHint?: string;
}

/** V2.1：find_desktop_element 结果（确定性打分，只在当前 observation 内检索） */
export interface ClassFlowDesktopComputerElementMatch {
  elementId: string;
  role: string;
  name: string;
  enabled: boolean;
  focused: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  score: number;
}

export interface ClassFlowDesktopComputerElementSearchResult {
  observationId: string;
  query: string;
  matches: ClassFlowDesktopComputerElementMatch[];
  totalElements: number;
}

export interface ClassFlowDesktopComputerBridgeV1 {
  version: 1;
  capabilities(): Promise<ClassFlowDesktopComputerCapabilities>;
  observe(input: {
    target?: "active-window" | "screen";
    windowId?: string;
    includeScreenshot?: boolean;
    includeUiTree?: boolean;
    sessionId?: string;
  }): Promise<ClassFlowDesktopComputerObservation>;
}

/**
 * Desktop Computer Bridge V2（Computer Use Phase 2：Observe + Action）。
 * 所有输入由 Main / native runtime 执行；renderer 不得调用 unrestricted native input API。
 */
export interface ClassFlowDesktopComputerBridgeV2 {
  version: 2;
  capabilities(): Promise<ClassFlowDesktopComputerCapabilities>;
  observe(input: {
    target?: "active-window" | "screen";
    windowId?: string;
    includeScreenshot?: boolean;
    includeUiTree?: boolean;
    sessionId?: string;
  }): Promise<ClassFlowDesktopComputerObservation>;
  /** 只读校验 + 风险事实（不执行输入） */
  prepareAction(
    input: ClassFlowDesktopComputerActionRequest
  ): Promise<ClassFlowDesktopComputerActionPreparation>;
  /** 执行动作（内部重复完整校验），settle 后自动重新观察 */
  action(
    input: ClassFlowDesktopComputerActionRequest
  ): Promise<ClassFlowDesktopComputerActionResult>;
  /** Emergency Stop：清空该 session 的 observation 并拒绝后续 action */
  cancelActions(input: { sessionId: string }): Promise<{ ok: boolean; cancelled: number }>;
}

/**
 * Desktop Computer Bridge V3（Computer Use Phase 3：Autonomous Desktop Agent）。
 * - Session 生命周期 / Task Loop Guard / Pause / Resume
 * - 多窗口：list / activate（session-local opaque windowId）
 * - 应用：open_application（logical app identifier + allowlist 解析；绝不接受 exe 路径）
 * - Session 事件流（UI-only；sanitized）
 */
export interface ClassFlowDesktopComputerBridgeV3 {
  version: 3;
  capabilities(): Promise<ClassFlowDesktopComputerCapabilities>;
  observe(input: {
    target?: "active-window" | "screen";
    windowId?: string;
    includeScreenshot?: boolean;
    includeUiTree?: boolean;
    sessionId?: string;
  }): Promise<ClassFlowDesktopComputerObservation>;
  prepareAction(
    input: ClassFlowDesktopComputerActionRequest
  ): Promise<ClassFlowDesktopComputerActionPreparation>;
  action(
    input: ClassFlowDesktopComputerActionRequest
  ): Promise<ClassFlowDesktopComputerActionResult>;
  /** Emergency Stop：清空该 session 的 observation 并拒绝后续 action */
  cancelActions(input: { sessionId: string }): Promise<{ ok: boolean; cancelled: number }>;
  /** 多窗口列表（opaque session-local windowId） */
  listWindows(input: { sessionId?: string }): Promise<ClassFlowDesktopComputerWindowList>;
  /** V2.1：在当前 observation 的控件树内做确定性语义检索（返回 elementId） */
  findElements(input: {
    observationId: string;
    query: string;
    maxResults?: number;
    sessionId?: string;
  }): Promise<ClassFlowDesktopComputerElementSearchResult>;
  /** 激活窗口（activate → observe → action 工作流） */
  activateWindow(input: {
    windowId: string;
    sessionId?: string;
  }): Promise<{
    windowId: string;
    appName: string;
    windowTitle: string;
    activated: boolean;
    session?: ClassFlowDesktopComputerSessionStatus;
  }>;
  /** 打开应用（logical app identifier；allowlist 解析） */
  openApplication(input: {
    app: string;
    sessionId?: string;
  }): Promise<ClassFlowDesktopComputerAppLaunchResult>;
  getSessionStatus(input: { sessionId: string }): Promise<ClassFlowDesktopComputerSessionStatus>;
  pauseSession(input: { sessionId: string }): Promise<ClassFlowDesktopComputerSessionStatus>;
  resumeSession(input: { sessionId: string }): Promise<ClassFlowDesktopComputerSessionStatus>;
  /** Turn 正常结束 → completed（cancelled / failed 不被覆盖） */
  completeSession(input: { sessionId: string }): Promise<ClassFlowDesktopComputerSessionStatus>;
  /** renderer 侧 UI 状态（approval-required / waiting / idle） */
  setSessionState(input: {
    sessionId: string;
    state: "approval-required" | "waiting" | "idle";
  }): Promise<ClassFlowDesktopComputerSessionStatus>;
  /** V2.3：设置目标 / 计划 / 当前步骤（模型显式声明；只存内存，不持久化） */
  updateSessionPlan(input: {
    sessionId: string;
    goal?: string;
    plan?: string[];
    stepIndex?: number;
    completeStep?: boolean;
  }): Promise<ClassFlowDesktopComputerSessionStatus>;
  /** Session 状态事件流；返回取消订阅函数 */
  subscribeSession(listener: (event: ClassFlowDesktopComputerSessionEvent) => void): () => void;
}

export type ClassFlowDesktopComputerBridge =
  | ClassFlowDesktopComputerBridgeV1
  | ClassFlowDesktopComputerBridgeV2
  | ClassFlowDesktopComputerBridgeV3;

declare global {
  interface Window {
    /** Desktop Runtime 注入的唯一入口；Web 只通过 lib/desktop/bridge.ts 访问 */
    classflowDesktop?: ClassFlowDesktopBridgeV1;
  }
}
