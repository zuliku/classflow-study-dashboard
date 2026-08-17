# Kiro Computer Agent V2 — Part 3 Artifact UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Kiro Computer Agent V2 by turning durable Artifact metadata into a usable read-only Web artifact workflow: Preview, Download, Recent 12, Ask Kiro context, stale-record handling, and the minimal Artifact integrity fixes required for those surfaces to stay truthful.

**Architecture:** Preserve the existing V1/V2 Computer trust boundary. Artifact UX is an explicit user-side read layer over the existing Artifact Registry + live Workspace adapters; it is not a new model tool or permission bypass. A small `artifacts/access.ts` service resolves stable `artifactId` to current logical Workspace/root/path, verifies filesystem availability, and produces bounded preview/download payloads. Ask Kiro attaches only safe logical Artifact metadata to the existing Kiro Context lifecycle; file content remains reread through normal Computer tools. Before exposing Recent Artifacts, close two registry-integrity gaps: create Undo must remove its Artifact record, and generic text patching of registered artifacts must keep revision metadata coherent while structured Kiro documents must use `update_document` rather than raw text patching.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Zustand, IndexedDB/fake-indexeddb, existing Computer Adapters, existing Kiro Artifact Registry/Source Store, ReactMarkdown/KiroMarkdown, Mammoth raw-text extraction, Shared Dialog/Popover primitives, Vitest, Playwright.

## Global Constraints

- Reuse `docs/superpowers/specs/2026-08-13-kiro-computer-agent-v2-artifact-file-lifecycle-design.md` as product/security source of truth.
- No new model-facing tool is added in Part 3.
- Preview/Download are explicit user-side read operations: no Agent audit entry, no mutation quota, no approval dialog.
- Preview/Download must still resolve the live Artifact → Workspace → root → normalized relative path → adapter chain; Browser grant checks remain enforced by the adapter.
- Never expose `adapterRef`, native path, `FileSystemDirectoryHandle`, bytes, cached full content, or permission tokens to model context/history/audit.
- Recent Artifacts shows exactly the latest 12 registered artifacts for the current active Workspace, sorted by `updatedAt` descending.
- Task-card Preview/Download resolves by stable `artifactId` and may continue to work after the user switches active Workspace, as long as the Artifact’s own Workspace still exists and is accessible.
- Ask Kiro is only offered for the current active Workspace Artifact; it may explicitly enable Computer for that already-active Workspace but must never silently switch to another Workspace or request a Browser directory grant.
- Artifact Context contains only `artifactId`, `workspaceId`, `rootId`, `relativePath`, `type`, and `revision`; full content is never auto-injected.
- Artifact Context is session-ephemeral: do not persist it into Kiro conversation history. The durable Artifact remains in the Artifact Registry and can be reattached from Recent Artifacts after reload.
- Markdown Preview reuses `KiroMarkdown`; do not enable raw HTML/`rehype-raw`.
- DOCX Preview uses safe structure facts plus bounded raw text. Do not add Mammoth HTML rendering or a new sanitizer subsystem.
- No native open/reveal behavior on Web.
- No model-facing delete. Removing a stale Artifact record is explicit UI metadata cleanup only and never deletes filesystem content.
- Do not create a global Explorer page.
- Do not start Tauri/Windows/Shell/MCP/PPTX/XLSX/PDF generation.
- Verification stays focused: new Artifact unit tests, existing focused Computer tests touched by integrity changes, the existing `kiro-computer-artifacts-v2.spec.ts`, and `npm run typecheck`. Skip full suites/build by default.

---

## File Map

### Create

- `lib/ai/computer/artifacts/access.ts` — live Artifact resolution, availability, bounded Preview payloads, exact Download payloads, Recent 12 availability list.
- `lib/ai/computer/artifacts/download.ts` — browser Blob-URL download trigger only; no filesystem authority.
- `store/useKiroArtifactUiStore.ts` — ephemeral `previewArtifactId`; never persisted.
- `hooks/useKiroArtifactActions.ts` — reusable Preview/Download action handlers with toast/error mapping.
- `components/kiro/computer/KiroArtifactPreviewDialogHost.tsx` — one global preview host under `KiroSessionProvider`.
- `components/kiro/computer/KiroRecentArtifactsPopover.tsx` — current-Workspace Recent 12 surface.
- `tests/unit/kiro-artifact-access.test.ts` — access/preview/download/stale tests.
- `tests/unit/kiro-artifact-context.test.ts` — safe Artifact Context + non-persistence tests.

### Modify

