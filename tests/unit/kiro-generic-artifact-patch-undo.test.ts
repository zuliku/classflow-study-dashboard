import { describe, it, expect } from "vitest";
import {
  undoGenericArtifactPatchRuntime,
  RestoreGenericArtifactRevisionInverse,
} from "@/lib/ai/computer/genericArtifactPatchUndo";
import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";
import { KiroArtifact } from "@/lib/ai/computer/artifacts/types";
import { ComputerError } from "@/lib/ai/computer/errors";

/** 内存 fake Artifact Registry（helper deps 注入用） */
class FakeRegistry {
  private map = new Map<string, KiroArtifact>();
  constructor(private initial: KiroArtifact) {
    this.map.set(initial.id, initial);
  }
  get(id: string): KiroArtifact | null {
    return this.map.get(id) ?? null;
  }
  set(revision: number, updatedAt?: string) {
    const a = this.map.get(this.initial.id);
    if (a) this.map.set(a.id, { ...a, revision, updatedAt: updatedAt ?? new Date().toISOString() });
  }
}

/** 内存 fake filesystem（记录 write 调用） */
function fakeIo(initial: Record<string, string>): { io: ComputerAdapterIO; writes: string[]; text: () => string } {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  const io: ComputerAdapterIO = {
    list: async () => [],
    stat: async (p) => {
      const t = files.get(p);
      return t === undefined ? null : { kind: "file", size: new TextEncoder().encode(t).byteLength, type: "text/plain" };
    },
    readText: async (p) => {
      const t = files.get(p);
      if (t === undefined) throw new ComputerError("RESOURCE_NOT_FOUND", "文件不存在");
      return t;
    },
    readBytes: async () => new Uint8Array(),
    createDirectory: async () => "created",
    writeText: async (p, c) => {
      writes.push(p);
      files.set(p, c);
    },
    writeBytes: async () => undefined,
    remove: async (p) => {
      files.delete(p);
    },
    move: async () => undefined,
  };
  return { io, writes, text: () => files.get("notes.txt") ?? "" };
}

