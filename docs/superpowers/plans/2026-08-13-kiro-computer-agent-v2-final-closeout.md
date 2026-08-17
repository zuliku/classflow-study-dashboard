# Kiro Computer Agent V2 — Final Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Kiro Computer Agent V2 with one final integrity correction and focused verification: revision-aware Undo must verify restored files read-only after Registry recovery, never rewrite an already-restored file merely to verify it.

**Architecture:** Keep the existing V2 checkpoint/inverse model unchanged. Both `documentRevisionUndo.ts` and `genericArtifactPatchUndo.ts` already implement preflight, exact restoration, factual Registry reread, compensation, and stale-state protection. The only correction is to split `write + verify` helpers from pure `verify` helpers, so the factual `previous` branch performs read-only confirmation. Then run the focused V2 regression set and one offline Artifact E2E before declaring V2 ready to close.

**Tech Stack:** TypeScript 5.5, existing Computer Runtime, IndexedDB/fake-indexeddb, Vitest, Playwright.

## Global Constraints

- No new Computer tools, capabilities, Agent modes, Artifact schema, UI, Context schema, or permissions.
- No changes to Preview/Download/Recent Artifacts/Ask Kiro behavior unless a focused regression exposes a direct failure.
- Runtime snapshots remain runtime-only and never enter model context/history/audit/persisted Zustand.
- Do not add delete/shell/MCP/Tauri/Desktop capabilities.
- Verification must remain focused; skip full suites/build unless a real blocker requires them.
- `09f518bf6d80bbc927019af113adb56f25edd865` is the implementation baseline for Part 3.1.

---

## Task 1: Make Successful Undo Verification Read-Only

**Files:**
- Modify: `lib/ai/computer/genericArtifactPatchUndo.ts`
- Modify: `lib/ai/computer/documentRevisionUndo.ts`
- Test: `tests/unit/kiro-generic-artifact-patch-undo.test.ts`
- Test: `tests/unit/kiro-computer-checkpoints.test.ts`

### Root cause

Both helpers currently use a write helper in the factual-`previous` branch:

```ts
await writeExactText(io, inverse.relativePath, inverse.beforeText);
```

and:

```ts
await writeAndVerifySnapshot(io, inverse.relativePath, inverse.snapshot);
```

At that point the previous file state was already written and the Artifact Registry/Source has already been factually confirmed at the previous revision. A second write is unnecessary and creates a new mutation window after metadata recovery.

### Required helper split

- [ ] **Step 1: Add read-only exact verification helpers**

In `genericArtifactPatchUndo.ts` add:

```ts
async function verifyExactText(
  io: ComputerAdapterIO,
  path: string,
  expected: string
): Promise<void> {
  const readBack = await io.readText(path);
  if (readBack !== expected) {
    throw new ComputerError("VERIFICATION_FAILED", "撤销后文本校验失败");
  }
}
```

Keep `writeExactText()` for actual restore/compensation mutations only.

In `documentRevisionUndo.ts` add:

```ts
async function verifySnapshot(
  io: ComputerAdapterIO,
  path: string,
  snapshot: DocumentFileSnapshot
): Promise<void> {
  if (snapshot.format === "markdown") {
    const readBack = await io.readText(path);
    if (readBack !== snapshot.text) {
      throw new ComputerError("VERIFICATION_FAILED", "撤销后文档校验失败");
    }
    return;
  }

  const readBack = await io.readBytes(path);
  if (!bytesEqual(readBack, snapshot.bytes)) {
    throw new ComputerError("VERIFICATION_FAILED", "撤销后文档校验失败");
  }
}
```

Keep `writeAndVerifySnapshot()` for restore/compensation only.

- [ ] **Step 2: Replace factual-previous second writes with read-only verification**

Generic:

```ts
if (after && locationMatches && after.revision === inverse.previousRevision) {
  await verifyExactText(io, inverse.relativePath, inverse.beforeText);
  return;
}
```

Structured document:

```ts
if (state === "previous") {
  await verifySnapshot(io, inverse.relativePath, inverse.snapshot);
  return;
}
```

Do not alter the `newer` compensation branch; compensation is intentionally a write.

Do not alter preflight or unknown-state handling.

- [ ] **Step 3: Add RED regression assertions for write count**

Update the generic helper fake IO to count writes and assert normal success performs exactly one restore write:

```ts
expect(writes).toHaveLength(1);
```

For the post-commit API-error/factual-previous case also assert exactly one write. Before the fix this should fail because the previous branch writes twice.

In `kiro-computer-checkpoints.test.ts`, instrument the Markdown structured document Undo production path and assert successful `restore-document-revision` behavior performs one restore write, not a second verification write. If the production structured revision dispatcher is exercised elsewhere, use that exact helper path rather than a manual sequence.

- [ ] **Step 4: Run focused RED test before implementation**

```bash
npx vitest run \
  tests/unit/kiro-generic-artifact-patch-undo.test.ts \
  tests/unit/kiro-computer-checkpoints.test.ts
```