- `lib/ai/computer/artifacts/db.ts` — atomic metadata-only revision bump for generic Artifact text patches.
- `lib/ai/computer/artifacts/service.ts` — Recent sorting, explicit metadata removal, matching removal, generic content revision commit.
- `lib/ai/computer/checkpoints.ts` — optional `artifactId` on `remove-created`.
- `lib/ai/computer/executor.ts` — create inverses carry Artifact ID; registered generic patch integrates Artifact revision; Kiro-owned structured docs reject raw patch.
- `hooks/useKiroChat.ts` — remove-created Undo cleans Artifact metadata/source after verified file removal.
- `lib/ai/context/types.ts` — add safe session-only Artifact Context metadata.
- `lib/ai/context/contextSelection.ts` — Artifact prompt projection uses safe logical whitelist.
- `lib/ai/context/presentation.ts` — no semantic change; keep generic manual-token behavior.
- `components/kiro/KiroContextBar.tsx` — exhaustive Artifact kind icon map only.
- `components/kiro/KiroContextPicker.tsx` — ensure Artifact kind does not accidentally become an @ picker category; exhaustive icon fallback remains explicit.
- `lib/ai/history/sanitize.ts` — explicitly exclude Artifact Context refs from persisted manual/entry refs.
- `components/kiro/KiroSessionProvider.tsx` — mount one Preview Dialog host.
- `components/kiro/KiroHeader.tsx` — add low-priority Recent Artifacts trigger beside session actions.
- `components/kiro/computer/KiroAgentTaskCard.tsx` — row-level Preview/Download actions for changes with `artifactId`, including restored history cards.
- `app/api/ai/chat/route.ts` — trusted note that Artifact Context metadata is a snapshot and Computer tool results are authoritative.
- `tests/unit/kiro-computer-checkpoints.test.ts` — create Undo removes Artifact Registry/Source.
- `tests/unit/kiro-computer-tools.test.ts` — structured Artifact patch guard + generic Artifact revision facts.
- `tests/e2e/kiro-computer-artifacts-v2.spec.ts` — Preview/Download/Recent/Ask Kiro/stale flow.

No global Settings/UI primitive redesign is part of this phase.

---

## Task 1: Close Artifact Integrity Gaps Needed by UX

**Files:**
- Modify: `lib/ai/computer/artifacts/db.ts`
- Modify: `lib/ai/computer/artifacts/service.ts`
- Modify: `lib/ai/computer/checkpoints.ts`
- Modify: `lib/ai/computer/executor.ts`
- Modify: `hooks/useKiroChat.ts`
- Test: `tests/unit/kiro-computer-checkpoints.test.ts`
- Test: `tests/unit/kiro-computer-tools.test.ts`

**Interfaces:**

Add to `lib/ai/computer/artifacts/service.ts`:

```ts
export async function removeArtifactRecord(artifactId: string): Promise<void>;

export async function removeArtifactRecordIfMatches(input: {
  artifactId: string;
  workspaceId: string;
  rootId: string;
  relativePath: string;
}): Promise<void>;

export async function commitGenericArtifactRevision(input: {
  artifactId: string;
  expectedRevision: number;
}): Promise<KiroArtifact>;

export async function listRecentArtifactsForWorkspace(
  workspaceId: string,
  limit?: number
): Promise<KiroArtifact[]>;
```

`listRecentArtifactsForWorkspace()` defaults to 12 and clamps `limit` to `1..12` for this V2 surface. Sort by numeric `Date.parse(updatedAt)` descending with `createdAt` as deterministic fallback.

Add an atomic metadata-only DB helper:

```ts
export async function artifactDbCommitMetadataRevision(input: {
  artifactId: string;
  expectedRevision: number;
}): Promise<KiroArtifact>;
```

It must use one `artifacts` readwrite transaction, verify the current revision, write `{ ...artifact, revision: revision + 1, updatedAt: new Date().toISOString() }`, resolve only after transaction completion, and re-read after commit. Revision mismatch throws `ARTIFACT_REVISION_CONFLICT`.

- [ ] **Step 1: Add failing tests for create Undo Artifact cleanup**

Extend `tests/unit/kiro-computer-checkpoints.test.ts` so both create-text and create-document tests assert the generated inverse carries the registered Artifact ID.

Example for Markdown document:

```ts
const created = await runTool("create_document", {
  path: "undo-artifact.md",
  document: IR_V1,
});
expect(created.kind).toBe("completed");
if (created.kind !== "completed" || created.runtime?.inverse?.type !== "remove-created") return;

const artifactId = created.runtime.change.artifactId;
expect(artifactId).toBeTruthy();
expect(created.runtime.inverse.artifactId).toBe(artifactId);
```

The final integration assertion in this file must use the same helper/orchestration extracted/used by `useKiroChat` rather than only `applyInverseToAdapter`, and assert after Undo:

```ts
expect(await io.stat("undo-artifact.md")).toBeNull();
expect(await getArtifact(artifactId!)).toBeNull();
expect(await getArtifactSource(artifactId!)).toBeNull();
```

- [ ] **Step 2: Add failing tests for registered patch integrity**

In `tests/unit/kiro-computer-tools.test.ts`, add two cases.

**Structured Kiro document cannot be raw patched:**

```ts
const artifactId = await seedEditableDoc(counters());
const c = counters();
const attempt = await executeKiroComputerTool({
  toolName: "patch_text_file",
  toolCallId: "call-structured-patch",
  toolInput: { path: "plan.md", edits: [{ oldText: "版本一", newText: "绕过 IR" }] },
  context: ctx(AUTO_SNAPSHOT),
  counters: c,
});
expect(attempt.kind).toBe("completed");
if (attempt.kind !== "completed") return;
expect(attempt.output.ok).toBe(false);
expect((attempt.output as { code: string }).code).toBe("ARTIFACT_UNSUPPORTED_OPERATION");
expect((await getArtifact(artifactId!))?.revision).toBe(1);
expect(c.mutationCount).toBe(0);
```

