/**
 * Computer Runtime 独立错误词汇表。
 * 不复用 ClassFlow 业务写入错误（不同 trust domain）。
 */
export type ComputerErrorCode =
  | "COMPUTER_DISABLED"
  | "WORKSPACE_NOT_FOUND"
  | "ROOT_NOT_FOUND"
  | "ROOT_REQUIRED"
  | "WORKSPACE_PERMISSION_REQUIRED"
  | "PATH_OUTSIDE_SANDBOX"
  | "RESOURCE_NOT_FOUND"
  | "RESOURCE_ALREADY_EXISTS"
  | "READ_ONLY_ROOT"
  | "PERMISSION_DENIED"
  | "USER_CANCELLED"
  | "PATCH_CONFLICT"
  | "PATCH_AMBIGUOUS"
  | "UNSUPPORTED_FILE_TYPE"
  | "UNSUPPORTED_BROWSER"
  | "DOCUMENT_RENDER_FAILED"
  | "VERIFICATION_FAILED"
  | "DOCUMENT_PROTOCOL_MISMATCH"
  | "DOCUMENT_CREATION_BLOCKED"
  | "FILE_TOO_LARGE"
  | "INVALID_INPUT"
  | "ARTIFACT_NOT_FOUND"
  | "ARTIFACT_NOT_EDITABLE"
  | "ARTIFACT_REVISION_CONFLICT"
  | "ARTIFACT_UNSUPPORTED_OPERATION"
  // Desktop Terminal V1（固定文案；绝不携带 bridge 原始异常 / 路径）
  | "TERMINAL_UNAVAILABLE"
  | "TERMINAL_PERMISSION_DENIED"
  | "TERMINAL_TIMEOUT"
  | "TERMINAL_EXECUTION_FAILED"
  | "TERMINAL_CANCELLED"
  | "TERMINAL_COMMAND_BLOCKED"
  | "TERMINAL_NATIVE_WORKSPACE_REQUIRED";

export class ComputerError extends Error {
  readonly code: ComputerErrorCode;

  constructor(code: ComputerErrorCode, message: string) {
    super(message);
    this.name = "ComputerError";
    this.code = code;
  }
}
