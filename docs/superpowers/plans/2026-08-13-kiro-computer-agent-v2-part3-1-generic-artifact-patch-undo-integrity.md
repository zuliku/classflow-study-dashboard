# Kiro Computer Agent V2 — Part 3.1 Generic Artifact Patch Undo Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final V2 Artifact integrity gap so Task Undo for a registered generic text Artifact restores both the exact previous file content and the previous Artifact revision instead of leaving Registry revision drift.

**Architecture:** Keep unregistered `patch_text_file` on the existing lightweight `restore-text` inverse. For a registered generic Artifact (registered metadata, no KiroDocument Source IR), emit a dedicated `restore-generic-artifact-revision` checkpoint carrying stable Artifact identity and the previous/expected-current revisions. Undo executes through a focused runtime helper that preflights live Artifact identity/revision before filesystem mutation, restores exact text, restores metadata revision atomically, rereads factual state, and compensates the file back to the pre-Undo content when Registry restoration factually did not commit. This mirrors the safety model already used by `documentRevisionUndo.ts` without introducing Source IR handling.

**Tech Stack:** TypeScript 5.5, existing Computer Adapter IO, IndexedDB Artifact Registry, fake-indexeddb, Vitest.

## Global Constraints

- This is a V2 integrity closeout, not V3 feature work.
- Preserve the existing `patch_text_file` behavior for unregistered files.
- Preserve the Part 3 raw-patch guard for structured Kiro documents; `ARTIFACT_UNSUPPORTED_OPERATION` remains unchanged.
- Do not add a model-facing tool.
- Do not add delete/shell/MCP/Tauri behavior.
- Checkpoint data remains runtime-only and must not enter Tool Output, chat history, audit, Zustand persistence, or Artifact metadata.
- Undo must never overwrite a newer Artifact revision: stale preflight rejects before filesystem mutation.
- Artifact Registry remains metadata authority only; filesystem remains content authority.
- Keep testing focused: new helper/unit coverage + touched Computer tests + `npm run typecheck`; no full suite/build unless a concrete failure requires it.

---

## Root Cause

Current registered generic patch flow is:

```text
patch_text_file
  -> exact file write + verify
  -> Artifact revision R -> R+1
  -> runtime.change carries artifactId/revision
  -> inverse = restore-text(beforeText)
```

Current `restore-text` Undo only writes `beforeText` back to the filesystem. It does not restore Artifact metadata revision. Therefore:

```text
before: file=v1, Artifact revision=1
patch:  file=v2, Artifact revision=2
Undo:   file=v1, Artifact revision=2   <-- drift
```

`update_document` does not have this problem because it uses `restore-document-revision` and restores filesystem + Artifact/Source revision together.

---

## File Map

### Create

- `lib/ai/computer/genericArtifactPatchUndo.ts` — runtime-only generic Artifact patch Undo helper with factual reread/compensation semantics.
- `tests/unit/kiro-generic-artifact-patch-undo.test.ts` — isolated happy/stale/commit-ambiguity/multi-revision coverage.

### Modify

- `lib/ai/computer/artifacts/db.ts` — atomic explicit metadata revision restore.
- `lib/ai/computer/artifacts/service.ts` — `restoreGenericArtifactRevision()` service wrapper.
- `lib/ai/computer/checkpoints.ts` — add dedicated inverse type and dispatch it through the helper.
- `lib/ai/computer/executor.ts` — registered generic patch emits the dedicated inverse; unregistered patch keeps `restore-text`.
- `tests/unit/kiro-computer-tools.test.ts` — assert registered generic patch inverse facts.
- `tests/unit/kiro-computer-checkpoints.test.ts` — assert dispatcher restores both file and Artifact revision through the production path.

No UI/history/API route changes are required.

---

### Task 1: Add the dedicated runtime inverse and atomic Artifact revision restore

**Files:**
- Create: `lib/ai/computer/genericArtifactPatchUndo.ts`
- Modify: `lib/ai/computer/artifacts/db.ts`
- Modify: `lib/ai/computer/artifacts/service.ts`
- Modify: `lib/ai/computer/checkpoints.ts`
- Test: `tests/unit/kiro-generic-artifact-patch-undo.test.ts`