**Generic registered text patch bumps metadata revision and returns artifact facts:** create a `.txt` using `create_text_file`, locate its Artifact, patch it, assert `artifactId` is unchanged, revision becomes 2, `runtime.change.artifactId` matches, and `runtime.change.revision === 2`.

- [ ] **Step 3: Run the focused tests RED**

```bash
npx vitest run \
  tests/unit/kiro-computer-checkpoints.test.ts \
  tests/unit/kiro-computer-tools.test.ts
```

Expected before implementation: inverse has no Artifact ID; create Undo leaves registry records; structured raw patch is allowed; generic patch does not update Artifact revision.

- [ ] **Step 4: Make Artifact record removal verified**

`removeArtifactRecord()` deletes Source first, then metadata, then factually re-reads both. If either remains, throw `ComputerError("VERIFICATION_FAILED", "Artifact 记录清理失败")`.

`removeArtifactRecordIfMatches()` first gets the Artifact. If already absent, return idempotently. If the stable ID exists but Workspace/root/path no longer matches the inverse, throw `ARTIFACT_REVISION_CONFLICT`/`VERIFICATION_FAILED`; never delete a record that has since moved to another logical location.

Do not touch filesystem content in these helpers.

- [ ] **Step 5: Add `artifactId?` to `remove-created`**

Update the checkpoint type:

```ts
{
  type: "remove-created";
  workspaceId: string;
  rootId: string;
  relativePath: string;
  resourceType: "file" | "directory";
  artifactId?: string;
}
```

In `create_text_file` and both `create_document` branches, pass the verified registered `artifactId` into the inverse. `create_directory` keeps it undefined.

- [ ] **Step 6: Integrate Artifact cleanup into Task Undo**

In `useKiroChat.ts`, keep the existing live Workspace/root resolution and `applyInverseToAdapter()` for `remove-created`. After the file/directory removal verifies, if `inverse.resourceType === "file" && inverse.artifactId`, run:

```ts
await removeArtifactRecordIfMatches({
  artifactId: inverse.artifactId,
  workspaceId: inverse.workspaceId,
  rootId: inverse.rootId,
  relativePath: inverse.relativePath,
});
```

If registry cleanup cannot verify, the existing Task Undo catch must produce `undo_failed`; never report full Undo success while a known Artifact record remains.

- [ ] **Step 7: Guard structured documents and revise generic registered patches**

In the `patch_text_file` branch, before mutation count and before filesystem write:

1. `findArtifactByLocation(ws.id, root.id, normalized)`.
2. If an Artifact exists, call `getArtifactSource(artifact.id)`.
3. If a Source IR exists at the same revision, return completed failure:

```ts
{
  ok: false,
  code: "ARTIFACT_UNSUPPORTED_OPERATION",
  message: "该文件是 Kiro 结构化文档，请使用 update_document 更新，不能使用原始文本 patch。"
}
```

4. If Source IR exists but Source/Artifact revisions disagree, return `ARTIFACT_REVISION_CONFLICT`.
5. Compute exact text patch fully in memory before mutation count.
6. Increment mutation count immediately before the first `writeText`.
7. Verify the patched file exactly.
8. If no Artifact is registered, preserve current behavior.
9. If a generic Artifact is registered, call `commitGenericArtifactRevision({ artifactId, expectedRevision: artifact.revision })` only after filesystem verification.
10. If metadata revision commit fails, restore the exact `current` text and exact-verify it before returning failure. If rollback also fails, return `VERIFICATION_FAILED` with manual-inspection semantics.
11. On success, include stable `artifactId` and new `revision` in `buildMutationRuntime()`.

This preserves the V2 invariant that content changes increment Artifact revision while structured Source IR cannot silently drift from the real file.

- [ ] **Step 8: Implement Recent sorting service**

`listRecentArtifactsForWorkspace(workspaceId, 12)` returns metadata only, sorted latest-first. It does not stat files; live availability belongs in Task 2 `access.ts`.

- [ ] **Step 9: Run Task 1 GREEN**

```bash
npx vitest run \
  tests/unit/kiro-computer-checkpoints.test.ts \
  tests/unit/kiro-computer-tools.test.ts
```

- [ ] **Step 10: Commit Task 1**

```bash
git add \
  lib/ai/computer/artifacts/db.ts \
  lib/ai/computer/artifacts/service.ts \
  lib/ai/computer/checkpoints.ts \
  lib/ai/computer/executor.ts \
  hooks/useKiroChat.ts \
  tests/unit/kiro-computer-checkpoints.test.ts \
  tests/unit/kiro-computer-tools.test.ts

git commit -m "fix(kiro): keep artifact registry aligned with file changes"
```

---

## Task 2: Build Safe Artifact Access, Preview, and Download

**Files:**
- Create: `lib/ai/computer/artifacts/access.ts`
- Create: `lib/ai/computer/artifacts/download.ts`
- Create: `store/useKiroArtifactUiStore.ts`
- Create: `hooks/useKiroArtifactActions.ts`
- Create: `components/kiro/computer/KiroArtifactPreviewDialogHost.tsx`
- Modify: `components/kiro/KiroSessionProvider.tsx`
- Modify: `components/kiro/computer/KiroAgentTaskCard.tsx`
- Test: `tests/unit/kiro-artifact-access.test.ts`

**Interfaces:**

`access.ts` exports:

