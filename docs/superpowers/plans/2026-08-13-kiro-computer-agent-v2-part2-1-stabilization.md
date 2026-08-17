# Kiro Computer Agent V2 — Part 2.1 Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix premature Computer mutation-quota consumption and make structured-document Undo preserve factual filesystem/Artifact revision consistency across restore and confirmation failures.

**Architecture:** Keep the existing V2 Computer Executor, Approval, Artifact Registry, and Checkpoint model. Move mutation counting for relocation/document revision to the actual write boundary, and extract document-revision Undo from `useKiroChat.ts` into a focused runtime helper that can factually re-read Artifact/Source state after restore errors and compensate the filesystem only when the registry state is coherently known.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, IndexedDB/fake-indexeddb, existing Computer Runtime/Artifact Service, Vitest.

## Global Constraints

- Add no user-facing Computer capability or UI.
- Do not change model-facing tool schemas, capabilities, or permission modes.
- Approval-required is not a mutation: no filesystem mutation, no Tool Output, and no mutation quota consumption.
- `rename_file`, `move_file`, and `update_document` increment `mutationCount` exactly once immediately before the first filesystem mutation.
- Invalid input, path/sandbox rejection, deny, read-only, approval-required, Artifact revision conflict, file-too-large, and pure render failure consume zero mutation quota.
- Pure document rendering must happen outside the write/rollback `try` block. A render failure must not trigger a compensating file write.
- Once the first filesystem mutation begins, the call counts as one mutation even if verification/registry synchronization later fails.
- Document Undo may report success only when filesystem content, Artifact metadata, and Source IR all factually match the previous revision.
- A thrown `restoreArtifactRevision()` does not prove whether its IndexedDB transaction committed; factually re-read Artifact + Source before choosing compensation.
- Compensate the file back to the newer state only when Artifact and Source are coherently still on `expectedCurrentRevision`.
- Split/missing/unreadable/unknown Artifact state fails safely without blind compensation or blind revision commit.
- Current/newer and previous file snapshots, Source IR, checkpoint internals, adapter refs, native paths, and tool inputs remain runtime-only and never enter Tool Output, Kiro history, audit, or persisted Zustand.
- Keep verification focused: three Computer unit files plus `npm run typecheck`. Skip Playwright/full suites/build by default.

---

## File Map

### Create
- `lib/ai/computer/documentRevisionUndo.ts` — testable runtime helper for `restore-document-revision`, factual state classification, and safe filesystem compensation.

### Modify
- `lib/ai/computer/executor.ts` — correct relocation/update-document mutation-counter timing.
- `hooks/useKiroChat.ts` — delegate document-revision Undo to the new runtime helper.
- `tests/unit/kiro-computer-relocation.test.ts` — rename/move approval and resume quota regression.
- `tests/unit/kiro-computer-tools.test.ts` — update-document approval/preflight quota regression.
- `tests/unit/kiro-computer-checkpoints.test.ts` — direct runtime Undo coverage for Markdown, DOCX, ambiguous restore, compensation, stale state, and multiple revisions.

No schema/history/audit/UI file is part of the planned change set.

---

### Task 1: Correct Mutation Quota Semantics

**Files:**
- Modify: `lib/ai/computer/executor.ts`
- Test: `tests/unit/kiro-computer-relocation.test.ts`
- Test: `tests/unit/kiro-computer-tools.test.ts`

**Interfaces:**
- Consumes: existing `ComputerCounterState`, `executeKiroComputerTool()`, Approval and one-shot rules.
- Produces: unchanged public interfaces; corrected timing of `counters.mutationCount += 1` only.

- [ ] **Step 1: Add failing relocation quota tests**

Extend `describe("relocation approval")` in `tests/unit/kiro-computer-relocation.test.ts`.

```ts
it("Guided rename approval-required does not consume mutation quota", async () => {
  await sandboxWriteText(SANDBOX_A, "draft.md", "d");
  const c = counters();
  const attempt = await executeKiroComputerTool({
    toolName: "rename_file",
    toolCallId: "call-quota-rename",
    toolInput: { rootId: "output", path: "draft.md", newName: "final.md" },
    context: ctx(workspace, [], "guided"),
    counters: c,
  });
  expect(attempt.kind).toBe("approval-required");
  expect(c.mutationCount).toBe(0);
  expect(await sandboxReadText(SANDBOX_A, "draft.md")).toBe("d");
});
```

