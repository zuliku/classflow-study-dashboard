/**
 * Document Failure Fuse（V2.3）—— 不让模型靠重复碰撞结构错误。
 *
 * 语义：
 * - schema failure（INVALID_INPUT / DOCUMENT_PROTOCOL_MISMATCH）允许 1 次 retry；
 *   同一 User Turn 第 2 次结构失败 → fuse（document tools blocked）。
 * - hard deterministic failure（DOCUMENT_RENDER_FAILED / VERIFICATION_FAILED）首次即 fuse
 *   （同样调用不会靠模型多猜一次解决）。
 * - 权限 / 路径 / 用户决策 / 并发类失败不计入（USER_CANCELLED / WORKSPACE_PERMISSION_REQUIRED /
 *   RESOURCE_ALREADY_EXISTS / READ_ONLY_ROOT / ARTIFACT_REVISION_CONFLICT / PERMISSION_DENIED 等）。
 */

export const DOCUMENT_SCHEMA_RETRY_LIMIT = 1;

export interface DocumentFailureFuseState {
  schemaFailures: number;
  hardFailure: boolean;
  blocked: boolean;
}

export const DOCUMENT_SCHEMA_FAILURE_CODES = new Set(["INVALID_INPUT", "DOCUMENT_PROTOCOL_MISMATCH"]);

export const DOCUMENT_HARD_FAILURE_CODES = new Set(["DOCUMENT_RENDER_FAILED", "VERIFICATION_FAILED"]);

/** 不计入 fuse 的失败 code（权限/路径/用户决策/并发，不是 Document Schema 崩坏） */
export const DOCUMENT_NON_FUSE_FAILURE_CODES = new Set([
  "USER_CANCELLED",
  "WORKSPACE_PERMISSION_REQUIRED",
  "RESOURCE_ALREADY_EXISTS",
  "READ_ONLY_ROOT",
  "ARTIFACT_REVISION_CONFLICT",
  "PERMISSION_DENIED",
  "ROOT_NOT_FOUND",
  "RESOURCE_NOT_FOUND",
  "FILE_TOO_LARGE",
]);

export function isDocumentSchemaFailure(code: string): boolean {
  return DOCUMENT_SCHEMA_FAILURE_CODES.has(code);
}

export function isDocumentHardFailure(code: string): boolean {
  return DOCUMENT_HARD_FAILURE_CODES.has(code);
}

/** 推进 fuse（纯函数）：返回是否因此 blocked */
export function advanceDocumentFailureFuse(
  state: DocumentFailureFuseState,
  output: { ok?: boolean; code?: string } | null | undefined
): boolean {
  if (!output || output.ok !== false || typeof output.code !== "string") return state.blocked;
  const code = output.code;
  if (isDocumentSchemaFailure(code)) {
    state.schemaFailures += 1;
    if (state.schemaFailures > DOCUMENT_SCHEMA_RETRY_LIMIT) state.blocked = true;
  } else if (isDocumentHardFailure(code)) {
    state.hardFailure = true;
    state.blocked = true;
  }
  return state.blocked;
}

interface ToolPartLike {
  type?: string;
  state?: string;
  output?: unknown;
}

/**
 * 从最后 User Turn 的已完成 create_document / update_document 输出推导 fuse 状态（server continuation 层）。
 * 返回 { schemaFailures, hardFailure, blocked }。
 */
export function deriveDocumentFailureFuseState(messages: unknown[]): DocumentFailureFuseState {
  const state: DocumentFailureFuseState = { schemaFailures: 0, hardFailure: false, blocked: false };
  const list = Array.isArray(messages) ? messages : [];
  let lastUserIdx = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i] as { role?: string } | null;
    if (m && m.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  for (let i = lastUserIdx + 1; i < list.length; i++) {
    const m = list[i] as { parts?: unknown[] } | null;
    const parts: ToolPartLike[] = Array.isArray(m?.parts) ? (m.parts as ToolPartLike[]) : [];
    for (const p of parts) {
      if (typeof p?.type !== "string") continue;
      if (p.type !== "tool-create_document" && p.type !== "tool-update_document") continue;
      if (p.state !== "output-available") continue;
      const output = p.output as { ok?: boolean; code?: string } | null;
      if (!output || output.ok !== false) continue;
      const code = output.code ?? "";
      if (isDocumentSchemaFailure(code)) {
        state.schemaFailures += 1;
        if (state.schemaFailures > DOCUMENT_SCHEMA_RETRY_LIMIT) state.blocked = true;
      } else if (isDocumentHardFailure(code)) {
        state.hardFailure = true;
        state.blocked = true;
      }
    }
  }
  return state;
}