```ts
export const MAX_ARTIFACT_PREVIEW_BYTES = 20 * 1024 * 1024;
export const MAX_ARTIFACT_PREVIEW_CHARS = 100_000;

export type KiroArtifactAvailability =
  | "available"
  | "missing"
  | "unavailable";

export interface KiroRecentArtifactEntry {
  artifact: KiroArtifact;
  workspaceLabel: string;
  rootLabel: string;
  availability: KiroArtifactAvailability;
  unavailableReason?: string;
}

export type KiroArtifactPreview =
  | {
      kind: "markdown";
      artifact: KiroArtifact;
      workspaceLabel: string;
      rootLabel: string;
      text: string;
      truncated: boolean;
      size: number;
    }
  | {
      kind: "text";
      artifact: KiroArtifact;
      workspaceLabel: string;
      rootLabel: string;
      text: string;
      truncated: boolean;
      size: number;
    }
  | {
      kind: "docx";
      artifact: KiroArtifact;
      workspaceLabel: string;
      rootLabel: string;
      text: string;
      truncated: boolean;
      size: number;
      facts: {
        title?: string;
        headings: number;
        paragraphs: number;
        lists: number;
        tables: number;
        codeBlocks: number;
        characters: number;
      };
    };

export interface KiroArtifactDownloadPayload {
  artifact: KiroArtifact;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export async function listRecentArtifactEntries(input: {
  workspaceId: string;
  workspaces: KiroWorkspaceMeta[];
  limit?: number;
}): Promise<KiroRecentArtifactEntry[]>;

export async function getArtifactPreview(input: {
  artifactId: string;
  workspaces: KiroWorkspaceMeta[];
}): Promise<KiroArtifactPreview>;

export async function getArtifactDownloadPayload(input: {
  artifactId: string;
  workspaces: KiroWorkspaceMeta[];
}): Promise<KiroArtifactDownloadPayload>;
```

- [ ] **Step 1: Write failing access tests**

Create `tests/unit/kiro-artifact-access.test.ts` with `fake-indexeddb/auto` and Sandbox workspaces. Cover:

1. Recent list sorts `updatedAt` descending and returns at most 12.
2. A metadata record whose file is missing returns `availability: "missing"` rather than being silently recreated.
3. Markdown preview returns bounded current filesystem text, `truncated: true` beyond 100,000 chars, and never returns Source IR/adapterRef.
4. Text preview returns monospace-ready text data.
5. Kiro-created DOCX preview returns structural facts from matching Source IR plus bounded raw text; no HTML field exists.
6. Download payload returns exact bytes and correct MIME/name for Markdown, text, DOCX.
7. Missing Artifact → `ARTIFACT_NOT_FOUND`.
8. Missing Workspace/root → logical `WORKSPACE_NOT_FOUND`/`ROOT_NOT_FOUND` failure.
9. Missing file → `RESOURCE_NOT_FOUND`.
10. Preview file above 20 MiB rejects `FILE_TOO_LARGE` before extraction.

- [ ] **Step 2: Run access test RED**

```bash
npx vitest run tests/unit/kiro-artifact-access.test.ts
```

- [ ] **Step 3: Implement one live Artifact resolver**

Inside `access.ts`, keep resolution private and shared by list/preview/download:

```text
artifactId
  ↓ getArtifact
Artifact logical metadata
  ↓ live workspaces.find(workspaceId)
Workspace
  ↓ roots.find(rootId)
Root
  ↓ normalizeRelativeComputerPath(relativePath)
normalized path
  ↓ getComputerAdapterForAdapterRef(root.adapterRef)
Adapter
  ↓ stat/read
filesystem truth
```

No caller receives `adapterRef` or handle.

For `listRecentArtifactEntries`, stat only the latest 12 metadata records. Classification:

- `stat` file → `available`;
- `stat` returns null → `missing`;
- Workspace/root absent or adapter/grant throws → `unavailable` with a bounded human-readable reason.

A denied/revoked Browser grant is `unavailable`, not `missing`; never suggest deleting real-file metadata solely because authorization is unavailable.

- [ ] **Step 4: Implement Markdown/Text Preview**

Require `stat.kind === "file"` and `size <= 20 MiB`. Read current text from the adapter. Bound to exactly `MAX_ARTIFACT_PREVIEW_CHARS` using existing `truncateText()`/normalization utilities. Filesystem content is authoritative even if Source IR exists.

Do not write to Artifact Registry during Preview.

- [ ] **Step 5: Implement safe DOCX Preview**

Read bytes only after size preflight. Use existing `extractDocx(new Blob([bytes], { type: DOCX_MIME }))` for bounded raw text; do not call `mammoth.convertToHtml`.

For structural facts:

- if `getArtifactSource(artifact.id)` exists and `source.revision === artifact.revision`, use `inspectDocumentFacts(source.document, "docx")`;
- otherwise return a safe fallback fact object with `title: artifact.title`, `headings/lists/tables/codeBlocks = 0`, `paragraphs` derived from non-empty raw-text paragraphs, and `characters` from extracted text.

No HTML is returned by `KiroArtifactPreview`.

- [ ] **Step 6: Implement exact Download payload**

Download always reads exact current bytes from the live adapter. MIME mapping:

```ts
markdown -> "text/markdown;charset=utf-8"
text     -> "text/plain;charset=utf-8"
docx     -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
```

No native open/reveal path exists.