**Interfaces:**

Create in `lib/ai/computer/genericArtifactPatchUndo.ts`:

```ts
export const GENERIC_ARTIFACT_PATCH_UNDO_LIMIT_BYTES = 1024 * 1024;

export interface RestoreGenericArtifactRevisionInverse {
  type: "restore-generic-artifact-revision";
  workspaceId: string;
  rootId: string;
  relativePath: string;
  artifactId: string;
  previousRevision: number;
  expectedCurrentRevision: number;
  beforeText: string;
}

export interface GenericArtifactPatchUndoDeps {
  getArtifact: typeof getArtifact;
  restoreGenericArtifactRevision: typeof restoreGenericArtifactRevision;
}

export async function undoGenericArtifactPatchRuntime(input: {
  io: ComputerAdapterIO;
  inverse: RestoreGenericArtifactRevisionInverse;
  deps?: Partial<GenericArtifactPatchUndoDeps>;
}): Promise<void>;
```

Add in `lib/ai/computer/artifacts/db.ts`:

```ts
export async function artifactDbRestoreMetadataRevision(input: {
  artifactId: string;
  expectedCurrentRevision: number;
  revision: number;
}): Promise<KiroArtifact>;
```

Add in `lib/ai/computer/artifacts/service.ts`:

```ts
export async function restoreGenericArtifactRevision(input: {
  artifactId: string;
  expectedCurrentRevision: number;
  revision: number;
}): Promise<KiroArtifact>;
```

- [ ] **Step 1: Write failing runtime-helper tests**

Create `tests/unit/kiro-generic-artifact-patch-undo.test.ts` with fake adapter IO + injectable deps. Cover all of these exact cases:

```ts
it("restores exact previous text and revision", async () => {
  // registry starts at revision 2, file = "v2"
  // inverse previousRevision=1 expectedCurrentRevision=2 beforeText="v1"
  // expect file === "v1" and registry revision === 1
});

it("rejects stale revision before any file write", async () => {
  // registry starts revision 3 while inverse expects 2
  // expect ARTIFACT_REVISION_CONFLICT
  // expect writeText was never called and file remains "v3"
});

it("treats post-commit API throw as success when factual registry is previous", async () => {
  // restoreGenericArtifactRevision mutates fake registry to revision 1 then throws
  // helper rereads registry revision 1, verifies file="v1", succeeds
});

it("compensates file to pre-undo text when registry factually remains newer", async () => {
  // restoreGenericArtifactRevision throws before fake registry mutation
  // expect helper rewrites file from "v1" back to captured "v2"
  // expect failure, registry still revision 2
});

it("fails safely on unknown registry state without blind success", async () => {
  // restore call throws and factual reread returns missing/wrong revision
  // expect VERIFICATION_FAILED/manual-inspection style failure
});

it("supports two revisions undone in reverse without drift", async () => {
  // rev3/file=v3 -> inverse B -> rev2/file=v2 -> inverse A -> rev1/file=v1
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
npx vitest run tests/unit/kiro-generic-artifact-patch-undo.test.ts
```

Expected: FAIL because the helper/service/DB restore path does not exist.

- [ ] **Step 3: Implement atomic explicit metadata revision restore**

In `artifactDbRestoreMetadataRevision()`:

1. open the existing Artifact DB;
2. one `artifacts` readwrite transaction;
3. read `artifactId`;
4. missing -> `ARTIFACT_NOT_FOUND`;
5. require `artifact.revision === expectedCurrentRevision`, otherwise `ARTIFACT_REVISION_CONFLICT`;
6. write `{ ...artifact, revision: input.revision, updatedAt: new Date().toISOString() }`;
7. resolve only on transaction completion;
8. reread after commit and require the returned revision equals `input.revision`, otherwise `VERIFICATION_FAILED`.

Do not touch the `sources` store: registered generic text Artifacts have no Source IR.

`restoreGenericArtifactRevision()` is a thin service wrapper around this DB primitive.

- [ ] **Step 4: Implement `undoGenericArtifactPatchRuntime()`**

Required algorithm:

```text
A. preflight before file mutation
   - get Artifact
   - require workspaceId/rootId/relativePath exact match
   - require revision === expectedCurrentRevision
   - stat current file; require regular file
   - require stat.size <= 1 MiB
   - capture exact current/pre-Undo text (compensation snapshot)

B. restore previous file
   - write beforeText
   - read-back exact verify
   - if this fails, restore captured current text + verify; then fail

C. restore Registry revision
   - call restoreGenericArtifactRevision(expectedCurrentRevision -> previousRevision)
   - a thrown call does NOT decide factual state

D. factual reread
   - Artifact revision === previousRevision and location still matches:
       verify file === beforeText; success
   - Artifact revision === expectedCurrentRevision and location still matches:
       restore captured current text + verify; throw VERIFICATION_FAILED
   - missing / wrong revision / changed location / reread failure:
       fail safely with VERIFICATION_FAILED and explicit manual-inspection message;
       do not claim Undo success
```

The helper must never persist `beforeText` or the compensation snapshot.

- [ ] **Step 5: Add the inverse to `ComputerInverseOperation` and production dispatch**

In `checkpoints.ts`, import `RestoreGenericArtifactRevisionInverse` and include it in the union.

`applyInverseToAdapter()` must handle it with:

```ts
if (inverse.type === "restore-generic-artifact-revision") {
  await undoGenericArtifactPatchRuntime({ io, inverse });
  return;
}
```

This keeps `useKiroChat` unchanged: its existing generic `applyInverseToAdapter(io, inverse)` branch automatically uses the new production path.

- [ ] **Step 6: Run helper tests GREEN**

Run:

```bash
npx vitest run tests/unit/kiro-generic-artifact-patch-undo.test.ts
```

Expected: PASS.

---

### Task 2: Emit the correct inverse from registered generic patches and cover production dispatch

**Files:**
- Modify: `lib/ai/computer/executor.ts`
- Modify: `tests/unit/kiro-computer-tools.test.ts`
- Modify: `tests/unit/kiro-computer-checkpoints.test.ts`

**Interfaces:**

Registered generic patch success already produces:

```ts
artifactId: string;
artifactRevision: number; // previous R
newRevision: number;      // committed R+1
```

Use those facts to choose the inverse after verified patch + metadata commit.

- [ ] **Step 1: Add failing executor assertions**

Extend the existing test named approximately:

```text
generic 已登记文本 patch：Artifact revision +1、id 不变、runtime facts 携带
```

Require:

```ts
expect(attempt.runtime?.inverse?.type).toBe("restore-generic-artifact-revision");

if (attempt.runtime?.inverse?.type === "restore-generic-artifact-revision") {
  expect(attempt.runtime.inverse.artifactId).toBe(artifact.id);
  expect(attempt.runtime.inverse.previousRevision).toBe(1);
  expect(attempt.runtime.inverse.expectedCurrentRevision).toBe(2);
  expect(attempt.runtime.inverse.beforeText).toBe("v1");
}
```

Also retain an unregistered-file regression proving its inverse is still `restore-text`.

- [ ] **Step 2: Run focused executor test RED**

Run:

```bash
npx vitest run tests/unit/kiro-computer-tools.test.ts
```

Expected: the new inverse assertion fails against current `restore-text` behavior.

- [ ] **Step 3: Change only inverse selection in `patch_text_file`**

Keep current patch validation/write/verify/revision commit untouched.

After `newRevision` is known:

```ts
inverse: canUndo
  ? artifactId && artifactRevision !== undefined && newRevision !== undefined
    ? {
        type: "restore-generic-artifact-revision",
        workspaceId: ws.id,
        rootId: root.id,
        relativePath: normalized,
        artifactId,
        previousRevision: artifactRevision,
        expectedCurrentRevision: newRevision,
        beforeText: current,
      }
    : {
        type: "restore-text",
        workspaceId: ws.id,
        rootId: root.id,
        relativePath: normalized,
        beforeText: current,
      }
  : undefined
```

Do not change mutation quota timing, approval semantics, structured-document guard, or review facts.

Replace the local numeric patch Undo limit with the shared helper constant if convenient, while preserving the exported compatibility name:

```ts
export const COMPUTER_PATCH_UNDO_LIMIT_BYTES = GENERIC_ARTIFACT_PATCH_UNDO_LIMIT_BYTES;
```

- [ ] **Step 4: Add one production-dispatch checkpoint test**

In `tests/unit/kiro-computer-checkpoints.test.ts` create/register a generic Artifact at revision 2 with file text `v2`, then call the real:

```ts
applyInverseToAdapter(io, {
  type: "restore-generic-artifact-revision",
  workspaceId: ...,
  rootId: ...,
  relativePath: "notes.txt",
  artifactId,
  previousRevision: 1,
  expectedCurrentRevision: 2,
  beforeText: "v1",
});
```

Assert after the same production dispatch:

```text
file text = v1
Artifact revision = 1
Artifact id unchanged
Source IR = null
```

- [ ] **Step 5: Run all focused V2 integrity tests**

Run:

```bash
npx vitest run \
  tests/unit/kiro-generic-artifact-patch-undo.test.ts \
  tests/unit/kiro-computer-checkpoints.test.ts \
  tests/unit/kiro-computer-tools.test.ts \
  tests/unit/kiro-artifact-access.test.ts \
  tests/unit/kiro-artifact-context.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run TypeScript verification**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Optional E2E only if unit/integration evidence exposes a hook-dispatch issue**

Default: skip Playwright. `useKiroChat` already delegates generic inverses to `applyInverseToAdapter`; the production-dispatch unit test exercises the exact new path. If implementation changes `useKiroChat`, then extend only `tests/e2e/kiro-computer-artifacts-v2.spec.ts` with one create-text -> patch -> Undo -> Registry revision assertion and run that single file.

- [ ] **Step 8: Commit**

Use one implementation commit:

```bash
git add \
  lib/ai/computer/genericArtifactPatchUndo.ts \
  lib/ai/computer/artifacts/db.ts \
  lib/ai/computer/artifacts/service.ts \
  lib/ai/computer/checkpoints.ts \
  lib/ai/computer/executor.ts \
  tests/unit/kiro-generic-artifact-patch-undo.test.ts \
  tests/unit/kiro-computer-checkpoints.test.ts \
  tests/unit/kiro-computer-tools.test.ts

git commit -m "fix(kiro): restore generic artifact revision on undo"
```

---

## Acceptance Checklist

- [ ] Registered generic patch still increments Artifact revision exactly once.
- [ ] Registered generic patch keeps the same Artifact ID.
- [ ] Registered generic patch emits `restore-generic-artifact-revision` when Undo snapshot is allowed.
- [ ] Unregistered patch still emits plain `restore-text`.
- [ ] Structured Kiro documents still reject `patch_text_file` and use `update_document`.
- [ ] Undo restores exact previous text and previous Artifact revision.
- [ ] Undo does not create Source IR for a generic Artifact.
- [ ] Stale Artifact revision rejects before any file mutation.
- [ ] Failed Registry restore with factual newer state compensates the file to pre-Undo content.
- [ ] Post-commit API error with factual previous state is treated according to factual state rather than blindly compensating.
- [ ] Multi-revision reverse Undo reaches the original file content/revision without drift.
- [ ] Runtime snapshots remain runtime-only.
- [ ] No model-facing tool/API/UI behavior changes.
- [ ] Focused Vitest passes.
- [ ] `npm run typecheck` passes.
- [ ] Build/full suites remain skipped unless a concrete blocker requires them.

## Final Report Format

```text
Kiro Computer Agent V2 — Part 3.1 Integrity Closeout

Commit:
- <sha> fix(kiro): restore generic artifact revision on undo

Root cause:
- registered generic patch incremented Registry revision but reused file-only restore-text inverse

Fix:
- dedicated restore-generic-artifact-revision inverse
- atomic metadata revision restore
- stale preflight
- factual reread + compensation

Verification:
- focused unit files: PASS/FAIL
- typecheck: PASS/FAIL
- Playwright: skipped by policy / PASS with reason
- build: skipped by policy / PASS with reason

V2 status:
- ready for final closeout
or
- blocker: <exact blocker>
```

After this task, STOP. Do not start V3 in the same implementation run.