```ts
it("Workspace Auto move approval-required does not consume mutation quota", async () => {
  await sandboxWriteText(SANDBOX_A, "notes.md", "n");
  const c = counters();
  const attempt = await executeKiroComputerTool({
    toolName: "move_file",
    toolCallId: "call-quota-move",
    toolInput: {
      rootId: "output",
      path: "notes.md",
      destinationRootId: "archive",
      destinationPath: "notes.md",
    },
    context: ctx(),
    counters: c,
    oneShotApprovals: [],
  });
  expect(attempt.kind).toBe("approval-required");
  expect(c.mutationCount).toBe(0);
});
```

```ts
it("approved relocation consumes exactly one mutation quota", async () => {
  await sandboxWriteText(SANDBOX_A, "notes.md", "n");
  const c = counters();
  const oneShots: ComputerOneShotApproval[] = [{
    approvalId: "quota-a1",
    toolCallId: "call-quota-resume",
    capability: "fs.move",
    workspaceId: "research",
    rootId: "output",
    relativePath: "notes.md",
  }];
  const attempt = await executeKiroComputerTool({
    toolName: "move_file",
    toolCallId: "call-quota-resume",
    toolInput: {
      rootId: "output",
      path: "notes.md",
      destinationRootId: "archive",
      destinationPath: "notes.md",
    },
    context: ctx(),
    counters: c,
    oneShotApprovals: oneShots,
  });
  expect(attempt.kind).toBe("completed");
  if (attempt.kind === "completed") expect(attempt.output.ok).toBe(true);
  expect(c.mutationCount).toBe(1);
});
```

- [ ] **Step 2: Add failing `update_document` quota tests**

Inside `describe("update_document（V2 Part 2）")` in `tests/unit/kiro-computer-tools.test.ts`, add:

```ts
it("Guided update_document asks without quota and approved resume consumes one", async () => {
  const artifactId = await seedEditableDoc(counters());
  expect(artifactId).toBeTruthy();
  if (!artifactId) return;

  const c = counters();
  const pending = await executeKiroComputerTool({
    toolName: "update_document",
    toolCallId: "call-doc-quota",
    toolInput: { artifactId, expectedRevision: 1, document: IR_V2 },
    context: ctx(),
    counters: c,
  });
  expect(pending.kind).toBe("approval-required");
  expect(c.mutationCount).toBe(0);

  const oneShots: ComputerOneShotApproval[] = [{
    approvalId: "doc-quota-a1",
    toolCallId: "call-doc-quota",
    capability: "document.modify",
    workspaceId: "research",
    rootId: "output",
    relativePath: "plan.md",
  }];
  const resumed = await executeKiroComputerTool({
    toolName: "update_document",
    toolCallId: "call-doc-quota",
    toolInput: { artifactId, expectedRevision: 1, document: IR_V2 },
    context: ctx(),
    counters: c,
    oneShotApprovals: oneShots,
  });
  expect(resumed.kind).toBe("completed");
  if (resumed.kind === "completed") expect(resumed.output.ok).toBe(true);
  expect(c.mutationCount).toBe(1);
});
```

For the existing stale-revision and `>5 MiB` tests, give the rejected call a fresh counter object and assert `mutationCount === 0` after rejection.

- [ ] **Step 3: Run Task 1 tests RED**

```bash
npx vitest run \
  tests/unit/kiro-computer-relocation.test.ts \
  tests/unit/kiro-computer-tools.test.ts
```

Expected before fix: new quota assertions fail because V2 special branches increment before approval/preflight completes.

- [ ] **Step 4: Move relocation counter to the actual relocation boundary**

In `lib/ai/computer/executor.ts`, remove the increment at the top of:

```ts
if (toolName === "rename_file" || toolName === "move_file") {
```

Keep schema/path, dual-resource policy, approval, Artifact lookup, and adapter resolution before quota consumption. Immediately before `sourceAdapter.move(...)` or `relocateFile(...)`, increment once:

```ts
const artifact = await findArtifactByLocation(ws.id, root.id, sourcePath);
const sourceAdapter = getComputerAdapterForAdapterRef(root.adapterRef);
const destAdapter = getComputerAdapterForAdapterRef(destRoot.adapterRef);

counters.mutationCount += 1;

if (root.adapterRef === destRoot.adapterRef) {
  await sourceAdapter.move(sourcePath, destinationPath);
} else {
  await relocateFile({
    source: sourceAdapter,
    sourcePath,
    destination: destAdapter,
    destinationPath,
  });
}
```