- [ ] **Step 7: Implement browser download trigger**

`lib/ai/computer/artifacts/download.ts` exports:

```ts
export function triggerArtifactDownload(payload: KiroArtifactDownloadPayload): void;
```

It creates a transient Blob URL, an `<a download>`, clicks it, removes the element, and always revokes the URL on the next task/timeout. Throw a bounded error when `window/document/URL.createObjectURL` is unavailable.

- [ ] **Step 8: Create ephemeral Preview UI store**

`useKiroArtifactUiStore` contains only:

```ts
previewArtifactId: string | null;
openPreview: (artifactId: string) => void;
closePreview: () => void;
```

No persist middleware.

- [ ] **Step 9: Create reusable Artifact UI actions hook**

`useKiroArtifactActions()` returns:

```ts
{
  previewArtifact(artifactId: string): void;
  downloadArtifact(artifactId: string): Promise<void>;
}
```

`downloadArtifact` reads `useKiroComputerStore.getState().workspaces` at click time, gets exact payload, triggers browser download, and reports bounded toast errors. It must not enable Computer, mutate Artifact metadata, write audit, or consume Agent quota.

- [ ] **Step 10: Create one global Preview Dialog host**

Mount `KiroArtifactPreviewDialogHost` exactly once inside `KiroSessionProvider`, next to the persistent Sidecar under all Kiro contexts.

Dialog requirements:

- shared `Dialog`, `overlayId="kiro-artifact-preview"`, `max-w-3xl`;
- loading, success, missing/unavailable error states;
- header: filename, `Markdown` / `文本` / `Word`, `vN` when revision > 1, logical Workspace/root label;
- Markdown: tabs `预览` and `源码`; preview uses existing `<KiroMarkdown content={preview.text} />`, raw uses `<pre>`; set a local `--kiro-output-font-size: 14px` wrapper because this host lives outside `KiroChatSurface`;
- Text: bounded read-only monospace `<pre>`;
- DOCX: structural fact grid + bounded raw text excerpt; no `dangerouslySetInnerHTML`;
- explicit truncation notice when `truncated`;
- `下载` button uses the same `useKiroArtifactActions()` path;
- Close button and Escape behavior from shared Dialog;
- missing-file state offers `移除失效记录` only when the Artifact Registry record still exists and actual `stat` was missing; this action calls `removeArtifactRecord()` and never touches filesystem content.

- [ ] **Step 11: Add Task Card artifact actions**

In `KiroAgentTaskCard.tsx`, retain task-wide `查看更改` and `撤销本次更改`. For each change row with `artifactId`, render two compact trailing icon buttons:

```text
预览 <displayName>
下载 <displayName>
```

Use `Eye` and `Download`. These actions must also render on restored/history Task cards when `artifactId` exists; history still has no Undo.

Do not add rename/move/delete controls to the Task Card.

- [ ] **Step 12: Run Task 2 tests GREEN**

```bash
npx vitest run tests/unit/kiro-artifact-access.test.ts
npm run typecheck
```

- [ ] **Step 13: Commit Task 2**

```bash
git add \
  lib/ai/computer/artifacts/access.ts \
  lib/ai/computer/artifacts/download.ts \
  store/useKiroArtifactUiStore.ts \
  hooks/useKiroArtifactActions.ts \
  components/kiro/computer/KiroArtifactPreviewDialogHost.tsx \
  components/kiro/KiroSessionProvider.tsx \
  components/kiro/computer/KiroAgentTaskCard.tsx \
  tests/unit/kiro-artifact-access.test.ts

git commit -m "feat(kiro): add artifact preview and download"
```

---

## Task 3: Add Recent 12 and Safe Ask Kiro Artifact Context

**Files:**
- Create: `components/kiro/computer/KiroRecentArtifactsPopover.tsx`
- Modify: `components/kiro/KiroHeader.tsx`
- Modify: `lib/ai/context/types.ts`
- Modify: `lib/ai/context/contextSelection.ts`
- Modify: `components/kiro/KiroContextBar.tsx`
- Modify: `components/kiro/KiroContextPicker.tsx`
- Modify: `lib/ai/history/sanitize.ts`
- Modify: `app/api/ai/chat/route.ts`
- Test: `tests/unit/kiro-artifact-context.test.ts`

**Interfaces:**

Extend Context types with:

```ts
export interface KiroArtifactContextMeta {
  artifactId: string;
  workspaceId: string;
  rootId: string;
  relativePath: string;
  type: "text" | "markdown" | "docx";
  revision: number;
}

export interface KiroContextRef {
  key: string;
  kind: "course" | "assignment" | "group-project" | "material" | "week" | "artifact";
  entityId?: string;
  label: string;
  source: "auto" | "manual" | "entry";
  artifact?: KiroArtifactContextMeta;
}
```

Artifact refs are always created as `source: "manual"` by Recent Artifacts.

`refsForPrompt()` must produce a strict safe projection. For Artifact:

```ts
{
  kind: "artifact",
  id: artifact.artifactId,
  label: ref.label,
  workspaceId: artifact.workspaceId,
  rootId: artifact.rootId,
  relativePath: artifact.relativePath,
  type: artifact.type,
  revision: artifact.revision,
}
```

No extra object spread from the original ref.

- [ ] **Step 1: Add failing safe-context tests**

