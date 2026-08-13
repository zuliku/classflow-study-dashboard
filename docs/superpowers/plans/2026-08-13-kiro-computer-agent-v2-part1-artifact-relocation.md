# Kiro Computer Agent V2 — Part 1 Artifact Foundation & Relocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn verified V1 file mutations into durable Artifact identities and add safe, approval-gated rename/move operations with verified undo, while preserving the existing Computer Runtime trust boundary.

**Architecture:** Add an Artifact Service behind the existing Computer Executor. The filesystem remains authoritative; the Artifact Registry stores only logical metadata, while a separate Source Store keeps Kiro-owned `KiroDocument` IR for later V2 structured revision. Rename/move continue through the existing schema → workspace/sandbox → permission/approval → adapter → verify → task/checkpoint/history lifecycle.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, IndexedDB, Zod, existing Browser/Sandbox Computer adapters, existing Approval/Task/Checkpoint/History runtime, Vitest, Playwright.

## Global Constraints

- Preserve `Sandbox != Permission`; Artifact metadata never grants access.
- The filesystem adapter remains authoritative for file existence and bytes.
- Never send `adapterRef`, native paths, `FileSystemDirectoryHandle`, file bytes, source IR, permission tokens, or checkpoint data to the model/history.
- V2 Part 1 adds only `rename_file` and `move_file`; it does not add model-facing delete, shell, app access, MCP, or network tools.
- `fs.move` remains `deny` in Plan and `ask` in both Guided and Workspace Auto.
- Rename/move never overwrite an existing target.
- Cross-Workspace move is forbidden.
- Source and destination roots must both be `read-write` because relocation removes the source and creates a destination.
- Relocation must evaluate permission/safety for both source and destination. Any deny on either side denies the operation; any ask on either side requires approval.
- Artifact location updates occur only after filesystem verification succeeds.
- Path changes do not increment Artifact document revision.
- Kiro-owned `create_document` source IR is stored only in the Artifact Source Store, never in chat history.
- Workspace removal removes Artifact metadata/source records before adapter cleanup without deleting real Browser Workspace files.
- The Settings authorization spacing fix is local to `KiroAgentSettings`; do not change global `SettingsGroup` spacing.
- Keep tests focused: targeted Artifact/relocation/tool/history unit tests, exactly one deterministic offline V2 E2E, and `npm run typecheck`; skip full suites/build by default.

---

## File Map

### Create
- `lib/ai/computer/artifacts/types.ts` — Artifact metadata/source contracts.
- `lib/ai/computer/artifacts/db.ts` — IndexedDB `artifacts` / `sources` storage.
- `lib/ai/computer/artifacts/service.ts` — register/adopt/find/list/update-location/workspace-cleanup.
- `lib/ai/computer/filesystem/relocate.ts` — verified same/cross-adapter relocation helper.
- `tests/unit/kiro-artifact-registry.test.ts`
- `tests/unit/kiro-computer-relocation.test.ts`
- `tests/e2e/kiro-computer-artifacts-v2.spec.ts`

### Modify
- `lib/ai/computer/tools/schemas.ts`
- `lib/ai/computer/tools/registry.ts`
- `lib/ai/computer/executor-types.ts`
- `lib/ai/computer/adapters/sandbox.ts`
- `lib/ai/computer/adapters/browser.ts`
- `lib/ai/computer/executor.ts`
- `lib/ai/computer/result.ts`
- `lib/ai/computer/types.ts`
- `lib/ai/computer/task.ts`
- `lib/ai/computer/checkpoints.ts`
- `hooks/useKiroChat.ts`
- `lib/ai/history/types.ts`
- `lib/ai/history/sanitize.ts`
- `components/kiro/computer/KiroAgentTaskCard.tsx`
- `components/settings/KiroAgentSettings.tsx`
- `tests/unit/kiro-computer-tools.test.ts`
- `tests/unit/kiro-computer-history-audit.test.ts`

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

Storage:

```text
DB: classflow-kiro-artifacts-v1
stores:
  artifacts  key = artifact.id
  sources    key = artifactId
```

- [ ] **Step 1: Write failing Artifact Registry tests**

Create `tests/unit/kiro-artifact-registry.test.ts` and cover these exact behaviors:

```ts
it("registers Kiro-created Markdown with revision 1 and source IR");
it("generic text Artifact stores no source IR");
it("adopted workspace Artifact stores no source IR");
it("location update keeps stable artifact id and revision");
it("a second registration at the same logical location replaces stale registry identity instead of keeping two records");
it("workspace cleanup removes Artifact metadata and source IR");
```

