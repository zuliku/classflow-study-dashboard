# Kiro Computer Agent V2 — Part 2 Structured Document Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe structured revision of Kiro-owned Markdown/DOCX Artifacts with optimistic revision guards, verified rollback/Undo, and fix the global `UISelect` internal-scroll dismissal bug without widening menu scope.

**Architecture:** Reuse the V2 Artifact Registry and V1 Computer Runtime. `update_document` resolves a stable `artifactId` to the Artifact’s current logical Workspace/root/path, evaluates `document.modify`, renders through the existing `KiroDocument` pipeline, verifies the filesystem result, then atomically commits Artifact metadata + Source IR revision. Exact pre-update file content and Source IR stay runtime-only so failures and Undo can restore the prior revision. The Select bug is fixed at the shared `UISelect` scroll-dismiss boundary: internal listbox scroll is ignored, external page/container scroll still closes the fixed-position menu.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, IndexedDB, Zod, existing Computer Runtime/Approval/Checkpoint/History, existing Markdown/DOCX renderers, Vitest, Playwright.

## Global Constraints

- Preserve `Sandbox != Permission`; Artifact identity never authorizes access.
- `update_document` supports only `source === "kiro-created"`, type `markdown | docx`, with a matching Source IR record.
- `update_document` input is `artifactId + expectedRevision + KiroDocument`; the model does not provide native path, `adapterRef`, raw Markdown/OOXML, or bytes.
- `document.modify` policy remains Plan=`deny`, Guided=`ask`, Workspace Auto=`allow`; explicit deny/read-only/sandbox/grant failures remain authoritative.
- Revision increments only after verified file write and successful Artifact metadata + Source IR commit.
- Revision changes must preserve Artifact ID and current logical location.
- `ARTIFACT_REVISION_CONFLICT` must never overwrite a newer known Artifact revision.
- A document update is limited to a current file size of `5 * 1024 * 1024` bytes so exact rollback/Undo snapshots remain bounded. Larger files return `FILE_TOO_LARGE` before mutation.
- Exact previous file content, previous Source IR, and checkpoint data are runtime-only and never enter tool output, history, audit, Zustand persistence, or model context.
- No model-facing delete, shell, app, MCP, network, arbitrary overwrite, or existing arbitrary DOCX editing is added.
- The `UISelect` fix must keep external scroll/resize dismissal; only scroll events originating inside the open listbox are ignored.
- Do not stop/prevent wheel scrolling inside the Select menu.
- Keep tests focused: one existing Settings Select E2E, focused Artifact revision unit tests, existing Computer tool/checkpoint/history tests, one offline V2 Artifact E2E, and `npm run typecheck`; skip full suites/build by default.

---

## File Map

### Create
- `tests/unit/kiro-artifact-revision.test.ts` — editable Artifact/revision/atomic source+metadata behavior.

### Modify
- `components/ui/Select.tsx` — ignore internal listbox scroll while retaining external anchor-scroll dismissal.
- `tests/e2e/settings-select.spec.ts` — deterministic long-model-list wheel regression.
- `lib/ai/computer/errors.ts` — Artifact revision-specific error codes.
- `lib/ai/computer/artifacts/db.ts` — atomic dual-store revision commit/restore transaction.
- `lib/ai/computer/artifacts/service.ts` — editable state preflight and revision commit/restore API.
- `lib/ai/computer/tools/schemas.ts` — `updateDocumentSchema`.
- `lib/ai/computer/tools/registry.ts` — register `update_document` as `document.modify` mutation.
- `lib/ai/computer/executor.ts` — resolve Artifact-backed resource, update/verify/rollback, runtime change/inverse.
- `lib/ai/computer/checkpoints.ts` — runtime-only `restore-document-revision` inverse.
- `lib/ai/computer/task.ts` — update step/mutation guard and safe revision facts.
- `lib/ai/computer/result.ts` — safe revision fact fields if required by current action result shape.
- `lib/ai/computer/types.ts` — safe `revision?` display fact if action facts still mirror Task changes.
- `hooks/useKiroChat.ts` — document-revision Undo orchestration.
- `lib/ai/history/types.ts` — persist safe Artifact revision number.
- `lib/ai/history/sanitize.ts` — retain safe revision metadata only.
- `components/kiro/computer/KiroAgentTaskCard.tsx` — render document update as `修改 <name> · vN`.
- `tests/unit/kiro-computer-tools.test.ts` — exposure/policy/mutation guard.
- `tests/unit/kiro-computer-checkpoints.test.ts` — exact revision Undo/verification/single-use failure behavior.
- `tests/unit/kiro-computer-history-audit.test.ts` — safe revision history boundary.
- `tests/e2e/kiro-computer-artifacts-v2.spec.ts` — add deterministic create_document → update_document → Undo flow.