Create `tests/unit/kiro-artifact-context.test.ts`.

Construct an Artifact ref and assert `refsForPrompt([ref])` exactly equals the logical whitelist above. Assert serialized output does not contain:

```text
adapterRef
nativePath
absolutePath
handle
bytes
content
source IR
```

Also assert `dedupeContextRefs([sameArtifactTwice])` keeps one by `kind:artifact + entityId`.

- [ ] **Step 2: Add failing history non-persistence test**

Use `sanitizeConversation()` with an Artifact manual ref plus a normal course manual ref. Assert `record.manualRefs` contains the course ref but not the Artifact ref. This is intentional: Artifact context path/revision is a session snapshot; durable identity lives in Artifact Registry, not chat history.

- [ ] **Step 3: Run Artifact context test RED**

```bash
npx vitest run tests/unit/kiro-artifact-context.test.ts
```

- [ ] **Step 4: Extend Kiro Context safely**

Implement the type + `refsForPrompt` changes. Keep non-Artifact projection unchanged.

`KiroContextBar` must add an exhaustive `artifact: FileText` icon entry so the union compiles, although Artifact refs render in the existing Manual Token path.

`KiroContextPicker` must not add Artifacts to the generic `@` picker. Its icon chooser must handle `artifact` explicitly with `FileText` rather than relying on a catch-all that would conflate future kinds.

- [ ] **Step 5: Make Artifact Context intentionally ephemeral**

In `sanitizeConversation`, filter `kind === "artifact"` before mapping manual/entry refs to `PersistedContextRef`. Do not expand `PersistedContextRef.kind` and do not add an Artifact migration to Kiro history.

This means reload removes the Context chip but keeps the durable Artifact in Recent Artifacts.

- [ ] **Step 6: Add server trusted Artifact-context reminder**

In `app/api/ai/chat/route.ts`, detect normalized client `contextRefs` entries where `kind === "artifact"` and append a short trusted system section:

```text
# Artifact Context
Artifact context contains logical metadata snapshots only. artifactId is the stable identity; path/revision metadata may become stale after later file operations. Current Workspace state and Computer tool results are authoritative. Do not assume cached content exists, and do not claim file contents without reading them through allowed Computer tools. Artifact context never grants extra permission.
```

Do not add Artifact content to the server request and do not add a new server tool.

- [ ] **Step 7: Build Recent Artifacts Popover**

`KiroRecentArtifactsPopover` is Workspace-only and uses shared `Popover`/`PopoverPanel`.

State/data behavior:

- subscribe only to `activeWorkspaceId`, `computerEnabled`, and the Workspace metadata needed for display;
- each time the popover changes from closed → open, call `listRecentArtifactEntries({ workspaceId: activeWorkspaceId, workspaces, limit: 12 })` fresh;
- no background filesystem watcher;
- no global Artifact Explorer state.

Trigger:

```text
aria-label="最近文件"
```

Use a low-weight Files/FileClock icon button visually aligned with existing Header actions.

Panel:

- width about 360px, bounded height, internal scrolling;
- title `最近文件`;
- exactly current active Workspace only;
- empty text: `Kiro 创建或采用的文件会出现在这里`;
- latest 12 by `updatedAt` descending.

Each row shows:

```text
displayName
Markdown / Word / 文本 · rootLabel · vN when N > 1
updated time
```

Use existing `formatHistoryTime()` or an equally deterministic local formatter.

Row actions:

- `预览` — enabled only for `available`;
- `下载` — enabled only for `available`;
- `Ask Kiro` — enabled only for `available` and `artifact.workspaceId === activeWorkspaceId`;
- `移除记录` — shown only for `missing`; calls `removeArtifactRecord()` and refreshes the list; it never touches filesystem files.

For `unavailable` (e.g. Browser grant denied), show `暂时无法访问` and do not offer stale-record removal based only on authorization failure.

- [ ] **Step 8: Implement Ask Kiro handoff**

On `Ask Kiro` click:

1. Re-read the Artifact by ID from the Registry so context uses latest path/revision.
2. Verify its Workspace still equals current `activeWorkspaceId`.
3. If Computer is off, call `setComputerEnabled(true)` for the already-active Workspace. Do not switch Workspace and do not call `showDirectoryPicker`/`requestPermission`.
4. Create a manual Context ref:

```ts
{
  key: `manual-artifact-${artifact.id}`,
  kind: "artifact",
  entityId: artifact.id,
  label: `文件 · ${artifact.displayName}`,
  source: "manual",
  artifact: {
    artifactId: artifact.id,
    workspaceId: artifact.workspaceId,
    rootId: artifact.rootId,
    relativePath: artifact.relativePath,
    type: artifact.type,
    revision: artifact.revision,
  },
}
```

5. Call existing `useKiroRuntime().addManualContext(ref)`.
6. Close the popover and toast `已添加到 Kiro 上下文`.
7. Do not automatically send a model request and do not inject full file content.

- [ ] **Step 9: Mount Recent Artifacts in Kiro Header**

Change the right side of `KiroHeader` from only `KiroSessionActions` to:

```tsx
<div className="flex items-center gap-1.5 shrink-0">
  <KiroRecentArtifactsPopover />
  <KiroSessionActions ... />
</div>
```

Do not render this global Recent surface in Sidecar; Sidecar can still use Preview/Download actions from Task Cards.