Do not increment again during Artifact Registry location synchronization or Approval resume.

- [ ] **Step 5: Separate `update_document` render from mutation/rollback**

Remove the early counter increment from the beginning of the `update_document` branch.

After editability/workspace/policy/approval/stat/size/snapshot preflight, render the target payload in a pure pre-write phase:

```ts
type RenderedDocumentWrite =
  | { format: "markdown"; text: string }
  | { format: "docx"; bytes: Uint8Array };

let rendered: RenderedDocumentWrite;
try {
  rendered =
    artifact.type === "markdown"
      ? { format: "markdown", text: renderMarkdown(document) }
      : { format: "docx", bytes: await renderDocx(document) };
} catch {
  return {
    kind: "completed",
    output: { ok: false, code: "DOCUMENT_RENDER_FAILED", message: "文档渲染失败" },
  };
}
```

A render failure must return here: no quota increment and no rollback write because the filesystem has not changed.

- [ ] **Step 6: Count exactly once immediately before the first document write**

After successful render:

```ts
counters.mutationCount += 1;

try {
  if (rendered.format === "markdown") {
    await adapter.writeText(artifactPath, rendered.text, "text/markdown");
    const readBack = await adapter.readText(artifactPath);
    if (!(await verifyMarkdownWritten(rendered.text, readBack))) {
      throw new ComputerError("VERIFICATION_FAILED", "Markdown 校验失败");
    }
  } else {
    await adapter.writeBytes(
      artifactPath,
      rendered.bytes,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    const readBack = await adapter.readBytes(artifactPath);
    if (!(await verifyDocxBytes(readBack))) {
      throw new ComputerError("VERIFICATION_FAILED", "DOCX 校验失败");
    }
  }
} catch (err) {
  // Existing exact rollback semantics remain here because a filesystem write has begun.
  ...
}
```

Keep the existing exact rollback and Artifact revision commit behavior after this boundary. Do not add any second increment for rollback or Registry commit.

- [ ] **Step 7: Run Task 1 tests GREEN**

```bash
npx vitest run \
  tests/unit/kiro-computer-relocation.test.ts \
  tests/unit/kiro-computer-tools.test.ts
```

- [ ] **Step 8: Commit Task 1**

```bash
git add \
  lib/ai/computer/executor.ts \
  tests/unit/kiro-computer-relocation.test.ts \
  tests/unit/kiro-computer-tools.test.ts

git commit -m "fix(kiro): count computer mutations at execution"
```

---

### Task 2: Make Document Revision Undo Factually Consistent

**Files:**
- Create: `lib/ai/computer/documentRevisionUndo.ts`
- Modify: `hooks/useKiroChat.ts`
- Test: `tests/unit/kiro-computer-checkpoints.test.ts`

**Interfaces:**

Create:

```ts
export type RestoreDocumentRevisionInverse = Extract<
  ComputerInverseOperation,
  { type: "restore-document-revision" }
>;

export interface DocumentRevisionUndoDeps {
  getArtifact: typeof getArtifact;
  getArtifactSource: typeof getArtifactSource;
  restoreArtifactRevision: typeof restoreArtifactRevision;
}

export async function undoDocumentRevisionRuntime(input: {
  io: ComputerAdapterIO;
  inverse: RestoreDocumentRevisionInverse;
  deps?: Partial<DocumentRevisionUndoDeps>;
}): Promise<void>;
```

The helper uses real Artifact service functions by default. Dependency injection exists only for deterministic failure-state tests.

- [ ] **Step 1: Replace the manual Markdown checkpoint test with a direct runtime-helper test**

Import `undoDocumentRevisionRuntime` in `tests/unit/kiro-computer-checkpoints.test.ts` and change the existing Markdown V2→V1 test to call the helper directly:

```ts
await undoDocumentRevisionRuntime({ io: await io(), inverse });
expect(await sandboxReadText(SANDBOX_REF, "plan.md")).toBe(
  inverse.snapshot.format === "markdown" ? inverse.snapshot.text : ""
);
expect((await getArtifact(artifactId))?.revision).toBe(1);
expect((await getArtifactSource(artifactId))?.revision).toBe(1);
```

- [ ] **Step 2: Add exact DOCX Undo coverage**

