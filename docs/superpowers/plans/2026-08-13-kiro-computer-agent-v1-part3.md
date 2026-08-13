# Kiro Computer Agent V1 Part 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Kiro Computer Agent V1 by adding interactive approval, runtime-backed agent tasks, reviewable change records, task-level checkpoints/Undo, bounded audit/history metadata, and safe regenerate behavior on top of the verified Part 2 filesystem/document runtime.

**Architecture:** Keep `lib/ai/computer/*` as the independent trust domain. Part 3 does not change which model-facing tools exist; it adds a runtime control layer around the existing executor. A Computer tool that evaluates to `ask` must pause without returning tool output, surface a safe approval request to the user, and only resume the exact pending call after an explicit decision. Mutation execution returns model-safe output plus runtime-only change/checkpoint facts; sensitive snapshots never enter tool output, chat history, Zustand persistence, or model context.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Zustand 4.5, AI SDK 7, Zod, IndexedDB, File System Access API, existing Dialog/Drawer/Button primitives, Vitest 4, fake-indexeddb, Playwright.

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-08-13-kiro-computer-agent-v1-design.md`.
- Continue from Part 2 HEAD (`eb514b3` or newer); do not replace the Part 1/2 runtime, reasoning controls, workspace model, tool schemas, or document renderer.
- Sandbox remains a technical boundary. Approval can change `ask → allow` only for an already-valid operation; it can never expand workspace roots or bypass `PATH_OUTSIDE_SANDBOX`, read-only roots, hard deny capabilities, missing/revoked grants, or adapter failures.
- The model cannot choose approval persistence. No Computer tool schema may add `permission`, `approval`, `remember`, `force`, `unsafe`, or `skipCheck` fields.
- V1 still exposes no model tools for delete, move/rename, shell/PowerShell/cmd, application launch, MCP, arbitrary network access, or Full Access.
- Internal Undo may remove resources that were created by the same Computer task. This is runtime restoration, not an LLM delete capability.
- Every mutation and every Undo must verify the resulting adapter state before reporting success.
- Computer task steps are factual runtime activity only; do not expose or synthesize model chain-of-thought.
- No raw absolute path, `adapterRef`, `FileSystemDirectoryHandle`, permission token, file bytes, before-snapshot, or full text diff may enter model-facing tool output or persisted conversation history.
- Runtime-only text snapshots are capped at 1 MiB per modified file. Part 2 already rejects patching larger source files; preserve that boundary.
- Audit log stores metadata only and is bounded to the most recent 500 entries.
- Part 2 live Computer actions currently exist as a turn-global array. Part 3 must bind actions/tasks to the actual assistant message/toolCallId and remove the global bottom-of-conversation rendering path.
- Browser adapter must stop owning grant IndexedDB constants/lookup. Runtime handle retrieval belongs to `workspace/grants.ts`; the adapter consumes the exported runtime-only accessor.
- Test policy remains targeted: new Part 3 Vitest files + one focused Computer E2E. Do not run full Vitest, full Playwright, screenshot regression, or build by default.

---

## File Map

### Create
- `lib/ai/computer/approval.ts` — approval request/decision types, one-shot grant matching, persistent/session rule construction.
- `lib/ai/computer/task.ts` — agent task/change/step/view types and pure task reducer/helpers.
- `lib/ai/computer/checkpoints.ts` — runtime-only inverse-operation model and task Undo executor.
- `lib/ai/computer/audit.ts` — bounded IndexedDB audit metadata store.
- `lib/ai/computer/history.ts` — persisted display-only Computer task views keyed by conversation/message identity.
- `store/useKiroComputerRuntimeStore.ts` — non-persisted current-task/pending-approval UI state; no handles/snapshots.
- `components/kiro/computer/ComputerApprovalDialog.tsx` — dedicated approval UI.
- `components/kiro/computer/KiroAgentTaskCard.tsx` — factual task progress + grouped change summary.
- `components/kiro/computer/KiroChangeReviewDialog.tsx` — transient review of runtime change facts.
- `components/settings/KiroComputerAuditPanel.tsx` — recent safe audit metadata.
- `tests/unit/kiro-computer-approval.test.ts` — approval/rule/one-shot semantics.
- `tests/unit/kiro-computer-checkpoints.test.ts` — inverse operations/task Undo.
- `tests/unit/kiro-computer-history-audit.test.ts` — metadata sanitization, bounded audit/history restore.
- `tests/e2e/kiro-computer-agent-v1.spec.ts` — focused Sandbox approval → modify → review → Undo flow.

### Modify
- `lib/ai/computer/types.ts` — reuse existing public types; add only shared non-sensitive identifiers required by task/change views.
- `lib/ai/computer/result.ts` — separate model-safe `ComputerToolResult` from runtime-only execution metadata.
- `lib/ai/computer/executor.ts` — emit approval-required attempt without mutation; support exact one-shot approval; return runtime change/checkpoint data after verified mutation.
- `lib/ai/computer/adapters/types.ts` — add runtime-only `removeResource` method used solely by checkpoint restoration.
- `lib/ai/computer/adapters/browser.ts` — use grant-store accessor; implement safe non-recursive runtime remove.
- `lib/ai/computer/adapters/sandbox.ts` — implement runtime remove with explicit directory-empty checks.
- `lib/ai/computer/workspace/grants.ts` — export runtime-only directory-handle accessor; keep picker/requestPermission boundaries unchanged.
- `store/useKiroComputerStore.ts` — use existing persistent/session permission-rule actions; ensure session rules remain excluded from persistence.
- `hooks/useKiroChat.ts` — approval pause/resume orchestration, current Computer task ownership, checkpoint registry, message binding, history/audit writes, task-level Undo, regenerate guard UX integration.
- `components/kiro/KiroChatSurface.tsx` — mount approval/review UI and pass task actions.
- `components/kiro/KiroConversation.tsx` — render Computer task/card inside the owning assistant message instead of global turn footer.
- `components/kiro/computer/KiroComputerActionCard.tsx` — become a child display surface for task changes; add review affordance only from runtime facts.
- `components/settings/KiroAgentSettings.tsx` — show recent activity via `KiroComputerAuditPanel`; do not change agent-mode policy semantics.
- `lib/ai/tools/mutating.ts` — preserve Part 2 Computer mutation regenerate classification.
- `tests/unit/kiro-computer-tools.test.ts` — adapt executor result shape and verify ask never mutates before approval.

---

## Core Interfaces

### Approval

```ts
export type ComputerApprovalDecision =
  | "deny"
  | "allow-once"
  | "allow-session"
  | "allow-workspace";