---

### Task 0: Fix `UISelect` Internal Scroll Dismissal

**Files:**
- Modify: `components/ui/Select.tsx`
- Modify: `tests/e2e/settings-select.spec.ts`

**Root cause:** `UISelect` portals its listbox to `document.body` and registers `window.addEventListener("scroll", onScroll, true)`. Capture-phase `scroll` therefore observes the listbox’s own `overflow-y-auto` scroll; the current handler unconditionally calls `closeMenu()`, so wheel-scrolling a long model list closes the menu itself.

**Required behavior:**
- scroll inside `menuRef` → menu stays open and scrolls normally;
- scroll of Settings/page/ancestor outside the listbox → menu closes so its fixed-position anchor cannot drift;
- resize still closes;
- outside pointer, Escape, keyboard selection remain unchanged.

- [ ] **Step 1: Add a deterministic failing Settings model-scroll E2E**

In `tests/e2e/settings-select.spec.ts`, add one test that intercepts the OpenCode model catalog with a long deterministic list before `page.goto`:

```ts
await page.route("**/api/ai/models?provider=opencode-go", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      models: Array.from({ length: 20 }, (_, i) => ({
        id: `scroll-model-${i + 1}`,
        name: `测试滚动模型 ${String(i + 1).padStart(2, "0")}`,
        transport: "openai-compatible",
        vendor: "openai",
      })),
    }),
  });
});
```

Open Settings → `Kiro 与 AI`; choose `OpenCode Go` in `AI 服务`; wait for the `模型` combobox; open it. Assert the listbox is actually scrollable:

```ts
await expect.poll(() =>
  listbox.evaluate((el) => el.scrollHeight > el.clientHeight)
).toBe(true);
```

Then:

```ts
await listbox.hover();
await page.mouse.wheel(0, 500);
await expect(listbox).toBeVisible();
const last = listbox.getByRole("option", { name: "测试滚动模型 20" });
await last.scrollIntoViewIfNeeded();
await last.click();
await expect(modelTrigger).toContainText("测试滚动模型 20");
```

- [ ] **Step 2: Run only the new regression and confirm RED**

```bash
npx playwright test tests/e2e/settings-select.spec.ts -g "菜单内部滚动"
```

Expected before fix: listbox closes after `mouse.wheel`, so visibility/click assertion fails.

- [ ] **Step 3: Fix the root cause in `UISelect`**

Replace the unconditional scroll handler with event-aware dismissal:

```ts
const onScroll = (event: Event) => {
  const target = event.target;
  if (target instanceof Node && menuRef.current?.contains(target)) return;
  closeMenu();
};
```

Keep:

```ts
window.addEventListener("scroll", onScroll, true);
```

and remove it with the same capture flag. Do not add `wheel` handlers, `preventDefault`, `stopPropagation`, a Portal rewrite, or a new dependency.

- [ ] **Step 4: Run the focused Select E2E GREEN**

```bash
npx playwright test tests/e2e/settings-select.spec.ts -g "菜单内部滚动"
```

