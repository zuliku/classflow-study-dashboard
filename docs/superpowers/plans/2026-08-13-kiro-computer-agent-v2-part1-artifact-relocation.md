# Kiro Computer Agent V2 — Part 1 Artifact Foundation & Relocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn verified V1 file mutations into durable Artifact identities and add safe, approval-gated rename/move operations with verified undo, while preserving the existing Computer Runtime trust boundary.

**Architecture:** Add an Artifact Service behind the existing Computer Executor. The filesystem remains authoritative; the Artifact Registry stores only logical metadata, while the Source Store keeps Kiro-owned `KiroDocument` IR for later V2 structured revision. Rename/move continue through the existing schema → workspace/sandbox → policy/approval → adapter → verify → task/checkpoint/history pipeline.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Zustand, IndexedDB, Zod, existing Browser/Sandbox Computer adapters, existing Approval/Task/Checkpoint/History runtime, Vitest, Playwright.

## Global Constraints

- Preserve `Sandbox != Permission`; Artifact metadata never grants access.
- The filesystem adapter remains the source of truth for file existence and bytes.
- Never send `adapterRef`, native paths, `FileSystemDirectoryHandle`, file bytes, source IR, permission tokens, or checkpoint data to the model/history.
- V2 Part 1 adds `rename_file` and `move_file`; it does not add `delete_file`, `delete_directory`, shell, app access, MCP, or network capability.
- `fs.move` remains `deny` in Plan and `ask` in both Guided and Workspace Auto.
- Rename/move must never overwrite an existing target.
- Cross-Workspace move is forbidden.
- Both source and destination roots must be `read-write` because move removes the source and creates the destination.
- Artifact location updates occur only after filesystem verification succeeds.
- Path changes do not increment Artifact document revision.
- Kiro-owned `create_document` source IR is stored only in the Artifact Source Store, never in chat history.
- Workspace removal must remove Artifact metadata/source records for that Workspace before adapter cleanup, without deleting real Browser Workspace files.
- The Settings authorization spacing fix is local to `KiroAgentSettings`; do not change global `SettingsGroup` spacing.
- Keep tests focused: targeted Artifact/relocation unit tests, existing Computer lifecycle tests as needed, one offline Computer E2E, and `npm run typecheck`; skip full suites/build by default.

---

## File Map

### Create
- `lib/ai/computer/artifacts/types.ts` — Artifact metadata/source contracts.
- `lib/ai/computer/artifacts/db.ts` — IndexedDB persistence for `artifacts` and `sources` stores.
- `lib/ai/computer/artifacts/service.ts` — registration, lookup, location update, source IR, workspace cleanup.
- `lib/ai/computer/filesystem/relocate.ts` — verified adapter-level same/cross-adapter file relocation helpers.
- `tests/unit/kiro-artifact-registry.test.ts` — Artifact storage/registration/source IR/workspace cleanup.
- `tests/unit/kiro-computer-relocation.test.ts` — rename/move/policy/verification/rollback/undo.