- [ ] **Step 10: Run Task 3 unit tests GREEN**

```bash
npx vitest run tests/unit/kiro-artifact-context.test.ts
npm run typecheck
```

- [ ] **Step 11: Commit Task 3**

```bash
git add \
  components/kiro/computer/KiroRecentArtifactsPopover.tsx \
  components/kiro/KiroHeader.tsx \
  lib/ai/context/types.ts \
  lib/ai/context/contextSelection.ts \
  components/kiro/KiroContextBar.tsx \
  components/kiro/KiroContextPicker.tsx \
  lib/ai/history/sanitize.ts \
  app/api/ai/chat/route.ts \
  tests/unit/kiro-artifact-context.test.ts

git commit -m "feat(kiro): add recent artifact context workflow"
```

---

## Task 4: Complete Offline Artifact UX Regression

**Files:**
- Modify: `tests/e2e/kiro-computer-artifacts-v2.spec.ts`
- Modify only if required by direct regression: files already listed in Tasks 1–3.

**Interfaces:**
- Reuse existing deterministic SSE helpers and canonical Sandbox root ID `root-sandbox` already used in this E2E.
- Reuse existing `classflow-kiro-artifacts-v1` and `classflow-kiro-sandbox-v1` browser helpers.

- [ ] **Step 1: Add one Part 3 offline E2E flow**

Append a new test named:

```text
V2 Part 3：Artifact Preview / Download / Recent / Ask Kiro 使用安全逻辑上下文
```

Mock `/api/ai/chat` deterministically.

Turn 1 returns `create_document` for:

```ts
{
  path: "research.md",
  document: {
    title: "研究方案",
    blocks: [
      { type: "heading", level: 1, content: [{ text: "研究背景" }] },
      { type: "paragraph", content: [{ text: "这是 Artifact UX 测试正文。" }] },
    ],
  },
}
```

Then return a normal answer.

- [ ] **Step 2: Verify Task-card Preview**

After Turn 1 completes:

- locate the owning `kiro-agent-task-card`;
- click `预览 research.md`;
- expect preview dialog visible;
- expect filename `research.md`, `研究背景`, and body text;
- switch to `源码` and assert raw Markdown contains `# 研究背景`;
- close dialog.

- [ ] **Step 3: Verify Task-card Download**

Use Playwright download event:

```ts
const downloadPromise = page.waitForEvent("download");
await taskCard.getByRole("button", { name: "下载 research.md" }).click();
const download = await downloadPromise;
expect(download.suggestedFilename()).toBe("research.md");
```

No external network request is allowed.

- [ ] **Step 4: Verify Recent 12 surface**

Click Header button `最近文件`. Assert panel contains `research.md`, `Markdown`, and no more than 12 artifact rows. The current Sandbox Workspace is the only Workspace represented.

- [ ] **Step 5: Verify Ask Kiro safe context**

Before clicking Ask Kiro, install/retain the `/api/ai/chat` route handler so the next request body is captured in a local variable.

Click `Ask Kiro research.md`. Assert:

- Recent popover closes;
- Composer Context Bar contains `文件 · research.md`;
- no model request occurred merely from clicking Ask Kiro.

Fill Composer with `总结这个文件` and send.

In the route handler, parse the request JSON and locate `contextRefs.find(r => r.kind === "artifact")`. Assert exact safe fields:

```ts
expect(artifactRef).toEqual({
  kind: "artifact",
  id: expect.any(String),
  label: "文件 · research.md",
  workspaceId: expect.any(String),
  rootId: "root-sandbox",
  relativePath: "research.md",
  type: "markdown",
  revision: 1,
});
```

Also assert serialized `contextRefs` does not contain:

```text
adapterRef
sandbox-default
nativePath
absolutePath
bytes
Artifact UX 测试正文
```

The next mock response may call `read_text({ rootId: "root-sandbox", path: "research.md" })` and then answer, proving content is reread through normal Computer tools rather than injected in Artifact Context.

- [ ] **Step 6: Verify stale record handling**

Use browser IndexedDB test helper to delete only `sandbox-default\0research.md` from the Sandbox `files` store while leaving the Artifact Registry record.

Reopen `最近文件` so it refreshes availability. Assert:

- `research.md` is marked `文件不存在`/missing;
- Preview/Download are disabled;
- `移除记录` is shown;
- clicking `移除记录` removes only Artifact metadata/source;
- Sandbox filesystem is not modified beyond the deliberate test deletion;
- the row disappears after refresh.

This proves filesystem truth wins and stale cleanup is metadata-only.

- [ ] **Step 7: Verify create Undo leaves no ghost Artifact**

Add a lightweight browser-level assertion to an existing create/Undo path or the new flow: after a Kiro-created file is undone, query `classflow-kiro-artifacts-v1/artifacts` and assert no record remains for that path.

- [ ] **Step 8: Run only Part 3 E2E**

```bash
npx playwright test tests/e2e/kiro-computer-artifacts-v2.spec.ts
```

- [ ] **Step 9: Run final focused unit suite**

```bash
npx vitest run \
  tests/unit/kiro-artifact-access.test.ts \
  tests/unit/kiro-artifact-context.test.ts \
  tests/unit/kiro-computer-checkpoints.test.ts \
  tests/unit/kiro-computer-tools.test.ts
```

