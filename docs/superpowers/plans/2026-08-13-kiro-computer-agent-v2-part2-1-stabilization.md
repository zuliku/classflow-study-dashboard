# Kiro Computer Agent V2 — Part 2.1 Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix premature Computer mutation-quota consumption and make structured-document Undo preserve factual filesystem/Artifact revision consistency across restore and confirmation failures.

**Architecture:** Keep the existing V2 Computer Executor, Approval, Artifact Registry, and Checkpoint model. Move mutation counting for relocation/document revision to the actual mutation boundary, and extract document-revision Undo from `useKiroChat.ts` into a small runtime helper that can factually re-read Artifact/Source state after restore errors and compensate the filesystem only when the authoritative registry state is coherently known.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Zustand, IndexedDB/fake-indexeddb, existing Computer Runtime/Artifact Service, Vitest.

## Global Constraints

- Add no new user-facing Computer capability or UI.
- Do not change model-facing tool schemas or permission modes.
- Approval-required is not a mutation: no filesystem mutation, no Tool Output, and no mutation quota consumption.
- `rename_file`, `move_file`, and `update_document` increment `mutationCount` exactly once immediately before the first filesystem mutation.
- Pre-write invalid input, deny, read-only, approval-required, Artifact revision conflict, and file-too-large failures consume zero mutation quota.
- Once real filesystem mutation begins, the call counts as one mutation even if verification/registry synchronization later fails.
- A document Undo may report success only when filesystem content, Artifact metadata, and Source IR all factually match the previous revision.
- A thrown `restoreArtifactRevision()` call does not prove whether its IndexedDB transaction committed; always factually re-read Artifact + Source before choosing compensation.
- Compensate the file back to the newer state only when Artifact and Source are coherently still on `expectedCurrentRevision`.
- Split/missing/unreadable/unknown Artifact state must fail safely without blind compensation.
- Current/newer file snapshots, previous file snapshots, Source IR, checkpoint internals, adapter refs, native paths, and tool inputs remain runtime-only and never enter Tool Output, Kiro history, audit, or persisted Zustand.
- Keep verification focused: `kiro-computer-relocation.test.ts`, `kiro-computer-tools.test.ts`, `kiro-computer-checkpoints.test.ts`, and `npm run typecheck`. Skip Playwright/full suites/build by default.

---

## File Map

### Create
- `lib/ai/computer/documentRevisionUndo.ts` — testable runtime helper for `restore-document-revision`, factual state classification, and safe filesystem compensation.

### Modify
- `lib/ai/computer/executor.ts` — move relocation/update-document mutation counters to the first filesystem mutation boundary.
- `hooks/useKiroChat.ts` — delegate `restore-document-revision` execution to the new runtime helper; keep task/checkpoint orchestration unchanged.
- `tests/unit/kiro-computer-relocation.test.ts` — approval/quota regression for rename/move and approved resume.
- `tests/unit/kiro-computer-tools.test.ts` — update-document approval/preflight quota regression.
- `tests/unit/kiro-computer-checkpoints.test.ts` — direct document-Undo helper tests for Markdown, DOCX, restore ambiguity, compensation, stale state, and multi-revision reverse Undo.

No schema/history/audit/UI files should change unless typecheck proves a direct requirement.

---

### Task 1: Correct Mutation Quota Semantics

**Files:**
- Modify: `lib/ai/computer/executor.ts`
- Test: `tests/unit/kiro-computer-relocation.test.ts`
- Test: `tests/unit/kiro-computer-tools.test.ts`

**Interfaces:**
- Consumes: existing `ComputerCounterState { readCount: number; mutationCount: number }`, `executeKiroComputerTool()`, Approval/one-shot semantics.
- Produces: unchanged public interfaces; only corrected timing of `counters.mutationCount += 1`.

- [ ] **Step 1: Add failing relocation quota tests**

In `tests/unit/kiro-computer-relocation.test.ts`, extend `describe("relocation approval")` with exact counter assertions.

For Guided rename:

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

For Workspace Auto move (still `fs.move = ask`):

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

