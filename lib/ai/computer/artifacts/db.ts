/**
 * Kiro Artifact IndexedDB（classflow-kiro-artifacts-v1）。
 * stores: artifacts（key = artifact.id）、sources（key = artifactId）。
 * 只存逻辑 metadata + Kiro-owned Document IR；绝不存 bytes/handle/adapterRef/native path。
 */
import { KiroArtifact, KiroArtifactSourceRecord } from "@/lib/ai/computer/artifacts/types";
import { ComputerError } from "@/lib/ai/computer/errors";

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

/**
 * V2 Part 2：原子 revision 提交（artifacts + sources 同一 readwrite transaction）。
 * - 读取当前 Artifact/Source；任一缺失 → artifact-missing
 * - Artifact.revision 与 Source.revision 都必须等于 expectedRevision（校验乐观锁）
 * - 两个 store 在同事务内写入；resolve 只在 tx.oncomplete（commit 失败视为事务失败）
 * - 事务内不做任何 filesystem IO
 */
export async function artifactDbCommitRevision(input: {
  artifactId: string;
  expectedRevision: number;
  artifactPatch: (a: KiroArtifact) => KiroArtifact;
  sourcePatch: (s: KiroArtifactSourceRecord) => KiroArtifactSourceRecord;
}): Promise<{ outcome: "committed"; artifact: KiroArtifact }> {
  const db = await openArtifactDb();
  if (!db) throw new ComputerError("UNSUPPORTED_BROWSER", "当前环境不支持 Artifact Registry（无 IndexedDB）");
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([ARTIFACT_STORE, ARTIFACT_SOURCE_STORE], "readwrite");
      const artifactStore = tx.objectStore(ARTIFACT_STORE);
      const sourceStore = tx.objectStore(ARTIFACT_SOURCE_STORE);

      const artifactReq = artifactStore.get(input.artifactId);
      artifactReq.onsuccess = () => {
        const artifact = artifactReq.result as KiroArtifact | undefined;
        if (!artifact) {
          reject(new ComputerError("ARTIFACT_NOT_FOUND", "Artifact 不存在"));
          return;
        }
        const sourceReq = sourceStore.get(input.artifactId);
        sourceReq.onsuccess = () => {
          const source = sourceReq.result as KiroArtifactSourceRecord | undefined;
          if (!source) {
            reject(new ComputerError("ARTIFACT_NOT_FOUND", "Artifact Source 不存在"));
            return;
          }
          if (artifact.revision !== input.expectedRevision || source.revision !== input.expectedRevision) {
            reject(
              new ComputerError(
                "ARTIFACT_REVISION_CONFLICT",
                `Artifact 当前版本为 ${artifact.revision}，期望 ${input.expectedRevision}`
              )
            );
            return;
          }
          const updatedArtifact = input.artifactPatch(artifact);
          const updatedSource = input.sourcePatch(source);
          artifactStore.put(updatedArtifact, updatedArtifact.id);
          sourceStore.put(updatedSource, updatedSource.artifactId);
        };
        sourceReq.onerror = () => reject(new ComputerError("VERIFICATION_FAILED", "Artifact 读取失败"));
      };
      artifactReq.onerror = () => reject(new ComputerError("VERIFICATION_FAILED", "Artifact 读取失败"));

      tx.oncomplete = () => {
        // 事务已提交：重新读取确认（同事务内 put 后读取不可靠，这里在 oncomplete 后读）
        void artifactDbGet(input.artifactId).then((after) => {
          if (!after) {
            reject(new ComputerError("VERIFICATION_FAILED", "Artifact 提交后无法确认"));
            return;
          }
          resolve({ outcome: "committed", artifact: after });
        });
      };
      tx.onabort = () => reject(new ComputerError("VERIFICATION_FAILED", "Artifact revision 事务中止"));
      tx.onerror = () => reject(new ComputerError("VERIFICATION_FAILED", "Artifact revision 提交失败"));
    });
  } finally {
    db.close();
  }
}