export interface ComputerApprovalRequest {
  id: string;
  toolCallId: string;
  taskId: string;
  capability: ComputerCapability;
  risk: ComputerRisk;
  workspaceId: string;
  workspaceLabel: string;
  rootId?: string;
  rootLabel?: string;
  relativePath?: string;
  resourceLabel: string;
  description: string;
  allowedDecisions: ComputerApprovalDecision[];
}

export interface ComputerOneShotApproval {
  approvalId: string;
  toolCallId: string;
  capability: ComputerCapability;
  workspaceId: string;
  rootId?: string;
  relativePath?: string;
}
```

`allow-once` is an in-memory exact-match token. It never becomes a permission rule.

`allow-session` creates:

```ts
{
  id: `computer-rule-${crypto.randomUUID()}`,
  effect: "allow",
  capability,
  workspaceId,
  rootId,
  resourcePattern: relativePath,
  scope: "session"
}
```

`allow-workspace` creates a persistent workspace-scoped capability rule and deliberately omits `resourcePattern`:

```ts
{
  id: `computer-rule-${crypto.randomUUID()}`,
  effect: "allow",
  capability,
  workspaceId,
  scope: "persistent"
}
```

Do not create allow rules for any hard-denied capability.

### Execution split

```ts
export type ComputerExecutionAttempt =
  | {
      kind: "completed";
      output: ComputerToolResult;
      runtime?: ComputerRuntimeMutation;
    }
  | {
      kind: "approval-required";
      request: ComputerApprovalRequest;
    };
```

`output` is the only part passed to `chat.addToolOutput`. `runtime` is never sent to the model.

### Task / change

```ts
export type KiroAgentTaskStatus =
  | "running"
  | "awaiting_permission"
  | "completed"
  | "failed"
  | "cancelled"
  | "undone"
  | "undo_failed";

export interface KiroAgentTaskStep {
  id: string;
  toolCallId: string;
  label: string;
  status: "running" | "awaiting_permission" | "done" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
}

