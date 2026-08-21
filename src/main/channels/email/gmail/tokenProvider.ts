/**
 * Gmail Token Provider — Task 18A
 * SecretVault provider "google" holds refresh_token, access_token memory only.
 */

import { getRuntimeSecretVault } from "@/src/main/secrets/secretRuntime";

export class GmailTokenProvider {
  private credentialRef: string;
  private accessToken: string | null = null;
  private accessTokenExpiry = 0;

  constructor(credentialRef: string) {
    this.credentialRef = credentialRef;
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiry - 60_000) {
      return this.accessToken;
    }
    const vault = getRuntimeSecretVault();
    const refreshToken = vault.resolveSecretForProvider(this.credentialRef, "google");
    const clientId = process.env.CLASSFLOW_GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error(JSON.stringify({ code: "GMAIL_OAUTH_CONFIG_MISSING", message: "Gmail OAuth not configured" }));
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const data = await res.json() as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !data.access_token) {
      throw new Error(JSON.stringify({ code: "GMAIL_AUTH_FAILED", message: data.error || "Failed to refresh token" }));
    }
    this.accessToken = data.access_token;
    this.accessTokenExpiry = Date.now() + (data.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  clearCache(): void {
    this.accessToken = null;
    this.accessTokenExpiry = 0;
  }
}