### Modify
- `lib/ai/computer/tools/schemas.ts` — add `renameFileSchema`, `moveFileSchema`.
- `lib/ai/computer/tools/registry.ts` — register `rename_file`, `move_file` as `fs.move` mutations.
- `lib/ai/computer/executor-types.ts` — add adapter relocation primitive.
- `lib/ai/computer/adapters/sandbox.ts` — implement same-adapter move.
- `lib/ai/computer/adapters/browser.ts` — implement same-adapter move using read/write/remove with verification-safe runtime contract.
- `lib/ai/computer/executor.ts` — Artifact registration for verified creates; rename/move execution; approval description; Artifact runtime facts.
- `lib/ai/computer/result.ts` — extend action facts to move/rename and optional `artifactId`.
- `lib/ai/computer/types.ts` — extend `ComputerActionFact` operations and Artifact reference fields.
- `lib/ai/computer/task.ts` — extend change operations and step labels.
- `lib/ai/computer/checkpoints.ts` — add `move-back` inverse contract.
- `hooks/useKiroChat.ts` — resolve multi-root `move-back` during Undo; keep pending approval semantics unchanged.
- `lib/ai/history/types.ts` — persist safe Artifact/change display facts.
- `lib/ai/history/sanitize.ts` — retain safe Artifact ids/locations and strip source/runtime-only data.
- `components/kiro/computer/KiroAgentTaskCard.tsx` — render move/rename facts without new Artifact management UI.
- `components/settings/KiroAgentSettings.tsx` — local vertical spacing fix; remove Workspace artifacts/source metadata before adapter cleanup.
- `tests/unit/kiro-computer-tools.test.ts` — tool exposure/policy/mutation guard updates.
- `tests/unit/kiro-computer-history-audit.test.ts` — Artifact/history sanitization assertions.
- `tests/e2e/kiro-computer-agent-v1.spec.ts` — offline move/rename approval + undo smoke path if reusable; otherwise create the V2-specific file named below.
- `tests/e2e/kiro-computer-artifacts-v2.spec.ts` — create only if modifying the V1 lifecycle spec would make it ambiguous; deterministic offline tool-call stream only.

---

### Task 1: Artifact Registry, Source Store, and Verified Create Registration

**Files:**
- Create: `lib/ai/computer/artifacts/types.ts`
- Create: `lib/ai/computer/artifacts/db.ts`
- Create: `lib/ai/computer/artifacts/service.ts`
- Modify: `lib/ai/computer/executor.ts`
- Modify: `lib/ai/computer/result.ts`
- Modify: `lib/ai/computer/types.ts`
- Modify: `components/settings/KiroAgentSettings.tsx`
- Test: `tests/unit/kiro-artifact-registry.test.ts`

**Interfaces:**

```ts
export type KiroArtifactType = "text" | "markdown" | "docx";
export type KiroArtifactSource = "kiro-created" | "workspace-existing";

export interface KiroArtifact {
  id: string;
  workspaceId: string;
  rootId: string;
  relativePath: string;
  type: KiroArtifactType;
  title: string;
  displayName: string;
  source: KiroArtifactSource;
  sourceConversationId?: string;
  sourceTaskId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface KiroArtifactSourceRecord {
  artifactId: string;
  revision: number;
  document: KiroDocument;
  updatedAt: string;
}
```

Service API:

```ts
export async function registerCreatedArtifact(input: {
  workspaceId: string;
  rootId: string;
  relativePath: string;
  type: KiroArtifactType;
  title?: string;
  sourceConversationId?: string;
  sourceTaskId?: string;
  document?: KiroDocument;
}): Promise<KiroArtifact>;

export async function adoptWorkspaceArtifact(input: {
  workspaceId: string;
  rootId: string;
  relativePath: string;
  type: KiroArtifactType;
  title?: string;
}): Promise<KiroArtifact>;

export async function getArtifact(id: string): Promise<KiroArtifact | null>;
export async function findArtifactByLocation(workspaceId: string, rootId: string, relativePath: string): Promise<KiroArtifact | null>;
export async function listArtifactsForWorkspace(workspaceId: string): Promise<KiroArtifact[]>;
export async function updateArtifactLocation(id: string, rootId: string, relativePath: string): Promise<KiroArtifact>;
export async function getArtifactSource(id: string): Promise<KiroArtifactSourceRecord | null>;
export async function removeArtifactsForWorkspace(workspaceId: string): Promise<void>;
```

Registry rules:

```text
DB: classflow-kiro-artifacts-v1
stores: artifacts, sources
artifacts key: artifact.id
sources key: artifactId
```

- [ ] **Step 1: Write failing Artifact Registry tests**

Create `tests/unit/kiro-artifact-registry.test.ts` with exact coverage:

```ts
it("registers a Kiro-created Markdown artifact with revision 1", async () => {
  const artifact = await registerCreatedArtifact({
    workspaceId: "research",
    rootId: "output",
    relativePath: "plan.md",
    type: "markdown",
    title: "研究方案",
    sourceTaskId: "task-1",
    document: { title: "研究方案", blocks: [] },
  });
  expect(artifact.revision).toBe(1);
  expect(artifact.relativePath).toBe("plan.md");
  expect((await getArtifactSource(artifact.id))?.document.title).toBe("研究方案");
});

it("does not store source IR for generic text files", async () => {
  const artifact = await registerCreatedArtifact({
    workspaceId: "research",
    rootId: "output",
    relativePath: "notes.txt",
    type: "text",
  });
  expect(await getArtifactSource(artifact.id)).toBeNull();
});

it("keeps artifact id stable when location changes", async () => {
  const artifact = await registerCreatedArtifact({
    workspaceId: "research",
    rootId: "output",
    relativePath: "draft.md",
    type: "markdown",
  });
  const moved = await updateArtifactLocation(artifact.id, "archive", "draft.md");
  expect(moved.id).toBe(artifact.id);
  expect(moved.rootId).toBe("archive");
  expect(moved.revision).toBe(1);
});

it("removes Artifact metadata and source IR by Workspace", async () => {
  const artifact = await registerCreatedArtifact({
    workspaceId: "research",
    rootId: "output",
    relativePath: "plan.docx",
    type: "docx",
    document: { title: "Plan", blocks: [] },
  });
  await removeArtifactsForWorkspace("research");
  expect(await getArtifact(artifact.id)).toBeNull();
  expect(await getArtifactSource(artifact.id)).toBeNull();
});
```

Use the project’s existing IndexedDB test setup/fake implementation; do not introduce a new dependency solely for these tests.

- [ ] **Step 2: Run the Artifact Registry test and confirm RED**

```bash
npx vitest run tests/unit/kiro-artifact-registry.test.ts
```

Expected: fail because Artifact modules/functions do not exist.

- [ ] **Step 3: Implement `artifacts/types.ts` and IndexedDB stores**

Implement `classflow-kiro-artifacts-v1` with version `1`, object stores `artifacts` and `sources`, both keyed explicitly by string id. Keep all DB helpers internal to `db.ts`; no React/Zustand imports.

`artifacts` records contain only `KiroArtifact` fields. `sources` records contain only `KiroArtifactSourceRecord` fields.

- [ ] **Step 4: Implement Artifact Service invariants**

`registerCreatedArtifact()` must:

```text
normalize metadata from verified runtime facts
use crypto.randomUUID() for a new stable id
set source = kiro-created
set revision = 1
store source IR only when document is provided and type is markdown/docx
never store adapterRef/native path/bytes
```

`adoptWorkspaceArtifact()` must set `source = workspace-existing`, revision `1`, and never create a source IR record.

`updateArtifactLocation()` updates only `rootId`, `relativePath`, `displayName`, and `updatedAt`; it must not change `revision`.

- [ ] **Step 5: Register verified V1 creates in the Executor**

After successful verification, but before returning `ok:true`:

```text
create_text_file:
  .md -> markdown Artifact
  other text -> text Artifact
  no source IR

create_document .md:
  markdown Artifact + KiroDocument source IR

create_document .docx:
  docx Artifact + KiroDocument source IR
```

Pass the resulting `artifactId` into runtime change/action facts. If Artifact metadata persistence fails after file verification, return `VERIFICATION_FAILED` and do not claim a durable Artifact success. Do not delete the already-created file automatically in this failure path; return an explicit failure message that the file exists but Artifact registration failed, so the user is not told nothing happened.

- [ ] **Step 6: Extend safe action/change fact types with `artifactId?`**

`ComputerActionFact` remains model/history-safe and may add:

```ts
artifactId?: string;
operation: "create" | "modify" | "move" | "rename";
```

Do not put source IR or preview content into the action fact.

- [ ] **Step 7: Integrate Workspace deletion cleanup**