For approved resume:

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

In `tests/unit/kiro-computer-tools.test.ts`, inside `describe("update_document（V2 Part 2）")`, add:

```ts
it("Guided update_document approval-required does not consume mutation quota; approved resume consumes one", async () => {
  const seedCounters = counters();
  const artifactId = await seedEditableDoc(seedCounters);
  expect(artifactId).toBeTruthy();
  if (!artifactId) return;

  const approvalCounters = counters();
  const pending = await executeKiroComputerTool({
    toolName: "update_document",
    toolCallId: "call-doc-quota",
    toolInput: { artifactId, expectedRevision: 1, document: IR_V2 },
    context: ctx(),
    counters: approvalCounters,
  });
  expect(pending.kind).toBe("approval-required");
  expect(approvalCounters.mutationCount).toBe(0);

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
    counters: approvalCounters,
    oneShotApprovals: oneShots,
  });
  expect(resumed.kind).toBe("completed");
  if (resumed.kind === "completed") expect(resumed.output.ok).toBe(true);
  expect(approvalCounters.mutationCount).toBe(1);
});
```

Also assert zero mutation count for stale revision and >5 MiB pre-write rejection by giving those calls fresh `counters()` objects and checking `.mutationCount === 0` after the call.

- [ ] **Step 3: Run only the two affected unit files and confirm RED**

```bash
npx vitest run \
  tests/unit/kiro-computer-relocation.test.ts \
  tests/unit/kiro-computer-tools.test.ts
```

Expected before the fix: the new approval/preflight counter assertions fail because special V2 branches increment too early.

- [ ] **Step 4: Move relocation counting to the mutation boundary**

In `lib/ai/computer/executor.ts`, remove the early increment at the beginning of:

```ts
if (toolName === "rename_file" || toolName === "move_file") {
  counters.mutationCount += 1;
```

After schema/path/policy/approval handling and immediately before the first adapter relocation call, add exactly one increment:

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

Do not add a second increment during Artifact Registry synchronization or resume.

- [ ] **Step 5: Move `update_document` counting to the first file write**

Remove the early:

```ts
counters.mutationCount += 1;
```

from the beginning of the `update_document` branch.

Keep all of these before quota consumption:

```text
Artifact editability/revision check
frozen Workspace check
root/path resolution
policy / approval
stat + file-size limit
exact current snapshot
rendering of the new Markdown/DOCX payload
```

Restructure the render/write block so render completes before the increment. The intended shape is:

```ts
if (artifact.type === "markdown") {
  const markdown = renderMarkdown(document); // pure pre-write work
  counters.mutationCount += 1;
  await adapter.writeText(artifactPath, markdown, "text/markdown");
  const readBack = await adapter.readText(artifactPath);
  if (!(await verifyMarkdownWritten(markdown, readBack))) {
    throw new ComputerError("VERIFICATION_FAILED", "Markdown 校验失败");
  }
} else {
  const bytes = await renderDocx(document); // render before quota consumption
  counters.mutationCount += 1;
  await adapter.writeBytes(
    artifactPath,
    bytes,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  const readBack = await adapter.readBytes(artifactPath);
  if (!(await verifyDocxBytes(readBack))) {
    throw new ComputerError("VERIFICATION_FAILED", "DOCX 校验失败");
  }
}
```

Each execution path reaches exactly one increment. Do not increment again for atomic Artifact revision commit or rollback.

- [ ] **Step 6: Run Task 1 tests GREEN**

```bash
npx vitest run \
  tests/unit/kiro-computer-relocation.test.ts \
  tests/unit/kiro-computer-tools.test.ts
```

- [ ] **Step 7: Commit Task 1**

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

Create this exported helper contract:

