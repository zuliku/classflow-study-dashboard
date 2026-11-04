/**
 * SecretVault Domain Types — Task 03
 * Renderer 与 Zustand 永远只能看到 credentialRef / metadata，绝不接触 plaintext。
 */

export type CredentialRef = string;

export type SecretProvider = "mcp" | "qq-bot" | "google" | "qq-mail" | "tavily";

export interface SecretMetadata {
  credentialRef: CredentialRef;
  provider: SecretProvider;
  label: string;
  createdAt: number;
  updatedAt: number;
}

export type SecretVaultErrorCode =
  | "SECRET_STORAGE_UNAVAILABLE"
  | "CREDENTIAL_NOT_FOUND"
  | "CIPHERTEXT_CORRUPTED"
  | "PROVIDER_MISMATCH"
  | "INVALID_INPUT"
  | "ENCRYPTION_FAILED"
  | "DECRYPTION_FAILED"
  | "SECRET_PERSISTENCE_FAILED";

export interface SecretVaultError {
  code: SecretVaultErrorCode;
  message: string;
}

export const SECRET_PROVIDER_SET: ReadonlySet<SecretProvider> = new Set<SecretProvider>([
  "mcp",
  "qq-bot",
  "google",
  "qq-mail",
  "tavily",
]);

/** 创建/替换时的输入（secret 一次性通过 IPC 进入 Main Process） */
export interface CreateCredentialInput {
  provider: SecretProvider;
  label: string;
  secret: string;
}

export interface ReplaceCredentialInput {
  credentialRef: CredentialRef;
  secret: string;
}