export interface KiroComputerChange {
  id: string;
  toolCallId: string;
  operation: "create" | "modify";
  resourceType: "directory" | "text" | "document";
  workspaceId: string;
  workspaceLabel: string;
  rootId: string;
  rootLabel: string;
  relativePath: string;
  displayName: string;
  format?: "markdown" | "docx";
  size?: number;
  verification: "passed";
  review:
    | { kind: "create"; preview?: string }
    | { kind: "text-patch"; edits: Array<{ before: string; after: string }> }
    | {
        kind: "document";
        title?: string;
        headings: string[];
        paragraphs: number;
        lists: number;
        tables: number;
        codeBlocks: number;
        characters: number;
      };
}

export interface KiroAgentTask {
  id: string;
  conversationId: string | null;
  userMessageId: string;
  assistantMessageId?: string;
  title: string;
  status: KiroAgentTaskStatus;
  steps: KiroAgentTaskStep[];
  changes: KiroComputerChange[];
  toolCallIds: string[];
  canUndo: boolean;
  undoUsed: boolean;
  startedAt: string;
  completedAt?: string;
}
```

Persisted history must use a narrower display-only type; do not persist `review.edits`, preview text, checkpoints, adapter refs, handles, or snapshots.

### Checkpoint

```ts
export type ComputerInverseOperation =
  | {
      type: "remove-created";
      workspaceId: string;
      rootId: string;
      relativePath: string;
      resourceType: "file" | "directory";
    }
  | {
      type: "restore-text";
      workspaceId: string;
      rootId: string;
      relativePath: string;
      beforeText: string;
    };

export interface ComputerTaskCheckpoint {
  taskId: string;
  inverses: ComputerInverseOperation[];
  used: boolean;
}
```

Undo executes inverses in reverse order and verifies each inverse before moving to the next.

---

### Task 1: Approval Lifecycle + Grant Store Boundary

**Files:**
- Create: `lib/ai/computer/approval.ts`
- Create: `store/useKiroComputerRuntimeStore.ts`
- Modify: `lib/ai/computer/result.ts`
- Modify: `lib/ai/computer/executor.ts`
- Modify: `lib/ai/computer/workspace/grants.ts`
- Modify: `lib/ai/computer/adapters/browser.ts`
- Modify: `hooks/useKiroChat.ts`
- Create: `components/kiro/computer/ComputerApprovalDialog.tsx`
- Modify: `components/kiro/KiroChatSurface.tsx`
- Test: `tests/unit/kiro-computer-approval.test.ts`
- Test: `tests/unit/kiro-computer-tools.test.ts`

**Produces:** interactive ask-policy flow where no tool output is sent and no mutation occurs until the user decides.

- [ ] **Step 1: Add failing approval tests**

Cover all of the following:

```ts
// guided patch -> approval-required, target unchanged
expect(attempt.kind).toBe("approval-required");
expect(await readTarget()).toBe(before);

// allow-once only matches same toolCall/capability/workspace/root/path
expect(matchesOneShotApproval(grant, exactContext)).toBe(true);
expect(matchesOneShotApproval(grant, differentPath)).toBe(false);

// hard deny can never be converted to approval-required/allow
expect(evaluate(... "fs.delete" ...).effect).toBe("deny");

// session rule is not persistent
expect(rule.scope).toBe("session");