```ts
import { ComputerAdapterIO } from "@/lib/ai/computer/executor-types";
import { ComputerInverseOperation } from "@/lib/ai/computer/checkpoints";
import { KiroArtifact, KiroArtifactSourceRecord } from "@/lib/ai/computer/artifacts/types";

export type RestoreDocumentRevisionInverse = Extract<
  ComputerInverseOperation,
  { type: "restore-document-revision" }
>;

export interface DocumentRevisionUndoDeps {
  getArtifact: (artifactId: string) => Promise<KiroArtifact | null>;
  getArtifactSource: (artifactId: string) => Promise<KiroArtifactSourceRecord | null>;
  restoreArtifactRevision: (input: {
    artifactId: string;
    expectedCurrentRevision: number;
    revision: number;
    document: RestoreDocumentRevisionInverse["previousDocument"];
  }) => Promise<KiroArtifact>;
}

export async function undoDocumentRevisionRuntime(input: {
  io: ComputerAdapterIO;
  inverse: RestoreDocumentRevisionInverse;
  deps?: Partial<DocumentRevisionUndoDeps>;
}): Promise<void>;
```

Default deps use the existing Artifact service functions. Injection exists only to make failure states deterministic in unit tests; it is not persisted or exposed to the model.

- [ ] **Step 1: Add failing direct helper tests for normal Markdown/DOCX Undo**

In `tests/unit/kiro-computer-checkpoints.test.ts`, import `undoDocumentRevisionRuntime` and replace the current manual Markdown restoration test with a direct helper call.

Markdown pattern:

```ts
await undoDocumentRevisionRuntime({ io: await io(), inverse });
expect(await sandboxReadText(SANDBOX_REF, "plan.md")).toBe(
  inverse.snapshot.format === "markdown" ? inverse.snapshot.text : ""
);
expect((await getArtifact(artifactId))?.revision).toBe(1);
expect((await getArtifactSource(artifactId))?.revision).toBe(1);
```

Add a DOCX test that:

1. creates `plan.docx` with IR V1;
2. reads and stores exact V1 bytes;
3. updates to V2;
4. calls the helper with the runtime inverse;
5. reads exact post-Undo bytes and compares byte-for-byte with V1;
6. asserts Artifact + Source revision are 1 and Source IR is V1.

Use a local `bytesEqual()` test helper; no new dependency.

- [ ] **Step 2: Add failing restore-error state-classification tests**

Add three deterministic tests using `deps.restoreArtifactRevision` injection.

**Case A — commit actually happened, API then throws:**

```ts
const realRestore = restoreArtifactRevision;
await undoDocumentRevisionRuntime({
  io: await io(),
  inverse,
  deps: {
    restoreArtifactRevision: async (args) => {
      await realRestore(args); // commits previous revision
      throw new Error("simulated post-commit confirmation failure");
    },
  },
});
```

Expected: helper factually re-reads Artifact/Source as previous revision and returns success; it must not compensate the file back to V2.

**Case B — restore fails before commit, stores remain newer:**

Inject:

```ts
restoreArtifactRevision: async () => {
  throw new Error("simulated pre-commit failure");
}
```

Expected: helper restores the captured newer file content, verifies Artifact + Source remain at `expectedCurrentRevision`, then rejects with `ComputerError` / `VERIFICATION_FAILED` semantics. Assert file is V2 and Registry/Source are still V2.

**Case C — restore leaves split registry state:**

Use the existing exported Artifact DB functions to modify only one store inside the injected restore function, then throw. For example, update Artifact metadata to `previousRevision` while leaving Source IR at `expectedCurrentRevision`.

Expected: helper rejects with manual-inspection `VERIFICATION_FAILED` semantics and does not blindly write the newer snapshot back merely because the restore call threw.

- [ ] **Step 3: Add stale preflight and multi-revision reverse tests**

Stale test:

1. produce a V2 inverse expecting current revision 2;
2. advance the Artifact/Source to revision 3 through a legitimate `update_document` call;
3. record current file bytes/text;
4. call `undoDocumentRevisionRuntime()` with the stale V2 inverse;
5. expect `ARTIFACT_REVISION_CONFLICT` before any file mutation;
6. assert file remains unchanged at V3.

Multi-revision test:

```text
create V1
update V1 -> V2  => inverseA(expectedCurrent=2, previous=1)
update V2 -> V3  => inverseB(expectedCurrent=3, previous=2)
undo inverseB    => V2
undo inverseA    => V1
```