Expected before fix: at least the new write-count assertion fails (`2` vs `1`).

- [ ] **Step 5: Implement the helper split and rerun GREEN**

Run the same command and require zero failures.

- [ ] **Step 6: Commit**

```bash
git add \
  lib/ai/computer/genericArtifactPatchUndo.ts \
  lib/ai/computer/documentRevisionUndo.ts \
  tests/unit/kiro-generic-artifact-patch-undo.test.ts \
  tests/unit/kiro-computer-checkpoints.test.ts

git commit -m "fix(kiro): verify undo state without rewriting files"
```

---

## Task 2: V2 Focused Final Verification

**Files:**
- No production changes expected.
- Only add a focused fix if one of the commands below demonstrates a direct V2 regression.

- [ ] **Step 1: Run focused V2 Artifact/Undo unit suite**

```bash
npx vitest run \
  tests/unit/kiro-generic-artifact-patch-undo.test.ts \
  tests/unit/kiro-computer-checkpoints.test.ts \
  tests/unit/kiro-computer-tools.test.ts \
  tests/unit/kiro-artifact-access.test.ts \
  tests/unit/kiro-artifact-context.test.ts \
  tests/unit/kiro-artifact-revision.test.ts \
  tests/unit/kiro-computer-relocation.test.ts
```

Require zero failures. Report test/file counts from actual output.

- [ ] **Step 2: Run the single offline V2 Artifact lifecycle E2E**

```bash
npx playwright test tests/e2e/kiro-computer-artifacts-v2.spec.ts
```

This must remain fully offline using the existing `/api/ai/chat` route mock. Do not run real provider APIs.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Require exit code 0.

- [ ] **Step 4: Static trust-boundary audit**

```bash
rg -n \
"restore-generic-artifact-revision|restore-document-revision|beforeText|snapshot|adapterRef|FileSystemDirectoryHandle|nativePath|absolutePath|delete_file|run_shell" \
lib/ai/computer lib/ai/history hooks store components/kiro app/api/ai/chat/route.ts
```

Confirm manually:

- `beforeText` / document snapshots occur only in runtime/checkpoint/test paths, never persisted history/audit/model context.
- No model-facing delete or shell tool exists.
- `adapterRef` / handles / native paths remain runtime-only.
- Artifact Context remains logical metadata only.

- [ ] **Step 5: Build policy**

Default:

```text
SKIP npm run build
```

Run build only if typecheck or E2E exposes a bundling/client-server issue that cannot be validated otherwise.

- [ ] **Step 6: Do not create a test-only commit if nothing changed**

If Task 1 is the only code change and all verification passes, keep the one implementation commit. If verification exposes one directly-related regression, allow exactly one focused follow-up commit:

```text
fix(kiro): harden computer agent v2 closeout
```

---

## Acceptance

### Undo integrity

- [ ] Generic Artifact patch Undo restores exact previous text and previous revision.
- [ ] Structured document Undo restores exact previous content plus Artifact/Source revision.
- [ ] Successful factual-previous verification is read-only.
- [ ] Generic successful Undo performs one restore write, not two.
- [ ] Structured successful Undo performs one restore write, not two.
- [ ] `newer` factual state still performs intentional compensation write and fails safely.
- [ ] `unknown` state still never blind-compensates.
- [ ] stale revision still fails before filesystem mutation.
- [ ] multi-revision reverse Undo remains correct.

### V2 lifecycle

- [ ] create / create Undo Artifact cleanup remains correct.
- [ ] generic patch revision and Undo remain aligned.
- [ ] structured update revision and Undo remain aligned.
- [ ] relocation and move-back remain aligned.
- [ ] Preview / Download / Recent 12 remain functional.
- [ ] Ask Kiro Artifact Context remains metadata-only and server-whitelisted.
- [ ] DOCX inspect still returns bounded raw text, not HTML/OOXML/bytes.

### Safety

- [ ] no new model tool/capability.
- [ ] no delete/shell/MCP/Tauri.
- [ ] no native path/handle leak.
- [ ] checkpoint snapshots remain runtime-only.

### Verification

- [ ] focused 7-file Vitest command PASS.
- [ ] one offline Artifact V2 Playwright spec PASS.
- [ ] typecheck PASS.
- [ ] build skipped or justified.

---

## Final Report

Report only:

```text
Kiro Computer Agent V2 — Final Closeout

Commit:
- SHA + message

Integrity fix:
- generic Undo read-only verification
- structured Undo read-only verification

Verification:
- focused Vitest: actual result
- Artifact V2 E2E: actual result
- typecheck: actual result
- build: skipped / PASS + reason

Security audit:
- runtime-only snapshot boundary
- no native/model capability leak

V2 status:
- VERIFIED COMPLETE
or
- BLOCKED: <specific failing evidence>

Next:
- V3 design only after VERIFIED COMPLETE
```

## STOP

After the final report, STOP. Do not start V3 implementation in the same run.