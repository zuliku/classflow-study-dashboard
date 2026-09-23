/**
 * Computer Use Phase 3 — DesktopControlSession（Main 侧状态机 + Task Loop Guard）。
 *
 * 生命周期：
 *   idle → observing → idle → acting → idle → … → completed / failed / cancelled
 *                       ↘ paused ↗        ↘ approval-required / waiting ↗
 *
 * 守卫（每个 Session 独立）：
 * - max actions / max observations / max duration
 * - repeated-action detection（连续相同动作指纹）
 * - no-progress detection（连续多次 observation UI 指纹不变 + 动作相似）
 *
 * 只会向 renderer 发送脱敏状态（opaque sessionId / 应用名 / 窗口标题 / 动作标签 / 计数），
 * 绝不包含 native handle / path / 截图。
 */
import type { DesktopAppProfileInfo } from "./appProfiles";
import {
  MAX_TRAJECTORY_STEPS,
  sanitizeTrajectoryTargetLabel,
  type DesktopTrajectory,
  type DesktopTrajectoryResult,
  type DesktopTrajectoryStep,
} from "./trajectory";

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

export const DESKTOP_SESSION_LIMITS = {
  maxActions: 30,
  maxObservations: 60,
  maxDurationMs: 10 * 60_000,
  maxRepeatedActions: 3,
  maxNoProgress: 3,
  /** 终态 session 记录保留时长（内存） */
  terminalTtlMs: 10 * 60_000,
  /** V2.3：计划约束 */
  maxPlanSteps: 8,
  maxPlanStepLength: 80,
  maxGoalLength: 120,
  /** V2.3：连续验证失败达到该值 → reflectionRequired */
  maxVerificationFailStreak: 2,
} as const;

export interface DesktopControlSessionStatus {
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
  /** 最近动作的人类可读标签（如“点击 Button「搜索」”） */
  actionLabel: string | null;
  /** 守卫触发原因（failed 时） */
  failureReason: string | null;
  /** V2.3：本会话目标（模型声明，≤120 字符） */
  goal: string | null;
  /** V2.3：计划步骤（1–8 条，每条 ≤80 字符） */
  plan: string[];
  /** V2.3：当前步骤索引（0-based；无计划 → 0） */
  stepIndex: number;
  /** V2.3：需要反思（连续验证失败 / 无进展）——模型必须重新观察并更新计划 */
  reflectionRequired: boolean;
  /** V2.4：当前应用画像（已脱敏 label；无匹配 → null） */
  appProfile: DesktopAppProfileInfo | null;
}

export interface DesktopControlSessionEvent {
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
  appProfile: DesktopAppProfileInfo | null;
  /** P5：守卫触发原因（sanitized 短句；failed 时 UI 可展示，绝不透传 raw exception） */
  failureReason: string | null;
}

export type DesktopSessionGuardCode =
  | "SESSION_CANCELLED"
  | "SESSION_PAUSED"
  | "SESSION_LIMIT_REACHED"
  | "REPEATED_ACTION"
  | "NO_PROGRESS";

export class DesktopSessionGuardError extends Error {
  readonly code: DesktopSessionGuardCode;
  constructor(code: DesktopSessionGuardCode, message: string) {
    super(message);
    this.name = "DesktopSessionGuardError";
    this.code = code;
  }
}

interface SessionRecord {
  id: string;
  state: DesktopControlSessionState;
  createdAt: number;
  updatedAt: number;
  actions: number;
  observations: number;
  appName: string | null;
  windowTitle: string | null;
  actionLabel: string | null;
  lastUiSignature: string | null;
  lastActionFingerprint: string | null;
  repeatedActionCount: number;
  noProgressCount: number;
  failureReason: string | null;
  // V2.3：计划 / 反思
  goal: string | null;
  plan: string[];
  stepIndex: number;
  verificationFailStreak: number;
  reflectionRequired: boolean;
  // V2.4：应用画像（进程名 / 标题解析；已脱敏）
  appProfile: DesktopAppProfileInfo | null;
  // V2.6：轨迹（结构化事实；无输入文本 / 路径 / 截图）
  trajectory: DesktopTrajectoryStep[];
}