const ARTIFACT: KiroArtifact = {
  id: "art-1",
  workspaceId: "ws-a",
  rootId: "root-out",
  relativePath: "notes.txt",
  type: "text",
  title: "notes.txt",
  displayName: "notes.txt",
  source: "kiro-created",
  revision: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

function inverse(overrides: Partial<RestoreGenericArtifactRevisionInverse> = {}): RestoreGenericArtifactRevisionInverse {
  return {
    type: "restore-generic-artifact-revision",
    workspaceId: "ws-a",
    rootId: "root-out",
    relativePath: "notes.txt",
    artifactId: "art-1",
    previousRevision: 1,
    expectedCurrentRevision: 2,
    beforeText: "v1",
    ...overrides,
  };
}

describe("undoGenericArtifactPatchRuntime", () => {
  it("restores exact previous text and revision", async () => {
    const registry = new FakeRegistry(ARTIFACT);
    const { io, writes, text } = fakeIo({ "notes.txt": "v2" });
    await undoGenericArtifactPatchRuntime({
      io,
      inverse: inverse(),
      deps: {
        getArtifact: (id) => Promise.resolve(registry.get(id)),
        restoreGenericArtifactRevision: async (args) => {
          registry.set(args.revision);
          return registry.get("art-1")!;
        },
      },
    });
    expect(text()).toBe("v1");
    expect(registry.get("art-1")?.revision).toBe(1);
    // V2 closeout：factual previous 必须 read-only 验证，不能二次写
    expect(writes).toHaveLength(1);
  });

  it("rejects stale revision before any file write", async () => {
    const registry = new FakeRegistry({ ...ARTIFACT, revision: 3 });
    const { io, writes, text } = fakeIo({ "notes.txt": "v3" });
    await expect(
      undoGenericArtifactPatchRuntime({
        io,
        inverse: inverse(), // expects current revision 2, registry is 3
        deps: {
          getArtifact: (id) => Promise.resolve(registry.get(id)),
          restoreGenericArtifactRevision: async () => registry.get("art-1")!,
        },
      })
    ).rejects.toMatchObject({ code: "ARTIFACT_REVISION_CONFLICT" });
    expect(writes.length).toBe(0);
    expect(text()).toBe("v3");
  });

  it("treats post-commit API throw as success when factual registry is previous", async () => {
    const registry = new FakeRegistry(ARTIFACT);
    const { io, writes, text } = fakeIo({ "notes.txt": "v2" });
    await undoGenericArtifactPatchRuntime({
      io,
      inverse: inverse(),
      deps: {
        getArtifact: (id) => Promise.resolve(registry.get(id)),
        restoreGenericArtifactRevision: async (args) => {
          registry.set(args.revision); // 事务实际已提交
          throw new Error("simulated post-commit confirmation failure");
        },
      },
    });
    expect(text()).toBe("v1");
    expect(registry.get("art-1")?.revision).toBe(1);
    // factual previous → read-only verify，仍只有一次 restore write
    expect(writes).toHaveLength(1);
  });

  it("compensates file to pre-undo text when registry factually remains newer", async () => {
    const registry = new FakeRegistry(ARTIFACT);
    const { io, text } = fakeIo({ "notes.txt": "v2" });
    await expect(
      undoGenericArtifactPatchRuntime({
        io,
        inverse: inverse(),
        deps: {
          getArtifact: (id) => Promise.resolve(registry.get(id)),
          restoreGenericArtifactRevision: async () => {
            throw new Error("simulated pre-commit failure");
          },
        },
      })
    ).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
    expect(text()).toBe("v2"); // 补偿回撤销前
    expect(registry.get("art-1")?.revision).toBe(2);
  });

  it("fails safely on unknown registry state without blind success", async () => {
    const registry = new FakeRegistry(ARTIFACT);
    const { io, text } = fakeIo({ "notes.txt": "v2" });
    let restoreRan = false;
    await expect(
      undoGenericArtifactPatchRuntime({
        io,
        inverse: inverse(),
        deps: {
          // preflight 正常读到 revision 2；restore 后 registry 变为 missing（reread 失败 → unknown）
          getArtifact: () => Promise.resolve(restoreRan ? null : registry.get("art-1")),
          restoreGenericArtifactRevision: async () => {
            restoreRan = true;
            throw new Error("simulated failure");
          },
        },
      })
    ).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
    // 无 blind 补偿：文件保持 helper 已写的 beforeText，不补偿回 v2
    expect(text()).toBe("v1");
    void registry;
  });

  it("supports two revisions undone in reverse without drift", async () => {
    const registry = new FakeRegistry({ ...ARTIFACT, revision: 3 });
    const { io, text } = fakeIo({ "notes.txt": "v3" });
    const deps = {
      getArtifact: (id: string) => Promise.resolve(registry.get(id)),
      restoreGenericArtifactRevision: async (args: { artifactId: string; revision: number }) => {
        registry.set(args.revision);
        return registry.get("art-1")!;
      },
    };
    // inverse B: rev3 → rev2 (beforeText=v2)
    await undoGenericArtifactPatchRuntime({
      io,
      inverse: inverse({ previousRevision: 2, expectedCurrentRevision: 3, beforeText: "v2" }),
      deps,
    });
    expect(text()).toBe("v2");
    expect(registry.get("art-1")?.revision).toBe(2);
    // inverse A: rev2 → rev1 (beforeText=v1)
    await undoGenericArtifactPatchRuntime({
      io,
      inverse: inverse({ previousRevision: 1, expectedCurrentRevision: 2, beforeText: "v1" }),
      deps,
    });
    expect(text()).toBe("v1");
    expect(registry.get("art-1")?.revision).toBe(1);
  });
});