In `KiroAgentSettings.deleteWorkspace(ws)` call:

```ts
await removeArtifactsForWorkspace(ws.id)
```

before adapter namespace/grant cleanup. If Artifact cleanup fails, continue logical Workspace removal and adapter cleanup, but surface the same existing cleanup-failure toast path. Never delete real Browser Workspace files because of Artifact cleanup.

- [ ] **Step 8: Fix the authorization spacing regression locally**

Change only the custom Authorization content wrapper in `KiroAgentSettings` from the current edge-touching spacing to:

```tsx
<div className="px-1 py-2.5 space-y-2">
```

Keep Workspace row design unchanged. Do not edit `SettingsGroup.tsx`.

- [ ] **Step 9: Run Artifact Registry tests GREEN**

```bash
npx vitest run tests/unit/kiro-artifact-registry.test.ts
```

- [ ] **Step 10: Commit Task 1**

```bash
git add lib/ai/computer/artifacts lib/ai/computer/executor.ts lib/ai/computer/result.ts lib/ai/computer/types.ts components/settings/KiroAgentSettings.tsx tests/unit/kiro-artifact-registry.test.ts
git commit -m "feat(kiro): add durable computer artifacts"
```

---

### Task 2: Verified Rename/Move Tools, Approval, and Undo

**Files:**
- Create: `lib/ai/computer/filesystem/relocate.ts`
- Modify: `lib/ai/computer/tools/schemas.ts`
- Modify: `lib/ai/computer/tools/registry.ts`
- Modify: `lib/ai/computer/executor-types.ts`
- Modify: `lib/ai/computer/adapters/sandbox.ts`
- Modify: `lib/ai/computer/adapters/browser.ts`
- Modify: `lib/ai/computer/executor.ts`
- Modify: `lib/ai/computer/checkpoints.ts`
- Modify: `lib/ai/computer/task.ts`
- Modify: `lib/ai/computer/result.ts`
- Modify: `hooks/useKiroChat.ts`
- Test: `tests/unit/kiro-computer-relocation.test.ts`
- Test: `tests/unit/kiro-computer-tools.test.ts`

**Interfaces:**

Schemas:

```ts
export const renameFileSchema = z.object({
  rootId: z.string().trim().min(1).max(120),
  path: z.string().trim().min(1).max(512),
  newName: z.string().trim().min(1).max(255),
});

export const moveFileSchema = z.object({
  rootId: z.string().trim().min(1).max(120),
  path: z.string().trim().min(1).max(512),
  destinationRootId: z.string().trim().min(1).max(120),
  destinationPath: z.string().trim().min(1).max(512),
});
```

Extend adapter IO:

```ts
move(from: string, to: string): Promise<void>;
```

Checkpoint:

```ts
export type ComputerInverseOperation =
  | ExistingInverseOperations
  | {
      type: "move-back";
      workspaceId: string;
      fromRootId: string;
      fromPath: string;
      toRootId: string;
      toPath: string;
    };
```

- [ ] **Step 1: Write failing relocation tests**

Create `tests/unit/kiro-computer-relocation.test.ts` covering:

```ts
it("rename_file moves a file in the same root and verifies source absent/target present");
it("rename_file rejects an existing destination");
it("rename_file rejects unsafe newName containing slash or Windows reserved names");
it("move_file supports two read-write roots in the same Workspace");
it("move_file rejects cross-Workspace attempts because destination is resolved only from the frozen active Workspace");
it("move_file rejects a read-only source root");
it("move_file rejects a read-only destination root");
it("Guided rename_file returns approval-required before IO");
it("Workspace Auto move_file still returns approval-required before IO");
it("move-back Undo restores the original logical location and Artifact Registry location");
```

Use Sandbox adapters for deterministic file IO. Do not call real browser grants in unit tests.

- [ ] **Step 2: Run relocation/tool tests and confirm RED**

```bash
npx vitest run tests/unit/kiro-computer-relocation.test.ts tests/unit/kiro-computer-tools.test.ts
```