const TERMINAL_STATES: ReadonlySet<DesktopControlSessionState> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export function isTerminalSessionState(state: DesktopControlSessionState): boolean {
  return TERMINAL_STATES.has(state);
}

export interface ObserveGateInput {
  appName: string | null;
  windowTitle: string | null;
  uiSignature: string;
  /** V2.4：应用画像（null = 无匹配；undefined = 本次不更新） */
  appProfile?: DesktopAppProfileInfo | null;
}

export interface ActionGateInput {
  fingerprint: string;
  actionLabel: string;
  appName: string | null;
  windowTitle: string | null;
}

export class DesktopControlSessionStore {
  private sessions = new Map<string, SessionRecord>();
  private emitter: ((event: DesktopControlSessionEvent) => void) | null = null;

  setEmitter(emitter: ((event: DesktopControlSessionEvent) => void) | null): void {
    this.emitter = emitter;
  }

  ensure(sessionId: string, now: number = Date.now()): DesktopControlSessionStatus {
    const existing = this.sessions.get(sessionId);
    if (existing) return this.toStatus(existing, now);
    const record: SessionRecord = {
      id: sessionId,
      state: "idle",
      createdAt: now,
      updatedAt: now,
      actions: 0,
      observations: 0,
      appName: null,
      windowTitle: null,
      actionLabel: null,
      lastUiSignature: null,
      lastActionFingerprint: null,
      repeatedActionCount: 0,
      noProgressCount: 0,
      failureReason: null,
      goal: null,
      plan: [],
      stepIndex: 0,
      verificationFailStreak: 0,
      reflectionRequired: false,
      appProfile: null,
      trajectory: [],
    };
    this.sessions.set(sessionId, record);
    return this.toStatus(record, now);
  }

  get(sessionId: string, now: number = Date.now()): DesktopControlSessionStatus | null {
    const record = this.sessions.get(sessionId);
    if (!record) return null;
    return this.toStatus(record, now);
  }

  size(): number {
    return this.sessions.size;
  }

  /** observation 前置守卫（计数 + 时长 + 暂停/取消） */
  beginObserve(sessionId: string, now: number = Date.now()): void {
    const record = this.ensureRecord(sessionId, now);
    this.assertRunnable(record, now);
    if (record.observations >= DESKTOP_SESSION_LIMITS.maxObservations) {
      this.fail(record, "已达到本会话观察次数上限", now);
      throw new DesktopSessionGuardError("SESSION_LIMIT_REACHED", "已达到本会话观察次数上限，请重新开始任务。");
    }
    record.observations += 1;
    record.state = "observing";
    this.touch(record, now);
  }