- [ ] **Step 5: Commit the isolated bug fix**

```bash
git add components/ui/Select.tsx tests/e2e/settings-select.spec.ts
git commit -m "fix(ui): keep select open during internal scroll"
```

---

### Task 1: Atomic Artifact Revision State

**Files:**
- Modify: `lib/ai/computer/errors.ts`
- Modify: `lib/ai/computer/artifacts/db.ts`
- Modify: `lib/ai/computer/artifacts/service.ts`
- Test: `tests/unit/kiro-artifact-revision.test.ts`

**Interfaces:**

Add error codes:

```ts
| "ARTIFACT_NOT_FOUND"
| "ARTIFACT_NOT_EDITABLE"
| "ARTIFACT_REVISION_CONFLICT"
```

Add service contracts:

```ts
export interface EditableArtifactRevisionState {
  artifact: KiroArtifact;
  source: KiroArtifactSourceRecord;
}

export async function getEditableArtifactRevisionState(
  artifactId: string,
  expectedRevision: number
): Promise<EditableArtifactRevisionState>;

export async function commitArtifactRevision(input: {
  artifactId: string;
  expectedRevision: number;
  document: KiroDocument;
}): Promise<KiroArtifact>;

export async function restoreArtifactRevision(input: {
  artifactId: string;
  expectedCurrentRevision: number;
  revision: number;
  document: KiroDocument;
}): Promise<KiroArtifact>;
```

DB layer must implement one read-write transaction spanning both `artifacts` and `sources` so metadata revision and source revision cannot commit independently.

- [ ] **Step 1: Write failing revision tests**

`tests/unit/kiro-artifact-revision.test.ts` must cover:

```ts
it("loads only Kiro-owned Markdown/DOCX artifacts with matching source IR");
it("rejects workspace-existing artifacts as ARTIFACT_NOT_EDITABLE");
it("rejects generic Kiro-created markdown without source IR as ARTIFACT_NOT_EDITABLE");
it("rejects stale expectedRevision as ARTIFACT_REVISION_CONFLICT");
it("atomically commits metadata revision and Source IR revision together");
it("restoreArtifactRevision requires the expected current revision and restores both stores together");
it("content revision keeps artifact id/root/path stable");
```