Test flow:

```text
create_document plan.docx with IR_V1
read exact V1 bytes
update_document to IR_V2
extract restore-document-revision inverse
undoDocumentRevisionRuntime(...)
read exact final bytes
```

Assert byte-for-byte equality with the saved V1 bytes, Artifact revision 1, Source revision 1, and Source IR V1. Add a local deterministic `bytesEqual(a,b)` test helper.

- [ ] **Step 3: Add factual restore-error tests**

Add these three tests.

**A. Commit succeeds, wrapper throws afterward:**

```ts
const realRestore = restoreArtifactRevision;
await undoDocumentRevisionRuntime({
  io: await io(),
  inverse,
  deps: {
    restoreArtifactRevision: async (args) => {
      await realRestore(args);
      throw new Error("simulated post-commit confirmation failure");
    },
  },
});
```

Assert helper returns successfully, file remains previous snapshot, and Artifact + Source are previous revision. This proves thrown API error does not trigger blind compensation.

**B. Restore fails before commit:**

```ts
await expect(
  undoDocumentRevisionRuntime({
    io: await io(),
    inverse,
    deps: {
      restoreArtifactRevision: async () => {
        throw new Error("simulated pre-commit failure");
      },
    },
  })
).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
```

Assert file has been compensated exactly back to V2/current content and Artifact + Source remain on `expectedCurrentRevision`.

**C. Restore leaves a split Registry state:**

Inside the injected restore function, use existing exported Artifact DB APIs to write only Artifact metadata to `previousRevision`, leave Source at `expectedCurrentRevision`, then throw.

Assert helper rejects with `VERIFICATION_FAILED` manual-inspection semantics. Assert it does not blindly compensate the file back to newer merely because an error was thrown.

- [ ] **Step 4: Add stale preflight test**

Produce an inverse expecting revision 2, then legitimately advance Artifact + Source to revision 3. Capture current V3 file. Call the stale inverse and assert:

```text
ARTIFACT_REVISION_CONFLICT
file unchanged at V3
Artifact revision 3
Source revision 3
```

No file write may occur before this rejection.

- [ ] **Step 5: Add two-revision reverse Undo test**

Execute:

```text
V1 create
V1 -> V2 = inverseA
V2 -> V3 = inverseB
undo inverseB => V2
undo inverseA => V1
```

After each Undo, assert exact file content and both stored revision numbers.

- [ ] **Step 6: Run checkpoint tests RED**

```bash
npx vitest run tests/unit/kiro-computer-checkpoints.test.ts
```

Expected before implementation: helper import is missing and current Hook-only code cannot support the injected recovery-state cases.

- [ ] **Step 7: Implement exact snapshot utilities in `documentRevisionUndo.ts`**

Use the existing `DocumentFileSnapshot` type from `checkpoints.ts`.

```ts
const DOCUMENT_UNDO_LIMIT_BYTES = 5 * 1024 * 1024;

async function readCurrentSnapshot(
  io: ComputerAdapterIO,
  inverse: RestoreDocumentRevisionInverse
): Promise<DocumentFileSnapshot> {
  const stat = await io.stat(inverse.relativePath);
  if (!stat || stat.kind !== "file") {
    throw new ComputerError("RESOURCE_NOT_FOUND", "Artifact 文件不存在");
  }
  if (stat.size > DOCUMENT_UNDO_LIMIT_BYTES) {
    throw new ComputerError("FILE_TOO_LARGE", "文档超过 5 MiB，无法安全撤销");
  }
  return inverse.snapshot.format === "markdown"
    ? { format: "markdown", text: await io.readText(inverse.relativePath) }
    : { format: "docx", bytes: await io.readBytes(inverse.relativePath) };
}
```

Implement `writeAndVerifySnapshot()` using exact string equality or exact byte equality.

- [ ] **Step 8: Implement coherent revision-state classification**

```ts
type RegistryRevisionState = "previous" | "newer" | "unknown";

function classifyRegistryState(input: {
  artifact: KiroArtifact | null;
  source: KiroArtifactSourceRecord | null;
  previousRevision: number;
  expectedCurrentRevision: number;
}): RegistryRevisionState {
  if (
    input.artifact?.revision === input.previousRevision &&
    input.source?.revision === input.previousRevision
  ) return "previous";

  if (
    input.artifact?.revision === input.expectedCurrentRevision &&
    input.source?.revision === input.expectedCurrentRevision
  ) return "newer";

  return "unknown";
}
```