  endObserve(sessionId: string, input: ObserveGateInput, now: number = Date.now()): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.lastUiSignature = input.uiSignature;
    if (input.appName) record.appName = input.appName;
    if (input.windowTitle) record.windowTitle = input.windowTitle;
    if (input.appProfile !== undefined) record.appProfile = input.appProfile;
    if (record.state === "observing") record.state = "idle";
    this.touch(record, now);
  }

  /** action 前置守卫（计数 / 时长 / repeated / no-progress） */
  beginAction(sessionId: string, input: ActionGateInput, now: number = Date.now()): void {
    const record = this.ensureRecord(sessionId, now);
    this.assertRunnable(record, now);
    if (record.actions >= DESKTOP_SESSION_LIMITS.maxActions) {
      this.fail(record, "已达到本会话操作次数上限", now);
      throw new DesktopSessionGuardError("SESSION_LIMIT_REACHED", "已达到本会话操作次数上限，请重新开始任务。");
    }
    // repeated-action detection：连续相同动作指纹
    if (record.lastActionFingerprint === input.fingerprint) {
      record.repeatedActionCount += 1;
    } else {
      record.repeatedActionCount = 1;
      record.lastActionFingerprint = input.fingerprint;
    }
    if (record.repeatedActionCount > DESKTOP_SESSION_LIMITS.maxRepeatedActions) {
      this.fail(record, "检测到重复动作循环", now);
      throw new DesktopSessionGuardError(
        "REPEATED_ACTION",
        "检测到相同动作连续重复执行，已停止自动尝试。请重新观察界面后换一种方式。"
      );
    }
    record.actions += 1;
    record.actionLabel = input.actionLabel;
    if (input.appName) record.appName = input.appName;
    if (input.windowTitle) record.windowTitle = input.windowTitle;
    record.state = "acting";
    this.touch(record, now);
  }

  /**
   * action 后置结算：
   * - 动作前后 UI 指纹相同 → no-progress 计数 +1；UI 变化 → 归零
   * - 恢复 idle（或保持 failed / cancelled）
   */
  endAction(
    sessionId: string,
    input: {
      beforeUiSignature: string | null;
      newUiSignature: string | null;
      ok: boolean;
      actionFingerprint: string;
    },
    now: number = Date.now()
  ): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    if (input.ok && input.beforeUiSignature !== null && input.newUiSignature !== null) {
      if (input.beforeUiSignature === input.newUiSignature) {
        record.noProgressCount += 1;
        // V2.3：任何一次无进展 → 要求模型反思（重新观察 / 换策略），而不是继续重复
        record.reflectionRequired = true;
      } else {
        record.noProgressCount = 0;
      }
      record.lastUiSignature = input.newUiSignature;
    }
    if (record.state === "acting") record.state = "idle";
    this.touch(record, now);
    if (record.noProgressCount > DESKTOP_SESSION_LIMITS.maxNoProgress) {
      this.fail(record, "连续多次观察界面无变化且动作相似", now);
      throw new DesktopSessionGuardError(
        "NO_PROGRESS",
        "连续多次操作后界面没有变化，已停止自动尝试。请检查当前窗口状态或换一种操作方式。"
      );
    }
  }

  /** V2.3：记录一次 action 后的 expect 验证结果（连续失败 → 要求反思） */
  recordVerification(
    sessionId: string,
    passed: boolean | null,
    now: number = Date.now()
  ): void {
    if (passed === null) return; // 未配置 expect：不参与失败计数
    const record = this.ensureRecord(sessionId, now);
    if (passed) {
      record.verificationFailStreak = 0;
    } else {
      record.verificationFailStreak += 1;
      if (record.verificationFailStreak >= DESKTOP_SESSION_LIMITS.maxVerificationFailStreak) {
        record.reflectionRequired = true;
      }
    }
    this.touch(record, now);
  }

  /**
   * V2.3：设置目标 / 计划 / 当前步骤（模型显式声明；只存内存）。
   * 更新计划视为一次"重新规划" → 消费 reflectionRequired。
   */
  updatePlan(
    sessionId: string,
    input: { goal?: string; plan?: string[]; stepIndex?: number; completeStep?: boolean },
    now: number = Date.now()
  ): DesktopControlSessionStatus {
    const record = this.ensureRecord(sessionId, now);
    if (input.goal !== undefined) {
      record.goal = input.goal.slice(0, DESKTOP_SESSION_LIMITS.maxGoalLength);
    }
    if (input.plan !== undefined) {
      record.plan = input.plan
        .slice(0, DESKTOP_SESSION_LIMITS.maxPlanSteps)
        .map((step) => step.slice(0, DESKTOP_SESSION_LIMITS.maxPlanStepLength));
      record.stepIndex = Math.max(0, Math.min(record.stepIndex, Math.max(0, record.plan.length - 1)));
      record.reflectionRequired = false; // 重新规划 = 反思完成
      record.verificationFailStreak = 0; // 重新计数：重规划后重新获得 2 次尝试
    }
    if (input.stepIndex !== undefined) {
      const maxIndex = Math.max(0, record.plan.length - 1);
      record.stepIndex = Math.max(0, Math.min(Math.trunc(input.stepIndex), maxIndex));
    }
    if (input.completeStep) {
      const maxIndex = Math.max(0, record.plan.length - 1);
      record.stepIndex = Math.min(record.stepIndex + 1, maxIndex);
      record.reflectionRequired = false;
    }
    this.touch(record, now);
    return this.toStatus(record, now);
  }

  /**
   * V2.6：记录一次动作轨迹（结构化事实；调用方保证不含输入文本 / 路径 / 截图）。
   * 超出上限丢弃最旧步骤。
   */
  recordTrajectoryStep(
    sessionId: string,
    step: {
      action: DesktopTrajectoryStep["action"];
      targetLabel: string;
      risk: DesktopTrajectoryStep["risk"];
      verificationPassed: boolean | null;
    },
    now: number = Date.now()
  ): void {
    const record = this.ensureRecord(sessionId, now);
    record.trajectory.push({
      index: record.trajectory.length,
      action: step.action,
      targetLabel: sanitizeTrajectoryTargetLabel(step.targetLabel),
      risk: step.risk,
      verificationPassed: step.verificationPassed,
      at: now,
    });
    if (record.trajectory.length > MAX_TRAJECTORY_STEPS) {
      record.trajectory = record.trajectory.slice(record.trajectory.length - MAX_TRAJECTORY_STEPS);
    }
    this.touch(record, now);
  }

  /** V2.6：轨迹快照（生成 Skill 草稿用；终态 → completed / failed / cancelled） */
  trajectorySnapshot(sessionId: string, now: number = Date.now()): DesktopTrajectory | null {
    const record = this.sessions.get(sessionId);
    if (!record || record.trajectory.length === 0) return null;
    const result: DesktopTrajectoryResult =
      record.state === "completed"
        ? "completed"
        : record.state === "cancelled"
          ? "cancelled"
          : record.state === "failed"
            ? "failed"
            : "in-progress";
    return {
      appName: record.appName,
      appLabel: record.appProfile?.label ?? null,
      goal: record.goal,
      steps: record.trajectory.map((step) => ({ ...step })),
      result,
      startedAt: record.createdAt,
    };
  }

  /** V2.3：当前反思提示（消费式读取：由 runtime 在输出 reflectionHint 时调用） */
  reflectionSnapshot(sessionId: string): { required: boolean; failStreak: number; noProgress: number } {
    const record = this.sessions.get(sessionId);
    if (!record) return { required: false, failStreak: 0, noProgress: 0 };
    return {
      required: record.reflectionRequired,
      failStreak: record.verificationFailStreak,
      noProgress: record.noProgressCount,
    };
  }

  /**
   * approval-required / waiting 等 UI 状态（renderer 显式设置；仅允许非终态）。
   */  setState(
    sessionId: string,
    state: Extract<DesktopControlSessionState, "approval-required" | "waiting" | "idle">,
    now: number = Date.now()
  ): void {
    const record = this.ensureRecord(sessionId, now);
    if (isTerminalSessionState(record.state)) return;
    if (record.state === "paused" && state !== "idle") return;
    record.state = state;
    this.touch(record, now);
  }

  pause(sessionId: string, now: number = Date.now()): DesktopControlSessionStatus {
    const record = this.ensureRecord(sessionId, now);
    if (!isTerminalSessionState(record.state)) {
      record.state = "paused";
      this.touch(record, now);
    }
    return this.toStatus(record, now);
  }

  resume(sessionId: string, now: number = Date.now()): DesktopControlSessionStatus {
    const record = this.ensureRecord(sessionId, now);
    if (record.state === "paused") {
      record.state = "idle";
      this.touch(record, now);
    }
    return this.toStatus(record, now);
  }

  cancel(sessionId: string, now: number = Date.now()): DesktopControlSessionStatus {
    const record = this.ensureRecord(sessionId, now);
    if (!isTerminalSessionState(record.state)) {
      record.state = "cancelled";
      this.touch(record, now);
    }
    return this.toStatus(record, now);
  }

  /** Turn 正常结束（未 cancelled / failed）→ completed */
  complete(sessionId: string, now: number = Date.now()): DesktopControlSessionStatus {
    const record = this.ensureRecord(sessionId, now);
    if (!isTerminalSessionState(record.state)) {
      record.state = "completed";
      this.touch(record, now);
    }
    return this.toStatus(record, now);
  }

  /** 已存在的 session 才 complete（不存在 → null；避免为未使用的 turn 创建记录） */
  completeExisting(sessionId: string, now: number = Date.now()): DesktopControlSessionStatus | null {
    const record = this.sessions.get(sessionId);
    if (!record) return null;
    if (!isTerminalSessionState(record.state)) {
      record.state = "completed";
      this.touch(record, now);
    }
    return this.toStatus(record, now);
  }

  isCancelled(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.state === "cancelled";
  }

  isPaused(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.state === "paused";
  }

  /** 清理长时间未更新的 session 记录 */
  sweep(now: number = Date.now()): number {
    let removed = 0;
    for (const [id, record] of this.sessions) {
      if (!isTerminalSessionState(record.state)) continue;
      if (now - record.updatedAt > DESKTOP_SESSION_LIMITS.terminalTtlMs) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.sessions.clear();
  }

  private ensureRecord(sessionId: string, now: number): SessionRecord {
    this.ensure(sessionId, now);
    return this.sessions.get(sessionId)!;
  }

  private assertRunnable(record: SessionRecord, now: number): void {
    if (record.state === "cancelled") {
      throw new DesktopSessionGuardError("SESSION_CANCELLED", "用户已停止电脑操作。");
    }
    if (record.state === "paused") {
      throw new DesktopSessionGuardError("SESSION_PAUSED", "电脑操作已暂停。");
    }
    if (record.state === "failed") {
      throw new DesktopSessionGuardError(
        "SESSION_LIMIT_REACHED",
        record.failureReason ?? "本会话已停止。"
      );
    }
    if (now - record.createdAt > DESKTOP_SESSION_LIMITS.maxDurationMs) {
      this.fail(record, "本会话已超过时间上限", now);
      throw new DesktopSessionGuardError("SESSION_LIMIT_REACHED", "本会话已超过时间上限，请重新开始任务。");
    }
  }

  private fail(record: SessionRecord, reason: string, now: number): void {
    record.state = "failed";
    record.failureReason = reason;
    this.touch(record, now);
  }

  private touch(record: SessionRecord, now: number): void {
    record.updatedAt = now;
    this.emitter?.({
      type: "session",
      sessionId: record.id,
      state: record.state,
      appName: record.appName,
      windowTitle: record.windowTitle,
      actionLabel: record.actionLabel,
      actions: record.actions,
      observations: record.observations,
      updatedAt: now,
      goal: record.goal,
      plan: [...record.plan],
      stepIndex: record.stepIndex,
      reflectionRequired: record.reflectionRequired,
      appProfile: record.appProfile,
      failureReason: record.failureReason,
    });
  }

  private toStatus(record: SessionRecord, now: number): DesktopControlSessionStatus {
    return {
      sessionId: record.id,
      state: record.state,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      elapsedMs: Math.max(0, now - record.createdAt),
      actions: record.actions,
      observations: record.observations,
      remainingActions: Math.max(0, DESKTOP_SESSION_LIMITS.maxActions - record.actions),
      appName: record.appName,
      windowTitle: record.windowTitle,
      actionLabel: record.actionLabel,
      failureReason: record.failureReason,
      goal: record.goal,
      plan: [...record.plan],
      stepIndex: record.stepIndex,
      reflectionRequired: record.reflectionRequired,
      appProfile: record.appProfile,
    };
  }
}