Use the existing IndexedDB test environment; no new dependency.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/unit/kiro-artifact-revision.test.ts
```

- [ ] **Step 3: Implement dual-store atomic DB transaction**

In `artifacts/db.ts`, add an internal transaction helper that:

1. opens `artifacts` + `sources` with `readwrite`;
2. reads current Artifact and Source record;
3. rejects missing records;
4. verifies current Artifact revision and Source revision equal `expectedRevision`;
5. writes both updated records in the same transaction;
6. resolves only on `tx.oncomplete`;
7. reports conflict separately from generic transaction failure.

Do not perform filesystem IO in this IndexedDB transaction.

- [ ] **Step 4: Implement service-level editability and revision methods**

`getEditableArtifactRevisionState()` must require:

```text
artifact exists
artifact.source === kiro-created
artifact.type === markdown | docx
source record exists
source.revision === artifact.revision
expectedRevision === artifact.revision
```

`commitArtifactRevision()` increments exactly by `+1` and updates `updatedAt`. `restoreArtifactRevision()` sets the explicit prior revision and Source IR only when the current revision equals `expectedCurrentRevision`.

- [ ] **Step 5: Run revision unit GREEN**

```bash
npx vitest run tests/unit/kiro-artifact-revision.test.ts
```

- [ ] **Step 6: Commit Task 1**

```bash
git add lib/ai/computer/errors.ts lib/ai/computer/artifacts/db.ts lib/ai/computer/artifacts/service.ts tests/unit/kiro-artifact-revision.test.ts
git commit -m "feat(kiro): add atomic artifact revisions"
```

---

### Task 2: `update_document` Tool, Permission, Verification, and Rollback

**Files:**
- Modify: `lib/ai/computer/tools/schemas.ts`
- Modify: `lib/ai/computer/tools/registry.ts`
- Modify: `lib/ai/computer/executor.ts`
- Modify: `lib/ai/computer/task.ts`
- Modify: `lib/ai/computer/result.ts`
- Modify: `lib/ai/computer/types.ts`
- Test: `tests/unit/kiro-computer-tools.test.ts`

**Tool schema:**

```ts
export const updateDocumentSchema = z.object({
  artifactId: z.string().trim().min(1).max(160),
  expectedRevision: z.number().int().min(1).max(1_000_000),
  document: z
    .unknown()
    .refine(isKiroDocument, { message: "document 必须是结构化 KiroDocument IR" }),
});
```

Registry:

```ts
{
  name: "update_document",
  description: "更新 Kiro 创建的 Markdown/DOCX Artifact；必须提供当前 expectedRevision。",
  schema: updateDocumentSchema,
  capability: "document.modify",
  mutation: true,
}
```

Add constant:

```ts
export const COMPUTER_DOCUMENT_REVISION_LIMIT_BYTES = 5 * 1024 * 1024;
```

- [ ] **Step 1: Extend tool/policy tests RED**

Add exact assertions to `kiro-computer-tools.test.ts`:

```text
Plan: update_document not exposed
Guided: exposed, policy asks
Workspace Auto: exposed, policy allows
read-only root: denied
workspace-existing/no-source Artifact: ARTIFACT_NOT_EDITABLE
stale expectedRevision: ARTIFACT_REVISION_CONFLICT and file unchanged
file > 5 MiB: FILE_TOO_LARGE before write
```

Run:

```bash
npx vitest run tests/unit/kiro-computer-tools.test.ts
```

- [ ] **Step 2: Resolve `update_document` resource from Artifact identity**

`update_document` does not have model-provided `rootId/path`. Before the generic single-resource path branch in `executeKiroComputerTool()`:

1. load `getEditableArtifactRevisionState(artifactId, expectedRevision)`;
2. require `artifact.workspaceId === frozen turnSnapshot.workspaceId`;
3. derive `rootId = artifact.rootId` and `path = artifact.relativePath`;
4. resolve that root from the live Workspace;
5. normalize the derived logical path through the normal resolver;
6. run normal `prepareComputerTool(... capability=document.modify ...)` and Approval flow.

On Approval resume, reload Artifact state and rerun these checks. Do not trust stale pending metadata.

- [ ] **Step 3: Snapshot current exact file before mutation**

After permission/grant succeeds, stat/read current content. Require a file and size `<= COMPUTER_DOCUMENT_REVISION_LIMIT_BYTES`.

Snapshot form is runtime-only:

```ts
type DocumentFileSnapshot =
  | { format: "markdown"; text: string }
  | { format: "docx"; bytes: Uint8Array };
```

For Markdown use exact `readText`; for DOCX use exact `readBytes`.

- [ ] **Step 4: Render and verify the new document**

Reuse existing renderer/verification:

```text
markdown -> renderMarkdown -> writeText -> exact/verifyMarkdownWritten
docx     -> renderDocx -> writeBytes -> readBytes -> verifyDocxBytes
```

Do not allow the model to choose format independently; use `artifact.type`.

- [ ] **Step 5: Roll back filesystem on any post-write failure**

If the new file fails verification, or Artifact revision commit fails/conflicts after write:

1. restore the exact previous snapshot;
2. read it back;
3. verify exact text equality for Markdown or exact byte equality for DOCX;
4. only then return the original conflict/failure code;
5. if rollback itself fails, return `VERIFICATION_FAILED` with a message that the file/Artifact state may require manual inspection.

Do not report `ok:true` before both filesystem verification and Artifact revision commit succeed.

- [ ] **Step 6: Commit Artifact revision only after file verification**

Call:

```ts
const updatedArtifact = await commitArtifactRevision({
  artifactId,
  expectedRevision,
  document,
});
```

Success result must contain only safe facts:

```ts
{
  artifactId,
  path: artifact.relativePath,
  format: artifact.type,
  revision: updatedArtifact.revision,
  verified: true,
}
```

- [ ] **Step 7: Emit runtime change facts**

Use `operation: "modify"`, `resourceType: "document"`, current logical location, `artifactId`, `format`, and `revision: updatedArtifact.revision`. Review facts come from `inspectDocumentFacts(document, format)` + real headings, not a model-authored summary.

Add:

```ts
case "update_document":
  return "正在更新文档";