// workspace rule is capability + workspace scoped
expect(rule.resourcePattern).toBeUndefined();
```

- [ ] **Step 2: Run only approval/tools tests and confirm RED**

```bash
npx vitest run tests/unit/kiro-computer-approval.test.ts tests/unit/kiro-computer-tools.test.ts
```

- [ ] **Step 3: Centralize Browser handle lookup in `workspace/grants.ts`**

Export a runtime-only accessor such as:

```ts
export async function getBrowserWorkspaceDirectoryHandle(
  adapterRef: string
): Promise<DirectoryHandleLike | null>;
```

`showDirectoryPicker()` remains only in `chooseBrowserWorkspaceDirectory()`. `requestPermission()` remains only in the explicit re-authorization helper. Remove duplicated grant DB/store/version constants and direct IndexedDB lookup from `adapters/browser.ts`.

- [ ] **Step 4: Implement approval helpers**

`buildComputerApprovalRequest()` receives trusted executor/preflight facts plus `toolCallId/taskId`. It builds only safe logical labels/path. `buildPermissionRuleFromDecision()` returns a rule only for `allow-session` or `allow-workspace`. `allow-once` produces an exact in-memory grant. `deny` produces neither.

- [ ] **Step 5: Refactor executor return shape**

`executeKiroComputerTool()` receives `toolCallId`, `taskId`, and optional `oneShotApproval`.

Mandatory logic:

```text
schema
→ frozen snapshot/live workspace
→ path/sandbox
→ policy
→ hard deny => completed false output
→ ask + no matching one-shot => approval-required (NO IO)
→ ask + exact matching one-shot => continue
→ live grant/adapter
→ execute
→ verify
→ completed
```

A one-shot grant must not skip a later live grant check, read-only check, sandbox check, or verification.

- [ ] **Step 6: Implement non-persisted approval UI state**

`useKiroComputerRuntimeStore` holds only serializable UI facts:

```ts
pendingApproval: ComputerApprovalRequest | null
reviewTaskId: string | null
```

It must not persist and must not hold callbacks, file handles, adapter refs, snapshots, text before-images, or bytes.

The actual pending execution context stays in `useKiroChat` refs keyed by `approvalId`.

- [ ] **Step 7: Pause/resume the exact tool call in `useKiroChat`**

On `approval-required`:

1. Do not call `chat.addToolOutput`.
2. Record the safe request in the runtime store.
3. Keep `{ toolCallId, toolName, original input, frozen snapshot, taskId }` in a hook ref.
4. Mark the task/step `awaiting_permission`.

On decision:

- `deny`: send one final false tool output with `USER_CANCELLED`; do not execute.
- `allow-once`: rerun exact call with exact one-shot grant, then add its real output.
- `allow-session`: add session rule to `useKiroComputerStore`, rerun exact call through normal policy, then add its real output.
- `allow-workspace`: add persistent workspace rule, rerun exact call through normal policy, then add its real output.

If workspace/grant was revoked while waiting, the resumed executor must fail normally.

- [ ] **Step 8: Build dedicated approval dialog**

Use shared `Dialog`; do not reuse the destructive `ConfirmDialog`.

Show:

```text
Kiro 请求文件权限
修改已有文件
notes.md
论文研究 / output

[拒绝]
[允许这一次]
[本次会话允许]
[此 Workspace 始终允许]
```

Only render decisions contained in `allowedDecisions`. The UI cannot manufacture stronger permission choices than the request permits.

- [ ] **Step 9: Cancellation cleanup**

Stop/new conversation/session switch/unmount must clear the visible approval and pending execution ref. Never execute a stale approval against a different turn/session.

- [ ] **Step 10: Run targeted tests and commit**

```bash
npx vitest run tests/unit/kiro-computer-approval.test.ts tests/unit/kiro-computer-tools.test.ts