After each helper call assert exact file content + Artifact revision + Source revision match the expected revision.

- [ ] **Step 4: Run checkpoint tests and confirm RED**

```bash
npx vitest run tests/unit/kiro-computer-checkpoints.test.ts
```

Expected before helper implementation: import/function is missing and current Hook-only implementation cannot satisfy injected failure-state tests.

- [ ] **Step 5: Implement factual state helpers in `documentRevisionUndo.ts`**

Define an internal coherent-state classifier:

```ts
type RegistryRevisionState = "previous" | "newer" | "unknown";

function classifyRegistryState(input: {
  artifact: KiroArtifact | null;
  source: KiroArtifactSourceRecord | null;
  previousRevision: number;
  expectedCurrentRevision: number;
}): RegistryRevisionState {
  const { artifact, source, previousRevision, expectedCurrentRevision } = input;
  if (artifact?.revision === previousRevision && source?.revision === previousRevision) return "previous";
  if (
    artifact?.revision === expectedCurrentRevision &&
    source?.revision === expectedCurrentRevision
  ) return "newer";
  return "unknown";
}
```

Also define exact snapshot helpers:

```ts
async function readCurrentSnapshot(
  io: ComputerAdapterIO,
  inverse: RestoreDocumentRevisionInverse
): Promise<DocumentFileSnapshot>;

async function writeAndVerifySnapshot(
  io: ComputerAdapterIO,
  path: string,
  snapshot: DocumentFileSnapshot
): Promise<void>;
```

`writeAndVerifySnapshot()` must use exact text equality for Markdown and exact byte equality for DOCX.

Before capturing current state, `io.stat(inverse.relativePath)` must return a file and must be `<= 5 * 1024 * 1024` bytes; otherwise throw `RESOURCE_NOT_FOUND` or `FILE_TOO_LARGE` before file mutation.

- [ ] **Step 6: Implement normal Undo preflight**

At the start of `undoDocumentRevisionRuntime()`:

```text
read current Artifact
read current Source
require Artifact exists
require Artifact.workspaceId === inverse.workspaceId
require Artifact.rootId === inverse.rootId
require Artifact.relativePath === inverse.relativePath
require Artifact.revision === inverse.expectedCurrentRevision
require Source exists
require Source.revision === inverse.expectedCurrentRevision
capture exact current/newer file snapshot
```

A revision mismatch throws `ARTIFACT_REVISION_CONFLICT`; location/source mismatch throws `VERIFICATION_FAILED` or the existing specific Artifact error before touching the file.

- [ ] **Step 7: Implement previous-file restore and factual registry recovery**

Normal flow:

```ts
await writeAndVerifySnapshot(io, inverse.relativePath, inverse.snapshot);

let restoreError: unknown = null;
try {
  await deps.restoreArtifactRevision({
    artifactId: inverse.artifactId,
    expectedCurrentRevision: inverse.expectedCurrentRevision,
    revision: inverse.previousRevision,
    document: inverse.previousDocument,
  });
} catch (error) {
  restoreError = error;
}

const artifactAfter = await deps.getArtifact(inverse.artifactId);
const sourceAfter = await deps.getArtifactSource(inverse.artifactId);
const state = classifyRegistryState({
  artifact: artifactAfter,
  source: sourceAfter,
  previousRevision: inverse.previousRevision,
  expectedCurrentRevision: inverse.expectedCurrentRevision,
});
```

Then:

```text
state = previous
  -> verify file still exactly equals inverse.snapshot
  -> return success even if restoreError existed

state = newer
  -> writeAndVerifySnapshot(current/newer snapshot)
  -> re-read Artifact + Source and require both still newer
  -> throw VERIFICATION_FAILED("撤销未完成，已恢复撤销前状态")

state = unknown
  -> do not guess / do not blind-commit / do not blindly compensate
  -> throw VERIFICATION_FAILED("撤销状态无法确认，文件 / Artifact 可能需要人工检查")
```

If compensation for `state = newer` fails, throw the manual-inspection `VERIFICATION_FAILED` message.

