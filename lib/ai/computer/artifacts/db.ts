/**
 * Kiro Artifact IndexedDB（classflow-kiro-artifacts-v1）。
 * stores: artifacts（key = artifact.id）、sources（key = artifactId）。
 * 只存逻辑 metadata + Kiro-owned Document IR；绝不存 bytes/handle/adapterRef/native path。
 */
import { KiroArtifact, KiroArtifactSourceRecord } from "@/lib/ai/computer/artifacts/types";

const ARTIFACT_DB = "classflow-kiro-artifacts-v1";
export const ARTIFACT_STORE = "artifacts";
export const ARTIFACT_SOURCE_STORE = "sources";
const ARTIFACT_VERSION = 1;

function openArtifactDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const req = indexedDB.open(ARTIFACT_DB, ARTIFACT_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(ARTIFACT_STORE)) {
        req.result.createObjectStore(ARTIFACT_STORE);
      }
      if (!req.result.objectStoreNames.contains(ARTIFACT_SOURCE_STORE)) {
        req.result.createObjectStore(ARTIFACT_SOURCE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function artifactDbGet(id: string): Promise<KiroArtifact | null> {
  const db = await openArtifactDb();
  if (!db) return null;
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(ARTIFACT_STORE, "readonly");
      const req = tx.objectStore(ARTIFACT_STORE).get(id);
      req.onsuccess = () => resolve((req.result as KiroArtifact | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export async function artifactDbPut(artifact: KiroArtifact): Promise<boolean> {
  const db = await openArtifactDb();
  if (!db) return false;
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(ARTIFACT_STORE, "readwrite");
      tx.objectStore(ARTIFACT_STORE).put(artifact, artifact.id);
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => resolve(false);
      tx.onerror = () => resolve(false);
    });
  } finally {
    db.close();
  }
}

export async function artifactDbDelete(id: string): Promise<void> {
  const db = await openArtifactDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(ARTIFACT_STORE, "readwrite");
      tx.objectStore(ARTIFACT_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}

/** 全量 artifact 列表（只读；供 find/list/cleanup 使用） */
export async function artifactDbAll(): Promise<KiroArtifact[]> {
  const db = await openArtifactDb();
  if (!db) return [];
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(ARTIFACT_STORE, "readonly");
      const req = tx.objectStore(ARTIFACT_STORE).getAll();
      req.onsuccess = () => resolve((req.result as KiroArtifact[]) ?? []);
      req.onerror = () => resolve([]);
    });
  } finally {
    db.close();
  }
}

export async function artifactSourceGet(artifactId: string): Promise<KiroArtifactSourceRecord | null> {
  const db = await openArtifactDb();
  if (!db) return null;
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(ARTIFACT_SOURCE_STORE, "readonly");
      const req = tx.objectStore(ARTIFACT_SOURCE_STORE).get(artifactId);
      req.onsuccess = () => resolve((req.result as KiroArtifactSourceRecord | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export async function artifactSourcePut(record: KiroArtifactSourceRecord): Promise<boolean> {
  const db = await openArtifactDb();
  if (!db) return false;
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(ARTIFACT_SOURCE_STORE, "readwrite");
      tx.objectStore(ARTIFACT_SOURCE_STORE).put(record, record.artifactId);
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => resolve(false);
      tx.onerror = () => resolve(false);
    });
  } finally {
    db.close();
  }
}

export async function artifactSourceDelete(artifactId: string): Promise<void> {
  const db = await openArtifactDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(ARTIFACT_SOURCE_STORE, "readwrite");
      tx.objectStore(ARTIFACT_SOURCE_STORE).delete(artifactId);
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}