Do not infer a state from Artifact metadata alone.

- [ ] **Step 9: Implement stale/location/source preflight before file mutation**

`undoDocumentRevisionRuntime()` must first read Artifact and Source and require:

```text
Artifact exists
Artifact.workspaceId === inverse.workspaceId
Artifact.rootId === inverse.rootId
Artifact.relativePath === inverse.relativePath
Artifact.revision === inverse.expectedCurrentRevision
Source exists
Source.revision === inverse.expectedCurrentRevision
```

Revision mismatch → `ARTIFACT_REVISION_CONFLICT`.

Missing/split/location mismatch → existing specific Artifact error or `VERIFICATION_FAILED`.

Only after all checks pass, capture the exact current/newer file snapshot.

- [ ] **Step 10: Implement normal previous-revision restore**

Flow:

```ts
const newerSnapshot = await readCurrentSnapshot(io, inverse);

try {
  await writeAndVerifySnapshot(io, inverse.relativePath, inverse.snapshot);
} catch {
  // Registry is still known-newer because restoreArtifactRevision has not run.
  try {
    await writeAndVerifySnapshot(io, inverse.relativePath, newerSnapshot);
  } catch {
    throw new ComputerError(
      "VERIFICATION_FAILED",
      "撤销文件恢复失败且无法恢复撤销前状态，文件 / Artifact 可能需要人工检查"
    );
  }
  throw new ComputerError("VERIFICATION_FAILED", "撤销未完成，已恢复撤销前状态");
}

try {
  await deps.restoreArtifactRevision({
    artifactId: inverse.artifactId,
    expectedCurrentRevision: inverse.expectedCurrentRevision,
    revision: inverse.previousRevision,
    document: inverse.previousDocument,
  });
} catch {
  // Do not decide yet; factual read below determines state.
}
```

- [ ] **Step 11: Re-read facts and choose exactly one recovery path**

After the restore call, whether it resolved or threw:

```ts
const artifactAfter = await deps.getArtifact(inverse.artifactId);
const sourceAfter = await deps.getArtifactSource(inverse.artifactId);
const state = classifyRegistryState({
  artifact: artifactAfter,
  source: sourceAfter,
  previousRevision: inverse.previousRevision,
  expectedCurrentRevision: inverse.expectedCurrentRevision,
});
```

Behavior:

```text
previous:
  verify file exactly equals inverse.snapshot
  return success

newer:
  write newerSnapshot back
  exact verify
  re-read Artifact + Source and require both still newer
  throw VERIFICATION_FAILED("撤销未完成，已恢复撤销前状态")

unknown:
  do not blind-compensate
  do not write registry
  throw VERIFICATION_FAILED("撤销状态无法确认，文件 / Artifact 可能需要人工检查")
```

If newer-state compensation or its final re-read fails, throw the manual-inspection message.

- [ ] **Step 12: Delegate Hook orchestration to the helper**

In `hooks/useKiroChat.ts`, keep live Workspace/root resolution in the existing Undo loop. For `restore-document-revision`:

```ts
const root = ws.roots.find((r) => r.id === inverse.rootId);
if (!root) throw new ComputerError("ROOT_NOT_FOUND", "根目录不存在");
const io = getComputerAdapterForAdapterRef(root.adapterRef);
await undoDocumentRevisionRuntime({ io, inverse });
```

Delete the old Hook-local file/Artifact restoration implementation and its local byte-comparison helper if unused.

Do not change the existing task/checkpoint status logic: thrown helper error → `undo_failed`; only successful completion of every inverse → `undone`.

- [ ] **Step 13: Run checkpoint tests GREEN**

```bash
npx vitest run tests/unit/kiro-computer-checkpoints.test.ts
```

- [ ] **Step 14: Commit Task 2**

```bash
git add \
  lib/ai/computer/documentRevisionUndo.ts \
  hooks/useKiroChat.ts \
  tests/unit/kiro-computer-checkpoints.test.ts

git commit -m "fix(kiro): harden document revision undo"
```

---

### Task 3: Focused Verification and Boundary Audit

**Files:**
- No planned source changes.

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: verified Part 2.1 stabilization without new UI/tool surface.

- [ ] **Step 1: Run the full focused unit set**