For same-location replacement, assert that after registration there is exactly one logical record for `(workspaceId, rootId, relativePath)`, the old source record is removed, and the new Artifact has a new id/revision `1`. This handles a file that was externally removed and later recreated at the same path without conflating two identities.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/unit/kiro-artifact-registry.test.ts
```

- [ ] **Step 3: Implement Artifact DB and service invariants**

`registerCreatedArtifact()`:

```text
find existing logical-location record
if present: delete its source + metadata first
create new stable id with crypto.randomUUID()
source = kiro-created
revision = 1
store source IR only when document exists and type is markdown/docx
```

`adoptWorkspaceArtifact()` uses `workspace-existing`, revision `1`, no source IR, and the same logical-location uniqueness rule.

`updateArtifactLocation()` changes only `rootId`, `relativePath`, `displayName`, `updatedAt`; revision remains unchanged.

- [ ] **Step 4: Register verified V1 creates in `executor.ts`**

After file verification and before returning success:

```text
create_text_file:
  .md -> Artifact type markdown, no IR
  other text -> Artifact type text, no IR

create_document .md:
  Artifact type markdown + KiroDocument source IR

create_document .docx:
  Artifact type docx + KiroDocument source IR
```

Use `context.taskId` as `sourceTaskId` when available. `sourceConversationId` may remain unset in Part 1 because the Executor does not currently own conversation identity.

If file verification succeeds but Artifact persistence fails, return a model-safe failure such as:

```text
code = VERIFICATION_FAILED
message = 文件已创建并验证，但 Artifact 元数据登记失败；请重新检查工作区文件后再继续。
```

Do not claim durable Artifact success and do not silently delete the verified file.

- [ ] **Step 5: Extend safe mutation facts**

Extend `ComputerActionFact` and `KiroComputerChange` with optional:

```ts
artifactId?: string;
```

and extend operation unions to:

```ts
"create" | "modify" | "move" | "rename"
```

No source IR/bytes/native data may enter these facts.

- [ ] **Step 6: Integrate Workspace deletion cleanup and fix Settings spacing**

In `KiroAgentSettings.deleteWorkspace(ws)` call:

```ts
await removeArtifactsForWorkspace(ws.id)
```

before Sandbox/Browser adapter cleanup. On failure, continue logical removal and use the existing cleanup-failure toast path.

Fix only the custom Authorization content wrapper:

```tsx
<div className="px-1 py-2.5 space-y-2">
```

Do not edit `SettingsGroup.tsx` and do not redesign Workspace rows.

- [ ] **Step 7: Run GREEN**

```bash
npx vitest run tests/unit/kiro-artifact-registry.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add lib/ai/computer/artifacts lib/ai/computer/executor.ts lib/ai/computer/result.ts lib/ai/computer/types.ts lib/ai/computer/task.ts components/settings/KiroAgentSettings.tsx tests/unit/kiro-artifact-registry.test.ts
git commit -m "feat(kiro): add durable computer artifacts"
```

---

### Task 2: Verified Rename/Move, Dual-Resource Policy, and Undo

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
- Modify: `hooks/useKiroChat.ts`
- Test: `tests/unit/kiro-computer-relocation.test.ts`
- Test: `tests/unit/kiro-computer-tools.test.ts`

**Schemas:**

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

**Adapter contract:**

```ts
move(from: string, to: string): Promise<void>;
```

**Checkpoint:**

```ts
{
  type: "move-back";
  workspaceId: string;
  fromRootId: string;
  fromPath: string;
  toRootId: string;
  toPath: string;
  artifactId?: string;
}
```

- [ ] **Step 1: Write failing relocation tests**

Create `tests/unit/kiro-computer-relocation.test.ts` covering:

```text
rename_file verifies source absent + target present
rename_file rejects existing destination
rename_file rejects slash/backslash/dot-dot/Windows reserved basename
move_file works across two read-write roots in the same Workspace
move_file cannot resolve destination from another Workspace
read-only source denies
read-only destination denies
explicit deny on source denies
explicit deny on destination denies
Guided rename returns approval-required before IO
Workspace Auto move still returns approval-required before IO
allow-once resumes the exact frozen Tool Call
move-back restores original file and Artifact location
partial cross-adapter failure never returns success
```

Use Sandbox IO only in unit tests.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/unit/kiro-computer-relocation.test.ts tests/unit/kiro-computer-tools.test.ts
```

- [ ] **Step 3: Add tool schemas/registry entries**

Register `rename_file` and `move_file` as `fs.move`, `mutation: true`. Plan mode excludes them through existing read-only tool exposure; Guided/Workspace Auto expose them but policy remains authoritative.

- [ ] **Step 4: Validate rename destination safely**

`newName` is a basename only. Reject `/`, `\\`, `.`, `..`, NUL/control characters and Windows reserved names. Build `dirname(source) + newName`, then pass the full target through `normalizeRelativeComputerPath()`.

`move_file.destinationPath` is a full relative path and must use normal path normalization.

- [ ] **Step 5: Implement adapter-level relocation**