```

and include it in `isComputerMutationTool()` / mutation guards.

Approval description:

```text
更新文档 研究方案.docx（v1 → v2）
```

- [ ] **Step 8: Run tool tests GREEN**

```bash
npx vitest run tests/unit/kiro-computer-tools.test.ts tests/unit/kiro-artifact-revision.test.ts
```

- [ ] **Step 9: Commit Task 2**

```bash
git add lib/ai/computer/tools/schemas.ts lib/ai/computer/tools/registry.ts lib/ai/computer/executor.ts lib/ai/computer/task.ts lib/ai/computer/result.ts lib/ai/computer/types.ts tests/unit/kiro-computer-tools.test.ts
git commit -m "feat(kiro): add structured artifact updates"
```

---

### Task 3: Document Revision Checkpoint, Undo, History, and Offline E2E

**Files:**
- Modify: `lib/ai/computer/checkpoints.ts`
- Modify: `hooks/useKiroChat.ts`
- Modify: `lib/ai/history/types.ts`
- Modify: `lib/ai/history/sanitize.ts`
- Modify: `components/kiro/computer/KiroAgentTaskCard.tsx`
- Modify: `tests/unit/kiro-computer-checkpoints.test.ts`
- Modify: `tests/unit/kiro-computer-history-audit.test.ts`
- Modify: `tests/e2e/kiro-computer-artifacts-v2.spec.ts`

**Runtime-only inverse:**

```ts
export type DocumentFileSnapshot =
  | { format: "markdown"; text: string }
  | { format: "docx"; bytes: Uint8Array };

{
  type: "restore-document-revision";
  workspaceId: string;
  rootId: string;
  relativePath: string;
  artifactId: string;
  previousRevision: number;
  expectedCurrentRevision: number;
  previousDocument: KiroDocument;
  snapshot: DocumentFileSnapshot;
}
```

This inverse is held only in the existing runtime checkpoint ref.

- [ ] **Step 1: Write failing checkpoint/history tests**

`kiro-computer-checkpoints.test.ts` must cover:

```text
Markdown v2 -> Undo restores exact v1 text + Source IR + revision 1
DOCX v2 -> Undo restores exact previous bytes + Source IR + revision
multiple updates on same Artifact undo in reverse revision order
revision changed externally before Undo -> undo_failed, no false success
second Undo remains rejected by existing single-use semantics
```

`kiro-computer-history-audit.test.ts` must assert history may persist:

```text
artifactId
revision
format
logical path/display labels
operation=modify
verification
```

and must not persist:

```text
previousDocument
snapshot.text
snapshot.bytes
Source IR
before bytes
checkpoint
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run \
  tests/unit/kiro-computer-checkpoints.test.ts \
  tests/unit/kiro-computer-history-audit.test.ts