git add lib/ai/computer store/useKiroComputerRuntimeStore.ts hooks/useKiroChat.ts components/kiro tests/unit/kiro-computer-approval.test.ts tests/unit/kiro-computer-tools.test.ts
git commit -m "feat(kiro): add interactive computer approvals"
```

---

### Task 2: Runtime Agent Tasks, Changes, Checkpoints, and Undo

**Files:**
- Create: `lib/ai/computer/task.ts`
- Create: `lib/ai/computer/checkpoints.ts`
- Modify: `lib/ai/computer/result.ts`
- Modify: `lib/ai/computer/executor.ts`
- Modify: `lib/ai/computer/adapters/types.ts`
- Modify: `lib/ai/computer/adapters/browser.ts`
- Modify: `lib/ai/computer/adapters/sandbox.ts`
- Modify: `hooks/useKiroChat.ts`
- Create: `components/kiro/computer/KiroAgentTaskCard.tsx`
- Create: `components/kiro/computer/KiroChangeReviewDialog.tsx`
- Modify: `components/kiro/computer/KiroComputerActionCard.tsx`
- Modify: `components/kiro/KiroConversation.tsx`
- Test: `tests/unit/kiro-computer-checkpoints.test.ts`

**Produces:** each Computer turn has one factual task with steps/changes and one task-level Undo checkpoint.

- [ ] **Step 1: Add failing task/checkpoint tests**

Cover:

- create text → inverse removes created file;
- create DOCX → inverse removes created file;
- create directory → inverse removes only that empty created directory;
- patch text → inverse restores exact previous text;
- mixed task Undo executes reverse order;
- Undo twice is rejected;
- external/unrelated content prevents unsafe directory removal;
- revoked grant causes Undo failure rather than false success;
- verified state after every inverse.

- [ ] **Step 2: Add runtime-only adapter remove**

Extend `ComputerAdapter` with:

```ts
removeResource(
  resource: ResolvedComputerResource,
  options: { kind: "file" | "directory" }
): Promise<void>;
```

This method is not exported as a model tool.

Browser implementation uses `removeEntry(name)` with no recursive deletion. Sandbox deletes exactly one file record or an empty directory record; non-empty directory removal fails.

- [ ] **Step 3: Return runtime mutation metadata separately from model-safe output**

For each verified mutation, executor returns runtime-only facts:

- create directory/file/document → `remove-created` inverse;
- patch → full pre-write `beforeText` inverse, capped by the existing 1 MiB patch limit;
- text patch review → exact edit pairs;
- text create preview → first 2000 characters only;
- document review → structural facts derived from validated Document IR, not model prose.

None of this runtime payload is included in `chat.addToolOutput`.

- [ ] **Step 4: Implement task reducer/helpers**

Task creation occurs at user send only when the frozen Computer snapshot is enabled. The initial title may be the first 60 visible characters of the user's request; this is display text only, not authority.

Each Computer tool call appends a factual step using a fixed tool-name label map:

```text
list/search/grep/read       → 查看/搜索/读取工作区
create_directory            → 创建目录
create_text_file            → 创建文件
patch_text_file             → 修改文件
create_document             → 创建文档
inspect_document            → 检查文档
```

Do not expose raw input JSON in the step UI.

- [ ] **Step 5: Bind task/actions to the owning assistant message**

Remove the Part 2 turn-global `computerActions` footer path.

Track the task's `toolCallIds`. When building `KiroChatMessageView`, attach the live task to the assistant message whose tool-call parts contain those ids. Historical restored task views are keyed by assistant message id.

`KiroConversationRow` renders `KiroAgentTaskCard` inside that assistant message alongside existing worklog/action surfaces.

- [ ] **Step 6: Build Change Review**

`KiroAgentTaskCard` shows status, number of verified changes, and buttons:

```text
[查看更改]
[撤销本次更改]  // only when canUndo && !undoUsed && task completed
```

`KiroChangeReviewDialog` groups changes:

- created directory/file: logical location + size/preview if available;
- text patch: each exact before/after pair, with UI truncation at 2000 chars per side;
- DOCX/Markdown document: title/headings/count facts;
- no native path/adapterRef.

- [ ] **Step 7: Implement task-level Undo**

Checkpoint registry lives in a hook/runtime ref keyed by taskId, not persisted Zustand/history.

`undoComputerTask(taskId)`:

```text
load checkpoint
→ reject used
→ resolve each live workspace/root
→ execute inverse operations in reverse
→ verify each inverse
→ mark checkpoint used
→ mark task undone
→ append audit entries
```

If any inverse fails, stop, mark `undo_failed`, report exact safe error, and never claim full rollback succeeded.

- [ ] **Step 8: Run targeted checkpoint test and existing tool tests**

```bash
npx vitest run tests/unit/kiro-computer-checkpoints.test.ts tests/unit/kiro-computer-tools.test.ts
```

- [ ] **Step 9: Commit**

```bash
git add lib/ai/computer hooks/useKiroChat.ts components/kiro tests/unit/kiro-computer-checkpoints.test.ts tests/unit/kiro-computer-tools.test.ts
git commit -m "feat(kiro): add computer task review and undo"
```

---

### Task 3: Audit, Display-Only History, Regenerate Safety, and Settings Activity

**Files:**
- Create: `lib/ai/computer/audit.ts`
- Create: `lib/ai/computer/history.ts`
- Create: `components/settings/KiroComputerAuditPanel.tsx`
- Modify: `components/settings/KiroAgentSettings.tsx`
- Modify: `hooks/useKiroChat.ts`
- Modify: `components/kiro/KiroConversation.tsx`
- Modify: `components/kiro/computer/KiroAgentTaskCard.tsx`
- Test: `tests/unit/kiro-computer-history-audit.test.ts`

**Produces:** bounded metadata audit + restored non-sensitive Computer task cards; restored tasks never regain executable Undo state.

- [ ] **Step 1: Add failing audit/history tests**

Audit sanitizer must reject/strip keys named or shaped like:

```text
adapterRef
absolutePath
nativePath
handle
fileBytes
beforeText
content
permissionToken
```

History view includes only:

```ts
{
  taskId,
  assistantMessageId,
  title,
  status,
  changes: [
    {
      operation,
      resourceType,
      displayName,
      workspaceLabel,
      rootLabel,
      relativePath,
      format,
      size,
      changeCount,
      verification
    }
  ],
  canUndo: false,
  startedAt,
  completedAt
}
```

Write 510 audit records and verify only the newest 500 remain.

- [ ] **Step 2: Implement bounded audit store**

Use IndexedDB `classflow-kiro-computer-audit-v1`, store `entries`. Append after policy decision and after final execution/Undo outcome. Store metadata only.

Minimum entry:

```ts
{
  id,
  timestamp,
  taskId,
  conversationId,
  toolCallId,
  toolName,
  capability,
  decision: "allow" | "ask" | "deny",
  outcome: "completed" | "cancelled" | "failed" | "undone",
  workspaceId,
  workspaceLabel,
  rootId,
  rootLabel,
  relativePath,
  verification?: "passed" | "failed"
}
```

No content snapshots.

- [ ] **Step 3: Implement display-only Computer history store**

Use IndexedDB `classflow-kiro-computer-history-v1`, store `tasks`, keyed by `${conversationId}:${assistantMessageId}`.

Persist/update only after an assistant message id is known. On history restore, load display-only task views into `restoredComputerTasksRef` and attach them to the corresponding `KiroChatMessageView`.

Restored views always set `canUndo=false`; checkpoint data is session-runtime only.

- [ ] **Step 4: Add recent activity to Settings**

`KiroComputerAuditPanel` loads the latest 10 entries and presents compact rows such as:

```text
已允许 · 修改文件 · notes.md
论文研究 / output · 14:32
```

Provide a user-only `清除活动记录` action. Clearing audit metadata does not alter files, workspaces, permission rules, or conversation history.

- [ ] **Step 5: Regenerate safety**

Keep Computer mutation tool names in `KIRO_MUTATING_TOOL_NAMES` and preserve `canRegenerate=false` for a turn that performed a mutation.

Do not add an automatic replay path. If the existing Kiro UI exposes regenerate for a restored/current Computer-mutating turn due to another code path, force it disabled and use existing disabled-reason copy or a concise Computer-specific reason:

```text
该回复已修改工作区文件，不能直接重新生成。
```

Pure Computer read-only turns remain eligible under existing rules.

- [ ] **Step 6: Run history/audit tests**

```bash
npx vitest run tests/unit/kiro-computer-history-audit.test.ts tests/unit/kiro-computer-checkpoints.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add lib/ai/computer components/settings components/kiro hooks/useKiroChat.ts tests/unit/kiro-computer-history-audit.test.ts
git commit -m "feat(kiro): persist safe computer activity metadata"
```

---

### Task 4: Full V1 Focused Regression and Security Audit

**Files:**
- Create: `tests/e2e/kiro-computer-agent-v1.spec.ts`
- Modify: `tests/unit/kiro-computer-approval.test.ts`
- Modify: `tests/unit/kiro-computer-checkpoints.test.ts`
- Modify: `tests/unit/kiro-computer-history-audit.test.ts`
- Modify: `tests/unit/kiro-computer-tools.test.ts` only for real integration regressions found during this task.

- [ ] **Step 1: Write one focused Sandbox E2E**

Use Sandbox so CI does not need native directory permission.

Scenario:

1. Open Kiro and enable Computer Sandbox.
2. Set `workspace-auto`; ask Kiro to create `notes.md` with known content. Confirm a verified Computer task/action appears inside the assistant message.
3. Switch to `guided`; ask Kiro to modify the existing file through `patch_text_file`.
4. Confirm `ComputerApprovalDialog` appears and the task status says awaiting permission.
5. Choose `允许这一次`.
6. Confirm the same task resumes, verified modification appears, and approval dialog disappears.
7. Open `查看更改`; confirm before/after text appears.
8. Click `撤销本次更改`; confirm task changes to undone and a direct `read_text`/UI-visible runtime check shows original content restored.
9. Reload/switch away-and-back using the existing Kiro session flow; confirm the historical Computer task card restores as display-only and does not offer executable Undo.

Do not create screenshot assertions.

- [ ] **Step 2: Run targeted Vitest**

```bash
npx vitest run \
  tests/unit/kiro-computer-approval.test.ts \
  tests/unit/kiro-computer-checkpoints.test.ts \
  tests/unit/kiro-computer-history-audit.test.ts \
  tests/unit/kiro-computer-tools.test.ts
