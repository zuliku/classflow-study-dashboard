/**
 * Gmail OAuth — Task 18A
 * Main-only Authorization Code + PKCE S256 + loopback 127.0.0.1 + state + 180s timeout
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { shell } from "electron";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"].join(" ");

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export interface GmailOAuthResult {
  refreshToken: string;
  emailAddress: string;
}

function getClientId(): string | null {
  // ClassFlow built-in Desktop OAuth Client, dev override via env
  return process.env.CLASSFLOW_GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || null;
}

export async function startGmailOAuth(): Promise<GmailOAuthResult> {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error(JSON.stringify({ code: "GMAIL_OAUTH_CONFIG_MISSING", message: "Gmail OAuth not configured" }));
  }

  const state = base64url(randomBytes(16));
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());

  return new Promise((resolve, reject) => {
    let server: ReturnType<typeof createServer> | null = null;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { server?.close(); } catch {}
      reject(new Error(JSON.stringify({ code: "GMAIL_OAUTH_TIMEOUT", message: "OAuth timeout" })));
    }, 180_000);

    const cleanup = () => {
      clearTimeout(timeout);
      try { server?.close(); } catch {}
    };

    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end();
          return;
        }
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<h1>Authorization denied</h1>");
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error(JSON.stringify({ code: "GMAIL_OAUTH_DENIED", message: "OAuth denied" })));
          }
          return;
        }

        if (returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h1>State mismatch</h1>");
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error(JSON.stringify({ code: "GMAIL_OAUTH_STATE_MISMATCH", message: "State mismatch" })));
          }
          return;
        }

        if (!code) {
          res.writeHead(400);
          res.end();
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error(JSON.stringify({ code: "GMAIL_OAUTH_DENIED", message: "Missing code" })));
          }
          return;
        }

        // Single use: close server after handling
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>ClassFlow Gmail connected, you can close this window</h1>");

        if (settled) return;
        settled = true;
        cleanup();

        // Exchange code for tokens
        const redirectUri = `http://127.0.0.1:${(server!.address() as { port: number }).port}/callback`;
        try {
          const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: clientId,
              code,
              code_verifier: verifier,
              grant_type: "authorization_code",
              redirect_uri: redirectUri,
            }),
          });
          const tokenData = await tokenRes.json() as { refresh_token?: string; access_token?: string; error?: string };
          if (!tokenRes.ok || !tokenData.refresh_token) {
            throw new Error(JSON.stringify({ code: "GMAIL_AUTH_FAILED", message: tokenData.error || "Token exchange failed" }));
          }
          // Fetch Gmail profile to get emailAddress
          const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          });
          const profile = await profileRes.json() as { emailAddress?: string };
          if (!profile.emailAddress) throw new Error(JSON.stringify({ code: "GMAIL_AUTH_FAILED", message: "Failed to get Gmail profile" }));

          resolve({ refreshToken: tokenData.refresh_token, emailAddress: profile.emailAddress });
        } catch (e) {
          reject(e instanceof Error ? e : new Error(JSON.stringify({ code: "GMAIL_AUTH_FAILED", message: String(e) })));
        }
      } catch (e) {
        res.writeHead(500);
        res.end();
        if (!settled) {
          settled = true;
          cleanup();
          reject(e);
        }
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server!.address() as { port: number };
      const redirectUri = `http://127.0.0.1:${addr.port}/callback`;
      const authUrl = new URL(GOOGLE_AUTH_URL);
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", SCOPES);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      void shell.openExternal(authUrl.toString());
    });

    server.on("error", (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    });
  });
}