If writing/verifying the previous file snapshot itself fails before any registry restoration attempt, the registry is still factually newer. Attempt to restore the captured newer file snapshot; if that compensation verifies, throw a normal Undo failure; if it does not, throw manual-inspection verification failure.

- [ ] **Step 8: Replace Hook-local Undo implementation with the helper**

In `hooks/useKiroChat.ts`:

1. import `undoDocumentRevisionRuntime`;
2. keep the existing live Workspace/root lookup;
3. get `io = getComputerAdapterForAdapterRef(root.adapterRef)`;
4. call:

```ts
await undoDocumentRevisionRuntime({ io, inverse });
```

Delete the duplicated local Artifact revision/file restoration implementation and its local `bytesEqual()` if no longer used elsewhere.

Do not change task status logic: the existing caller already maps thrown errors to `undo_failed` and only marks `undone` after all inverses return successfully.

- [ ] **Step 9: Run checkpoint tests GREEN**

```bash
npx vitest run tests/unit/kiro-computer-checkpoints.test.ts
```

- [ ] **Step 10: Commit Task 2**

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
- Modify only if a focused test exposes a defect directly covered by this spec.

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: verified Part 2.1 stabilization with no new UI/tool surface.

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

- [ ] **Step 3: Run a narrow static audit**

```bash
rg -n \
  "mutationCount \+= 1|restore-document-revision|previousDocument|snapshot|adapterRef|nativePath|FileSystemDirectoryHandle" \
  lib/ai/computer hooks/useKiroChat.ts lib/ai/history
```

Manually confirm:

```text
rename_file/move_file/update_document do not increment before approval
approved executions increment exactly once
runtime document snapshots remain in checkpoints/documentRevisionUndo/useKiroChat runtime only
history sanitizer does not persist previousDocument/snapshot/bytes
no new model schema/tool/capability was introduced
```

- [ ] **Step 4: Build policy**

Default:

```text
npm run build — SKIP
```

Run build only if typecheck exposes a Next client/server or bundling-only concern. No Playwright is required because Part 2.1 changes no visible UI behavior.

- [ ] **Step 5: Optional hardening commit only if verification required a direct fix**

```bash
git add <only directly affected files>
git commit -m "fix(kiro): harden revision stabilization"
```

Do not create an empty verification commit.

---

## Final Acceptance Checklist

### Mutation quota

- [ ] Guided `rename_file` ask consumes 0.
- [ ] `move_file` ask consumes 0.
- [ ] Guided `update_document` ask consumes 0.
- [ ] Approved relocation consumes exactly 1.
- [ ] Approved document update consumes exactly 1.
- [ ] Stale Artifact revision consumes 0 before write.
- [ ] File-too-large consumes 0 before write.
- [ ] Verification/registry failure after first write still counts as 1.

### Document Undo

- [ ] Markdown exact Undo restores file + Artifact + Source.
- [ ] DOCX exact-byte Undo restores file + Artifact + Source.
- [ ] Stale Artifact/Source fails before file mutation.
- [ ] Restore API error + factually previous Registry is accepted as success.
- [ ] Factually newer Registry triggers exact file compensation to newer state and returns `undo_failed`.
- [ ] Split/unknown Registry state never triggers blind compensation/commit.
- [ ] Compensation failure reports manual-inspection verification failure.
- [ ] Two revisions undo in reverse order without drift.
- [ ] Existing checkpoint single-use semantics remain unchanged.

### Security / persistence

- [ ] No new model-facing tool/schema/capability.
- [ ] No native path/handle/adapterRef exposed.
- [ ] Newer/previous file snapshots remain runtime-only.
- [ ] Previous/newer Source IR remains runtime-only except the existing Artifact Source Store.
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

Allow one additional `fix(kiro): harden revision stabilization` only if focused verification reveals a directly related defect.

## Final Report

Report only:

```text
Kiro Computer Agent V2 — Part 2.1 Stabilization Result

Commits:
- SHA + message

Mutation quota:
- relocation ask/resume
- document update ask/resume
- preflight failures

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