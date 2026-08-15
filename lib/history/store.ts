/**
 * Learning History IndexedDB Store（Part 1）。
 * 独立 DB：classflow-learning-history（version 1），stores: events / meta。
 * 禁止模块 import 时直接 indexedDB.open()（SSR 安全）：只能显式函数触发。
 */

import {
  LearningHistoryCoverage,
  LearningHistoryEvent,
  LEARNING_HISTORY_SCHEMA_VERSION,
} from "@/lib/history/types";

export const LEARNING_HISTORY_DB_NAME = "classflow-learning-history";
export const LEARNING_HISTORY_DB_VERSION = 1;

const EVENTS_STORE = "events";
const META_STORE = "meta";

let dbPromise: Promise<IDBDatabase> | null = null;

function hasIndexedDB(): boolean {
  return typeof indexedDB !== "undefined" && !!indexedDB;
}

export function openLearningHistoryDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (!hasIndexedDB()) {
    dbPromise = Promise.reject(new Error("IndexedDB unavailable"));
    return dbPromise;
  }
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(LEARNING_HISTORY_DB_NAME, LEARNING_HISTORY_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        const store = db.createObjectStore(EVENTS_STORE, { keyPath: "id" });
        store.createIndex("occurredAt", "occurredAt");
        store.createIndex("localDate", "localDate");
        store.createIndex("type", "type");
        store.createIndex("entityType", "entityType");
        store.createIndex("entityId", "entityId");
        store.createIndex("semesterId", "semesterId");
        store.createIndex("semesterWeek", "semesterWeek");
        store.createIndex("courseId", "courseId");
        store.createIndex("assignmentId", "assignmentId");
        store.createIndex("source", "source");
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("failed to open learning history db"));
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("tx aborted"));
  });
}

/** 重置 DB 句柄（clear/reset 后由下一次 open 重建） */
function resetDbHandle(): void {
  dbPromise = null;
}

export async function appendLearningHistoryEvent(event: LearningHistoryEvent): Promise<void> {
  await appendLearningHistoryEvents([event]);
}

export async function appendLearningHistoryEvents(events: LearningHistoryEvent[]): Promise<void> {
  if (events.length === 0) return;
  const db = await openLearningHistoryDB();
  const tx = db.transaction(EVENTS_STORE, "readwrite");
  const store = tx.objectStore(EVENTS_STORE);
  for (const event of events) {
    store.put(event);
  }
  await txDone(tx);
}

export async function getLearningHistoryEvent(id: string): Promise<LearningHistoryEvent | null> {
  const db = await openLearningHistoryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENTS_STORE, "readonly");
    const req = tx.objectStore(EVENTS_STORE).get(id);
    req.onsuccess = () => resolve((req.result as LearningHistoryEvent | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function countLearningHistoryEvents(): Promise<number> {
  const db = await openLearningHistoryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENTS_STORE, "readonly");
    const req = tx.objectStore(EVENTS_STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clearLearningHistoryStorage(): Promise<void> {
  const db = await openLearningHistoryDB();
  const tx = db.transaction([EVENTS_STORE, META_STORE], "readwrite");
  tx.objectStore(EVENTS_STORE).clear();
  tx.objectStore(META_STORE).clear();
  await txDone(tx);
}

export async function getLearningHistoryCoverage(): Promise<LearningHistoryCoverage | null> {
  const db = await openLearningHistoryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readonly");
    const req = tx.objectStore(META_STORE).get("coverage");
    req.onsuccess = () => resolve((req.result?.value as LearningHistoryCoverage | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function setLearningHistoryCoverage(
  coverage: LearningHistoryCoverage
): Promise<void> {
  const db = await openLearningHistoryDB();
  const tx = db.transaction(META_STORE, "readwrite");
  tx.objectStore(META_STORE).put({ key: "coverage", value: coverage });
  await txDone(tx);
}

/** 首次初始化：写入 historyStartedAt 等 coverage（幂等） */
export async function ensureLearningHistoryCoverage(): Promise<LearningHistoryCoverage> {
  const existing = await getLearningHistoryCoverage();
  if (existing) return existing;
  const coverage: LearningHistoryCoverage = {
    schemaVersion: LEARNING_HISTORY_SCHEMA_VERSION,
    historyStartedAt: Date.now(),
    initializedAt: Date.now(),
    focusBackfillCompleted: false,
    backfilledFocusSessions: 0,
  };
  await setLearningHistoryCoverage(coverage);
  return coverage;
}

/** 完全清空并重置（reset/restore 语义）：新 historyStartedAt，允许 Focus backfill */
export async function resetLearningHistoryCoverage(): Promise<LearningHistoryCoverage> {
  await clearLearningHistoryStorage();
  resetDbHandle();
  const coverage: LearningHistoryCoverage = {
    schemaVersion: LEARNING_HISTORY_SCHEMA_VERSION,
    historyStartedAt: Date.now(),
    initializedAt: Date.now(),
    focusBackfillCompleted: false,
    backfilledFocusSessions: 0,
  };
  await setLearningHistoryCoverage(coverage);
  return coverage;
}

/** 用户主动清空 History：阻止再次回填旧 Focus */
export async function clearLearningHistoryForUser(): Promise<void> {
  await clearLearningHistoryStorage();
  resetDbHandle();
  await setLearningHistoryCoverage({
    schemaVersion: LEARNING_HISTORY_SCHEMA_VERSION,
    historyStartedAt: Date.now(),
    initializedAt: Date.now(),
    focusBackfillCompleted: true,
    backfilledFocusSessions: 0,
    focusBackfillDisabled: true,
  });
}