Extend `ComputerAdapterIO` with `move` and implement it for Browser/Sandbox without exposing handles.

V2 Part 1 relocates files only; directory relocation is rejected.

Same-adapter move semantics:

```text
source must exist and be file
destination must not exist
copy/write target
verify target exists and byte length matches
remove source
verify source absent
if source removal/verification fails: attempt target cleanup and always throw VERIFICATION_FAILED
```

- [ ] **Step 6: Implement `relocateFile()` for cross-adapter/root moves**

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
stat source -> file required
stat target -> null required
read source bytes
write target bytes
verify target exists + byte length
remove source
verify source absent
if remove/verify fails:
  attempt target remove
  verify target absent when possible
  throw VERIFICATION_FAILED
```

If rollback fails, error text must state that a partial destination may remain. Never claim atomic success.

- [ ] **Step 7: Implement dual-resource permission evaluation**

Do not reuse the current single-resource preflight blindly for `move_file`.

For relocation compute two policy decisions through existing `prepareComputerTool()`:

```text
source decision: fs.move on source workspace/root/path
destination decision: fs.move on same workspace/destination root/destination path
```

Combine:

```text
if either deny -> deny
else if either ask -> ask
else allow
```

Both roots must separately pass read-write/sandbox validation.

For `rename_file`, source and destination are in the same root but still evaluate both normalized paths so resource-scoped deny rules on the destination cannot be bypassed.

Approval request is bound to the frozen `toolCallId` + source logical resource and must include the verified destination in its human-readable description. Because the pending executable stores the exact original tool input, an allow-once approval cannot be reused with a changed destination. On resume, recompute both policies; explicit/hard deny on either side still wins.

- [ ] **Step 8: Execute verified relocation and sync Artifact path**

Before IO:

```ts
const artifact = await findArtifactByLocation(ws.id, sourceRoot.id, sourcePath)
```

After filesystem verification:

```ts
if (artifact) await updateArtifactLocation(artifact.id, destinationRoot.id, destinationPath)
```

If file relocation succeeds but registry update fails, return `VERIFICATION_FAILED` with an accurate “file moved, registry sync failed” message. Do not silently move the file back after a successful filesystem relocation.

Runtime change facts:

```ts
operation: "rename" | "move";
artifactId?: string;
fromRootId: string;
fromRootLabel: string;
fromRelativePath: string;
rootId/rootLabel/relativePath = verified destination;
```

- [ ] **Step 9: Extend task labels and mutation descriptions**

```text
rename_file -> 正在重命名文件
move_file   -> 正在移动文件
```

Approval descriptions:

```text
重命名 draft.md → final.md
移动 notes.md → archive/notes.md
```

Ensure both tools are covered by all explicit mutation guards such as `isComputerMutationTool()`.

- [ ] **Step 10: Add `move-back` checkpoint and Undo orchestration**

The inverse stores `artifactId?` directly.

Do not push a two-root operation through the existing one-adapter `applyInverseToAdapter()` API. In `useKiroChat` Undo orchestration, handle `move-back` separately:

```text
resolve live Workspace by inverse.workspaceId
resolve original root (fromRootId) and moved root (toRootId)
create source adapter for toRootId/toPath
create destination adapter for fromRootId/fromPath
verified relocate back
verify original exists + moved path absent
if artifactId exists: update Artifact Registry back to fromRootId/fromPath
```

Checkpoint remains runtime-only, reverse-order, single-use.

- [ ] **Step 11: Run GREEN**

```bash
npx vitest run tests/unit/kiro-computer-relocation.test.ts tests/unit/kiro-computer-tools.test.ts
```

- [ ] **Step 12: Commit**

```bash
git add lib/ai/computer/tools/schemas.ts lib/ai/computer/tools/registry.ts lib/ai/computer/executor-types.ts lib/ai/computer/adapters/sandbox.ts lib/ai/computer/adapters/browser.ts lib/ai/computer/filesystem/relocate.ts lib/ai/computer/executor.ts lib/ai/computer/checkpoints.ts lib/ai/computer/task.ts hooks/useKiroChat.ts tests/unit/kiro-computer-relocation.test.ts tests/unit/kiro-computer-tools.test.ts
git commit -m "feat(kiro): add verified artifact relocation"
```

---

### Task 3: History Facts, Task Rendering, Offline E2E, and Final Audit

**Files:**
- Modify: `lib/ai/history/types.ts`
- Modify: `lib/ai/history/sanitize.ts`
- Modify: `components/kiro/computer/KiroAgentTaskCard.tsx`
- Modify: `tests/unit/kiro-computer-history-audit.test.ts`
- Create: `tests/e2e/kiro-computer-artifacts-v2.spec.ts`

- [ ] **Step 1: Extend history sanitization tests first**

Persisted relocation facts may include:

```text
artifactId
operation = move/rename
from logical root/path display facts
destination logical root/path display facts
verification
revision metadata when present
```

They must not include:

```text
KiroDocument source IR
preview content
file bytes
adapterRef
native path
handle
checkpoint
beforeText
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/unit/kiro-computer-history-audit.test.ts
```

- [ ] **Step 3: Extend existing history pipeline only**

Update existing `PersistedComputerTaskView` / sanitizer with safe Artifact/relocation display fields. Do not create a second chat history database and do not persist Artifact Source Store contents into conversation history.

- [ ] **Step 4: Update Task Card factual rendering**

Render:

```text
创建 plan.md
修改 notes.md
重命名 draft.md → final.md
移动 notes.md → archive/notes.md
```

Do not add Preview/Download/Recent Artifact UI in Part 1.

- [ ] **Step 5: Add deterministic offline V2 E2E**

Create exactly `tests/e2e/kiro-computer-artifacts-v2.spec.ts` and reuse the existing `/api/ai/chat` mock-stream pattern.

Flow:

```text
1. Enable Sandbox + Workspace Auto.
2. Script create_text_file("draft.md", known content).
3. Script rename_file("draft.md" -> "final.md").
4. Assert Approval Dialog appears even in Workspace Auto because fs.move = ask.
5. Allow once.
6. Assert owning Agent Task Card reports rename to final.md.
7. Click Undo.
8. Script/read through Computer runtime and assert draft.md exists while final.md does not.
9. Reload/load conversation.
10. Assert historical task still renders rename facts but has no Undo action.
```

No external model/provider calls.

- [ ] **Step 6: Run focused final verification**

```bash
npx vitest run \
  tests/unit/kiro-artifact-registry.test.ts \
  tests/unit/kiro-computer-relocation.test.ts \
  tests/unit/kiro-computer-tools.test.ts \
  tests/unit/kiro-computer-history-audit.test.ts