- [ ] **Step 3: Add schemas and registry definitions**

Register:

```ts
{
  name: "rename_file",
  description: "重命名工作区中的文件；不覆盖已有目标。",
  schema: renameFileSchema,
  capability: "fs.move",
  mutation: true,
}

{
  name: "move_file",
  description: "在当前 Workspace 的授权根之间移动文件；不覆盖已有目标。",
  schema: moveFileSchema,
  capability: "fs.move",
  mutation: true,
}
```

`getComputerToolsForMode("plan")` must exclude them. Guided/Workspace Auto may expose them, but policy evaluation remains authoritative and returns `ask`.

- [ ] **Step 4: Implement strict destination name/path validation**

`rename_file.newName` is a basename only. Reject `/`, `\\`, `.`, `..`, empty-after-trim, control/NUL characters, and existing Windows reserved device names through the existing resolver safety rules. Build the destination as `dirname(source) + newName`, then pass the full relative destination through `normalizeRelativeComputerPath()`.

`move_file.destinationPath` is a full relative file path and must pass normal path safety validation.

- [ ] **Step 5: Implement same-adapter move**

Add `move()` to both adapter implementations.

Sandbox implementation may perform read bytes/text → write target → verify target → remove source, with target cleanup rollback if source removal fails.

Browser implementation must use the same product semantics through existing File System Access primitives; do not expose handles upward. It may implement copy+remove because Web File System Access has no project-wide native rename abstraction.

Both implementations must reject directory relocation in V2 Part 1; these are file tools only.

- [ ] **Step 6: Implement cross-root relocation helper**

`lib/ai/computer/filesystem/relocate.ts` must expose:

```ts
export async function relocateFile(input: {
  source: ComputerAdapterIO;
  sourcePath: string;
  destination: ComputerAdapterIO;
  destinationPath: string;
}): Promise<{ size: number; type?: string }>;
```

Algorithm:

```text
stat source -> must be file
stat destination -> must be null
read source bytes
write destination bytes
verify destination exists and byte length matches
remove source file
verify source absent
if source remove/verify fails:
  attempt remove destination
  verify rollback target absent
  throw VERIFICATION_FAILED regardless
```

If rollback itself fails, throw `VERIFICATION_FAILED` with a message that a partial destination may remain. Never return success for partial relocation.

- [ ] **Step 7: Execute `rename_file` and `move_file` through existing approval flow**

For rename:

```text
source root = rootId
source path = normalized path
destination root = same root
destination path = dirname + newName
```

For move:

```text
source root = rootId
destination root = destinationRootId
both resolved from current frozen Workspace
```

Before approval/IO, require both roots `read-write`. Use `fs.move` policy. For approval resource labeling, describe both source and destination in `description`, but keep request resource authority tied to the normalized source path plus capability/workspace/root.

After approval, call same-adapter `move()` when adapter refs match; otherwise call `relocateFile()` with two adapter IO instances.

- [ ] **Step 8: Update Artifact location only after verified relocation**

Before relocation call:

```ts
const artifact = await findArtifactByLocation(ws.id, sourceRoot.id, sourcePath)
```

After relocation verifies:

```ts
if (artifact) await updateArtifactLocation(artifact.id, destinationRoot.id, destinationPath)
```

If filesystem relocation succeeds but Artifact metadata update fails, return `VERIFICATION_FAILED` with an accurate message that the file moved but registry synchronization failed. Do not move the file back automatically unless the failure occurred inside the verified relocation itself.

- [ ] **Step 9: Extend task/change facts**

`KiroComputerChange.operation` becomes:

```ts
"create" | "modify" | "move" | "rename"
```

Add optional safe fields:

```ts
artifactId?: string;
fromRootId?: string;
fromRootLabel?: string;
fromRelativePath?: string;
```

For rename/move, `rootId/rootLabel/relativePath/displayName` describe the verified destination and `from*` describes the original location.

