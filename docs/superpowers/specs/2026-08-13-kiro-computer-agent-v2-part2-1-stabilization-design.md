# Kiro Computer Agent V2 — Part 2.1 Revision / Approval Stabilization Design

**Status:** Ready for user review

**Date:** 2026-08-13

## 1. Goal

Stabilize the already-implemented V2 Part 2 document revision lifecycle before adding Artifact UX.

This phase adds no new user-facing Computer capability. It fixes two runtime consistency defects:

1. approval-required mutation attempts must not consume mutation quota before real execution;
2. document revision Undo must not leave filesystem content and Artifact Registry / Source IR on different revisions when registry restoration fails or its post-commit confirmation is inconclusive.

After this stabilization, V2 Part 3 may safely depend on revision state for Preview / Download / Recent Artifacts.

## 2. Scope

### In scope

- `rename_file`, `move_file`, and `update_document` mutation-counter semantics;
- document revision Undo all-or-fail recovery semantics;
- focused regression coverage for those boundaries;
- exact failure reporting when recovery itself cannot be completed.

### Out of scope

- new tools;
- Artifact Preview;
- Artifact Download;
- Recent Artifacts;
- new permission modes;
- changes to Sandbox, Workspace, Browser grants, Artifact schema, or model-facing tool schemas;
- Tauri / Windows / shell / MCP.

## 3. Mutation Quota Contract

The existing V1 contract remains authoritative:

```text
schema / sandbox / policy evaluation
        ↓
policy = ask
        ↓
approval-required
        ↓
NO filesystem mutation
NO tool output
NO mutation quota consumption
        ↓
user approves
        ↓
resume exact tool call
        ↓
re-check live security state
        ↓
actual mutation begins
        ↓
mutationCount += 1
```

An approval request is not a mutation.

### 3.1 Required correction

`rename_file`, `move_file`, and `update_document` must not increment `counters.mutationCount` before permission evaluation.

The counter increments exactly once after all pre-mutation checks and any required approval have succeeded, immediately before the first filesystem mutation.

### 3.2 Failed preflight does not consume quota

These failures must not consume mutation quota:

- invalid input;
- path/sandbox rejection;
- explicit deny;
- read-only root;
- approval-required;
- Artifact not found/not editable/revision conflict detected before write;
- file-too-large rejection detected before write.

Once real filesystem mutation has begun, the call counts as one mutation even if verification later fails.

## 4. Document Undo Consistency Contract

`restore-document-revision` spans two authorities:

1. filesystem bytes/text;
2. Artifact metadata + Source IR IndexedDB transaction.

A successful Undo must restore both to the same prior revision.

The product must never report `undone` when only one side is restored.

## 5. Undo Recovery Strategy

Before Undo mutates anything, capture the current pre-Undo state needed to restore the newer revision if necessary:

- current Artifact revision;
- current Source IR;
- exact current file content (Markdown text or DOCX bytes).

These values remain runtime-only and bounded by the existing document revision limit.

Normal Undo sequence:

```text
validate current Artifact revision/location
        ↓
capture current newer state
        ↓
restore previous exact file snapshot
        ↓
verify previous file
        ↓
restore Artifact metadata + Source IR to previous revision
        ↓
re-read Artifact + Source
        ↓
verify both stores and file are on previous revision
        ↓
SUCCESS
```

## 6. Registry Restore Failure / Inconclusive Confirmation

`restoreArtifactRevision()` uses an atomic IndexedDB transaction, but it also performs post-commit confirmation. Therefore a thrown error does not prove that the transaction remained on the newer revision.

After any restore error, the runtime must first perform a best-effort factual re-read of Artifact metadata and Source IR before choosing a compensation direction.

### Case A — both stores are already on the previous revision

If:

```text
artifact.revision === previousRevision
source.revision === previousRevision
```

and the restored file still exactly matches the previous snapshot, treat the factual state as a successful Undo even if the earlier confirmation call threw.

Do not write the newer file back merely because an intermediate API call failed.

### Case B — both stores remain on the newer revision