```bash
npx vitest run \
  tests/unit/kiro-computer-relocation.test.ts \
  tests/unit/kiro-computer-tools.test.ts \
  tests/unit/kiro-computer-checkpoints.test.ts
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Run the narrow static audit**

```bash
rg -n \
  "mutationCount \+= 1|restore-document-revision|previousDocument|snapshot|adapterRef|nativePath|FileSystemDirectoryHandle" \
  lib/ai/computer hooks/useKiroChat.ts lib/ai/history
```

Confirm:

```text
rename_file/move_file/update_document do not increment before approval
approved executions increment exactly once
render failure performs no rollback write
runtime document snapshots remain confined to checkpoints/documentRevisionUndo/useKiroChat runtime paths
history sanitizer does not persist previousDocument/snapshot/bytes
no new model-facing tool/schema/capability exists
```

- [ ] **Step 4: Build / Playwright policy**

```text
Playwright: SKIP — no user-visible behavior changed
npm run build: SKIP — no client/server or bundling boundary changed
```

Only run build if typecheck reveals a compile/bundle-only issue.

- [ ] **Step 5: If focused verification exposes a directly related defect, fix it and create one hardening commit**

Only the following known files may be included in that hardening commit:

```bash
git add \
  lib/ai/computer/executor.ts \
  lib/ai/computer/documentRevisionUndo.ts \
  hooks/useKiroChat.ts \
  tests/unit/kiro-computer-relocation.test.ts \
  tests/unit/kiro-computer-tools.test.ts \
  tests/unit/kiro-computer-checkpoints.test.ts

git commit -m "fix(kiro): harden revision stabilization"
```

If there is no additional change, do not create this commit.

---

## Final Acceptance Checklist

### Mutation quota

- [ ] Guided `rename_file` ask consumes 0.
- [ ] `move_file` ask consumes 0.
- [ ] Guided `update_document` ask consumes 0.
- [ ] Approved relocation consumes exactly 1.
- [ ] Approved document update consumes exactly 1.
- [ ] Stale Artifact revision consumes 0.
- [ ] File-too-large consumes 0.
- [ ] Pure render failure consumes 0 and performs no rollback write.
- [ ] Verification/registry failure after first write still counts as 1.

### Document Undo

- [ ] Markdown exact Undo restores file + Artifact + Source.
- [ ] DOCX exact-byte Undo restores file + Artifact + Source.
- [ ] Stale/split preflight fails before file mutation.
- [ ] Restore error + factually previous Registry is accepted as success.
- [ ] Factually newer Registry triggers exact file compensation to newer state and returns failure.
- [ ] Split/unknown Registry state never triggers blind compensation/commit.
- [ ] Compensation failure reports manual-inspection verification failure.
- [ ] Two revisions undo in reverse order without drift.
- [ ] Existing checkpoint single-use semantics remain unchanged.

### Security / persistence

- [ ] No new model-facing tool/schema/capability.
- [ ] No native path/handle/adapterRef exposed.
- [ ] Newer/previous file snapshots remain runtime-only.
- [ ] Source IR remains only in the existing Artifact Source Store and runtime checkpoint/helper paths.
- [ ] Kiro history/audit/Zustand do not persist checkpoint snapshots.

### Verification

- [ ] 3 focused Vitest files PASS.
- [ ] `npm run typecheck` PASS.
- [ ] Playwright skipped by Part 2.1 policy.
- [ ] Build skipped unless explicitly justified.

## Commit Strategy

Prefer two implementation commits:

1. `fix(kiro): count computer mutations at execution`
2. `fix(kiro): harden document revision undo`

Allow one additional `fix(kiro): harden revision stabilization` only if focused verification finds a directly related defect.

## Final Report

Report only:

```text
Kiro Computer Agent V2 — Part 2.1 Stabilization Result

Commits:
- SHA + message

Mutation quota:
- relocation ask/resume
- document update ask/resume
- preflight/render failures

Document Undo:
- factual registry classification
- Markdown/DOCX exact restore
- compensation semantics
- stale/multi-revision behavior

Security boundary:
- runtime-only snapshots
- no schema/capability expansion

Verification:
- 3 focused Vitest files
- typecheck
- Playwright skipped
- build skipped or justified

Next:
- V2 Part 3 Artifact UX
```

After this report, **STOP**. Do not start Artifact Preview, Download, Recent Artifacts, Ask Kiro about Artifact, Tauri, shell, or MCP.