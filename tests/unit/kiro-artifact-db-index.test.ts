import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  ARTIFACT_STORE,
  ARTIFACT_SOURCE_STORE,
  ARTIFACT_WORKSPACE_INDEX,
  artifactDbListByWorkspace,
} from "@/lib/ai/computer/artifacts/db";
import {
  registerCreatedArtifact,
  findArtifactByLocation,
  listArtifactsForWorkspace,
} from "@/lib/ai/computer/artifacts/service";
import { KiroArtifact } from "@/lib/ai/computer/artifacts/types";

const DB_NAME = "classflow-kiro-artifacts-v1";
const DB_VERSION = 2;

function deleteArtifactDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

/** 模拟 v1 旧库：只有两个 store，没有任何 index */
function seedV1(artifact: KiroArtifact): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(ARTIFACT_STORE)) {
        req.result.createObjectStore(ARTIFACT_STORE);
      }
      if (!req.result.objectStoreNames.contains(ARTIFACT_SOURCE_STORE)) {
        req.result.createObjectStore(ARTIFACT_SOURCE_STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(ARTIFACT_STORE, "readwrite");
      tx.objectStore(ARTIFACT_STORE).put(artifact, artifact.id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        const error = tx.error;
        db.close();
        reject(error);
      };
    };
    req.onerror = () => reject(req.error);
  });
}

function sampleArtifact(overrides: Partial<KiroArtifact> = {}): KiroArtifact {
  return {
    id: "artifact-v1",
    workspaceId: "ws-a",
    rootId: "root-out",
    relativePath: "old.md",
    type: "markdown",
    title: "旧文档",
    displayName: "old.md",
    source: "kiro-created",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("artifact IndexedDB v1 → v2 workspaceId index", () => {
  beforeEach(async () => {
    await deleteArtifactDb();
  });

  it("升级保留旧数据，并补建非唯一 workspaceId index（version=2）", async () => {
    const artifact = sampleArtifact();
    await seedV1(artifact);

    const listed = await artifactDbListByWorkspace("ws-a");
    expect(listed.map((a) => a.id)).toEqual([artifact.id]);
    expect(await artifactDbListByWorkspace("ws-b")).toEqual([]);

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(db.version).toBe(DB_VERSION);
    const store = db.transaction(ARTIFACT_STORE, "readonly").objectStore(ARTIFACT_STORE);
    expect(store.indexNames.contains(ARTIFACT_WORKSPACE_INDEX)).toBe(true);
    expect(store.index(ARTIFACT_WORKSPACE_INDEX).unique).toBe(false);
    db.close();
  });

  it("service 列表/定位只返回目标 workspace 的记录", async () => {
    const a = await registerCreatedArtifact({
      workspaceId: "ws-a",
      rootId: "root-out",
      relativePath: "a.md",
      type: "markdown",
    });
    const b = await registerCreatedArtifact({
      workspaceId: "ws-b",
      rootId: "root-out",
      relativePath: "b.md",
      type: "markdown",
    });

    expect((await listArtifactsForWorkspace("ws-a")).map((x) => x.id)).toEqual([a.id]);
    expect((await listArtifactsForWorkspace("ws-b")).map((x) => x.id)).toEqual([b.id]);
    expect(await findArtifactByLocation("ws-a", "root-out", "a.md")).toEqual(a);
    expect(await findArtifactByLocation("ws-b", "root-out", "a.md")).toBeNull();
    expect(await findArtifactByLocation("ws-a", "root-out", "missing.md")).toBeNull();
  });
});