```

- [ ] **Step 3: Append document inverse after verified update**

`executeKiroComputerTool()` returns the `restore-document-revision` inverse with the exact pre-update snapshot and previous Source IR/revision. It must never be copied into tool output or persisted task/history data.

- [ ] **Step 4: Add special Undo orchestration in `useKiroChat`**

Like `move-back`, do not force this through `applyInverseToAdapter()` because Artifact metadata/source must be restored too.

For each `restore-document-revision`, in reverse order:

1. resolve current live Workspace/root and adapter;
2. load current Artifact and require current revision equals `expectedCurrentRevision` and current location matches the inverse logical location;
3. restore exact file snapshot;
4. verify exact text or bytes;
5. call `restoreArtifactRevision({ artifactId, expectedCurrentRevision, revision: previousRevision, document: previousDocument })`;
6. re-read Artifact + Source record and verify both equal the previous revision;
7. only then mark that inverse successful.

Any failure preserves existing `undo_failed` semantics and must not claim full rollback.

- [ ] **Step 5: Persist only safe revision display facts**

Extend current persisted Computer change shape with:

```ts
revision?: number;
```

Task Card line for a document revision:

```text
修改 研究方案.docx · v2
```

Historical cards remain read-only and cannot Undo after reload.

- [ ] **Step 6: Extend the existing deterministic V2 Artifact E2E**

Add a second test to `tests/e2e/kiro-computer-artifacts-v2.spec.ts` rather than creating another file.

Flow:

1. Sandbox + Workspace Auto.
2. Turn 1 mocked `create_document` creates `plan.md` from IR v1.
3. Read `classflow-kiro-artifacts-v1/artifacts` in `page.evaluate` and capture the generated `artifactId` + revision `1` into the Playwright test closure.
4. Configure the next mocked `/api/ai/chat` response to call:

```ts
update_document({
  artifactId,
  expectedRevision: 1,
  document: IR_V2,
})
```

5. Assert no Approval in Workspace Auto (`document.modify=allow`).
6. Assert Task Card contains `修改 plan.md · v2`.
7. Read Sandbox `plan.md` and assert v2 content exists.
8. Read Artifact DB and Source store; assert metadata revision `2`, source revision `2`, Source IR is v2.
9. Click Undo; assert exact v1 Markdown restored, Artifact/source revision back to `1`, Source IR v1.
10. Reload/load history; card still shows safe revision fact but no Undo.

Keep `/api/ai/chat` fully deterministic/offline.

- [ ] **Step 7: Run focused GREEN**

```bash
npx vitest run \
  tests/unit/kiro-artifact-revision.test.ts \
  tests/unit/kiro-computer-tools.test.ts \
  tests/unit/kiro-computer-checkpoints.test.ts \
  tests/unit/kiro-computer-history-audit.test.ts

npx playwright test tests/e2e/settings-select.spec.ts -g "菜单内部滚动"

npx playwright test tests/e2e/kiro-computer-artifacts-v2.spec.ts

npm run typecheck
```

- [ ] **Step 8: Commit Task 3**

```bash
git add lib/ai/computer/checkpoints.ts hooks/useKiroChat.ts lib/ai/history/types.ts lib/ai/history/sanitize.ts components/kiro/computer/KiroAgentTaskCard.tsx tests/unit/kiro-computer-checkpoints.test.ts tests/unit/kiro-computer-history-audit.test.ts tests/e2e/kiro-computer-artifacts-v2.spec.ts
git commit -m "feat(kiro): complete artifact revision lifecycle"
```

---

## Final Static Audit

Run:

```bash
rg -n \
"update_document|ARTIFACT_REVISION_CONFLICT|restore-document-revision|previousDocument|snapshot|FileSystemDirectoryHandle|adapterRef|nativePath|absolutePath|delete_file|run_shell" \
lib/ai/computer lib/ai/history hooks components/kiro
```

Confirm:

- `update_document` uses stable `artifactId`, not model-provided path.
- Source IR is only in Artifact Source Store + runtime/tests.
- previous file snapshots only exist in runtime checkpoint paths/tests.
- no source IR/snapshot/native data enters history/tool output.
- no delete/shell/App/MCP tool was added.
- `UISelect` still closes on external scrolling/resizing and remains open only for internal listbox scrolling.

## Final Verification Policy

Required:

```bash
npx vitest run \
  tests/unit/kiro-artifact-revision.test.ts \
  tests/unit/kiro-computer-tools.test.ts \
  tests/unit/kiro-computer-checkpoints.test.ts \
  tests/unit/kiro-computer-history-audit.test.ts

