# Kiro Computer Agent V2 — Final Closeout Tightening

This addendum extends `2026-08-13-kiro-computer-agent-v2-final-closeout.md` and is part of the same closeout task.

## Additional Root Cause: UTF-8 byte/character mismatch

Current `patch_text_file` Undo eligibility uses JavaScript `current.length`, while `genericArtifactPatchUndo.ts` protects the same 1 MiB snapshot boundary using filesystem byte size (`stat.size`). For multibyte UTF-8 text, a file can therefore be considered undoable when the checkpoint is created but be rejected by the actual Undo runtime with `FILE_TOO_LARGE`.

Example: a Chinese text whose JavaScript character count is below 1,048,576 but whose UTF-8 encoded size is above 1,048,576 bytes.

This must be fixed in the same final closeout before V2 is declared complete.

## Required change

In `lib/ai/computer/executor.ts`, replace character-count eligibility with UTF-8 byte-count eligibility:

```ts
const undoSnapshotBytes = new TextEncoder().encode(current).byteLength;
const canUndo = undoSnapshotBytes <= COMPUTER_PATCH_UNDO_LIMIT_BYTES;
```

An equivalent shared helper is acceptable.

Requirements:

- `COMPUTER_PATCH_UNDO_LIMIT_BYTES` remains exactly `1024 * 1024`.
- Do not truncate `beforeText`; retain an exact snapshot or retain no inverse.
- Unregistered patch larger than 1 MiB UTF-8 bytes may succeed, but must have no `restore-text` inverse.
- Registered generic Artifact patch larger than 1 MiB UTF-8 bytes may succeed and advance Artifact revision, but must have no `restore-generic-artifact-revision` inverse.
- Keep the runtime `stat.size` preflight as defense in depth for legacy/stale checkpoints.
- Do not change approval, quota timing, Artifact revision semantics, UI, history, audit, or tool schemas.

## Required RED/GREEN regression

Extend `tests/unit/kiro-computer-tools.test.ts` with:

1. ASCII content below 1 MiB -> inverse exists.
2. Multibyte UTF-8 content with `text.length < 1 MiB` but encoded bytes `> 1 MiB` -> no inverse.
3. Registered generic Artifact with the same multibyte condition -> revision increments, artifactId stays stable, no inverse.
4. Exactly 1 MiB encoded bytes -> inverse allowed.
5. 1 MiB + 1 byte -> inverse denied.

The first multibyte regression must fail on the current baseline before the fix and pass after it.

## Final verification amendment

The focused closeout command in the parent plan already includes `tests/unit/kiro-computer-tools.test.ts`; keep it there. In the final static audit additionally search:

```text
current.length
COMPUTER_PATCH_UNDO_LIMIT_BYTES
GENERIC_ARTIFACT_PATCH_UNDO_LIMIT_BYTES
```

Acceptance additionally requires:

- no patch Undo eligibility uses character count;
- checkpoint creation and runtime preflight enforce the same 1 MiB byte boundary;
- UI never offers Undo for a checkpoint that the runtime deterministically rejects only because of the UTF-8 size mismatch.

Preferred implementation can remain one closeout commit if both fixes are cohesive:

`fix(kiro): harden final undo verification boundaries`

Do not start V3 until the parent closeout verification and this addendum both pass.