Update `toolStepLabel()`:

```text
rename_file -> 正在重命名文件
move_file   -> 正在移动文件
```

- [ ] **Step 10: Add `move-back` checkpoint and Undo orchestration**

Do not force `applyInverseToAdapter()` to handle two roots through one adapter. Keep that helper for single-adapter inverses and add a dedicated relocation inverse path in `useKiroChat` Undo orchestration:

```text
resolve current live Workspace from inverse.workspaceId
resolve fromRootId and toRootId
build source adapter at to* (current moved location)
build destination adapter at from* (original location)
relocate verified target back
verify original exists + moved path absent
update Artifact location back if change has artifactId
```

Checkpoint is runtime-only and single-use as in V1.

- [ ] **Step 11: Extend mutation/regenerate guards**

Ensure `rename_file` and `move_file` are included in `COMPUTER_MUTATION_TOOL_NAMES` automatically through registry membership and in any explicit `isComputerMutationTool()` switch in `task.ts`.

- [ ] **Step 12: Run relocation/tool tests GREEN**

```bash
npx vitest run tests/unit/kiro-computer-relocation.test.ts tests/unit/kiro-computer-tools.test.ts
```

- [ ] **Step 13: Commit Task 2**

```bash
git add lib/ai/computer/tools/schemas.ts lib/ai/computer/tools/registry.ts lib/ai/computer/executor-types.ts lib/ai/computer/adapters/sandbox.ts lib/ai/computer/adapters/browser.ts lib/ai/computer/filesystem/relocate.ts lib/ai/computer/executor.ts lib/ai/computer/checkpoints.ts lib/ai/computer/task.ts lib/ai/computer/result.ts hooks/useKiroChat.ts tests/unit/kiro-computer-relocation.test.ts tests/unit/kiro-computer-tools.test.ts
git commit -m "feat(kiro): add verified artifact relocation"
```

---

### Task 3: History Facts, Task Rendering, Offline Integration, and Final Audit

**Files:**
- Modify: `lib/ai/history/types.ts`
- Modify: `lib/ai/history/sanitize.ts`
- Modify: `components/kiro/computer/KiroAgentTaskCard.tsx`
- Modify: `tests/unit/kiro-computer-history-audit.test.ts`
- Modify: `tests/e2e/kiro-computer-agent-v1.spec.ts` if its offline harness already supports extending scripted tool calls; otherwise create `tests/e2e/kiro-computer-artifacts-v2.spec.ts` and leave the V1 spec unchanged.

**Produces:** safe display persistence for Artifact relocation facts and one deterministic offline end-to-end relocation/undo proof.

- [ ] **Step 1: Extend history tests first**

Add assertions that persisted Computer changes may include:

```text
artifactId
action operation move/rename
verified destination logical path
from logical display path
revision metadata when present
```

and must not include:

```text
source IR
preview body
file bytes
adapterRef
native path
handle
checkpoint
```

- [ ] **Step 2: Run history test RED**

```bash
npx vitest run tests/unit/kiro-computer-history-audit.test.ts
```

- [ ] **Step 3: Extend existing history display contracts**

Keep existing `PersistedComputerTaskView` ownership and serialization pipeline. Add only safe fields required to render relocation facts. Do not create a second Artifact history database.

- [ ] **Step 4: Update Task Card rendering**

Render factual lines:

```text
创建 plan.md
修改 notes.md
重命名 draft.md → final.md
移动 notes.md → archive/notes.md
```

Do not add Preview/Download/Recent Artifact UI in Part 1; those belong to V2 Part 3.

- [ ] **Step 5: Add one deterministic offline E2E flow**

Use the existing `/api/ai/chat` route mock pattern from `kiro-computer-agent-v1.spec.ts`.

Flow:

```text
1. Sandbox Workspace Auto creates draft.md through create_text_file.
2. Switch/keep Guided or Workspace Auto; scripted model requests rename_file draft.md -> final.md.
3. Approval dialog appears because fs.move = ask even in Workspace Auto.
4. Allow once.
5. Task card reports rename and verified destination.
6. Undo task.
7. Verify via scripted/read tool or Sandbox-visible runtime assertion that draft.md exists and final.md does not.
8. Reload/load conversation and verify historical task renders relocation facts but no Undo button.
```

No external provider calls.

- [ ] **Step 6: Run final focused verification**

```bash
npx vitest run \
  tests/unit/kiro-artifact-registry.test.ts \
  tests/unit/kiro-computer-relocation.test.ts \
  tests/unit/kiro-computer-tools.test.ts \
  tests/unit/kiro-computer-history-audit.test.ts
```

Then run exactly one Computer E2E file:

```bash
npx playwright test tests/e2e/kiro-computer-artifacts-v2.spec.ts
```

If the flow was added to the existing V1 file instead, run only:

```bash
npx playwright test tests/e2e/kiro-computer-agent-v1.spec.ts
```

Do not run both unless the implementation actually modified both.

Then:

```bash
npm run typecheck
```

Build is skipped unless a Next/client boundary or bundling-only error appears.

- [ ] **Step 7: Static security audit**

Run:

```bash
rg -n "FileSystemDirectoryHandle|adapterRef|nativePath|absolutePath|source IR|beforeText|fileBytes|delete_file|delete_directory|run_shell|PowerShell" \
  lib/ai/computer lib/ai/history hooks components/kiro components/settings
```

Confirm:

```text
Artifact metadata contains logical workspace/root/path only.
Source IR appears only in Artifact Source Store/runtime and tests.
No model-facing delete tool exists.
Move/rename use fs.move approval.
Settings spacing fix did not modify SettingsGroup.tsx.
```

- [ ] **Step 8: Commit Task 3**

```bash
git add lib/ai/history/types.ts lib/ai/history/sanitize.ts components/kiro/computer/KiroAgentTaskCard.tsx tests/unit/kiro-computer-history-audit.test.ts tests/e2e
git commit -m "feat(kiro): persist artifact relocation facts"
```

---

## Final Self-Review Checklist

### Artifact Foundation
- [ ] Artifact Registry uses stable ids and logical locations only.
- [ ] Artifact Source Store contains Kiro-owned `KiroDocument` IR only.
- [ ] `create_text_file` and `create_document` register verified artifacts.
- [ ] Generic existing files are not auto-indexed.
- [ ] Artifact path updates do not increment revision.
- [ ] Workspace removal removes Artifact metadata/source records.

### Relocation
- [ ] `rename_file` exists and never overwrites.
- [ ] `move_file` exists and never overwrites.
- [ ] Plan denies both.
- [ ] Guided asks for both.
- [ ] Workspace Auto still asks for both.
- [ ] Read-only source or destination root denies relocation.
- [ ] Cross-Workspace move is impossible.
- [ ] Same-adapter move verifies target/source state.
- [ ] Cross-adapter move performs rollback attempt on partial failure.
- [ ] Filesystem success precedes Artifact Registry location update.

### Undo / Task / History
- [ ] `move-back` inverse is runtime-only.
- [ ] Undo verifies original restored and moved target absent.
- [ ] Artifact Registry location is restored after successful Undo.
- [ ] `KiroComputerChange` supports move/rename.
- [ ] History persists safe display facts only.
- [ ] Relocation turns are mutation-regenerate guarded.

### UI / Regression
- [ ] Authorization custom content has stable top/bottom padding.
- [ ] `SettingsGroup.tsx` is unchanged.
- [ ] No Artifact Preview/Download/Recent UI is started in Part 1.

### Verification
- [ ] Focused Artifact tests PASS.
- [ ] Focused relocation/tool/history tests PASS.
- [ ] Exactly one deterministic offline Computer E2E PASS.
- [ ] `npm run typecheck` PASS.
- [ ] `npm run build` skipped by policy unless explicitly justified.