- [ ] **Step 10: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 11: Static security audit**

```bash
rg -n \
"adapterRef|FileSystemDirectoryHandle|nativePath|absolutePath|dangerouslySetInnerHTML|convertToHtml|delete_file|delete_directory|run_shell|showDirectoryPicker|artifactId|kind: \"artifact\"" \
lib/ai/computer/artifacts \
lib/ai/context \
lib/ai/history \
components/kiro \
store \
app/api/ai/chat/route.ts
```

Manually verify:

- Preview/Download UI may use adapter resolution internally but does not expose `adapterRef` to React display/model/history.
- `showDirectoryPicker` is not introduced into Artifact UX.
- Artifact prompt projection is a strict whitelist.
- no `dangerouslySetInnerHTML`/Mammoth HTML path was added.
- no model-facing delete/shell tool exists.
- stale-record removal only calls Artifact metadata cleanup.
- Preview/Download do not write audit entries.

- [ ] **Step 12: Build policy**

Default:

```text
npm run build — SKIPPED by V2 Part 3 policy
```

Run build only if typecheck/E2E exposes a Next-only client/server boundary, dynamic Mammoth bundling issue, or compile problem not represented by typecheck.

- [ ] **Step 13: Final commit if regression fixes were required**

If Task 4 required code fixes beyond the three main commits:

```bash
git add <only directly related files>
git commit -m "fix(kiro): harden artifact ux lifecycle"
```

Do not create an empty fourth commit.

---

## Final Acceptance Checklist

### Artifact Integrity

- [ ] create-text/create-document inverse carries Artifact ID.
- [ ] create Undo removes file + matching Artifact metadata + Source IR.
- [ ] Undo never deletes a moved/rebound Artifact record by stale ID/location.
- [ ] raw `patch_text_file` cannot mutate a Kiro structured document with Source IR.
- [ ] generic registered text patch increments Artifact revision after verified file write.
- [ ] generic patch registry failure rolls file back exactly.

### Preview

- [ ] Task Card artifacts expose Preview.
- [ ] History Task Card artifact IDs can still Preview if live Artifact exists.
- [ ] Markdown uses safe existing `KiroMarkdown`.
- [ ] Markdown has rendered/raw views.
- [ ] Text is bounded monospace.
- [ ] DOCX shows safe structural facts + bounded raw text.
- [ ] no raw/rich HTML path added.
- [ ] Preview is read-only and does not consume Agent quota/audit.

### Download

- [ ] Task Card artifacts expose Download.
- [ ] Sandbox exact bytes download.
- [ ] Browser Workspace downloads a browser copy through authorized adapter.
- [ ] Blob URL is revoked.
- [ ] no native open/reveal claim.
- [ ] Download does not consume Agent quota/audit.

### Recent Artifacts

- [ ] Workspace Header has low-priority `最近文件` entry.
- [ ] only current active Workspace is listed.
- [ ] exactly latest 12 by `updatedAt` descending.
- [ ] rows show name/type/root/revision/time.
- [ ] stale missing file is visibly marked.
- [ ] grant-unavailable is not mislabeled missing.
- [ ] missing record can be removed explicitly without deleting filesystem content.
- [ ] no full Explorer page.

### Ask Kiro

- [ ] adds Manual Context, does not auto-send.
- [ ] current Workspace only; no silent Workspace switching.
- [ ] may explicitly enable Computer for already-active Workspace.
- [ ] no permission/grant picker from Ask Kiro.
- [ ] Context includes only artifactId/workspaceId/rootId/relativePath/type/revision.
- [ ] no file body/source IR/adapterRef/native path/bytes in Context.
- [ ] Artifact context not persisted to chat history.
- [ ] model reads actual content through normal Computer tools.
- [ ] server reminds model that metadata is a snapshot and tool results are authoritative.

### Security / Non-goals

- [ ] no new model tool.
- [ ] no model delete.
- [ ] no shell/process/app launch/MCP.
- [ ] no Tauri/Windows runtime.
- [ ] no semantic index/background watcher.
- [ ] no PPTX/XLSX/PDF artifact generation.
- [ ] no native path/handle leak.

### Verification

- [ ] `kiro-artifact-access.test.ts` PASS.
- [ ] `kiro-artifact-context.test.ts` PASS.
- [ ] focused checkpoint/tool tests PASS.
- [ ] existing offline Artifact V2 E2E PASS.
- [ ] typecheck PASS.
- [ ] build skipped or justified.

## Final Report Format

Report only:

```text
Kiro Computer Agent V2 — Part 3 Artifact UX Result

Commits:
- SHA + message

Artifact integrity:
- create Undo registry cleanup
- generic patch revision
- structured patch guard

Preview:
- Markdown
- Text
- DOCX
- stale behavior

Download:
- Sandbox
- Browser copy

Recent Artifacts:
- current Workspace
- latest 12
- stale cleanup

Ask Kiro:
- Context lifecycle
- safe metadata
- Computer/tool reread semantics

Security:
- no content/native leak
- no new model capabilities

Verification:
- focused unit
- Artifact E2E
- typecheck
- build

V2 status:
- complete / blockers
```

## STOP

After Part 3 verification and final report, STOP. Do not start Tauri, Windows Desktop, Shell, MCP, semantic indexing, Skills, or V3 automatically.