```

```bash
npx playwright test tests/e2e/kiro-computer-artifacts-v2.spec.ts
```

```bash
npm run typecheck
```

Build is skipped unless a Next/client boundary or bundling-only error appears.

- [ ] **Step 7: Static security audit**

```bash
rg -n "FileSystemDirectoryHandle|adapterRef|nativePath|absolutePath|beforeText|fileBytes|delete_file|delete_directory|run_shell|PowerShell" \
  lib/ai/computer lib/ai/history hooks components/kiro components/settings
```

Confirm Artifact metadata is logical-only, source IR exists only in Artifact Source Store/runtime/tests, no model delete/shell tool exists, and `SettingsGroup.tsx` was not modified for the spacing fix.

- [ ] **Step 8: Commit**

```bash
git add lib/ai/history/types.ts lib/ai/history/sanitize.ts components/kiro/computer/KiroAgentTaskCard.tsx tests/unit/kiro-computer-history-audit.test.ts tests/e2e/kiro-computer-artifacts-v2.spec.ts
git commit -m "feat(kiro): persist artifact relocation facts"
```

---

## Final Self-Review Checklist

### Artifact Foundation
- [ ] Artifact Registry uses stable ids and logical locations only.
- [ ] Artifact Source Store contains Kiro-owned `KiroDocument` IR only.
- [ ] Verified `create_text_file` and `create_document` register Artifacts.
- [ ] Existing files are not automatically workspace-indexed.
- [ ] Same-location re-registration leaves one record and a new identity.
- [ ] Artifact path updates do not increment revision.
- [ ] Workspace removal clears Artifact metadata/source records.

### Relocation
- [ ] `rename_file` and `move_file` exist.
- [ ] Neither overwrites an existing destination.
- [ ] Plan denies both.
- [ ] Guided asks for both.
- [ ] Workspace Auto still asks for both.
- [ ] Source and destination policies are both evaluated.
- [ ] Any deny on either side wins.
- [ ] Read-only source/destination root denies.
- [ ] Cross-Workspace move is impossible.
- [ ] Same/cross-adapter relocation verifies target/source state.
- [ ] Partial failure never returns success.
- [ ] Artifact location changes only after verified filesystem success.

### Undo / History
- [ ] `move-back` carries `artifactId?` and is runtime-only.
- [ ] Undo verifies original restored and moved target absent.
- [ ] Artifact Registry location restores after successful Undo.
- [ ] Task/history support factual move/rename display.
- [ ] Relocation turns are mutation-regenerate guarded.

### UI / Verification
- [ ] Authorization content has stable top/bottom padding.
- [ ] `SettingsGroup.tsx` unchanged.
- [ ] No Artifact Preview/Download/Recent UI started in Part 1.
- [ ] Four targeted unit files PASS.
- [ ] Exactly one offline V2 E2E PASS.
- [ ] `npm run typecheck` PASS.
- [ ] `npm run build` skipped unless explicitly justified.
