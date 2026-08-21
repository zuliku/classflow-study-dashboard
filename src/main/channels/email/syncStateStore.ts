/**
 * Sync State Store — Task 18A
 * <userData>/channels/email-sync-state.json
 * Gmail: historyId, initializedAt, lastSyncAt
 * Atomic tmp + rename, cursor commit after inbox ingest.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { app } from "electron";
import { randomUUID } from "node:crypto";

export interface GmailSyncState {
  historyId: string;
  initializedAt?: number;
  lastSyncAt?: number;
}

export interface QQMailSyncState {
  uidValidity: string;
  lastSeenUid: number;
  initializedAt?: number;
  lastSyncAt?: number;
}

export interface EmailSyncStateFile {
  gmail?: Record<string, GmailSyncState>; // key = channelId
  qqMail?: Record<string, QQMailSyncState>;
}

function getSyncStatePath(): string {
  return join(app.getPath("userData"), "channels", "email-sync-state.json");
}

export class EmailSyncStateStore {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? getSyncStatePath();
  }

  getFilePath(): string {
    return this.filePath;
  }

  load(): EmailSyncStateFile {
    try {
      if (!existsSync(this.filePath)) return {};
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as EmailSyncStateFile;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  save(state: EmailSyncStateFile): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.email-sync-tmp-${randomUUID().slice(0, 8)}`);
    try {
      const data = JSON.stringify(state, null, 2);
      writeFileSync(tmp, data, "utf8");
      renameSync(tmp, this.filePath);
    } catch (e) {
      try { unlinkSync(tmp); } catch {}
      throw e;
    }
  }

  getGmailState(channelId: string): GmailSyncState | null {
    const state = this.load();
    return state.gmail?.[channelId] ?? null;
  }

  setGmailState(channelId: string, gmailState: GmailSyncState): void {
    const state = this.load();
    if (!state.gmail) state.gmail = {};
    state.gmail[channelId] = gmailState;
    this.save(state);
  }

  getQQMailState(channelId: string): QQMailSyncState | null {
    const state = this.load();
    return state.qqMail?.[channelId] ?? null;
  }

  setQQMailState(channelId: string, qqState: QQMailSyncState): void {
    const state = this.load();
    if (!state.qqMail) state.qqMail = {};
    state.qqMail[channelId] = qqState;
    this.save(state);
  }

  deleteForChannel(channelId: string): void {
    const state = this.load();
    let changed = false;
    if (state.gmail?.[channelId]) {
      delete state.gmail[channelId];
      changed = true;
    }
    if (state.qqMail?.[channelId]) {
      delete (state.qqMail as Record<string, unknown>)[channelId];
      changed = true;
    }
    if (changed) this.save(state);
  }
}