```

- [ ] **Step 3: Run only the Part 3 Computer E2E**

```bash
npx playwright test tests/e2e/kiro-computer-agent-v1.spec.ts
```

Do not run the full Kiro/Playwright suite.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Static security audit**

```bash
grep -R -n \
  "FileSystemDirectoryHandle\|adapterRef\|absolutePath\|nativePath\|beforeText\|fileBytes\|showDirectoryPicker\|run_shell\|PowerShell\|delete_file\|delete_directory" \
  app hooks lib/ai/computer store components/kiro components/settings
```

Review every hit. Expected sensitive uses:

- handle / adapterRef: workspace metadata, grants, adapter/executor runtime only;
- `beforeText`: checkpoint runtime/tests only;
- `showDirectoryPicker`: explicit workspace grant helper only;
- no model-facing shell/delete tools.

Also confirm approval UI/store/history/audit files contain no handle/adapterRef/native path or raw snapshot persistence.

- [ ] **Step 6: Build policy**

Skip `npm run build` by default. Run it only for a demonstrated Next/client-server bundling issue not covered by typecheck.

- [ ] **Step 7: Final commit if regression fixes were required**

```bash
git add tests lib/ai/computer hooks components store
git commit -m "fix(kiro): harden computer agent v1 lifecycle"
```

If there are no post-verification code changes, do not create an empty commit.

---

## Part 3 Acceptance

### Approval
- [ ] `ask` pauses without mutation and without model tool output.
- [ ] deny never executes.
- [ ] allow-once matches only the exact pending tool call/resource/capability.
- [ ] session permission is in-memory only.
- [ ] workspace permission is persistent and workspace-scoped.
- [ ] hard deny/read-only/path/grant boundaries remain non-overridable.
- [ ] stale approvals are cancelled on stop/session switch/unmount.

### Agent Task / Change Review
- [ ] one Computer task per Computer-enabled user turn.
- [ ] steps are factual tool activity, not hidden reasoning.
- [ ] task is bound to the owning assistant message/toolCallIds.
- [ ] Part 2 global `computerActions` footer path is removed.
- [ ] text patch review shows real exact before/after edits.
- [ ] document review derives from structured document facts.
- [ ] no native path/adapterRef in review UI.

### Checkpoint / Undo
- [ ] create file/document/directory can be undone through runtime-only removal.
- [ ] patch can restore exact before text.
- [ ] task Undo runs reverse order and verifies every inverse.
- [ ] no recursive directory delete.
- [ ] checkpoint can only be consumed once.
- [ ] Undo failure is explicit; no false full-success claim.
- [ ] checkpoint/snapshot data is not persisted to chat/history/Zustand.

### Audit / History
- [ ] audit metadata store capped at 500.
- [ ] recent activity visible in Kiro Agent Settings.
- [ ] conversation restore shows display-only Computer task/change facts.
- [ ] restored task cannot Undo.
- [ ] no content/bytes/handles/adapterRef/native path/snapshots in persisted metadata.

### Regenerate
- [ ] mutation turns remain non-regenerable.
- [ ] read-only Computer turns preserve normal regenerate behavior.
- [ ] no automatic replay of Computer mutations.

### Part 2 Structural Closeout
- [ ] Browser adapter no longer duplicates grant DB lookup/constants.
- [ ] grant handle access is centralized in `workspace/grants.ts`.

### Verification
- [ ] four targeted Vitest files pass.
- [ ] one focused Part 3 Computer E2E passes.
- [ ] `npm run typecheck` passes.
- [ ] build skipped by policy or justified/pass if run.

## Explicitly Deferred Beyond V1

- Model-facing delete/move/rename tools.
- App launch/open/reveal.
- Shell/PowerShell/cmd and Windows process sandbox.
- MCP/plugin computer capabilities.
- Arbitrary network permissions.
- Tauri/Windows native adapter.
- Parallel workers/background automations.
- Persistent executable checkpoints across browser restarts.
- Full binary/document diff editor.

Part 3 must STOP after V1 approval, task/review, session-level checkpoint/Undo, audit/history metadata, and focused regression are complete.