npx playwright test tests/e2e/settings-select.spec.ts -g "菜单内部滚动"

npx playwright test tests/e2e/kiro-computer-artifacts-v2.spec.ts

npm run typecheck
```

Default skip:

```text
npm test
full Vitest
full Playwright
visual screenshot regression
npm run build
```

Run `npm run build` only if a client/server boundary, bundling, or compile-only issue appears that typecheck cannot cover.

## Commit Strategy

Target 4 logical commits maximum:

```text
fix(ui): keep select open during internal scroll
feat(kiro): add atomic artifact revisions
feat(kiro): add structured artifact updates
feat(kiro): complete artifact revision lifecycle
```

Adjacent Kiro commits may be merged if the diff is cleaner; keep the Select bug fix isolated.

## Acceptance Checklist

### Select bug
- [ ] Model/Settings long Select remains open while its own menu scrolls.
- [ ] A scrolled-to option remains clickable/selectable.
- [ ] External Settings/page scroll still closes the fixed-position Select.
- [ ] Resize/outside click/Escape behavior unchanged.
- [ ] No wheel suppression or menu-system rewrite.

### Artifact revision
- [ ] `update_document` exists.
- [ ] Only Kiro-created Markdown/DOCX with Source IR are editable.
- [ ] Generic `.md` from `create_text_file` is not structured-editable.
- [ ] `artifactId` remains stable.
- [ ] Revision increments only after verified write + registry/source commit.
- [ ] Artifact root/path remain unchanged by content revision.
- [ ] stale expected revision returns `ARTIFACT_REVISION_CONFLICT`.
- [ ] stale conflict does not leave new file content behind.
- [ ] file >5 MiB is rejected before mutation.
- [ ] Plan denies, Guided asks, Workspace Auto allows.
- [ ] read-only root denies.
- [ ] Approval resume rechecks current Artifact revision/location/security.

### Undo/history
- [ ] exact Markdown revision Undo.
- [ ] exact DOCX bytes Undo.
- [ ] Source IR/revision restored with file.
- [ ] multi-update inverse order works.
- [ ] stale Undo becomes `undo_failed`, never false success.
- [ ] revision is safe display/history metadata.
- [ ] previous Source IR/file snapshots never persist.
- [ ] update turn remains non-regenerable.

### Non-goals
- [ ] no arbitrary existing DOCX structured editing.
- [ ] no delete tool.
- [ ] no shell/MCP/Tauri.
- [ ] no Artifact Preview/Download/Recent UI yet.

### Verification
- [ ] 4 focused Vitest files pass.
- [ ] focused Settings Select scroll E2E passes.
- [ ] offline V2 Artifact E2E passes.
- [ ] typecheck passes.
- [ ] build skipped by policy or justified pass.

## Final Report

Report only:

```text
Kiro Computer Agent V2 — Part 2 Result

Commits:
- SHA + message

UISelect bug:
- root cause
- internal vs external scroll behavior

Artifact revision:
- update_document
- atomic registry/source revision
- revision conflict
- permission modes

Verification/Rollback:
- Markdown
- DOCX
- failure rollback

Undo:
- restore-document-revision
- exact file + Source IR restoration

History/Safety:
- persisted revision facts
- sensitive runtime state excluded

Verification:
- targeted Vitest
- Select E2E
- V2 Artifact E2E
- typecheck
- build

Deferred to V2 Part 3:
- Preview
- Download
- Recent Artifacts
- Ask Kiro about Artifact
```

## STOP

After V2 Part 2 is complete, STOP. Do not begin V2 Part 3, Tauri, Windows Desktop, Shell, MCP, or any new document format.