If:

```text
artifact.revision === expectedCurrentRevision
source.revision === expectedCurrentRevision
```

then compensate the filesystem back to the captured newer file state:

```text
write captured newer file state
        ↓
verify newer file
        ↓
verify Registry / Source still newer
        ↓
return Undo failure
```

If compensation succeeds:

- task status becomes `undo_failed`;
- filesystem and registry remain aligned on the newer revision;
- message states that Undo was not completed;
- no partial-success language is allowed.

### Case C — stores are split, missing, unreadable, or neither known revision

If the post-failure factual read cannot establish a coherent previous or newer Registry/Source state:

- do not guess which revision is authoritative;
- do not perform another blind revision commit;
- return `undo_failed` with `VERIFICATION_FAILED`-class semantics;
- explicitly state that file / Artifact state may require manual inspection.

The runtime may only perform filesystem compensation when the Registry/Source state is coherently known to still be on the newer revision.

### Compensation failure

If Case B compensation itself fails:

- task status remains `undo_failed`;
- report verification failure/manual-inspection semantics;
- never claim the original Undo succeeded.

## 7. Stale Revision Safety

Before changing the file during Undo, the runtime must verify:

```text
current artifact.revision === expectedCurrentRevision
```

and current logical location still matches the checkpoint.

The current Source IR must also exist at the same `expectedCurrentRevision` before the file is changed.

A stale or split mismatch stops before any file mutation.

This preserves the existing rule: Undo must never overwrite a newer independent revision.

## 8. Runtime Data Boundary

The recovery snapshot is runtime-only.

Do not persist or expose:

- current/newer file bytes;
- previous file bytes;
- previous/newer Document IR;
- checkpoint internals;
- adapterRef;
- native path;
- tool input.

These values must not enter:

- model Tool Output;
- Kiro history;
- audit DB;
- persisted Zustand state.

## 9. Testing Strategy

Keep this phase narrow.

### Required unit coverage

Extend existing focused Computer tests to cover:

1. Guided `rename_file` approval-required does not increment mutation quota;
2. Guided `move_file` approval-required does not increment mutation quota;
3. Guided `update_document` approval-required does not increment mutation quota;
4. approved resume increments exactly once;
5. pre-write revision conflict and file-too-large rejection do not increment mutation quota;
6. Markdown document Undo restores exact file + Artifact + Source revision;
7. DOCX document Undo restores exact bytes + Artifact + Source revision;
8. restore error with stores factually already on the previous revision is treated according to the verified final state, not blindly compensated;
9. restore failure with stores coherently still on the newer revision compensates the file back to the captured newer state;
10. split/unreadable post-failure Registry state returns manual-inspection failure without blind compensation;
11. compensation failure produces explicit `undo_failed` / verification failure semantics;
12. stale Artifact/Source revision fails before file mutation;
13. two document revisions in one task undo in reverse order without revision drift.

### Verification

Only the focused Computer unit files plus `npm run typecheck` are required by default.

No full Playwright run and no build unless implementation unexpectedly crosses a client/server or bundling boundary.

## 10. Acceptance Criteria

Part 2.1 is complete when:

- approval-required relocation/revision calls consume zero mutation quota;
- approved execution consumes exactly one mutation quota;
- preflight failures consume zero mutation quota;
- document Undo cannot report success unless file, Artifact metadata, and Source IR all factually match the previous revision;
- a restore API error is resolved from factual post-error state rather than assumption;
- coherent newer Registry state triggers verified filesystem compensation back to the newer file;
- incoherent/unknown Registry state fails safely without blind compensation;
- stale Artifact/Source state never touches the file;
- runtime snapshots remain non-persistent and model-invisible;
- no new Computer capability or UI surface is introduced;
- focused tests and typecheck pass.

## 11. Next Phase

After Part 2.1 is implemented and reviewed, proceed to:

**Kiro Computer Agent V2 — Part 3: Artifact UX**

covering Preview, Download, Recent Artifacts, and Ask Kiro about Artifact.