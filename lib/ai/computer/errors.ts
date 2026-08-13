/**
 * Computer Runtime 独立错误词汇表。
 * 不复用 ClassFlow 业务写入错误（不同 trust domain）。
 */
export type ComputerErrorCode =
  | "COMPUTER_DISABLED"
  | "WORKSPACE_NOT_FOUND"
  | "ROOT_NOT_FOUND"
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
  | "FILE_TOO_LARGE";

export class ComputerError extends Error {
  readonly code: ComputerErrorCode;

  constructor(code: ComputerErrorCode, message: string) {
    super(message);
    this.name = "ComputerError";
    this.code = code;
  }
}
